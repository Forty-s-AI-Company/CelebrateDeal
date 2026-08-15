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
  initialInteractionRoleActionState: {
    status: "idle",
    message: "",
    values: {
      id: "",
      name: "",
      avatarUrl: "",
      avatarMode: "preset",
      label: "官方角色",
      roleType: "official",
      tone: "",
      isActive: true,
    },
  },
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
  beforeEach(() => {
    hookState.actionState = null;
    hookState.action.mockReset();
    hookState.pending = false;
    hookState.stateCursor = 0;
    hookState.stateValues = [];
  });

  it("renders an empty create state with no destructive edit control", () => {
    const html = renderHtml({ roles: [], selectedRole: null, csrfToken: "csrf-empty-token" });

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
    const html = renderHtml({ roles: [selected], selectedRole: selected, csrfToken: "csrf-edit-token" });

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
    const html = renderHtml({ roles: [], selectedRole: null, csrfToken: "csrf-token", error: "invalid_role" });

    expect(html).toContain('role="alert"');
    expect(html).toContain("角色資料無效");
    expect(html).toContain("不代表真人、即時留言、觀看人數、報名、訂單、付款、評論或成效");
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
});
