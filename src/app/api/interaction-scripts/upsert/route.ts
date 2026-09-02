import { NextResponse } from "next/server";
import { saveInteractionScript } from "@/app/actions/interaction-actions";

/**
 * Native form transport prevents a successful script write from depending on
 * the Server Action reducer. The shared mutation retains every security and
 * persistence decision; only the terminal browser transport is a 303.
 */
export async function POST(request: Request) {
  const destination = await saveInteractionScript(await request.formData());
  const browserOrigin = request.headers.get("origin");
  const redirectBase = browserOrigin ? new URL(browserOrigin).origin : new URL(request.url).origin;
  return NextResponse.redirect(new URL(destination, redirectBase), 303);
}
