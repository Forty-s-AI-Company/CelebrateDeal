import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A forged success URL has no signed registrant session. Keep the real async
// sharing component in this page regression, without a Next request context.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
import VerifyRegistrationPage from "./page";

const token = `fsv1.formsub_test.1780000000.1.${"a".repeat(43)}`;

async function render(searchParams: { token?: string; status?: string; rechoose?: string }) {
  const stream = await renderToReadableStream(await VerifyRegistrationPage({ searchParams: Promise.resolve(searchParams) }));
  await stream.allReady;
  return new Response(stream).text();
}

describe("VerifyRegistrationPage", () => {
  it("有效 token 只呈現明確 POST 確認表單，render 過程不讀寫資料庫", async () => {
    const html = await render({ token });

    expect(html).toContain("確認這是你的 Email");
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/form-submissions/verify"');
    expect(html).toContain(`name="token" value="${token}"`);
    expect(html).toContain('aria-disabled="false"');
    expect(html).not.toContain('role="alert"');
  });

  it("verified 與 invalid 狀態不回顯 token，也不呈現 POST 表單", async () => {
    const verified = await render({ token, status: "verified" });
    const invalid = await render({ token, status: "invalid" });

    expect(verified).toContain("Email 已確認");
    expect(verified).not.toContain("分享已報名活動");
    expect(verified).not.toContain("邀請朋友參加活動");
    expect(invalid).toContain("確認連結無效或已過期");
    for (const html of [verified, invalid]) {
      expect(html).not.toContain('action="/api/form-submissions/verify"');
      expect(html).not.toContain(token);
    }
  });

  it("retry 狀態提示連結仍有效、請重試，而不是說連結無效", async () => {
    const html = await render({ status: "retry" });

    expect(html).toContain("請重試");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("確認連結無效或已過期");
    expect(html).not.toContain('action="/api/form-submissions/verify"');
  });
});

describe("VerifyRegistrationPage cancelled session (指定場次)", () => {
  it("says the session was cancelled and links only to a same-site registration path", async () => {
    const html = await render({ status: "session_cancelled", rechoose: "/form/summer-live" });
    expect(html).toContain("你報名的場次已取消");
    expect(html).toContain('href="/form/summer-live"');
    expect(html).not.toContain('action="/api/form-submissions/verify"');
    for (const rechoose of ["https://evil.example/form/x", "//evil.example/lp/x", "/admin/lives", "/lp/"]) {
      const unsafe = await render({ status: "session_cancelled", rechoose });
      expect(unsafe).toContain("你報名的場次已取消");
      expect(unsafe).not.toContain("重新選擇場次</a>");
    }
  });
});