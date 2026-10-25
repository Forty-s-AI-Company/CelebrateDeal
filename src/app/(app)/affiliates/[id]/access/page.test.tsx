import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Member = { id: string; vendorId: string; role: string; status: string; user: { name: string; status: string } };
type Where = { vendorId?: string; status?: string; role?: string | { not: string }; id?: string | { gt: string } };

const state = vi.hoisted(() => ({ members: [] as Member[], wheres: [] as Where[] }));
const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  affiliateFindFirst: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
}));

function matches(member: Member, where: Where) {
  if (where.vendorId !== member.vendorId || where.status !== member.status) return false;
  if (typeof where.role === "string" && member.role !== where.role) return false;
  if (where.role && typeof where.role === "object" && member.role === where.role.not) return false;
  if (typeof where.id === "string" && member.id !== where.id) return false;
  if (where.id && typeof where.id === "object" && !(member.id > where.id.gt)) return false;
  return true;
}

vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    affiliate: { findFirst: mocks.affiliateFindFirst },
    vendorMember: {
      findFirst: async ({ where }: { where: Where }) => { state.wheres.push(where); return state.members.find((member) => matches(member, where)) ?? null; },
      findMany: async ({ where, take }: { where: Where; take: number }) => {
        state.wheres.push(where);
        return state.members.filter((member) => matches(member, where)).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, take);
      },
    },
  }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));
vi.mock("@/app/actions/affiliate-portal-actions", () => ({ setAffiliatePortalAccessAction: vi.fn() }));

import AffiliateAccessPage from "./page";

function member(id: string, role: string, vendorId = "vendor-1"): Member {
  return { id, vendorId, role, status: "active", user: { name: `name-${id}`, status: "active" } };
}

async function render(searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(await AffiliateAccessPage({ params: Promise.resolve({ id: "affiliate-1" }), searchParams: Promise.resolve(searchParams) }));
}

/** Option values of the member select, in display order. */
function optionIds(html: string) {
  return [...html.matchAll(/<option value="([^"]*)"/g)].map((match) => match[1]).filter(Boolean);
}

function nextCursor(html: string) {
  const match = /cursor=([^"&]+)"/.exec(html);
  return match ? decodeURIComponent(match[1]!) : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.wheres = [];
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.affiliateFindFirst.mockResolvedValue({ name: "合作夥伴", portalAccess: null });
});

describe("affiliate portal access member list", () => {
  it("lists partners first, then the other roles, with role labels", async () => {
    state.members = [member("a-owner", "owner"), member("b-partner", "partner"), member("c-support", "support"), member("d-partner", "partner"), member("z-foreign", "partner", "vendor-2")];
    const html = await render();
    expect(optionIds(html)).toEqual(["b-partner", "d-partner", "a-owner", "c-support"]);
    expect(html).toContain("name-b-partner（夥伴）");
    expect(html).toContain("name-c-support（Support（客服））");
    expect(nextCursor(html)).toBeNull();
    // Every member query is bound to the session vendor and active members.
    expect(state.wheres.every((where) => where.vendorId === "vendor-1" && where.status === "active")).toBe(true);
  });

  it("pages through partners before the other roles without skipping or repeating anyone", async () => {
    const partners = Array.from({ length: 30 }, (_, index) => member(`p${String(index).padStart(2, "0")}`, "partner"));
    const others = Array.from({ length: 30 }, (_, index) => member(`a${String(index).padStart(2, "0")}`, index % 2 ? "support" : "accountant"));
    state.members = [...others, ...partners];

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const html = await render(cursor ? { cursor } : {});
      seen.push(...optionIds(html));
      cursor = nextCursor(html);
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    expect(seen).toEqual([...partners.map((row) => row.id), ...others.map((row) => row.id).sort()]);
  });

  it("switches to the other roles right after the last partner on a full page", async () => {
    state.members = [...Array.from({ length: 25 }, (_, index) => member(`p${String(index).padStart(2, "0")}`, "partner")), member("a-admin", "admin")];
    const first = await render();
    expect(optionIds(first)).toHaveLength(25);
    expect(nextCursor(first)).toBe("p.p24");
    expect(optionIds(await render({ cursor: "p.p24" }))).toEqual(["a-admin"]);
  });

  it.each(["p24", "x.p24", "p.", "p.bad id"])("rejects a malformed cursor %j", async (cursor) => {
    state.members = [member("p24", "partner")];
    await expect(render({ cursor })).rejects.toThrow("not-found");
  });

  it("rejects a cursor naming the wrong group or another tenant's member", async () => {
    state.members = [member("p1", "partner"), member("o1", "owner"), member("f1", "partner", "vendor-2")];
    await expect(render({ cursor: "o.p1" })).rejects.toThrow("not-found");
    await expect(render({ cursor: "p.o1" })).rejects.toThrow("not-found");
    await expect(render({ cursor: "p.f1" })).rejects.toThrow("not-found");
    expect(optionIds(await render({ cursor: "p.p1" }))).toEqual(["o1"]);
  });
});
