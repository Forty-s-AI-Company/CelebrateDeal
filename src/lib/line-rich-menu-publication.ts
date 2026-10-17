import { createHash } from "node:crypto";
import sharp from "sharp";
import { LineRichMenuSchema, type LineRichMenu } from "@/lib/line-rich-menu";
import type { LineRichMenuClient } from "@/lib/line-rich-menu-client";

export const LINE_RICH_MENU_IMAGE_LIMIT = 1_000_000;
export const LINE_RICH_MENU_PLACEHOLDERS = ["live_url", "consultation_url", "portal_url", "voucher_url"] as const;
export type RichMenuLinks = Partial<Record<typeof LINE_RICH_MENU_PLACEHOLDERS[number], string>>;
export type PreparedLineRichMenu = { menu: LineRichMenu; image: Buffer; contentType: "image/png" | "image/jpeg"; fingerprint: string };
export type RichMenuPreparation = { status: "ready"; publication: PreparedLineRichMenu }
  | { status: "invalid_menu" | "unresolved_links" | "invalid_image" | "image_too_large" | "image_size_mismatch" };

/** Validate bytes locally; never fetch merchant URLs or turn a draft into a sync claim. */
export async function prepareLineRichMenuPublication(input: unknown, imageBytes: Uint8Array, links: RichMenuLinks): Promise<RichMenuPreparation> {
  const parsed = LineRichMenuSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid_menu" };
  const menu = parsed.data;
  for (const area of menu.areas) {
    if (area.action.type !== "uri") continue;
    const placeholder = /^\{\{(live_url|consultation_url|portal_url|voucher_url)\}\}$/u.exec(area.action.uri);
    if (placeholder) {
      const replacement = links[placeholder[1] as keyof RichMenuLinks];
      if (typeof replacement !== "string" || !replacement.trim()) return { status: "unresolved_links" };
      area.action.uri = replacement;
    }
    if (area.action.uri.includes("{{") || area.action.uri.includes("}}")) return { status: "unresolved_links" };
  }
  const resolved=LineRichMenuSchema.safeParse(menu);
  if (!resolved.success) return { status: "invalid_menu" };
  if (imageBytes.byteLength > LINE_RICH_MENU_IMAGE_LIMIT) return { status: "image_too_large" };
  // Do not pass SVG, external references or other formats into the decoder.
  const image = Buffer.from(imageBytes);
  const png = image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = image.length >= 3 && image[0] === 255 && image[1] === 216 && image[2] === 255;
  if (!png && !jpeg) return { status: "invalid_image" };
  try {
    const decoder = sharp(image, { limitInputPixels: 2500 * 1686, failOn: "warning" });
    const metadata = await decoder.metadata();
    if ((metadata.format !== "png" && metadata.format !== "jpeg") || (metadata.pages ?? 1) !== 1 || (metadata.orientation ?? 1) !== 1) return { status: "invalid_image" };
    if (metadata.width !== menu.size.width || metadata.height !== menu.size.height) return { status: "image_size_mismatch" };
    // Metadata alone can succeed on a truncated file; require a complete decode.
    await decoder.raw().toBuffer();
    const imageHash = createHash("sha256").update(image).digest("hex");
    const fingerprint = createHash("sha256").update(`line-rich-menu-v1:${JSON.stringify(resolved.data)}:${imageHash}`).digest("hex");
    return { status: "ready", publication: { menu:resolved.data, image, contentType: png ? "image/png" : "image/jpeg", fingerprint } };
  } catch { return { status: "invalid_image" }; }
}

type PublicationStage = "read_default" | "create" | "upload" | "check_current" | "set_default" | "confirm";
export type RichMenuPublicationResult = {
  status: "synced" | "conflict" | "failed" | "uncertain";
  stage: PublicationStage;
  remoteMenuId: string | null;
  previousMenuId: string | null;
  previousDefaultKnown: boolean;
  fingerprint: string;
};

/**
 * One attempt only. The caller must own the tenant resource and provide an
 * authoritative revision/lease check. It must still persist this result with CAS.
 * Never delete remote resources or restore defaults after an uncertain outcome.
 */
export async function publishPreparedLineRichMenu(
  client: LineRichMenuClient,
  publication: PreparedLineRichMenu,
  isCurrent: () => Promise<boolean>,
  onProgress: (result: RichMenuPublicationResult) => Promise<void> = async () => {},
): Promise<RichMenuPublicationResult> {
  let stage: PublicationStage = "check_current";
  let remoteMenuId: string | null = null,previousMenuId: string | null = null,previousDefaultKnown = false;
  const result = (status: RichMenuPublicationResult["status"]): RichMenuPublicationResult => ({ status,stage,remoteMenuId,previousMenuId,previousDefaultKnown,fingerprint:publication.fingerprint });
  try {
    if (!await isCurrent()) return result("conflict");
    stage="read_default";previousMenuId=await client.getDefault();previousDefaultKnown=true;
    await onProgress(result("uncertain"));
    stage="check_current";if (!await isCurrent()) return result("conflict");
    stage="create";remoteMenuId=await client.create(publication.menu);
    await onProgress(result("uncertain"));
    stage="upload";await client.uploadImage(remoteMenuId,publication.image,publication.contentType);
    stage="check_current";if (!await isCurrent()) return result("conflict");
    if (await client.getDefault() !== previousMenuId) return result("conflict");
    // Persist intent before sending; a failed checkpoint must not claim a request was sent.
    await onProgress({...result("uncertain"),stage:"set_default"});
    stage="set_default";await client.setDefault(remoteMenuId);
    stage="confirm";
    if (await client.getDefault() !== remoteMenuId) return result("uncertain");
    if (!await isCurrent()) return result("uncertain");
    return result("synced");
  } catch {
    // A create or upload timeout may have left an artifact even before a default
    // switch. Keep it uncertain so a caller cannot blindly repeat the operation.
    return result(stage === "read_default" || (stage === "check_current" && remoteMenuId === null) ? "failed" : "uncertain");
  }
}
