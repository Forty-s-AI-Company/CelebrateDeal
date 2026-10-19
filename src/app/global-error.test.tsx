import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hook = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useState: <T,>(initial: T) => [hook.value === null ? initial : (hook.value as T), (next: T) => { hook.value = next; }] };
});
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import GlobalError from "./global-error";

const first = Object.assign(new Error("first"), { digest: "a" });
const second = Object.assign(new Error("second"), { digest: "b" });

describe("GlobalError retry button", () => {
  beforeEach(() => { hook.value = null; });

  it("is enabled initially", () => {
    expect(renderToStaticMarkup(<GlobalError error={first} retry={() => undefined} />)).not.toMatch(/<button[^>]*disabled/u);
  });

  it("is disabled while the retried error is still shown", () => {
    hook.value = first;
    const html = renderToStaticMarkup(<GlobalError error={first} retry={() => undefined} />);
    expect(html).toMatch(/<button[^>]*disabled/u);
    expect(html).toContain("正在重新載入");
  });

  it("becomes clickable again when the retry fails with a new error", () => {
    hook.value = first;
    const html = renderToStaticMarkup(<GlobalError error={second} retry={() => undefined} />);
    expect(html).not.toMatch(/<button[^>]*disabled/u);
    expect(html).toContain("重新載入");
  });
});
