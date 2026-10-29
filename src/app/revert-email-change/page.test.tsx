import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ describe: vi.fn() }));
vi.mock("@/lib/account-email-change", () => ({ describeAccountEmailRevertLink: mocks.describe, ACCOUNT_EMAIL_CHANGE_LOCK_DAYS: 7 }));

import RevertEmailChangePage from "./page";

async function render(searchParams: Record<string, string>) {
  return renderToStaticMarkup(await RevertEmailChangePage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  mocks.describe.mockReset().mockResolvedValue(null);
});

describe("/revert-email-change", () => {
  it.each([
    ["restore", "還原登入 Email", "已被改成其他信箱", "原本的密碼會停用"],
    ["cancel", "取消變更", "尚未完成的登入 Email 變更", "密碼與登入狀態都不會變動"],
  ] as const)("shows a %s button that posts the token, without any address", async (mode, button, explanation, consequence) => {
    mocks.describe.mockResolvedValue({ mode });
    const html = await render({ token: "aer1.payload.signature" });
    expect(html).toContain("不是我操作，還原 Email");
    expect(html).toContain(button);
    expect(html).toContain(explanation);
    expect(html).toContain(consequence);
    // Only a real revert locks the account down; a cancel sets no change lock.
    if (mode === "restore") expect(html).toContain("7 天內不能再自行變更登入 Email");
    else expect(html).not.toContain("天內不能再自行變更");
    expect(html).toContain('action="/api/auth/email-change/revert"');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="token" value="aer1.payload.signature"');
    expect(html).not.toContain("@");
  });

  it("explains an unusable link without a button", async () => {
    const html = await render({ token: "aer1.payload.signature" });
    expect(html).toContain("連結無效或已過期");
    expect(html).not.toContain("/api/auth/email-change/revert");
    expect(html).toContain('href="/password-reset/request"');
  });

  it.each([
    ["reverted", "登入 Email 已還原"],
    ["cancelled", "已取消變更登入 Email"],
    ["conflict", "請聯絡客服"],
    ["retry", "系統忙碌"],
    ["unknown", "連結無效或已過期"],
  ])("reports the %s result and points to a password reset", async (status, title) => {
    const html = await render({ status });
    expect(html).toContain(title);
    expect(html).toContain('href="/password-reset/request"');
    expect(mocks.describe).not.toHaveBeenCalled();
  });

  it("tells the owner after a revert that the password stopped working and links to the reset", async () => {
    const html = await render({ status: "reverted" });
    expect(html).toContain("請重設密碼");
    expect(html).toContain("原本的密碼已停用");
    expect(html).toContain("兩步驟驗證與備用碼也已移除");
    expect(html).toContain("7 天內不能再自行變更登入 Email");
    expect(html).toContain('href="/password-reset/request"');
  });

  it("tells the owner after a cancel that nothing else changed", async () => {
    const html = await render({ status: "cancelled" });
    expect(html).toContain("密碼與登入狀態都沒有變動");
    expect(html).not.toContain("天內不能再自行變更");
  });
});
