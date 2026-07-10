import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, "csp-report", 120, 60_000);
  if (limited) return limited;

  await request.text().catch(() => "");
  return new NextResponse(null, { status: 204 });
}
