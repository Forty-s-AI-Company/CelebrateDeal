import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { createRichMenuTemplate } from "@/lib/line-rich-menu";
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorOwner: mocks.auth }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { updateRichMenuDraftAction, type RichMenuActionState } from "@/app/actions/line-rich-menu-actions";

const vendorIds: string[] = [];
const initial: RichMenuActionState = { status: "idle", error: null, reference: null };
function form(reference: RichMenuActionState["reference"] = null, intent = "save") {
  const data = new FormData();
  data.set("id", reference?.id ?? ""); data.set("revision", String(reference?.revision ?? 0)); data.set("intent", intent);
  data.set("menu", JSON.stringify(createRichMenuTemplate("minimal-4")));
  return data;
}
async function vendor() {
  const suffix = crypto.randomUUID();
  const row = await getDb().vendor.create({ data: { name: "Synthetic rich menu owner", slug: `menu-${suffix}`, email: `menu-${suffix}@example.test`, passwordHash: "synthetic-test-only" } });
  vendorIds.push(row.id);
  return row;
}
afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

describe("LINE draft PostgreSQL isolation and compare-and-swap", () => {
  it("enables RLS without public policies on the draft table", async () => {
    const rows = await getDb().$queryRaw<Array<{ relrowsecurity: boolean; policies: bigint }>>`
      SELECT c.relrowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c WHERE c.oid = '"LineRichMenuDraft"'::regclass
    `;
    expect(rows).toEqual([{ relrowsecurity: true, policies: BigInt(0) }]);
  });
  it("allows one first save and one writer per revision, rejects stale deletion and old identities after recreation", async () => {
    const owner = await vendor(); mocks.auth.mockResolvedValue({ vendor: { id: owner.id } });
    const created = await Promise.all([updateRichMenuDraftAction(initial, form()), updateRichMenuDraftAction(initial, form())]);
    expect(created.map((r) => r.status).sort()).toEqual(["error", "saved"]);
    expect(created.find((r) => r.status === "error")?.error).toBe("conflict");
    const reference = created.find((r) => r.status === "saved")!.reference;
    const updates = await Promise.all([updateRichMenuDraftAction(initial, form(reference)), updateRichMenuDraftAction(initial, form(reference))]);
    expect(updates.map((r) => r.status).sort()).toEqual(["error", "saved"]);
    expect(await updateRichMenuDraftAction(initial, form(reference, "delete"))).toMatchObject({ error: "conflict" });
    const current = updates.find((r) => r.status === "saved")!.reference;
    expect(await updateRichMenuDraftAction(initial, form(current, "delete"))).toMatchObject({ status: "deleted" });
    const recreated = await updateRichMenuDraftAction(initial, form());
    expect(recreated.status).toBe("saved");
    expect(recreated.reference?.id).not.toBe(reference?.id);
    expect(await updateRichMenuDraftAction(initial, form(reference))).toMatchObject({ error: "conflict" });
    expect(await getDb().lineRichMenuDraft.findUnique({ where: { vendorId: owner.id } })).toMatchObject({ ...recreated.reference, menu: createRichMenuTemplate("minimal-4") });
  });
  it("prevents another tenant from updating or deleting a known draft and cascades only its owner", async () => {
    const a = await vendor(); const b = await vendor();
    mocks.auth.mockResolvedValue({ vendor: { id: a.id } });
    const draft = await updateRichMenuDraftAction(initial, form());
    mocks.auth.mockResolvedValue({ vendor: { id: b.id } });
    for (const intent of ["save", "delete"]) expect(await updateRichMenuDraftAction(initial, form(draft.reference, intent))).toMatchObject({ error: "conflict" });
    expect(await getDb().lineRichMenuDraft.findUnique({ where: { vendorId: a.id } })).toMatchObject({ revision: 1 });
    await getDb().vendor.delete({ where: { id: b.id } });
    expect(await getDb().lineRichMenuDraft.count({ where: { vendorId: a.id } })).toBe(1);
    await getDb().vendor.delete({ where: { id: a.id } });
    expect(await getDb().lineRichMenuDraft.count({ where: { vendorId: a.id } })).toBe(0);
  });
});
