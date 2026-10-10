import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

/** Fingerprint only declared, real files inside this owned source tree. */
export function captureSourceFingerprint(root, files) {
  const base = fs.realpathSync(root);
  return Object.fromEntries([...new Set(files)].sort().map(file => {
    if (typeof file !== "string" || path.isAbsolute(file) || file.split(/[\\/]/u).some(part => part === ".." || part.startsWith(".env"))) {
      throw new Error("invalid-source-file");
    }
    const target = fs.realpathSync(path.join(base, file));
    const relative = path.relative(base, target);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative) || !fs.statSync(target).isFile()) {
      throw new Error("source-outside-owned-tree");
    }
    return [file, createHash("sha256").update(fs.readFileSync(target)).digest("hex")];
  }));
}

export function assertSourceFingerprintStable(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("source-changed");
}
