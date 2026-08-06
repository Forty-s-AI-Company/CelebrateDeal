import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  GET,
  HEAD,
  LINEAGE_PAYLOAD,
  validatePreviewLineagePayload,
} from "./route";

const EXPECTED_KEYS = [
  "baseSourceDigest",
  "baseWorkPackage",
  "remediationWorkPackage",
  "schemaVersion",
  "sourceDigestSemantics",
];

describe("Preview deployment lineage marker route", () => {
  it("returns the exact deterministic v2 payload with safe response headers", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual(EXPECTED_KEYS);
    expect(payload).toEqual(LINEAGE_PAYLOAD);
    expect(validatePreviewLineagePayload(payload)).toBe(true);
  });

  it("serves HEAD with the same contract headers and no response body", async () => {
    const response = HEAD();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("");
  });

  it("accepts only the v2 payload and rejects legacy or tampered shapes", () => {
    expect(validatePreviewLineagePayload(LINEAGE_PAYLOAD)).toBe(true);
    expect(validatePreviewLineagePayload({
      workPackage: "WP-187",
      sourceDigest: LINEAGE_PAYLOAD.baseSourceDigest,
    })).toBe(false);
    expect(validatePreviewLineagePayload({
      ...LINEAGE_PAYLOAD,
      baseWorkPackage: "WP-196",
    })).toBe(false);
    expect(validatePreviewLineagePayload({
      ...LINEAGE_PAYLOAD,
      baseSourceDigest: "sha256:invalid",
    })).toBe(false);
    expect(validatePreviewLineagePayload({
      ...LINEAGE_PAYLOAD,
      token: "must-not-be-accepted",
    })).toBe(false);
  });

  it("has no runtime, environment, data, or external-service dependency", async () => {
    const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
    for (const forbidden of [
      "process.env",
      "@prisma/client",
      "@/lib/db",
      "fs.",
      "node:fs",
      "fetch(",
      "cookies(",
      "headers(",
    ]) {
      expect(source.includes(forbidden)).toBe(false);
    }
  });

  it("returns byte-stable JSON across repeated GET calls", async () => {
    const first = await GET().text();
    const second = await GET().text();
    expect(first).toBe(second);
    expect(first).toBe(JSON.stringify(LINEAGE_PAYLOAD));
  });
});
