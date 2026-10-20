import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/line-actions", () => ({
  saveLineOfficialAccountAction: vi.fn(),
  testLineOfficialAccountAction: vi.fn(),
}));

import { LineOfficialAccountForm, describeLineSaveError } from "./line-official-account-form";

describe("LineOfficialAccountForm", () => {
  it("shows the three-step setup guide", () => {
    const html = renderToStaticMarkup(
      <LineOfficialAccountForm csrfToken="t" connected={false} webhookUrl="https://x.test/hook" lastValidatedAt={null} />,
    );
    expect(html).toContain("三步驟完成綁定");
    expect(html).toContain("Channel access token");
    expect(html).toContain("測試連線");
  });

  it("names the failing fields in the error message", () => {
    expect(describeLineSaveError({ status: "error", error: "invalid_credentials", fields: ["messagingAccessToken", "loginChannelSecret"] }))
      .toContain("Messaging Access Token、Login Channel Secret");
    expect(describeLineSaveError({ status: "error", error: "save_failed" })).toContain("無法儲存");
    expect(describeLineSaveError({ status: "error", error: "invalid_credentials" })).toContain("每個欄位");
  });
});
