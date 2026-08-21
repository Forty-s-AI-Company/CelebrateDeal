import { NextResponse } from "next/server";
import { manageTeamFunnelTemplateAction } from "@/app/actions/team-funnel-template-actions";

const initialState = { status: "idle" as const, message: "" };
const noStoreHeaders = { "Cache-Control": "private, no-store" };

/**
 * Native form transport for team-template mutations. The Server Action keeps
 * ownership, CSRF, origin and service validation in one place; this route only
 * exposes its safe action-state response to the browser.
 */
export async function POST(request: Request) {
  try {
    const result = await manageTeamFunnelTemplateAction(initialState, await request.formData());
    return NextResponse.json(result, {
      // Validation and authorization failures are already represented by the
      // safe action state. Keep the transport successful so expected form
      // feedback does not become a browser console network failure.
      status: 200,
      headers: noStoreHeaders,
    });
  } catch {
    return NextResponse.json(
      { status: "error", message: "操作未完成，請稍後再試一次。" },
      { status: 500, headers: noStoreHeaders },
    );
  }
}
