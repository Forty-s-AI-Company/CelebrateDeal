import { NextResponse } from "next/server";
import { z } from "zod";
import { createLiveInput } from "@/lib/cloudflare-stream";

const LiveInputRequest = z.object({
  name: z.string().min(1).max(120),
});

export async function POST(request: Request) {
  const parsed = LiveInputRequest.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid live input request" }, { status: 400 });
  }

  const liveInput = await createLiveInput(parsed.data.name);
  return NextResponse.json({ ok: true, liveInput });
}
