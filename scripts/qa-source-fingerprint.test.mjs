import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { captureSourceFingerprint, assertSourceFingerprintStable } from "./qa-source-fingerprint.mjs";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-source-proof-")); roots.push(root);
  const file = "src/app/(app)/products/[id]/edit/page.tsx";
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), "synthetic merchant source");
  fs.writeFileSync(path.join(root, "next.config.ts"), "synthetic build config");
  return { root, files: [file, "next.config.ts"] };
}
it.each(["src/app/(app)/products/[id]/edit/page.tsx", "next.config.ts"])("rejects a mid-run change to %s", file => {
  const { root, files } = fixture();
  const before = captureSourceFingerprint(root, files);
  fs.appendFileSync(path.join(root, file), " changed");
  const after = captureSourceFingerprint(root, files);
  expect(after[file]).not.toBe(before[file]);
  expect(() => assertSourceFingerprintStable(before, after)).toThrow("source-changed");
});
it("is stable across duplicate and reordered declarations", () => {
  const { root, files } = fixture();
  const before = captureSourceFingerprint(root, files);
  expect(() => assertSourceFingerprintStable(before, captureSourceFingerprint(root, [...files].reverse().concat(files)))).not.toThrow();
});
it("rejects sensitive or escaping declarations before reading files", () => {
  const { root } = fixture();
  for (const file of [".env", ".env.local", "src/.env.test", "../outside.txt", path.resolve(root, "next.config.ts")]) {
    expect(() => captureSourceFingerprint(root, [file])).toThrow("invalid-source-file");
  }
});
