import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import type { InteractionRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  actionState: null as {
    status: "idle" | "error";
    message: string;
    values: Record<string, unknown>;
  } | null,
  action: vi.fn(),
  pending: false,
  stateCursor: 0,
  stateValues: [] as unknown[],
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useActionState: (_action: unknown, initialState: typeof hookState.actionState extends infer T ? T : never) => [
      hookState.actionState ?? initialState,
      hookState.action,
      hookState.pending,
    ],
    useState: (initialValue: unknown) => {
      const index = hookState.stateCursor++;
      if (!(index in hookState.stateValues)) {
        hookState.stateValues[index] = typeof initialValue === "function"
          ? (initialValue as () => unknown)()
          : initialValue;
      }
      const setValue = (nextValue: unknown | ((currentValue: unknown) => unknown)) => {
        const currentValue = hookState.stateValues[index];
        hookState.stateValues[index] = typeof nextValue === "function"
          ? (nextValue as (currentValue: unknown) => unknown)(currentValue)
          : nextValue;
      };
      return [hookState.stateValues[index], setValue];
    },
    useEffect: () => undefined,
    useMemo: (factory: () => unknown) => factory(),
  };
});

vi.mock("@/app/actions", () => ({
  deleteInteractionRoleAction: vi.fn(),
  upsertInteractionRoleAction: vi.fn(),
  upsertInteractionRoleActionState: vi.fn(),
}));

vi.mock("@/components/media-upload-field", () => ({
  MediaUploadField: (props: {
    kind: string;
    label: string;
    defaultUrl?: string | null;
    defaultAssetId?: string | null;
    urlInputName?: string;
    assetIdInputName?: string;
    statusInputName?: string;
    allowExternalUrlFallback?: boolean;
    onBlockingChange?: (blocked: boolean) => void;
  }) => (
    <div
      data-testid="media-upload-field"
      data-kind={props.kind}
      data-default-url={props.defaultUrl ?? ""}
      data-default-asset-id={props.defaultAssetId ?? ""}
      data-url-input-name={props.urlInputName ?? ""}
      data-asset-id-input-name={props.assetIdInputName ?? ""}
      data-status-input-name={props.statusInputName ?? ""}
      data-allow-external-url-fallback={props.allowExternalUrlFallback ? "true" : "false"}
    >
      <span>{props.label}</span>
      {props.urlInputName ? <input type="hidden" name={props.urlInputName} value={props.defaultUrl ?? ""} readOnly /> : null}
      {props.assetIdInputName ? <input type="hidden" name={props.assetIdInputName} value={props.defaultAssetId ?? ""} readOnly /> : null}
      {props.statusInputName ? <input type="hidden" name={props.statusInputName} value="idle" readOnly /> : null}
    </div>
  ),
}));

vi.mock("@/components/form-submit-button", () => ({
  FormSubmitButton: ({
    children,
    disabled = false,
    formAction,
    formNoValidate,
    name,
    value,
  }: {
    children: ReactNode;
    disabled?: boolean;
    formAction?: unknown;
    formNoValidate?: boolean;
    name?: string;
    value?: string;
  }) => (
    <button
      type="submit"
      disabled={disabled}
      formNoValidate={formNoValidate}
      name={name}
      value={value}
      data-has-form-action={formAction ? "true" : "false"}
    >
      {children}
    </button>
  ),
}));

import { InteractionRolesWorkbench } from "./interaction-roles-workbench";
import { interactionRoleAvatarUrl } from "@/lib/interaction-role";

type ElementProps = Record<string, unknown> & {
  onBlockingChange?: (blocked: boolean) => void;
  onChange?: (event: { target: { value: string } }) => void;
  onClick?: () => void;
  onSubmit?: (event: { preventDefault: () => void; nativeEvent: { submitter: unknown } }) => void;
};
type ElementNode = { type: unknown; props: ElementProps };

function isElementNode(value: unknown): value is ElementNode {
  return typeof value === "object" && value !== null && "type" in value && "props" in value;
}

