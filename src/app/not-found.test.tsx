import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import GlobalError from "./global-error";
import NotFound from "./not-found";
import ViewerNotFound from "./(viewer)/not-found";
import PublicPageError from "./p/[slug]/error";

const noop = () => undefined;
const error = Object.assign(new Error("boom"), { digest: "d" });

describe("Traditional Chinese 404 and error pages", () => {
  it("root not-found offers a way home", () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain("找不到這個頁面");
    expect(html).toContain('href="/"');
    expect(html).not.toMatch(/not found|404/iu);
  });

  it("viewer not-found has back and home exits", () => {
    const html = renderToStaticMarkup(<ViewerNotFound />);
    expect(html).toContain("找不到這個頁面");
    expect(html).toContain("返回上一頁");
    expect(html).toContain('href="/"');
  });

  it("public page error is Chinese with retry and home", () => {
    const html = renderToStaticMarkup(<PublicPageError error={error} retry={noop} />);
    expect(html).toContain("重新載入");
    expect(html).toContain("回首頁");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("boom");
  });

  it("global error is Chinese with retry and home, and hides the error message", () => {
    const html = renderToStaticMarkup(<GlobalError error={error} retry={noop} />);
    expect(html).toContain('lang="zh-Hant"');
    expect(html).toContain("重新載入");
    expect(html).toContain('href="/"');
    expect(html).not.toContain("boom");
  });
});
