import { createEventEnvelope } from "@sentry/core";
import { describe, expect, it } from "vitest";
import {
  REDACTED,
  REQUEST_HEADER_ALLOWLIST,
  createTracesSampler,
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

describe("scrubSentryEvent keeps structural identifiers intact (C-01)", () => {
  const eventId = "0123456789abcdef0123456789abcdef";
  const traceId = "fedcba9876543210fedcba9876543210";
  const spanId = "0123456789abcdef";
  const parentSpanId = "89abcdef01234567";
  const release = "3f786850e387550fdab836ed7e6dc881de23001b";
  const debugId = "c3a1f0aa-2b4d-4e7f-9a10-0123456789ab";
  const realEvent = {
    event_id: eventId,
    release,
    dist: "1234567890",
    environment: "production",
    timestamp: 1760875200.123,
    level: "error",
    platform: "node",
    sdk: { name: "sentry.javascript.nextjs", version: "10.64.0" },
    transaction: "GET /api/payments/status",
    tags: { runtime: "node", region: "hnd1" },
    contexts: { trace: { trace_id: traceId, span_id: spanId, parent_span_id: parentSpanId, op: "http.server", status: "ok" } },
    spans: [{ trace_id: traceId, span_id: spanId, parent_span_id: parentSpanId, start_timestamp: 1760875200.1, timestamp: 1760875200.2, description: "GET /api/payments/status?TradeNo=1" }],
    debug_meta: { images: [{ type: "sourcemap", debug_id: debugId, code_file: "app:///_next/static/chunks/0123456789abcdef0123456789abcdef.js" }] },
    exception: {
      values: [{
        type: "Error",
        value: "failed for buyer@example.com",
        stacktrace: { frames: [{ filename: "app:///_next/static/chunks/0123456789abcdef0123456789abcdef.js", function: "handleSubmit", lineno: 120, colno: 15, in_app: true, instruction_addr: "0x0123456789abcdef" }] },
      }],
    },
  };

  it("keeps event, trace, span, release and debug identifiers byte-for-byte", () => {
    const scrubbed = scrubSentryEvent(realEvent);
    expect(scrubbed.event_id).toBe(eventId);
    expect(scrubbed.release).toBe(release);
    expect(scrubbed.dist).toBe("1234567890");
    expect(scrubbed.environment).toBe("production");
    expect(scrubbed.timestamp).toBe(1760875200.123);
    expect(scrubbed.level).toBe("error");
    expect(scrubbed.platform).toBe("node");
    expect(scrubbed.sdk).toEqual(realEvent.sdk);
    expect(scrubbed.contexts.trace).toEqual(realEvent.contexts.trace);
    expect(scrubbed.spans[0]).toMatchObject({ trace_id: traceId, span_id: spanId, parent_span_id: parentSpanId, start_timestamp: 1760875200.1, timestamp: 1760875200.2 });
    expect(scrubbed.debug_meta).toEqual(realEvent.debug_meta);
    expect(scrubbed.tags).toEqual({ runtime: "node", region: "hnd1" });
    expect(scrubbed.transaction).toBe("GET /api/payments/status");
  });

  it("keeps stack frame locations while still scrubbing free text", () => {
    const scrubbed = scrubSentryEvent(realEvent);
    expect(scrubbed.exception.values[0]?.stacktrace.frames[0]).toEqual(realEvent.exception.values[0]?.stacktrace.frames[0]);
    expect(scrubbed.exception.values[0]?.value).toBe(`failed for ${REDACTED}`);
    expect(scrubbed.spans[0]?.description).toBe(`GET /api/payments/status?${REDACTED}`);
  });

  it("still produces a valid envelope header with the original event_id", () => {
    const envelope = createEventEnvelope(scrubSentryEvent(realEvent) as never);
    expect((envelope[0] as { event_id?: string }).event_id).toMatch(/^[0-9a-f]{32}$/u);
    expect((envelope[0] as { event_id?: string }).event_id).toBe(eventId);
  });

  it("keeps sentry.* attributes on logs but scrubs the message and user attributes", () => {
    const log = scrubSentryLog({
      level: "info",
      message: "sent to a@b.co",
      attributes: { "sentry.release": release, "sentry.trace_id": traceId, orderRef: "ok", email: "a@b.co" },
    });
    expect(log.attributes).toEqual({ "sentry.release": release, "sentry.trace_id": traceId, orderRef: "ok", email: REDACTED });
  });
});

describe("createTracesSampler", () => {
  const inherit = (rate: number) => (value: number) => value === rate ? 0.42 : -1;

  it("does not inherit the upstream decision for checkout, payment and webhook routes", () => {
    const sampler = createTracesSampler(false);
    for (const name of ["POST /api/payments/checkout", "POST /api/webhooks/payuni", "GET /checkout/result"]) {
      expect(sampler({ name, inheritOrSampleWith: () => 0 }), name).toBe(1);
    }
  });

  it("does not let an upstream sampled trace lift polling routes above 1%", () => {
    expect(createTracesSampler(false)({ name: "GET /api/live-chat", inheritOrSampleWith: () => 1 })).toBeLessThanOrEqual(0.01);
  });

  it("inherits the upstream decision for ordinary pages, falling back to 10%", () => {
    expect(createTracesSampler(false)({ name: "GET /dashboard", inheritOrSampleWith: inherit(0.1) })).toBe(0.42);
  });

  it("samples everything in development", () => {
    expect(createTracesSampler(true)({ name: "GET /dashboard", inheritOrSampleWith: () => 0 })).toBe(1);
  });
});
