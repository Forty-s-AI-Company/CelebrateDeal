import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkDocument, headerNonce, rootMainZodChunks, scriptNonceProblems } from "./csp-build-smoke.mjs";

const NONCE = "AAAAAAAAAAAAAAAAAAAAAA==";

describe("F-156 build smoke helpers", () => {
  it("finds zod only in root main chunks that contain it", () => {
    const files = {
      [path.join("/app", ".next", "build-manifest.json")]: JSON.stringify({ rootMainFiles: ["static/chunks/a.js", "static/chunks/b.js"] }),
      [path.join("/app", ".next", "static/chunks/a.js")]: "framework code",
      [path.join("/app", ".next", "static/chunks/b.js")]: 'x("$ZodObject",function(){})',
    };
    expect(rootMainZodChunks("/app", (file) => files[file])).toEqual(["static/chunks/b.js"]);
    expect(() => rootMainZodChunks("/app", () => "{}")).toThrow("no rootMainFiles");
  });

  it("reads the nonce from script-src only", () => {
    expect(headerNonce(`default-src 'self'; script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`)).toBe(NONCE);
    expect(headerNonce(`style-src-elem 'nonce-${NONCE}'`)).toBeNull();
    expect(headerNonce(null)).toBeNull();
  });

  it("requires every script tag to carry exactly the response nonce", () => {
    expect(scriptNonceProblems(`<script nonce="${NONCE}">a</script><script src="/x.js" nonce="${NONCE}" async></script>`, NONCE)).toEqual([]);
    expect(scriptNonceProblems(`<script nonce="${NONCE}"></script><script>b</script>`, NONCE)).toHaveLength(1);
    expect(scriptNonceProblems(`<script nonce="BBBBBBBBBBBBBBBBBBBBBB=="></script>`, NONCE)).toHaveLength(1);
    expect(scriptNonceProblems("<p>no scripts</p>", NONCE)).toEqual(["no <script> tags"]);
  });

  it("fails a document without an enforced nonce policy or with unsafe script sources", async () => {
    const respond = (headers, body) => async () => new Response(body, { headers });
    expect((await checkDocument("http://x", "/login", respond({ "content-security-policy": `script-src 'nonce-${NONCE}'` }, `<script nonce="${NONCE}"></script>`))).problems).toEqual([]);
    expect((await checkDocument("http://x", "/login", respond({ "content-security-policy-report-only": `script-src 'nonce-${NONCE}'` }, "<script></script>"))).problems).toEqual(["no enforced Content-Security-Policy header"]);
    expect((await checkDocument("http://x", "/login", respond({ "content-security-policy": `script-src 'nonce-${NONCE}' 'unsafe-inline'` }, `<script nonce="${NONCE}"></script>`))).problems).toEqual(["script-src allows unsafe-inline or unsafe-eval"]);
  });
});
