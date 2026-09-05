import { createHmac, timingSafeEqual } from "node:crypto";

export const LINE_MESSAGING_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TEXT_LENGTH = 5_000;
const MAX_ALT_TEXT_LENGTH = 400;
const RETRY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type LineTextMessage = { type: "text"; text: string };
export type LineFlexContents = Record<string, unknown> & {
  type: "bubble" | "carousel";
};
export type LineFlexMessage = {
  type: "flex";
  altText: string;
  contents: LineFlexContents;
};
export type LineMessage = LineTextMessage | LineFlexMessage;
export type LinePushOptions = { retryKey?: string };

export interface LineMessagingClient {
  push(to: string, messages: readonly LineMessage[], options?: LinePushOptions): Promise<void>;
  pushText(to: string, text: string, options?: LinePushOptions): Promise<void>;
  pushFlex(to: string, altText: string, contents: LineFlexContents, options?: LinePushOptions): Promise<void>;
}

export interface LineFetchClientOptions {
  accessToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  endpoint?: string;
}

export class LineMessagingError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "LineMessagingError";
    this.status = status;
  }
}

function validateRecipient(to: string): void {
  if (typeof to !== "string" || to.trim().length === 0 || to.length > 255) {
    throw new TypeError("LINE recipient must be a non-empty string of at most 255 characters");
  }
}

function validateText(text: string, field: "text" | "altText", max: number): void {
  if (typeof text !== "string" || text.length === 0 || text.length > max) {
    throw new TypeError(`LINE ${field} must contain 1-${max} characters`);
  }
}

function validateFlexContents(contents: LineFlexContents): void {
  if (!contents || typeof contents !== "object" || (contents.type !== "bubble" && contents.type !== "carousel")) {
    throw new TypeError('LINE Flex contents must be an object with type "bubble" or "carousel"');
  }
  if (contents.type === "carousel" && !Array.isArray(contents.contents)) {
    throw new TypeError("LINE Flex carousel contents must be an array");
  }
}

function validateMessages(messages: readonly LineMessage[]): void {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 5) {
    throw new TypeError("LINE push requires 1-5 messages");
  }
  for (const message of messages) {
    if (message.type === "text") validateText(message.text, "text", MAX_TEXT_LENGTH);
    else if (message.type === "flex") {
      validateText(message.altText, "altText", MAX_ALT_TEXT_LENGTH);
      validateFlexContents(message.contents);
    } else throw new TypeError("Unsupported LINE message type");
  }
}

export class LineFetchClient implements LineMessagingClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly endpoint: string;

  constructor(private readonly accessToken: string, options: Omit<LineFetchClientOptions, "accessToken"> = {}) {
    if (!accessToken || accessToken.trim().length === 0) throw new TypeError("LINE access token is required");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.endpoint = options.endpoint ?? LINE_MESSAGING_PUSH_URL;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new TypeError("LINE timeout must be positive");
  }

  pushText(to: string, text: string, options?: LinePushOptions): Promise<void> {
    return this.push(to, [{ type: "text", text }], options);
  }

  pushFlex(to: string, altText: string, contents: LineFlexContents, options?: LinePushOptions): Promise<void> {
    return this.push(to, [{ type: "flex", altText, contents }], options);
  }

  async push(to: string, messages: readonly LineMessage[], options: LinePushOptions = {}): Promise<void> {
    validateRecipient(to);
    validateMessages(messages);
    if (options.retryKey && !RETRY_KEY_PATTERN.test(options.retryKey)) throw new TypeError("LINE retry key must be a UUID v4");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          ...(options.retryKey ? { "X-Line-Retry-Key": options.retryKey } : {}),
        },
        body: JSON.stringify({ to, messages }),
        signal: controller.signal,
      });
      if (!response.ok) throw new LineMessagingError(`LINE Messaging API request failed (HTTP ${response.status})`, response.status);
    } catch (error) {
      if (error instanceof LineMessagingError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") throw new LineMessagingError("LINE Messaging API request timed out");
      throw new LineMessagingError("LINE Messaging API request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export type MockLinePushCall = { to: string; messages: readonly LineMessage[]; retryKey?: string };

export class MockLineMessagingClient implements LineMessagingClient {
  readonly calls: MockLinePushCall[] = [];
  private failure: Error | null = null;
  private failuresRemaining = 0;

  constructor(failure?: Error) {
    if (failure) this.setFailure(failure);
  }

  setFailure(error: Error | null, count = Number.POSITIVE_INFINITY): void {
    this.failure = error;
    this.failuresRemaining = error ? count : 0;
  }

  pushText(to: string, text: string, options?: LinePushOptions): Promise<void> { return this.push(to, [{ type: "text", text }], options); }
  pushFlex(to: string, altText: string, contents: LineFlexContents, options?: LinePushOptions): Promise<void> { return this.push(to, [{ type: "flex", altText, contents }], options); }

  async push(to: string, messages: readonly LineMessage[], options: LinePushOptions = {}): Promise<void> {
    validateRecipient(to);
    validateMessages(messages);
    if (this.failure && this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw this.failure;
    }
    this.calls.push({ to, messages: structuredClone(messages), ...(options.retryKey ? { retryKey: options.retryKey } : {}) });
  }
}

export function verifyLineSignature(body: string | Buffer, signature: string, channelSecret: string): boolean {
  if (!channelSecret || typeof signature !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return false;
  const expected = createHmac("sha256", channelSecret).update(body).digest();
  let received: Buffer;
  try { received = Buffer.from(signature, "base64"); } catch { return false; }
  return received.length === expected.length && timingSafeEqual(expected, received);
}