function findElements(value: unknown, predicate: (element: ElementNode) => boolean, result: ElementNode[] = []) {
  if (Array.isArray(value)) {
    for (const child of value) findElements(child, predicate, result);
    return result;
  }
  if (!isElementNode(value)) return result;
  if (predicate(value)) result.push(value);
  findElements(value.props.children, predicate, result);
  return result;
}

function renderTree(props: React.ComponentProps<typeof InteractionRolesWorkbench>) {
  hookState.stateCursor = 0;
  return InteractionRolesWorkbench(props);
}

function renderHtml(props: React.ComponentProps<typeof InteractionRolesWorkbench>) {
  return renderToStaticMarkup(renderTree(props));
}

function renderPreviewHtml(props: React.ComponentProps<typeof InteractionRolesWorkbench>) {
  const html = renderHtml(props);
  const start = html.indexOf('<section aria-labelledby="interaction-role-preview-title"');
  const end = html.indexOf("</section>", start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end + "</section>".length);
}

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
    isScheduled: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("InteractionRolesWorkbench", () => {
  beforeEach(() => {
    hookState.actionState = null;
    hookState.action.mockReset();
    hookState.pending = false;
    hookState.stateCursor = 0;
    hookState.stateValues = [];
  });

  it("renders an empty create state with no destructive edit control", () => {
    const html = renderHtml({ roles: [], selectedRole: null, csrfToken: "csrf-empty-token" });

    expect(html).toContain("0 個互動角色");
    expect(html).toContain("新增互動角色");
    expect(html).toContain('aria-label="新增互動角色"');
    expect(html).toContain('name="_csrf" value="csrf-empty-token"');
    expect(html).toContain("角色即時預覽");
    expect(html).toContain("未命名角色");
    expect(html).toContain("官方外觀");
    expect(html).toContain("這個預覽不會發布訊息");
    expect(html).not.toContain("刪除");
    expect(html).not.toContain('name="id"');
  });

  it("renders an existing inactive-or-active role with edit identity and delete action", () => {
    const selected = role({
      isActive: false,
      avatarUrl: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=editor-purple&backgroundType=gradientLinear&radius=18",
    });
    const html = renderHtml({ roles: [selected], selectedRole: selected, csrfToken: "csrf-edit-token" });

    expect(html).toContain("1 個互動角色");
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
    const html = renderHtml({ roles: [], selectedRole: null, csrfToken: "csrf-token", error: "invalid_role" });

    expect(html).toContain('role="alert"');
    expect(html).toContain("角色資料無效");
    expect(html).toContain("不代表真人、即時留言、觀看人數、報名、訂單、付款、評論或成效");
  });

  it("only offers official and audience role types and normalizes legacy roles", () => {
    const selected = role({ roleType: "support", label: "客服助手" });
    const html = renderHtml({ roles: [selected], selectedRole: selected, csrfToken: "csrf-role-type-token" });

    expect(html).toContain('option value="official" selected=""');
    expect(html).toContain('option value="audience"');
    expect(html).not.toContain('option value="ai_host"');
    expect(html).not.toContain('option value="system_assistant"');
    expect(html).not.toContain('option value="support"');
    expect(html).toContain("目前以官方角色呈現");
    expect(html).toContain("儲存後會轉為官方角色，不會再寫回舊類型");
  });

  it("round-trips scheduled state and keeps it after an action error", () => {
    const selected = role({ roleType: "audience", isScheduled: true });
    const html = renderHtml({ roles: [selected], selectedRole: selected, csrfToken: "csrf-scheduled-token" });
    expect(html).toMatch(/name="isScheduled"[^>]*checked=""/u);
    expect(html).toContain("排程角色");
    expect(html).toContain("直播排程與後續分析辨識");
    expect(html).toContain("標記此角色供直播排程與後續分析辨識");
    expect(html).toContain("前台呈現與數據排除將在直播互動流程完成後生效");
    expect(html).not.toContain("會顯示在聊天室，但不計入真實觀看、留言或成效數據");

    hookState.actionState = {
      status: "error",
      message: "角色資料無效",
      values: {
        id: "role-1",
        name: "排程觀眾",
        avatarUrl: "",
        avatarAssetId: "",
        avatarMode: "preset",
        avatarUploadPhase: "",
        label: "一般觀眾",
        roleType: "audience",
        tone: "保持原本語氣",
        isActive: true,
        isScheduled: true,
      },
    };
    const errorHtml = renderHtml({ roles: [selected], selectedRole: role({ ...selected, isScheduled: false }), csrfToken: "csrf-scheduled-error-token" });
    expect(errorHtml).toMatch(/name="isScheduled"[^>]*checked=""/u);
    expect(errorHtml).toContain("角色資料無效");
    expect(errorHtml).not.toContain('src=""');
  });

  it("uses the presentation role for preview appearance while keeping scheduled marker separate", () => {
    const audience = role({ roleType: "audience", isScheduled: true });
    const audienceHtml = renderHtml({ roles: [audience], selectedRole: audience, csrfToken: "csrf-audience-preview-token" });
    expect(audienceHtml).toContain("一般觀眾外觀");
    expect(audienceHtml).toContain("排程角色");
    expect(audienceHtml).not.toContain("官方外觀");

    hookState.stateValues = [];
    const scheduledOfficial = role({ roleType: "official", isScheduled: true });
    const scheduledOfficialPreview = renderPreviewHtml({
      roles: [scheduledOfficial],
      selectedRole: scheduledOfficial,
      csrfToken: "csrf-official-scheduled-preview-token",
    });
    expect(scheduledOfficialPreview).toContain("官方外觀");
    expect(scheduledOfficialPreview).toContain("排程角色");
    expect(scheduledOfficialPreview).not.toContain("一般觀眾外觀");

    hookState.stateValues = [];
    const manualOfficial = role({ roleType: "official", isScheduled: false });
    const manualOfficialPreview = renderPreviewHtml({
      roles: [manualOfficial],
      selectedRole: manualOfficial,
      csrfToken: "csrf-official-manual-preview-token",
    });
    expect(manualOfficialPreview).toContain("官方外觀");
    expect(manualOfficialPreview).not.toContain("排程角色");
    expect(manualOfficialPreview).not.toContain("一般觀眾外觀");
  });

  it("shows exact script impact before an active role is disabled or deleted", () => {
    const selected = role({ isActive: false });
    const html = renderHtml({
      roles: [selected],
      selectedRole: selected,
      roleUsage: [
        { scriptId: "script-1", scriptName: "主直播腳本", scriptStatus: "published", eventCount: 3, publicMessageCount: 2, liveCount: 2 },
        { scriptId: "script-2", scriptName: "售後草稿", scriptStatus: "draft", eventCount: 1, publicMessageCount: 1, liveCount: 0 },
      ],
      csrfToken: "csrf-impact-token",
    });

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
    const html = renderHtml({ roles: [selected], selectedRole: selected, roleUsage: [], csrfToken: "csrf-unused-token" });

    expect(html).toContain("0 個腳本 · 0 場直播");
    expect(html).toContain("尚未被任何互動腳本使用，可以安全調整或刪除");
    expect(html).not.toContain("不會出現在公開直播");
  });

  it("explains that a stale or cross-vendor role must be selected again", () => {
    const html = renderHtml({ roles: [], selectedRole: null, csrfToken: "csrf-token", error: "missing_role" });

    expect(html).toContain('role="alert"');
    expect(html).toContain("已不存在或不屬於目前商店");
    expect(html).toContain("重新選擇或建立新角色");
  });

  it("keeps canonical preset mode fields without mounting the upload field", () => {
    const selected = role({ avatarUrl: interactionRoleAvatarUrl("host-blue") });
    const html = renderHtml({ roles: [selected], selectedRole: selected, csrfToken: "csrf-preset-token", initialAvatarAssetId: "asset-must-not-leak-into-preset" });

    expect(html).toContain('name="avatarMode" value="preset"');
    expect(html).toContain(`name="avatarUrl" value="${interactionRoleAvatarUrl("host-blue").replaceAll("&", "&amp;")}"`);
    expect(html).toContain('name="avatarAssetId" value=""');
    expect(html).toContain('name="avatarUploadPhase" value=""');
    expect(html).not.toContain("data-testid=\"media-upload-field\"");
  });

  it("renders custom mode through MediaUploadField with the four persisted avatar contracts", () => {
    const selected = role({ avatarUrl: "https://cdn.example.test/role-avatar.webp" });
    const tree = renderTree({ roles: [selected], selectedRole: selected, csrfToken: "csrf-custom-token", initialAvatarAssetId: "asset-role-avatar" });
    const html = renderToStaticMarkup(tree);
    const mediaField = findElements(tree, (element) => element.props.kind === "image" && element.props.urlInputName === "avatarUrl")[0];

    expect(html).toContain('name="avatarMode" value="custom"');
    expect(html).toContain('name="avatarUrl" value="https://cdn.example.test/role-avatar.webp"');
    expect(html).toContain('name="avatarAssetId" value="asset-role-avatar"');
    expect(html).toContain('name="avatarUploadPhase" value="idle"');
    expect(mediaField?.props).toMatchObject({
      kind: "image",
      defaultUrl: "https://cdn.example.test/role-avatar.webp",
      defaultAssetId: "asset-role-avatar",
      urlInputName: "avatarUrl",
      assetIdInputName: "avatarAssetId",
      statusInputName: "avatarUploadPhase",
      allowExternalUrlFallback: true,
    });
    expect(mediaField?.props.onBlockingChange).toBeTypeOf("function");
  });

  it("blocks save and Enter while upload is incomplete", () => {
    const selected = role({ avatarUrl: "https://cdn.example.test/role-avatar.webp" });
    const props = { roles: [selected], selectedRole: selected, csrfToken: "csrf-blocked-token" };
    const firstTree = renderTree(props);
    const mediaField = findElements(firstTree, (element) => element.props.kind === "image" && element.props.urlInputName === "avatarUrl")[0];
    mediaField?.props.onBlockingChange?.(true);

    const tree = renderTree(props);
    const html = renderToStaticMarkup(tree);
    const form = findElements(tree, (element) => element.type === "form")[0];
    const submit = vi.fn();
    const saveSubmitter = Object.assign(new (class {})(), { value: "" });
    vi.stubGlobal("HTMLButtonElement", saveSubmitter.constructor);

    expect(html).toContain("頭像上傳尚未完成");
    const saveButton = findElements(tree, (element) => (
      element.props.disabled === true && element.props.pendingMessage === "正在儲存互動角色"
    ))[0];
    expect(saveButton?.props.disabled).toBe(true);

    form?.props.onSubmit?.({
      preventDefault: submit,
      nativeEvent: { submitter: saveSubmitter },
    });
    expect(submit).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it("keeps delete formAction available and bypasses the upload block", () => {
    const selected = role({ avatarUrl: "https://cdn.example.test/role-avatar.webp" });
    const props = { roles: [selected], selectedRole: selected, csrfToken: "csrf-delete-token" };
    const firstTree = renderTree(props);
    const mediaField = findElements(firstTree, (element) => element.props.kind === "image" && element.props.urlInputName === "avatarUrl")[0];
    mediaField?.props.onBlockingChange?.(true);

    const tree = renderTree(props);
    const form = findElements(tree, (element) => element.type === "form")[0];
    const deleteButton = findElements(tree, (element) => element.props.value === "delete")[0];
    const preventDefault = vi.fn();
    const deleteSubmitter = Object.assign(new (class {})(), { value: "delete" });
    vi.stubGlobal("HTMLButtonElement", deleteSubmitter.constructor);

    expect(deleteButton?.props.formAction).toBeDefined();
    expect(deleteButton?.props.name).toBe("intent");
    expect(deleteButton?.props.value).toBe("delete");
    expect(deleteButton?.props.formNoValidate).toBe(true);

    form?.props.onSubmit?.({
      preventDefault,
      nativeEvent: { submitter: deleteSubmitter },
    });
    expect(preventDefault).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("shows an action-state error while retaining the current controlled role values", () => {
    hookState.actionState = {
      status: "error",
      message: "頭像上傳尚未完成，請完成上傳後再儲存。",
      values: {
        id: "role-1",
        name: "保留中的角色名稱",
        avatarUrl: "https://cdn.example.test/role-avatar.webp",
        avatarMode: "custom",
        avatarAssetId: "asset-1",
        avatarUploadPhase: "uploading",
        label: "直播小編",
        roleType: "official",
        tone: "保留中的語氣",
        isActive: true,
      },
    };
    const selected = role({
      avatarUrl: "https://cdn.example.test/original-role-avatar.webp",
      name: "送出前的原始名稱",
      label: "原始標籤",
      tone: "送出前的原始語氣",
    });
    const html = renderHtml({ roles: [selected], selectedRole: selected, csrfToken: "csrf-state-error-token" });

    expect(html).toContain('role="alert"');
    expect(html).toContain("頭像上傳尚未完成");
    expect(html).toMatch(/name="name"[^>]*value="保留中的角色名稱"/u);
    expect(html).toContain("保留中的語氣");
    expect(html).toContain('name="avatarMode" value="custom"');
    expect(html).toContain('name="avatarUrl" value="https://cdn.example.test/role-avatar.webp"');
  });

  it("shows a distinct initial empty state when no roles exist", () => {
    const html = renderHtml({ roles: [], selectedRole: null, csrfToken: "csrf-filter-empty-token" });

    expect(html).toContain("還沒有互動角色");
    expect(html).not.toContain("找不到符合條件的互動角色");
    expect(html).toContain("顯示 0 / 0 個互動角色");
  });

  it("searches name, label, and tone case-insensitively", () => {
    const roles = [
      role({ id: "name-match", name: "夏季主持人" }),
      role({ id: "label-match", name: "角色二", label: "優惠小編" }),
      role({ id: "tone-match", name: "角色三", tone: "溫柔提醒折扣" }),
    ];
    const tree = renderTree({ roles, selectedRole: null, csrfToken: "csrf-search-token" });
    const search = findElements(tree, (element) => element.props.id === "interaction-role-search")[0];

    search?.props.onChange?.({ target: { value: "  優惠  " } });
    const html = renderHtml({ roles, selectedRole: null, csrfToken: "csrf-search-token" });

    expect(html).toContain("顯示 1 / 3 個互動角色");
    expect(html).toContain("優惠小編");
    expect(html).not.toContain("夏季主持人");
    expect(html).not.toContain("溫柔提醒折扣");

    search?.props.onChange?.({ target: { value: "  溫柔提醒折扣  " } });
    const toneHtml = renderHtml({ roles, selectedRole: null, csrfToken: "csrf-search-token" });
    expect(toneHtml).toContain("顯示 1 / 3 個互動角色");
    expect(toneHtml).toContain("角色三");
  });

  it("trims, lowercases, and caps the search query at 120 characters", () => {
    const roles = [role({ id: "long-query-role", name: "a".repeat(120) })];
    const tree = renderTree({ roles, selectedRole: null, csrfToken: "csrf-query-limit-token" });
    const search = findElements(tree, (element) => element.props.id === "interaction-role-search")[0];
    const rawQuery = `  ${"A".repeat(130)}  `;

    search?.props.onChange?.({ target: { value: rawQuery } });
    const filteredTree = renderTree({ roles, selectedRole: null, csrfToken: "csrf-query-limit-token" });
    const filteredSearch = findElements(filteredTree, (element) => element.props.id === "interaction-role-search")[0];

    expect(filteredSearch?.props.value).toBe("a".repeat(120));
    expect(renderToStaticMarkup(filteredTree)).toContain("顯示 1 / 1 個互動角色");

    hookState.stateCursor = 0;
    hookState.stateValues = [];
    const longToneRole = role({
      id: "long-tone-role",
      name: "長語氣角色",
      tone: `${"前置文字".repeat(31)}深層語氣關鍵字`,
    });
    const longToneTree = renderTree({ roles: [longToneRole], selectedRole: null, csrfToken: "csrf-query-limit-token" });
    const longToneSearch = findElements(longToneTree, (element) => element.props.id === "interaction-role-search")[0];
    longToneSearch?.props.onChange?.({ target: { value: "深層語氣關鍵字" } });
    expect(renderToStaticMarkup(renderTree({ roles: [longToneRole], selectedRole: null, csrfToken: "csrf-query-limit-token" }))).toContain("顯示 1 / 1 個互動角色");
  });

  it("filters active and inactive roles without changing their original order", () => {
    const roles = [
      role({ id: "inactive-first", name: "停用角色", isActive: false }),
      role({ id: "active-second", name: "啟用角色", isActive: true }),
      role({ id: "active-third", name: "啟用角色三", isActive: true }),
    ];
    const tree = renderTree({ roles, selectedRole: null, csrfToken: "csrf-status-token" });
    const status = findElements(tree, (element) => element.props.id === "interaction-role-status")[0];

    status?.props.onChange?.({ target: { value: "active" } });
    const html = renderHtml({ roles, selectedRole: null, csrfToken: "csrf-status-token" });

    expect(html).toContain("顯示 2 / 3 個互動角色");
    expect(html).not.toContain("停用角色");
    expect(html.indexOf("啟用角色")).toBeLessThan(html.indexOf("啟用角色三"));

    status?.props.onChange?.({ target: { value: "inactive" } });
    expect(renderHtml({ roles, selectedRole: null, csrfToken: "csrf-status-token" })).toContain("顯示 1 / 3 個互動角色");
  });

  it("filters official and audience presentation roles and maps legacy roles to official", () => {
    const roles = [
      role({ id: "legacy-official", name: "舊官方", roleType: "support" }),
      role({ id: "audience-role", name: "觀眾角色", roleType: "audience" }),
      role({ id: "official-role", name: "官方角色", roleType: "official" }),
    ];
    const tree = renderTree({ roles, selectedRole: null, csrfToken: "csrf-presentation-token" });
    const presentation = findElements(tree, (element) => element.props.id === "interaction-role-presentation")[0];

    presentation?.props.onChange?.({ target: { value: "official" } });
    const officialHtml = renderHtml({ roles, selectedRole: null, csrfToken: "csrf-presentation-token" });
    expect(officialHtml).toContain("顯示 2 / 3 個互動角色");
    expect(officialHtml).toContain("舊官方");
    expect(officialHtml).toContain("官方角色");
    expect(officialHtml).not.toContain("觀眾角色");

    presentation?.props.onChange?.({ target: { value: "audience" } });
    const audienceHtml = renderHtml({ roles, selectedRole: null, csrfToken: "csrf-presentation-token" });
    expect(audienceHtml).toContain("顯示 1 / 3 個互動角色");
    expect(audienceHtml).toContain("觀眾角色");
    expect(audienceHtml).not.toContain("舊官方");
  });

  it("keeps scheduled and manual role filters separate", () => {
    const roles = [
      role({ id: "scheduled-role", name: "排程角色", isScheduled: true }),
      role({ id: "manual-role", name: "手動角色", isScheduled: false }),
    ];
    const tree = renderTree({ roles, selectedRole: null, csrfToken: "csrf-scheduled-filter-token" });
    const scheduled = findElements(tree, (element) => element.props.id === "interaction-role-scheduled")[0];

    scheduled?.props.onChange?.({ target: { value: "scheduled" } });
    const scheduledHtml = renderHtml({ roles, selectedRole: null, csrfToken: "csrf-scheduled-filter-token" });
    expect(scheduledHtml).toContain("顯示 1 / 2 個互動角色");
    expect(scheduledHtml).toContain("排程角色");
    expect(scheduledHtml).toContain('href="/interaction-roles/scheduled-role/edit"');
    expect(scheduledHtml).not.toContain('href="/interaction-roles/manual-role/edit"');

    scheduled?.props.onChange?.({ target: { value: "manual" } });
    const manualHtml = renderHtml({ roles, selectedRole: null, csrfToken: "csrf-scheduled-filter-token" });
    expect(manualHtml).toContain("顯示 1 / 2 個互動角色");
    expect(manualHtml).toContain("手動角色");
    expect(manualHtml).toContain('href="/interaction-roles/manual-role/edit"');
    expect(manualHtml).not.toContain('href="/interaction-roles/scheduled-role/edit"');
  });

  it("combines query, status, presentation, and scheduled filters as an intersection", () => {
    const roles = [
      role({ id: "all-match", name: "優惠主持", label: "官方", roleType: "official", isActive: true, isScheduled: true }),
      role({ id: "wrong-status", name: "優惠觀眾", roleType: "audience", isActive: false, isScheduled: true }),
      role({ id: "wrong-schedule", name: "優惠官方手動", roleType: "official", isActive: true, isScheduled: false }),
    ];
    const tree = renderTree({ roles, selectedRole: null, csrfToken: "csrf-intersection-token" });
    findElements(tree, (element) => element.props.id === "interaction-role-search")[0]?.props.onChange?.({ target: { value: "優惠" } });
    findElements(tree, (element) => element.props.id === "interaction-role-status")[0]?.props.onChange?.({ target: { value: "active" } });
    findElements(tree, (element) => element.props.id === "interaction-role-presentation")[0]?.props.onChange?.({ target: { value: "official" } });
    findElements(tree, (element) => element.props.id === "interaction-role-scheduled")[0]?.props.onChange?.({ target: { value: "scheduled" } });

    const html = renderHtml({ roles, selectedRole: null, csrfToken: "csrf-intersection-token" });
    expect(html).toContain("顯示 1 / 3 個互動角色");
    expect(html).toContain("優惠主持");
    expect(html).not.toContain("優惠觀眾");
    expect(html).not.toContain("優惠官方手動");
  });

  it("shows a filter-empty state instead of the initial empty state", () => {
    const roles = [role({ name: "現有角色" })];
    const tree = renderTree({ roles, selectedRole: null, csrfToken: "csrf-filter-no-result-token" });
    findElements(tree, (element) => element.props.id === "interaction-role-search")[0]?.props.onChange?.({ target: { value: "不存在" } });

    const html = renderHtml({ roles, selectedRole: null, csrfToken: "csrf-filter-no-result-token" });
    expect(html).toContain("找不到符合條件的互動角色");
    expect(html).not.toContain("還沒有互動角色");
    expect(html).toContain("清除條件");
  });

  it("only renders clear controls after a filter is active and restores all roles", () => {
    const roles = [role({ id: "first-role", name: "第一角色" }), role({ id: "second-role", name: "第二角色" })];
    const initialTree = renderTree({ roles, selectedRole: null, csrfToken: "csrf-clear-token" });
    expect(findElements(initialTree, (element) => element.props.children === "清除條件")).toHaveLength(0);

    findElements(initialTree, (element) => element.props.id === "interaction-role-status")[0]?.props.onChange?.({ target: { value: "inactive" } });
    const filteredTree = renderTree({ roles, selectedRole: null, csrfToken: "csrf-clear-token" });
    const clearButton = findElements(filteredTree, (element) => element.props.children === "清除條件")[0];
    expect(clearButton).toBeDefined();
    clearButton?.props.onClick?.();

    expect(renderToStaticMarkup(renderTree({ roles, selectedRole: null, csrfToken: "csrf-clear-token" }))).toContain("顯示 2 / 2 個互動角色");
  });

  it("announces filtered and total counts through the labelled live region", () => {
    const roles = [role({ id: "one", name: "一" }), role({ id: "two", name: "二" }), role({ id: "three", name: "三" })];
    const tree = renderTree({ roles, selectedRole: null, csrfToken: "csrf-live-region-token" });
    const search = findElements(tree, (element) => element.props.id === "interaction-role-search")[0];
    expect((findElements(tree, (element) => element.props["aria-live"] === "polite")[0]?.props.children as unknown[]).join("")).toContain("顯示 3 / 3");

    search?.props.onChange?.({ target: { value: "一" } });
    const filteredTree = renderTree({ roles, selectedRole: null, csrfToken: "csrf-live-region-token" });
    expect((findElements(filteredTree, (element) => element.props["aria-live"] === "polite")[0]?.props.children as unknown[]).join("")).toContain("顯示 1 / 3");
  });

  it("keeps the selected role form and identity when the selected role is filtered out", () => {
    const selected = role({ id: "selected-role", name: "正在編輯的官方角色", roleType: "official" });
    const roles = [selected, role({ id: "audience-role", name: "其他觀眾", roleType: "audience" })];
    const firstTree = renderTree({ roles, selectedRole: selected, csrfToken: "csrf-selected-filter-token" });
    findElements(firstTree, (element) => element.props.id === "interaction-role-presentation")[0]?.props.onChange?.({ target: { value: "audience" } });

    const filteredTree = renderTree({ roles, selectedRole: selected, csrfToken: "csrf-selected-filter-token" });
    const html = renderToStaticMarkup(filteredTree);
    expect(html).toContain("目前正在編輯「正在編輯的官方角色」");
    expect(html).toContain("篩選只影響左側清單，不會變更或捨棄編輯內容");
    expect(html).toContain('name="id" value="selected-role"');
    expect(html).toMatch(/name="name"[^>]*value="正在編輯的官方角色"/u);
    expect(html).toContain("其他觀眾");
  });

  it("keeps unknown role types in all results without crashing or misclassifying them", () => {
    const unknown = role({ id: "unknown-role", name: "未知類型角色", roleType: "future_role" });
    const known = role({ id: "known-role", name: "官方角色", roleType: "official" });
    const tree = renderTree({ roles: [unknown, known], selectedRole: null, csrfToken: "csrf-unknown-role-token" });

    expect(renderToStaticMarkup(tree)).toContain("未知類型角色");
    const presentation = findElements(tree, (element) => element.props.id === "interaction-role-presentation")[0];
    presentation?.props.onChange?.({ target: { value: "official" } });
    const officialHtml = renderHtml({ roles: [unknown, known], selectedRole: null, csrfToken: "csrf-unknown-role-token" });
    expect(officialHtml).toContain("顯示 1 / 2 個互動角色");
    expect(officialHtml).toContain("官方角色");
    expect(officialHtml).not.toContain("未知類型角色");
  });

  it("fails closed for an unknown selected role instead of silently changing it to official", () => {
    const selected = role({ id: "unknown-selected", roleType: "future_role", name: "未知選取角色" });

    expect(() => renderHtml({ roles: [selected], selectedRole: selected, csrfToken: "csrf-unknown-selected-token" })).not.toThrow();
    const html = renderHtml({ roles: [selected], selectedRole: selected, csrfToken: "csrf-unknown-selected-token" });
    expect(html).toContain("未知選取角色");
    expect(html).toContain("不可編輯、預覽或一般儲存");
    expect(html).not.toContain("角色即時預覽");
    expect(html).not.toContain("儲存後會轉為官方角色");
    expect(html).not.toContain("官方外觀");
  });

  it("preserves the roles array order after filtering", () => {
    const roles = [
      role({ id: "third", name: "第三個角色", isActive: true }),
      role({ id: "first", name: "第一個角色", isActive: true }),
      role({ id: "second", name: "第二個角色", isActive: true }),
    ];
    const tree = renderTree({ roles, selectedRole: null, csrfToken: "csrf-order-token" });
    const status = findElements(tree, (element) => element.props.id === "interaction-role-status")[0];
    status?.props.onChange?.({ target: { value: "active" } });
    const html = renderHtml({ roles, selectedRole: null, csrfToken: "csrf-order-token" });

    expect(html.indexOf("第三個角色")).toBeLessThan(html.indexOf("第一個角色"));
    expect(html.indexOf("第一個角色")).toBeLessThan(html.indexOf("第二個角色"));
  });
});
