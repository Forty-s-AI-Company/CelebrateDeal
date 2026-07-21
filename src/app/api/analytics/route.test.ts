import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/analytics/route";
import { MAX_JSON_BODY_BYTES } from "@/lib/api-security";

describe("analytics route", () => {
  it("returns 400 instead of throwing for an empty JSON body", async () => {
    const response = await POST(new Request("https://app.example.test/api/analytics", {
      method: "POST",
      headers: { "x-celebratedeal-client": "web" },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid payload" });
  });

  it("returns 400 for malformed JSON without calling downstream services", async () => {
    const response = await POST(new Request("https://app.example.test/api/analytics", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-celebratedeal-client": "web",
      },
      body: "{not-json}",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid payload" });
  });

  it("returns 400 for an oversized public analytics payload", async () => {
    const response = await POST(new Request("https://app.example.test/api/analytics", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-celebratedeal-client": "web",
      },
      body: JSON.stringify({ payload: "x".repeat(MAX_JSON_BODY_BYTES) }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid payload" });
  });
});
