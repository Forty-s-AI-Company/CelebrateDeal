import { describe, expect, it } from "vitest";
import {
  REDACTED,
  REQUEST_HEADER_ALLOWLIST,
  isSensitiveKey,
  resolveTraceSampleRate,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubSentryLog,
  scrubString,
  scrubValue,
  sentryBeforeSend,
  sentryDataCollection,
} from "./sentry-scrub";

describe("sentryDataCollection", () => {
  it("collects no cookies, query params, bodies, user info or stack-frame variables", () => {
    expect(sentryDataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      queryParams: false,
      httpBodies: [],
      stackFrameVariables: false,
      genAI: { inputs: false, outputs: false },
    });
  });

  it("allow-lists request headers and never allows cookies or credentials", () => {
    const allowed = sentryDataCollection.httpHeaders.request.allow;
    expect(allowed).toEqual([...REQUEST_HEADER_ALLOWLIST]);
    for (const forbidden of ["cookie", "set-cookie", "authorization", "x-csrf-token", "referer", "x-forwarded-for", "x-api-key"]) {
      expect(allowed).not.toContain(forbidden);
      expect(sentryDataCollection.httpHeaders.response.allow).not.toContain(forbidden);
    }
  });
});

describe("scrubString", () => {
  it("masks email addresses", () => {
    expect(scrubString("寄送失敗：buyer.name+test@example.co.uk 無法接收")).toBe(`寄送失敗：${REDACTED} 無法接收`);
  });

  it("masks Taiwan mobile and international phone numbers but keeps order numbers and timestamps", () => {
    expect(scrubString("電話 0912-345-678 與 0912345678")).toBe(`電話 ${REDACTED} 與 ${REDACTED}`);
    expect(scrubString("call +886 912 345 678 now")).toContain(REDACTED);
    expect(scrubString("call +886 912 345 678 now")).not.toContain("345");
    expect(scrubString("timestamp 1760875200123 order 20261019001")).toBe("timestamp 1760875200123 order 20261019001");
  });

  it("masks Luhn-valid card numbers with or without separators, but not other long numbers", () => {
    expect(scrubString("card 4242 4242 4242 4242 declined")).toBe(`card ${REDACTED} declined`);
    expect(scrubString("card 4242-4242-4242-4242")).toBe(`card ${REDACTED}`);
    expect(scrubString("pan=4111111111111111")).not.toContain("4111111111111111");
    expect(scrubString("id 1234567890123456")).toBe("id 1234567890123456");
  });

  it("masks bearer tokens, JWTs, provider keys and key=value secrets", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abc123signature";
    expect(scrubString(`Authorization: Bearer abcdef0123456789abcdef`)).not.toContain("abcdef0123456789");
    expect(scrubString(`token ${jwt}`)).toBe(`token ${REDACTED}`);
    expect(scrubString("key sk_live_abcdefghijklmnop1234")).toBe(`key ${REDACTED}`);
    expect(scrubString("password=hunter2&x=1")).toBe(`password=${REDACTED}&x=1`);
    expect(scrubString('{"csrf_token": "abc"}')).not.toContain('"abc"');
    expect(scrubString("sid 0123456789abcdef0123456789abcdef0123")).toBe(`sid ${REDACTED}`);
  });

  it("drops query strings from absolute and relative URLs", () => {
    expect(scrubString("GET https://app.example.com/checkout/result?TradeNo=123&name=王小明#x")).toBe(
      `GET https://app.example.com/checkout/result?${REDACTED}#x`,
    );
    expect(scrubString("redirected to /lives/new?draft=abc&error=slug_taken")).toBe(`redirected to /lives/new?${REDACTED}`);
  });

  it("leaves ordinary diagnostic text alone", () => {
    const text = "TypeError: Cannot read properties of undefined (reading 'map') at LiveChatPanel (live-chat-panel.tsx:120:15)";
    expect(scrubString(text)).toBe(text);
    expect(scrubString("")).toBe("");
  });
});

