"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireVendorOwner } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { LineRichMenuSchema } from "@/lib/line-rich-menu";

const ReferenceSchema = z.object({
  id: z.string().min(1).max(128),
  revision: z.number().int().min(1).max(2_147_483_646),
});
type DraftReference = z.infer<typeof ReferenceSchema>;
export type RichMenuActionState = {
  status: "idle" | "saved" | "deleted" | "error";
  error: "invalid_input" | "conflict" | "save_failed" | null;
  reference: DraftReference | null;
};

/** Every write is owner-scoped and compares both identity and revision to reject stale tabs. */
export async function updateRichMenuDraftAction(
  previous: RichMenuActionState,
  formData: FormData,
): Promise<RichMenuActionState> {
  await assertServerActionSecurity(formData);
  const { vendor } = await requireVendorOwner();
  // Prior action state is client-controlled; only echo a bounded reference, never use it for writes.
  const previousReference = ReferenceSchema.safeParse(previous?.reference);
  const fallbackReference = previousReference.success ? previousReference.data : null;
  const invalid = (): RichMenuActionState => ({ status: "error", error: "invalid_input", reference: fallbackReference });
  const id = formData.get("id");
  const rawRevision = formData.get("revision");
  if (typeof id !== "string" || typeof rawRevision !== "string" || !/^\d+$/.test(rawRevision)) return invalid();
  const parsed = ReferenceSchema.safeParse({ id, revision: Number(rawRevision) });
  if (!parsed.success && !(id === "" && rawRevision === "0")) return invalid();
  const reference = parsed.success ? parsed.data : null;
  const fail = (error: RichMenuActionState["error"]): RichMenuActionState => ({ status: "error", error, reference });
  const intent = formData.get("intent");
  if (intent !== "save" && intent !== "delete") return invalid();

  let result: RichMenuActionState;
  try {
    const db = getDb();
    if (intent === "delete") {
      if (!reference) return invalid();
      const deleted = await db.lineRichMenuDraft.deleteMany({ where: { vendorId: vendor.id, ...reference } });
      if (deleted.count !== 1) return fail("conflict");
      result = { status: "deleted", error: null, reference: null };
    } else {
      const raw = formData.get("menu");
      if (typeof raw !== "string" || raw.length > 40_000) return invalid();
      let value: unknown;
      try { value = JSON.parse(raw); } catch { return invalid(); }
      const menu = LineRichMenuSchema.safeParse(value);
      if (!menu.success) return invalid();
      if (reference) {
        const updated = await db.lineRichMenuDraft.updateMany({
          where: { vendorId: vendor.id, ...reference },
          data: { menu: menu.data, revision: { increment: 1 } },
        });
        if (updated.count !== 1) return fail("conflict");
        result = { status: "saved", error: null, reference: { id: reference.id, revision: reference.revision + 1 } };
      } else {
        // A unique vendor key makes simultaneous first saves conflict instead of creating orphan drafts.
        const created = await db.lineRichMenuDraft.create({
          data: { vendorId: vendor.id, menu: menu.data }, select: { id: true, revision: true },
        });
        result = { status: "saved", error: null, reference: created };
      }
    }
  } catch (error) {
    return fail(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" ? "conflict" : "save_failed");
  }
  revalidatePath("/settings/line");
  return result;
}
