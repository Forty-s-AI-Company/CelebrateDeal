import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Creates an explicitly synthetic, disposable JSON input for contract tests.
 * The fixture never enters the repository evidence tree or represents a
 * staging/Production observation.
 */
export function createSyntheticJsonFixture(filename, value) {
  if (!/^[A-Za-z0-9._-]+\.json$/u.test(filename)) throw new Error("SYNTHETIC_FIXTURE_FILENAME_INVALID");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-contract-fixture-"));
  const filePath = path.join(root, filename);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return Object.freeze({
    path: filePath,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  });
}
