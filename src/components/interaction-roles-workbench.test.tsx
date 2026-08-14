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
    isSimulated: true,
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
    expect(html).toContain("新增互動角色");
    expect(html).toContain('aria-label="新增互動角色"');
    expect(html).toContain('name="_csrf" value="csrf-empty-token"');
    expect(html).toContain("角色即時預覽");
    expect(html).toContain("未命名角色");
    expect(html).toContain("預先設定角色");
    expect(html).toContain("這個預覽不會發布訊息");
    expect(html).not.toContain("刪除");
    expect(html).not.toContain('name="id"');
  });

  it("renders an existing inactive-or-active role with edit identity and delete action", () => {
    const selected = role({
      isActive: false,
      avatarUrl: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=editor-purple&backgroundType=gradientLinear&radius=18",
    });
    const html = renderToStaticMarkup(
      <InteractionRolesWorkbench roles={[selected]} selectedRole={selected} csrfToken="csrf-edit-token" />,
    );

    expect(html).toContain("1 個官方互動角色");
    expect(html).toContain("編輯互動角色");
    expect(html).toContain('name="id" value="role-1"');
    expect(html).toMatch(/type="checkbox"[^>]+name="isActive"/);
    expect(html).not.toContain('name="isActive" type="checkbox" checked=""');
    expect(html).toContain("AI 主持人");
    expect(html).toContain("停用");
    expect(html).toContain("刪除");
    expect(html).toContain('formNoValidate=""');
    expect(html).toContain("seed=editor-purple");
    expect(html).toContain("男");
    expect(html).toContain("女");
  });

  it("shows a safe validation error and the public-transparency contract", () => {
    const html = renderToStaticMarkup(
      <InteractionRolesWorkbench roles={[]} selectedRole={null} csrfToken="csrf-token" error="invalid_role" />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("角色資料無效");
    expect(html).toContain("不代表真人、即時留言、觀看人數、報名、訂單、付款、評論或成效");
  });

  it("shows exact script impact before an active role is disabled or deleted", () => {
    const selected = role({ isActive: false });
    const html = renderToStaticMarkup(
      <InteractionRolesWorkbench
        roles={[selected]}
        selectedRole={selected}
        roleUsage={[
          { scriptId: "script-1", scriptName: "主直播腳本", scriptStatus: "published", eventCount: 3, publicMessageCount: 2, liveCount: 2 },
          { scriptId: "script-2", scriptName: "售後草稿", scriptStatus: "draft", eventCount: 1, publicMessageCount: 1, liveCount: 0 },
        ]}
        csrfToken="csrf-impact-token"
      />,
    );

    expect(html).toContain("腳本與直播使用狀況");
    expect(html).toContain("2 個腳本 · 2 場直播");
    expect(html).toContain("3 個官方留言／提醒事件不會出現在公開直播");
    expect(html).toContain("主直播腳本");
    expect(html).toContain("3 個引用事件");
    expect(html).toContain('href="/interaction-scripts/script-1/edit"');
    expect(html).toContain("目前有 2 個腳本引用");
  });

  it("makes an unused role safe to change without inventing references", () => {
    const selected = role();
    const html = renderToStaticMarkup(
      <InteractionRolesWorkbench roles={[selected]} selectedRole={selected} roleUsage={[]} csrfToken="csrf-unused-token" />,
    );

    expect(html).toContain("0 個腳本 · 0 場直播");
    expect(html).toContain("尚未被任何互動腳本使用，可以安全調整或刪除");
    expect(html).not.toContain("不會出現在公開直播");
  });

  it("explains that a stale or cross-vendor role must be selected again", () => {
    const html = renderToStaticMarkup(
      <InteractionRolesWorkbench roles={[]} selectedRole={null} csrfToken="csrf-token" error="missing_role" />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("已不存在或不屬於目前商店");
    expect(html).toContain("重新選擇或建立新角色");
  });
});
