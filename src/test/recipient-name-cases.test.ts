import { describe, expect, it } from "vitest";
import { expectNoPhishingTrace } from "./recipient-name-cases";

const TOKEN_URL = "https://app.example.test/api/live-session-switch?token=lsw1.AAAbz0eVILYua8_-x.sig-eVIL";
const UNSUBSCRIBE_URL = "https://app.example.test/unsubscribe?token=eu1.xxeVILyy&lang=zh";

describe("expectNoPhishingTrace", () => {
  it("ignores a marker that only appears inside a platform token", () => {
    expect(() => expectNoPhishingTrace({ subject: "提醒", body: `您好\n切換場次 ${TOKEN_URL}\n退訂 ${UNSUBSCRIBE_URL}` })).not.toThrow();
  });

  it("still fails when the name is printed in the body", () => {
    expect(() => expectNoPhishingTrace({ subject: "提醒", body: `您好 evil.test\n${TOKEN_URL}` })).toThrow();
  });

  it("still fails on a URL outside the platform host, in any form", () => {
    expect(() => expectNoPhishingTrace({ subject: "提醒", body: "請看 https://evil.test/x" })).toThrow();
    expect(() => expectNoPhishingTrace({ subject: "https://evil.test/x", body: "您好" })).toThrow();
  });

  it("still fails when a platform URL carries the name outside its token", () => {
    expect(() => expectNoPhishingTrace({ subject: "提醒", body: "請看 https://app.example.test/live?name=evil" })).toThrow();
    expect(() => expectNoPhishingTrace({ subject: "提醒", body: "請看 https://app.example.test/evil/live" })).toThrow();
  });
});
