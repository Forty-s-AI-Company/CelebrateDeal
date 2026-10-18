import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { StudentPortalActionState } from "@/lib/student-portal-action-state";

const state = vi.hoisted(() => ({ value: { status: "idle", message: "" } as StudentPortalActionState, pending: false }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useActionState: () => [state.value, () => undefined, state.pending] }));
vi.mock("@/app/actions/student-portal-actions", () => ({ requestMagicLinkAction: vi.fn() }));
import { StudentPortalLoginForm } from "./student-portal-login-form";

beforeEach(() => { state.value = { status: "idle", message: "" }; state.pending = false; });

it.each(["zh-TW", "en"] as const)("keeps the login tenant and CSRF fields unchanged in %s", locale => {
  const html = renderToStaticMarkup(<StudentPortalLoginForm locale={locale} vendorSlug="academy" csrfToken="synthetic-csrf" accentColor="#2563eb" />);
  expect(html).toContain('name="vendorSlug" value="academy"');
  expect(html).toContain('name="_csrf" value="synthetic-csrf"');
  expect(html).toContain(locale === "en" ? "Send sign-in link" : "寄送登入連結");
  expect(html).toContain('name="email"');
  expect(html).not.toContain("mockLink");
});

it("translates the shared anti-enumeration message and disables duplicate submits", () => {
  state.pending = true;
  state.value = { status: "sent", message: "如果這個 Email 有可存取的內容，我們已寄出 15 分鐘有效的安全連結。" };
  const html = renderToStaticMarkup(<StudentPortalLoginForm locale="en" vendorSlug="academy" csrfToken="synthetic-csrf" accentColor="#2563eb" />);
  expect(html).toContain("If this email has accessible content");
  expect(html).toContain("Preparing your secure link");
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain("disabled");
});
