import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { TEAM_VIDEO_EXECUTION_FILES, TEAM_VIDEO_MIRROR_CONFIG_FILES, teamVideoSourceRevision } from "./team-video-source-snapshot.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-team-video-source-test-"));
  for (const directory of ["src", "prisma", "public"]) fs.mkdirSync(path.join(root, directory), { recursive: true });
  for (const name of [...TEAM_VIDEO_EXECUTION_FILES, "src/synthetic.ts", "prisma/schema.prisma", "public/synthetic.txt"]) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `synthetic source for ${name}\n`);
  }
  return root;
}

it("binds every copied mirror config and every declared execution dependency", () => {
  const root = fixture();
  try {
    expect(TEAM_VIDEO_MIRROR_CONFIG_FILES.every(name => TEAM_VIDEO_EXECUTION_FILES.includes(name))).toBe(true);
    const baseline = teamVideoSourceRevision(root);
    for (const name of TEAM_VIDEO_EXECUTION_FILES) {
      const target = path.join(root, name);
      const original = fs.readFileSync(target);
      fs.appendFileSync(target, "synthetic revision change\n");
      expect(teamVideoSourceRevision(root), name).not.toBe(baseline);
      fs.writeFileSync(target, original);
      expect(teamVideoSourceRevision(root), name).toBe(baseline);
    }
  } finally {
    // This path was created by this test; it contains synthetic files only.
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("binds runtime source, migration schema and public assets", () => {
  const root = fixture();
  try {
    const baseline = teamVideoSourceRevision(root);
    for (const name of ["src/synthetic.ts", "prisma/schema.prisma", "public/synthetic.txt"]) {
      const target = path.join(root, name);
      const original = fs.readFileSync(target);
      fs.appendFileSync(target, "synthetic revision change\n");
      expect(teamVideoSourceRevision(root), name).not.toBe(baseline);
      fs.writeFileSync(target, original);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
