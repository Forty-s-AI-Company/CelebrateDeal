import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCHEMA_PATH = path.resolve("prisma/schema.prisma");
const MIGRATIONS_PATH = path.resolve("prisma/migrations");
const INVENTORY_PATH = path.resolve("docs/codex-goal/PRISMA_INVARIANTS.md");

describe("Prisma invariant inventory", () => {
  it("tracks every model and migration in the canonical inventory", () => {
    const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
    const inventory = fs.readFileSync(INVENTORY_PATH, "utf8");
    const models = Array.from(schema.matchAll(/^model\s+([A-Za-z0-9_]+)\s+\{/gm), (match) => match[1]);
    const migrations = fs.readdirSync(MIGRATIONS_PATH, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    // Keep these totals intentional: the canonical inventory below must be
    // updated in the same change as any schema model or migration directory.
    expect(models).toHaveLength(52);
    expect(migrations).toHaveLength(14);
    expect(models.filter((model) => !inventory.includes(`\`${model}\``))).toEqual([]);
    expect(migrations.filter((migration) => !inventory.includes(`\`${migration}\``))).toEqual([]);
  });
});
