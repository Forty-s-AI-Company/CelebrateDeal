import fs from "node:fs";
import { isIP } from "node:net";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { detectContactHostKindInBrowser, normalizeContactHost, parseSafeContactUrlInBrowser } from "@/lib/contact-url-rules";
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
