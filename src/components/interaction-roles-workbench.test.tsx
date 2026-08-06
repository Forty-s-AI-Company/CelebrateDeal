import { renderToStaticMarkup } from "react-dom/server";
import type { InteractionRole } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({
  deleteInteractionRoleAction: vi.fn(),
  upsertInteractionRoleAction: vi.fn(),
}));

import { InteractionRolesWorkbench } from "./interaction-roles-workbench";

function role(overrides: Partial<InteractionRole> = {}): InteractionRole {
  return {
    id: "role-1",
    vendorId: "vendor-1",
    name: "AI 主持人",
    avatarUrl: null,
    label: "AI 主持人",
    roleType: "ai_host",
    tone: "清楚、自然",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("InteractionRolesWorkbench", () => {
  it("renders an empty create state with no destructive edit control", () => {
    const html = renderToStaticMarkup(
      <InteractionRolesWorkbench roles={[]} selectedRole={null} csrfToken="csrf-empty-token" />,
    );

    expect(html).toContain("0 個官方互動角色");
    expect(html).toContain("新增使用者");
    expect(html).toContain('aria-label="新增互動角色"');
    expect(html).toContain('name="_csrf" value="csrf-empty-token"');
    expect(html).not.toContain("刪除");
    expect(html).not.toContain('name="id"');
  });

  it("renders an existing inactive-or-active role with edit identity and delete action", () => {
    const selected = role({ isActive: false });
    const html = renderToStaticMarkup(
      <InteractionRolesWorkbench roles={[selected]} selectedRole={selected} csrfToken="csrf-edit-token" />,
    );

    expect(html).toContain("1 個官方互動角色");
    expect(html).toContain("編輯使用者");
    expect(html).toContain('name="id" value="role-1"');
    expect(html).toMatch(/type="checkbox"[^>]+name="isActive"/);
    expect(html).not.toContain('name="isActive" type="checkbox" checked=""');
    expect(html).toContain("AI 主持人");
    expect(html).toContain("停用");
    expect(html).toContain("刪除");
    expect(html).toContain("男");
    expect(html).toContain("女");
  });
});