describe("isSensitiveKey", () => {
  it("matches credential and personal-data field names by word", () => {
    for (const key of ["password", "newPassword", "csrf_token", "x-api-key", "apiKey", "Authorization", "cookie", "sessionId", "email", "contactEmail", "phone", "card_number", "TradeSha", "HashInfo"]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
  });

  it("does not match structural Sentry keys that merely contain the letters", () => {
    for (const key of ["span", "spans", "span_id", "footprint", "transaction", "breadcrumbs", "exception", "frames", "filename", "function", "trace_id", "tags", "level", "message"]) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });
});

describe("scrubValue", () => {
  it("redacts sensitive keys entirely and scrubs nested strings without mutating the input", () => {
    const input = { user: { name: "x", email: "a@b.co" }, extra: { list: ["call 0912345678"], password: "p", note: "ok" } };
    const snapshot = JSON.parse(JSON.stringify(input));
    const output = scrubValue(input) as typeof input;
    expect(output.user.email).toBe(REDACTED);
    expect(output.extra.password).toBe(REDACTED);
    expect(output.extra.list[0]).toBe(`call ${REDACTED}`);
    expect(output.extra.note).toBe("ok");
    expect(input).toEqual(snapshot);
  });

  it("keeps non-plain objects and primitives and stops at a depth limit", () => {
    const date = new Date(0);
    expect(scrubValue({ at: date, n: 1, b: true, z: null }) as Record<string, unknown>).toEqual({ at: date, n: 1, b: true, z: null });
    let deep: Record<string, unknown> = { leaf: "x" };
    for (let index = 0; index < 20; index += 1) deep = { child: deep };
    expect(JSON.stringify(scrubValue(deep))).toContain(REDACTED);
  });
});

describe("scrubSentryEvent", () => {
  const event = {
    event_id: "evt",
    message: "failed for buyer@example.com",
    user: { id: 42, email: "buyer@example.com", username: "buyer", ip_address: "203.0.113.9" },
    request: {
      url: "https://app.example.com/checkout?token=abc&email=a@b.co",
      query_string: "token=abc",
      cookies: { session: "s3cret" },
      data: { cardNumber: "4242424242424242" },
      headers: {
        "User-Agent": "Mozilla/5.0",
        Cookie: "session=s3cret",
        Authorization: "Bearer abcdef0123456789",
        "X-CSRF-Token": "tok",
        Referer: "https://app.example.com/?email=a@b.co",
        "Content-Type": "application/json",
      },
    },
    exception: { values: [{ type: "Error", value: "card 4242 4242 4242 4242 rejected", stacktrace: { frames: [{ filename: "app.js", vars: { password: "x" } }] } }] },
    breadcrumbs: [{ category: "fetch", data: { url: "/api/orders?email=a@b.co", token: "t" } }],
    spans: [{ span_id: "1", description: "GET /api/payments/status?TradeNo=1" }],
  };

  it("keeps only an opaque user id", () => {
    expect(scrubSentryEvent(event).user).toEqual({ id: "42" });
    expect(scrubSentryEvent({ ...event, user: { email: "a@b.co" } }).user).toBeUndefined();
  });

  it("drops cookies, query string and body and keeps only allow-listed headers", () => {
    const request = scrubSentryEvent(event).request as Record<string, unknown>;
    expect(request).not.toHaveProperty("cookies");
    expect(request).not.toHaveProperty("query_string");
    expect(request).not.toHaveProperty("data");
    expect(request.headers).toEqual({ "User-Agent": "Mozilla/5.0", "Content-Type": "application/json" });
    expect(request.url).toBe(`https://app.example.com/checkout?${REDACTED}`);
  });

  it("scrubs messages, exceptions, breadcrumbs and spans while preserving structure", () => {
    const scrubbed = scrubSentryEvent(event) as typeof event;
    expect(scrubbed.message).toBe(`failed for ${REDACTED}`);
    expect(scrubbed.exception.values[0]?.value).toBe(`card ${REDACTED} rejected`);
    expect(scrubbed.exception.values[0]?.stacktrace.frames[0]).toEqual({ filename: "app.js", vars: { password: REDACTED } });
    expect(scrubbed.breadcrumbs[0]?.data).toEqual({ url: `/api/orders?${REDACTED}`, token: REDACTED });
    expect(scrubbed.spans[0]).toEqual({ span_id: "1", description: `GET /api/payments/status?${REDACTED}` });
    expect(scrubbed.event_id).toBe("evt");
  });

  it("never serializes any of the original secrets", () => {
    const serialized = JSON.stringify(scrubSentryEvent(event));
    for (const secret of ["buyer@example.com", "203.0.113.9", "s3cret", "4242424242424242", "4242 4242 4242 4242", "abcdef0123456789", "a@b.co"]) {
      expect(serialized, secret).not.toContain(secret);
    }
  });

  it("does not mutate the original event and works for events without a request or user", () => {
    const snapshot = JSON.stringify(event);
    scrubSentryEvent(event);
    expect(JSON.stringify(event)).toBe(snapshot);
    expect(sentryBeforeSend({ message: "plain" })).toEqual({ message: "plain" });
  });
});

describe("breadcrumb and log scrubbing", () => {
  it("scrubs breadcrumbs", () => {
    expect(scrubSentryBreadcrumb({ message: "user a@b.co clicked", data: { phone: "0912345678" } })).toEqual({
      message: `user ${REDACTED} clicked`,
      data: { phone: REDACTED },
    });
  });

  it("scrubs structured log messages and attributes", () => {
    expect(scrubSentryLog({ level: "info", message: "sent to a@b.co", attributes: { email: "a@b.co", orderCount: 3 } })).toEqual({
      level: "info",
      message: `sent to ${REDACTED}`,
      attributes: { email: REDACTED, orderCount: 3 },
    });
  });
});

describe("resolveTraceSampleRate", () => {
  it("samples everything in development", () => {
    expect(resolveTraceSampleRate({ name: "GET /api/live-chat" }, true)).toBe(1);
  });

  it("almost never samples live polling and usage routes", () => {
    for (const name of ["GET /api/live-chat", "POST /api/live-danmaku/scripted", "GET /api/stream-usage/heartbeat", "GET /api/analytics/track"]) {
      expect(resolveTraceSampleRate({ name }, false), name).toBeLessThanOrEqual(0.01);
    }
  });

  it("always samples payment, checkout and webhook traces", () => {
    for (const name of ["POST /api/payments/checkout", "POST /api/webhooks/payuni", "GET /checkout/result", "GET /checkout/vendor/product", "POST /api/refunds/request"]) {
      expect(resolveTraceSampleRate({ name }, false), name).toBe(1);
    }
  });

  it("uses the request path attribute when present and defaults to 10% elsewhere", () => {
    expect(resolveTraceSampleRate({ name: "http.server", attributes: { "url.path": "/api/payments/status?x=1" } }, false)).toBe(1);
    expect(resolveTraceSampleRate({ name: "GET /dashboard" }, false)).toBe(0.1);
    expect(resolveTraceSampleRate({ name: "" }, false)).toBe(0.1);
  });
});
