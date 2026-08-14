import { renderToStaticMarkup } from "react-dom/server";
import type { MessageTemplate } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  actionState: null as {
    status: "idle" | "error";
    error: "invalid_template" | "missing_template" | "conflict" | null;
    draft: {
      name: string;
      channel: string;
      trigger: string;
      subject: string;
      body: string;
      isActive: boolean;
    } | null;
    expectedUpdatedAt: string | null;
    version: number;
  } | null,
  pending: false,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useActionState: (_action: unknown, initialState: unknown) => [hookState.actionState ?? initialState, vi.fn(), hookState.pending],
  };
});

vi.mock("@/app/actions", () => ({ upsertTemplateAction: vi.fn() }));
vi.mock("@/components/csrf-field", () => ({
  CsrfField: () => <input type="hidden" name="_csrf" value="csrf-token" />,
}));

import { MessageTemplateForm } from "./message-template-form";

const template: MessageTemplate = {
  id: "template-1",
  vendorId: "vendor-1",
  name: "開播提醒",
  channel: "email",
  trigger: "live_reminder",
  subject: "直播即將開始",
  body: "嗨 {{name}}",
  isActive: true,
  createdAt: new Date("2026-08-08T00:00:00.000Z"),
  updatedAt: new Date("2026-08-08T00:00:00.000Z"),
};

beforeEach(() => {
  hookState.actionState = null;
  hookState.pending = false;
});

describe("MessageTemplateForm", () => {
  it("renders only Email as available and exposes bounded supported variables", () => {
    const html = renderToStaticMarkup(<MessageTemplateForm template={template} />);

    expect(html).toContain('name="channel"');
    expect(html).toContain('value="email" selected=""');
    expect(html).toMatch(/value="sms" disabled=""/u);
    expect(html).toMatch(/value="line" disabled=""/u);
    expect(html).toMatch(/value="cart_followup" disabled=""/u);
    expect(html).toContain("SMS（尚未串接，不能啟用）");
    expect(html).toContain("{{name}}");
    expect(html).toContain("{{live_start_at}}");
    expect(html).toContain("{{unsubscribe_url}}");
    expect(html).toMatch(/<input[^>]*required=""[^>]*maxLength="200"[^>]*name="subject"/u);
    expect(html).toMatch(/<textarea[^>]*name="body"[^>]*rows="8"[^>]*required=""[^>]*maxLength="20000"/u);
    expect(html).toContain('aria-busy="false"');
  });

  it.each([
    ["invalid_template", "模板資料無效"],
    ["missing_template", "已不存在或不屬於目前商店"],
  ] as const)("renders the recoverable %s state", (error, message) => {
    const html = renderToStaticMarkup(<MessageTemplateForm error={error} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain(message);
  });

  it("keeps the submitted merchant copy visible after server validation fails", () => {
    hookState.actionState = {
      status: "error",
      error: "invalid_template",
      draft: {
        name: "週五提醒草稿",
        channel: "email",
        trigger: "live_reminder",
        subject: "{{live_title}} 週五見",
        body: "這段很長的商家內容 {{unknown_variable}} 不可以消失",
        isActive: false,
      },
      expectedUpdatedAt: null,
      version: 1,
    };

    const html = renderToStaticMarkup(<MessageTemplateForm />);

    expect(html).toContain("內容已保留");
    expect(html).toContain('value="週五提醒草稿"');
    expect(html).toContain('value="{{live_title}} 週五見"');
    expect(html).toContain("這段很長的商家內容 {{unknown_variable}} 不可以消失");
    expect(html).not.toContain('name="id"');
  });

  it("turns a concurrently deleted edit into an explicit create recovery without losing copy", () => {
    hookState.actionState = {
      status: "error",
      error: "missing_template",
      draft: {
        name: "保留下來的提醒",
        channel: "email",
        trigger: "live_reminder",
        subject: "仍要寄出的主旨",
        body: "仍要寄出的內容",
        isActive: true,
      },
      expectedUpdatedAt: null,
      version: 1,
    };

    const html = renderToStaticMarkup(<MessageTemplateForm template={template} />);

    expect(html).toContain("再次儲存會建立新模板");
    expect(html).toContain("保留下來的提醒");
    expect(html).toContain("仍要寄出的內容");
    expect(html).not.toContain('name="id" value="template-1"');
  });

  it("keeps stale-tab copy and advances the explicit compare-and-swap claim", () => {
    hookState.actionState = {
      status: "error",
      error: "conflict",
      draft: {
        name: "舊分頁內容",
        channel: "email",
        trigger: "live_reminder",
        subject: "待確認主旨",
        body: "待確認內容",
        isActive: true,
      },
      expectedUpdatedAt: "2026-08-10T02:03:04.000Z",
      version: 1,
    };

    const html = renderToStaticMarkup(<MessageTemplateForm template={template} />);

    expect(html).toContain("其他分頁已有新版");
    expect(html).toContain("再次儲存");
    expect(html).toContain('name="id" value="template-1"');
    expect(html).toContain('name="expectedUpdatedAt" value="2026-08-10T02:03:04.000Z"');
    expect(html).toContain("待確認內容");
  });
});
