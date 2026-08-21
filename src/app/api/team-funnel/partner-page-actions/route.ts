import { NextResponse } from "next/server";
import {
  savePartnerPageAction,
  setPartnerPagePublishAction,
  type PartnerPageActionState,
} from "@/app/actions/team-funnel-partner-actions";

const initialState: PartnerPageActionState = { status: "idle", message: "" };
const noStoreHeaders = { "Cache-Control": "private, no-store" };

/**
 * Native form transport for partner-page mutations. Both operations reuse the
 * existing Server Actions so the browser path cannot bypass their CSRF,
 * origin, tenant and field-lock checks.
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const operation = formData.get("operation");
    const result = operation === "save"
      ? await savePartnerPageAction(initialState, formData)
      : operation === "publish"
        ? await setPartnerPagePublishAction(initialState, formData)
        : { status: "error" as const, message: "不支援的夥伴頁操作。" };

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
