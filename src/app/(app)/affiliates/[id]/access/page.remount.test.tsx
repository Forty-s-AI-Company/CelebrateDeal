// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Access = { vendorMemberId: string; revision: number; active: boolean; member: { id: string; role: string; status: string; user: { name: string; status: string } } } | null;

const mocks = vi.hoisted(() => ({
  affiliateFindFirst: vi.fn(),
  members: [
    { id: "m-partner", role: "partner", status: "active", user: { name: "Partner", status: "active" } },
    { id: "m-owner", role: "owner", status: "active", user: { name: "Owner", status: "active" } },
  ],
}));

vi.mock("@/lib/auth", () => ({ requireVendorManager: async () => ({ id: "vendor-1" }) }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    affiliate: { findFirst: mocks.affiliateFindFirst },
    vendorMember: {
      findFirst: async () => null,
      findMany: async ({ where }: { where: { role: string | { not: string } } }) =>
        mocks.members.filter((member) => (typeof where.role === "string" ? member.role === where.role : member.role !== where.role.not)),
    },
  }),
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); } }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));
vi.mock("@/app/actions/affiliate-portal-actions", () => ({ setAffiliatePortalAccessAction: vi.fn() }));

import AffiliateAccessPage from "./page";

let container: HTMLDivElement;
let root: Root;

function access(vendorMemberId: string, active: boolean, revision: number): Access {
  return { vendorMemberId, revision, active, member: mocks.members.find((member) => member.id === vendorMemberId)! };
}

/** Renders the page for the given stored access into the same client root, like a same-page redirect after the server action. */
async function show(portalAccess: Access, searchParams: Record<string, string> = {}) {
  mocks.affiliateFindFirst.mockResolvedValue({ name: "合作夥伴", portalAccess });
  const tree = await AffiliateAccessPage({ params: Promise.resolve({ id: "affiliate-1" }), searchParams: Promise.resolve(searchParams) });
  await act(async () => { root.render(tree); });
  return {
    select: container.querySelector<HTMLSelectElement>("select[name=vendorMemberId]")!,
    active: container.querySelector<HTMLInputElement>("input[name=active]")!,
    revision: container.querySelector<HTMLInputElement>("input[name=expectedRevision]")!,
  };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe("affiliate portal access form after saving", () => {
  it("selects the newly authorised member after the first save redirects back", async () => {
    const before = await show(null);
    expect(before.select.value).toBe("");
    expect(before.active.checked).toBe(true);

    const after = await show(access("m-owner", true, 1), { saved: "1" });
    expect(after.select.value).toBe("m-owner");
    expect(after.select.selectedOptions[0]?.textContent).toContain("Owner");
    expect(after.active.checked).toBe(true);
    expect(after.revision.value).toBe("1");
  });

  it("follows a change of member and a disabled portal on later saves", async () => {
    await show(access("m-partner", true, 3));
    const after = await show(access("m-owner", false, 4), { saved: "1" });
    expect(after.select.value).toBe("m-owner");
    expect(after.active.checked).toBe(false);
    expect(after.revision.value).toBe("4");
  });

  it("drops an unsaved selection once the stored access changes", async () => {
    const before = await show(access("m-partner", true, 1));
    before.select.value = "m-owner";
    before.active.checked = false;
    const after = await show(access("m-partner", true, 2), { saved: "1" });
    expect(after.select.value).toBe("m-partner");
    expect(after.active.checked).toBe(true);
  });
});
