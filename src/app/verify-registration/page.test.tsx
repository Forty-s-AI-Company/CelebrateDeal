import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import VerifyRegistrationPage from "./page";

const token = `fsv1.formsub_test.1780000000.1.${"a".repeat(43)}`;

async function render(searchParams: { token?: string; status?: string }) {
  return renderToStaticMarkup(await VerifyRegistrationPage({ searchParams: Promise.resolve(searchParams) }));
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
    expect(invalid).toContain("確認連結無效或已過期");
    for (const html of [verified, invalid]) {
      expect(html).not.toContain('action="/api/form-submissions/verify"');
      expect(html).not.toContain(token);
    }
  });
});
