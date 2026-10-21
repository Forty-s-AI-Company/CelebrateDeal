import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
import RegistrationErrorPage from "./page";

describe("registration error page (F-128)", () => {
  it("offers going back instead of the merchant-login home route", () => {
    const html = renderToStaticMarkup(<RegistrationErrorPage />);
    expect(html).toContain("回上一頁");
    expect(html).not.toContain("回首頁");
    expect(html).not.toContain('href="/"');
  });
});
