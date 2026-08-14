import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmailUnsubscribeToken } from "@/lib/email-delivery-pii";
import UnsubscribePage from "./page";

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "g7-07-unsubscribe-page-test-secret-longer-than-32-bytes");
});

afterEach(() => vi.unstubAllEnvs());

describe("UnsubscribePage", () => {
  it("asks for explicit confirmation and exposes pending feedback", async () => {
    const token = createEmailUnsubscribeToken("delivery-1");
    const html = renderToStaticMarkup(await UnsubscribePage({ searchParams: Promise.resolve({ token }) }));
    expect(html).toContain("確認停止通知");
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/email/unsubscribe"');
  });

  it("renders generic success and invalid states without recipient data", async () => {
    const success = renderToStaticMarkup(await UnsubscribePage({ searchParams: Promise.resolve({ status: "done" }) }));
    const invalid = renderToStaticMarkup(await UnsubscribePage({ searchParams: Promise.resolve({ status: "invalid" }) }));
    expect(success).toContain("已停止寄送");
    expect(invalid).toContain('role="alert"');
    expect(`${success}${invalid}`).not.toContain("@example.test");
  });
});
