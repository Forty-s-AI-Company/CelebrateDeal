import { describe, expect, it } from "vitest";
import { requestHasNonEmptyBody } from "./http-request-body";

function postRequest(body?: BodyInit, headers?: HeadersInit) {
  return new Request("https://app.example.test/api/fixed-task", {
    method: "POST",
    headers,
    ...(body === undefined ? {} : { body, duplex: "half" }),
  } as RequestInit);
}

describe("requestHasNonEmptyBody", () => {
  it("accepts absent and proxy-style zero-byte bodies", async () => {
    const zeroByteStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

    await expect(requestHasNonEmptyBody(postRequest())).resolves.toBe(false);
    await expect(requestHasNonEmptyBody(postRequest(zeroByteStream))).resolves.toBe(false);
  });

  it("rejects declared or streamed content", async () => {
    await expect(requestHasNonEmptyBody(postRequest("{}"))).resolves.toBe(true);
    await expect(requestHasNonEmptyBody(postRequest(undefined, { "content-length": "1" }))).resolves.toBe(true);
    await expect(requestHasNonEmptyBody(postRequest(undefined, { "content-length": "invalid" }))).resolves.toBe(true);
  });

  it("fails closed when the body stream cannot be read", async () => {
    const failingStream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("stream failure");
      },
    });

    await expect(requestHasNonEmptyBody(postRequest(failingStream))).resolves.toBe(true);
  });
});

