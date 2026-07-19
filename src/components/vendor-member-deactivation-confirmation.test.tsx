import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VendorMemberDeactivationConfirmation } from "./vendor-member-deactivation-confirmation";

const action = async () => {};
const csrfToken = "csrf-test-token";
const member = {
  id: "member-2",
  userId: "user-2",
  status: "active",
  user: { name: "王小明", email: "member@example.com" },
};

function renderConfirmation(overrides: Partial<React.ComponentProps<typeof VendorMemberDeactivationConfirmation>> = {}) {
  return renderToStaticMarkup(
    <VendorMemberDeactivationConfirmation
      action={action}
      currentUserId="owner-1"
      csrfToken={csrfToken}
      isOwner
      member={member}
      {...overrides}
    />,
  );
}

describe("VendorMemberDeactivationConfirmation", () => {
  it("renders a confirmation field and submit action for another active member", () => {
    const html = renderConfirmation();

    expect(html).toContain("輸入 member@example.com 以確認停用");
    expect(html).toContain('name="confirmation"');
    expect(html).toMatch(/type="email"[^>]*autoComplete="off"[^>]*required=""[^>]*name="confirmation"/);
    expect(html).toContain('name="id" value="member-2"');
    expect(html).toContain('name="_csrf" value="csrf-test-token"');
    expect(html).toContain("確認停用");
  });

  it("does not render a submittable deactivation action for the current user or inactive member", () => {
    expect(renderConfirmation({ currentUserId: member.userId })).toBe("");
    expect(renderConfirmation({ member: { ...member, status: "inactive" } })).toBe("");
  });
});
