import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  actionState: null as { status: "idle" | "error"; message: string; fieldErrors?: Record<string, string> } | null,
  pending: false,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useActionState: (_action: unknown, initialState: unknown) => [hookState.actionState ?? initialState, vi.fn(), hookState.pending],
  };
});
vi.mock("@/app/actions/form-actions", () => ({ upsertFormBuilderAction: vi.fn() }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="synthetic" /> }));
vi.mock("@/components/ui", () => ({ Card: ({ children }: { children: ReactNode }) => <section>{children}</section> }));

import { FormBuilder } from "./form-builder";

beforeEach(() => {
  hookState.actionState = null;
  hookState.pending = false;
});

describe("FormBuilder", () => {
  it("renders a visual builder with protected defaults, preview, and no raw JSON editor", () => {
    const html = renderToStaticMarkup(<FormBuilder draftScope="vendor-1" />);

    expect(html).toContain("1. 基本資料");
    expect(html).toContain("2. 報名欄位");
    expect(html).toContain("即時預覽");
    expect(html).toContain("核心欄位");
    expect(html).toContain("新增欄位");
    expect(html).toContain('name="fields"');
    expect(html).toContain("synthetic");
    expect(html).toContain("修改後會自動保存瀏覽器草稿");
    expect(html).toContain("報名頁海報");
    expect(html).toContain("報名頁背景");
    expect(html).toContain('name="heroImageUrl"');
    expect(html).toContain('name="heroImageAssetId"');
    expect(html).toContain('name="backgroundImageUrl"');
    expect(html).toContain('name="backgroundImageAssetId"');
    expect(html).toContain('name="promoVideoId"');
    expect(html.match(/name="heroImageUrl"/g)).toHaveLength(1);
    expect(html.match(/name="heroImageAssetId"/g)).toHaveLength(1);
    expect(html.match(/name="backgroundImageUrl"/g)).toHaveLength(1);
    expect(html.match(/name="backgroundImageAssetId"/g)).toHaveLength(1);
    expect(html.match(/name="promoVideoId"/g)).toHaveLength(1);
    expect(html).toContain("進階：使用既有圖片 URL");
    expect(html).not.toContain("欄位 JSON");
  });

  it("renders an existing valid legacy schema without changing stable field keys", () => {
    const form = {
      id: "form-1",
      name: "活動報名",
      slug: "summer",
      headline: "立即報名",
      description: "說明",
      fields: [
        { key: "name", label: "真實姓名", type: "text", required: true },
        { key: "email", label: "聯絡 Email", type: "email", required: true },
        { key: "company", label: "公司名稱", type: "text", required: false },
      ],
      submitLabel: "送出",
      successMessage: "完成",
      heroImageUrl: "https://media.example.test/hero.webp",
      heroImageAssetId: "hero-asset-1",
      backgroundImageUrl: "https://media.example.test/background.webp",
      backgroundImageAssetId: "background-asset-1",
      promoVideoId: "video-1",
      themeColor: "#12aBc9",
      countdownMinutes: 90,
      stickyText: "直播限定",
      bodyContent: "活動內文第一行\n第二行",
      notice: "請準時參加",
      seoTitle: "活動 SEO 標題",
      seoDescription: "活動 SEO 說明",
      maxVisibleSessions: 5,
      hideExpiredSessions: false,
      isActive: true,
      updatedAt: new Date("2026-08-10T01:02:03.000Z"),
    } as never;

    const html = renderToStaticMarkup(
      <FormBuilder
        form={form}
        draftScope="vendor-1"
        promoVideos={[{ id: "video-1", title: "新品宣傳影片" }]}
      />,
    );

    expect(html).toContain('name="id" value="form-1"');
    expect(html).toContain('name="expectedUpdatedAt" value="2026-08-10T01:02:03.000Z"');
    expect(html).toContain("活動報名");
    expect(html).toContain("真實姓名");
    expect(html).toContain("公司名稱");
    expect(html).toContain("company");
    expect(html).toContain('name="themeColor" value="#12aBc9"');
    expect(html).toContain('name="countdownMinutes"');
    expect(html).toContain('name="stickyText"');
    expect(html).toContain('name="bodyContent"');
    expect(html).toContain('name="notice"');
    expect(html).toContain('name="seoTitle"');
    expect(html).toContain('name="seoDescription"');
    expect(html).toContain('name="maxVisibleSessions" value="5"');
    expect(html).toContain('name="hideExpiredSessions"');
    expect(html).toContain('name="heroImageUrl" value="https://media.example.test/hero.webp"');
    expect(html).toContain('name="heroImageAssetId" value="hero-asset-1"');
    expect(html).toContain('name="backgroundImageUrl" value="https://media.example.test/background.webp"');
    expect(html).toContain('name="backgroundImageAssetId" value="background-asset-1"');
    expect(html).toContain('<option value="video-1" selected="">新品宣傳影片</option>');
    expect(html).toContain("直播限定");
    expect(html).toContain("活動內文第一行");
    expect(html).toContain("請準時參加");
    expect(html).toContain("倒數設定：90 分鐘");
    expect(html).toContain("場次顯示：最多 5 場・顯示過期場次");
    expect(html).toContain("border-top-color:#12aBc9");
    expect(html).not.toContain("儲存已停用");
  });

  it("fails closed for an invalid legacy schema until the merchant explicitly rebuilds it", () => {
    const form = {
      id: "form-legacy",
      name: "舊表單",
      slug: "legacy",
      headline: "舊標題",
      description: null,
      fields: [{ key: "email", label: "Email", type: "email", required: true }],
      submitLabel: "送出",
      successMessage: "完成",
      isActive: true,
      updatedAt: new Date("2026-08-10T01:02:03.000Z"),
    } as never;

    const html = renderToStaticMarkup(<FormBuilder form={form} draftScope="vendor-1" />);

    expect(html).toContain("既有欄位規格無法安全解析");
    expect(html).toContain("儲存已停用");
    expect(html).toContain("重建安全欄位");
  });

  it("keeps legacy redirect errors visible as accessible recovery feedback", () => {
    const html = renderToStaticMarkup(<FormBuilder error="invalid_fields" draftScope="vendor-1" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("先前的欄位設定無法儲存");
  });

  it("shows server media errors and links the promo video error to its input", () => {
    hookState.actionState = {
      status: "error",
      message: "請修正媒體設定。",
      fieldErrors: {
        heroImageAssetId: "海報不屬於目前商家。",
        backgroundImageUrl: "背景圖片網址格式錯誤。",
        promoVideoId: "宣傳影片目前不可用。",
      },
    };

    const html = renderToStaticMarkup(<FormBuilder draftScope="vendor-1" />);

    expect(html).toContain("海報不屬於目前商家。");
    expect(html).toContain("背景圖片網址格式錯誤。");
    expect(html).toContain("宣傳影片目前不可用。");
    expect(html).toContain('name="promoVideoId" aria-invalid="true" aria-describedby="form-promo-video-error"');
  });
});
