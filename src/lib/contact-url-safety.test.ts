import fs from "node:fs";
import { isIP } from "node:net";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  detectContactHostKindInBrowser,
  isUnsafeContactHost,
  isUnsafeContactHostnameInBrowser,
  normalizeContactHost,
  parseSafeContactUrlInBrowser,
} from "@/lib/contact-url-rules";
import { CONTACT_URL_ACCEPTED_CASES, CONTACT_URL_CASES, CONTACT_URL_REFUSED_CASES } from "@/lib/contact-url-safety.cases";
import { isUnsafeContactHostname, parseSafeBrandContactUrl } from "@/lib/contact-url-safety";
import { sanitizeEmailBrandSnapshot } from "@/lib/email-delivery-pii";

const implementations = {
  /** Brand settings save (Server Action). */
  server: (input: string) => parseSafeBrandContactUrl(input),
  /** Brand settings preview in the browser, without `node:net`. */
  browser: (input: string) => parseSafeContactUrlInBrowser(input),
  /** Contact URL frozen into an email delivery snapshot. */
  emailSnapshot: (input: string) => sanitizeEmailBrandSnapshot({ version: 1, contactUrl: input })?.contactUrl ?? null,
} satisfies Record<string, (input: string) => string | null>;

describe("contact URL case table", () => {
  it("has unique names and covers both outcomes", () => {
    const names = CONTACT_URL_CASES.map((testCase) => testCase.name);
    expect(new Set(names).size).toBe(names.length);
    expect(CONTACT_URL_REFUSED_CASES.every((testCase) => testCase.expected === null)).toBe(true);
    expect(CONTACT_URL_ACCEPTED_CASES.every((testCase) => typeof testCase.expected === "string")).toBe(true);
    for (const input of ["https://2130706433/", "https://0x7f.0.0.1/", "https://127.1/"]) {
      expect(CONTACT_URL_REFUSED_CASES.map((testCase) => testCase.input)).toContain(input);
    }
  });
});

describe.each(Object.entries(implementations))("contact URL rules: %s", (_name, parse) => {
  it.each(CONTACT_URL_CASES.map((testCase) => [testCase.name, testCase] as const))("%s", (_caseName, testCase) => {
    expect(parse(testCase.input)).toBe(testCase.expected);
  });
});

describe("server and browser agree", () => {
  it("gives the same result for every case", () => {
    const disagreements = CONTACT_URL_CASES.filter((testCase) => (
      implementations.server(testCase.input) !== implementations.browser(testCase.input)
      || implementations.server(testCase.input) !== implementations.emailSnapshot(testCase.input)
    )).map((testCase) => testCase.name);
    expect(disagreements).toEqual([]);
  });

  it("detects the same host kind as node:net for every hostname new URL() produced", () => {
    let checked = 0;
    for (const testCase of CONTACT_URL_CASES) {
      let hostname: string;
      try {
        hostname = new URL(testCase.input.trim()).hostname;
      } catch {
        continue;
      }
      const host = normalizeContactHost(hostname);
      const nodeKind = ({ 4: "ipv4", 6: "ipv6" } as const)[isIP(host) as 4 | 6] ?? "name";
      expect(detectContactHostKindInBrowser(host), testCase.name).toBe(nodeKind);
      // Accepted cases have a safe host; refused cases may be refused for their shape instead.
      if (testCase.expected !== null) expect(isUnsafeContactHostname(hostname), testCase.name).toBe(false);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(40);
  });
});

/**
 * #661 review MINOR-1: `new URL()` rewrites every IPv6 host to compressed hex,
 * so the URL case table never reaches the parse-failure branch or the check on
 * an embedded dotted IPv4. These call the host checks with raw text instead.
 */
describe("raw IPv6 hosts that new URL() never produces", () => {
  it.each([
    ["1::2::3", true],
    ["12345::1", true],
    ["1:2:3:4:5:6:7:8:9", true],
    ["fe80::1%eth0", true],
    ["::127.0.0.1", true],
    ["::10.0.0.1", true],
    ["::ffff:10.0.0.1", true],
    ["64:ff9b::10.0.0.1", true],
    ["64:ff9b::169.254.169.254", true],
    ["2001:db8::1", false],
    ["::8.8.8.8", false],
    ["64:ff9b::8.8.8.8", false],
  ] as const)("isUnsafeContactHost(%s, ipv6) is %s", (host, unsafe) => {
    expect(isUnsafeContactHost(host, "ipv6")).toBe(unsafe);
  });

  // Hosts that both `node:net` isIP and the browser detection read as IPv6.
  const rawHostChecks = {
    node: isUnsafeContactHostname,
    browser: isUnsafeContactHostnameInBrowser,
  } satisfies Record<string, (hostname: string) => boolean>;

  describe.each(Object.entries(rawHostChecks))("%s hostname check", (_name, isUnsafe) => {
    it.each([
      // Parse failure fails closed (contact-url-rules.ts `if (!segments) return true`).
      ["fe80::1%eth0", true],
      // Private embedded dotted IPv4 makes the parse fail; without that check
      // `::127.0.0.1` would parse as a public-looking address.
      ["::127.0.0.1", true],
      ["[::127.0.0.1]", true],
      ["::10.0.0.1", true],
      ["64:ff9b::10.0.0.1", true],
      ["::ffff:10.0.0.1", true],
      ["::8.8.8.8", false],
      ["2001:db8::1", false],
    ] as const)("%s is unsafe: %s", (hostname, unsafe) => {
      expect(isIP(normalizeContactHost(hostname))).toBe(6);
      expect(isUnsafe(hostname)).toBe(unsafe);
    });
  });

  it("refuses a malformed IPv6 host in the browser, where any host with a colon is IPv6", () => {
    // `node:net` isIP does not read "1::2::3" as IPv6; `new URL()` throws on it before either check runs.
    expect(isUnsafeContactHostnameInBrowser("1::2::3")).toBe(true);
    expect(() => new URL("https://[1::2::3]/")).toThrow();
  });
});

describe("one implementation of the rules", () => {
  const sourceRoot = path.join(process.cwd(), "src");
  const read = (relativePath: string) => fs.readFileSync(path.join(sourceRoot, relativePath), "utf8");

  it("keeps the browser rules free of Node built-ins and server-only", () => {
    const rules = read("lib/contact-url-rules.ts");
    expect(rules).not.toMatch(/from\s+["']node:/u);
    expect(rules).not.toMatch(/["']server-only["']/u);
  });

  it("guards the server entry point with server-only", () => {
    expect(read("lib/contact-url-safety.ts")).toMatch(/^import "server-only";$/mu);
  });

  it("has the email snapshot and brand form use the shared rules instead of their own copies", () => {
    for (const file of ["lib/email-delivery-pii.ts", "components/brand-settings-form.tsx", "lib/contact-url-safety-node.ts"]) {
      const source = read(file);
      expect(source, file).not.toMatch(/function (?:isPrivateOrSpecialIpv4|parseIpv6Segments|isUnsafeIpv6)\b/u);
    }
    expect(read("lib/email-delivery-pii.ts")).toContain('from "@/lib/contact-url-safety-node"');
    expect(read("components/brand-settings-form.tsx")).toContain('from "@/lib/contact-url-rules"');
  });
});
