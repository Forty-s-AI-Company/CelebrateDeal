import { NextResponse } from "next/server";
import { readFormDataBody } from "@/lib/api-security";
import {
  createPlatformPlanCheckout,
  platformPlanCheckoutPath,
} from "@/lib/platform-plan-checkout";

const REDIRECT_PATHS = [
  "/billing/plans",
  "/dashboard",
  "/login",
  "/mfa/setup",
  "/mfa/verify",
  "/settings/security",
];

function safeErrorResponse(status = 500) {
  return NextResponse.json(
    { error: "checkout" },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

function nativeRedirect(path: string) {
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: path,
      "Cache-Control": "private, no-store",
    },
  });
}

function redirectPathFromError(error: unknown, request: Request) {
  const digest = typeof error === "object" && error !== null && "digest" in error
    ? (error as { digest?: unknown }).digest
    : null;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT;")) return null;

  const path = digest.split(";")[2];
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;

  try {
    const target = new URL(path, request.url);
    if (target.origin !== new URL(request.url).origin) return null;
    if (!REDIRECT_PATHS.some((allowedPath) => target.pathname === allowedPath || target.pathname.startsWith(`${allowedPath}/`))) return null;
    return `${target.pathname}${target.search}`;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const formData = await readFormDataBody(request);
  if (!formData) return safeErrorResponse(400);

  try {
    // Keep the native transport on the same tenant-scoped mutation core as the
    // Server Action. Only the transport owns the 303 response.
    const result = await createPlatformPlanCheckout(formData, request);
    return nativeRedirect(platformPlanCheckoutPath(result));
  } catch (error) {
    const destination = redirectPathFromError(error, request);
    if (destination) return nativeRedirect(destination);
    return safeErrorResponse(500);
  }
}
