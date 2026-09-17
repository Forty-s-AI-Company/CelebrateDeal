import { describe, expect, it } from "vitest";
import { sanitizeFunnelHtml } from "./sandboxed-html";

describe("sanitizeFunnelHtml", () => {
  it("removes scripts, handlers, unsafe URL schemes and form controls", () => {
    const output = sanitizeFunnelHtml(`<script>alert(1)</script><img src="javascript:alert(1)" onerror="alert(2)"><a href="data:text/html,pwn">bad</a><form action="https://evil.test"><input name="email"></form><p title="safe">內容</p>`);
    expect(output).not.toMatch(/script|onerror|javascript:|data:|form|input/iu);
    expect(output).toContain('<a rel="noreferrer noopener">bad</a>');
    expect(output).toContain('<p title="safe">內容</p>');
  });

  it("keeps only HTTPS, same-site paths and anchors", () => {
    const output = sanitizeFunnelHtml(`<a href="https://example.com/a">https</a><a href="/safe">path</a><a href="#part">anchor</a><img src="http://example.com/x.png">`);
    expect(output).toContain('href="https://example.com/a"');
    expect(output).toContain('href="/safe"');
    expect(output).toContain('href="#part"');
    expect(output).not.toContain("http://example.com/x.png");
  });
});
