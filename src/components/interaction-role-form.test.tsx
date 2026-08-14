import { renderToStaticMarkup } from "react-dom/server";
import type { InteractionRole } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({ upsertInteractionRoleAction: vi.fn() }));

import { InteractionRoleForm } from "./interaction-role-form";

function role(overrides: Partial<InteractionRole> = {}): InteractionRole {
  return {
    id: "role-1",
    vendorId: "vendor-1",
    name: "客服小幫手",
    avatarUrl: "https://cdn.example.test/avatar.svg",
    label: "客服助手",
    roleType: "support",
    tone: "溫和、清楚",
    isActive: false,
    isSimulated: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("InteractionRoleForm", () => {
  it("renders a safe create form with the default official role and hidden CSRF/avatar fields", () => {
    const html = renderToStaticMarkup(<InteractionRoleForm csrfToken="csrf-test-token" />);

    expect(html).toContain('name="_csrf" value="csrf-test-token"');
    expect(html).toContain('name="avatarUrl"');
    expect(html).not.toContain('name="id"');
    expect(html).toContain('name="roleType"');
    expect(html).toContain('option value="official" selected=""');
    expect(html).toContain("16 種");
    expect(html).toContain("儲存互動角色");
  });

  it("preserves edit identity, inactive state, selected avatar, and supplied role label", () => {
    const html = renderToStaticMarkup(<InteractionRoleForm role={role()} csrfToken="csrf-edit-token" />);

    expect(html).toContain('name="id" value="role-1"');
    expect(html).toMatch(/name="name" value="客服小幫手"/);
    expect(html).toMatch(/name="label" value="客服助手"/);
    expect(html).toContain('name="avatarUrl" value="https://cdn.example.test/avatar.svg"');
    expect(html).not.toContain('name="isActive" type="checkbox" checked=""');
    expect(html).toContain("客服助手");
  });
});
