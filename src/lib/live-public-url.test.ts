import { describe, expect, it } from "vitest";
import { createLiveViewerUrl } from "./live-public-url";

describe("createLiveViewerUrl", () => {
  it("uses only the canonical public app URL and encodes a live slug", () => {
    expect(createLiveViewerUrl("summer / launch", {
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://app.example.test/ignored/path",
    })).toBe("https://app.example.test/live/summer%20%2F%20launch");
  });

  it("fails closed for a missing slug or unsafe production origin", () => {
    expect(() => createLiveViewerUrl("", { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://app.example.test" }))
      .toThrow("Live slug is required");
    expect(() => createLiveViewerUrl("launch", { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://app.example.test" }))
      .toThrow("HTTPS in production");
  });
});
