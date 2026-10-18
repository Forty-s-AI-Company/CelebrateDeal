import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const ROOT = process.cwd();
const schema = fs.readFileSync(path.join(ROOT, "prisma", "schema.prisma"), "utf8");
const migration = fs.readFileSync(
  path.join(ROOT, "prisma", "migrations", "20260808010000_live_product_tenant_binding", "migration.sql"),
  "utf8",
);
const actions = fs.readFileSync(path.join(ROOT, "src", "app", "actions.ts"), "utf8");
const bindings = fs.readFileSync(path.join(ROOT, "src", "lib", "live-product-bindings.ts"), "utf8");
const seed = fs.readFileSync(path.join(ROOT, "prisma", "seed.ts"), "utf8").replace(/\r\n/g, "\n");

describe("LiveProduct tenant binding contract", () => {
  it("declares vendor-scoped composite relations and lookup ordering", () => {
    const model = schema.match(/model LiveProduct \{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(model).toMatch(/vendorId\s+String/);
    expect(model).toContain("vendor  Vendor  @relation(fields: [vendorId], references: [id], onDelete: Cascade)");
    expect(model).toContain("live    Live    @relation(fields: [vendorId, liveId], references: [vendorId, id], onDelete: Cascade)");
    expect(model).toContain("product Product @relation(fields: [vendorId, productId], references: [vendorId, id], onDelete: Cascade)");
    expect(model).toContain("@@unique([vendorId, liveId, productId])");
    expect(model).toContain("@@index([vendorId, liveId, sortOrder])");
  });

  it("backfills safely and replaces unscoped foreign keys without deleting data", () => {
    expect(migration).toContain("LiveProduct tenant preflight failed");
    expect(migration).toContain('ALTER TABLE "LiveProduct" ADD COLUMN "vendorId" TEXT;');
    expect(migration).toContain('SET "vendorId" = l."vendorId"');
    expect(migration).toContain('ALTER COLUMN "vendorId" SET NOT NULL;');
    expect(migration).toContain('DROP CONSTRAINT "LiveProduct_liveId_fkey"');
    expect(migration).toContain('DROP CONSTRAINT "LiveProduct_productId_fkey"');
    expect(migration).toContain('"LiveProduct_vendorId_liveId_fkey"');
    expect(migration).toContain('"LiveProduct_vendorId_productId_fkey"');
    expect(migration).toContain('"LiveProduct_vendorId_liveId_productId_key"');
    expect(migration).not.toMatch(/\b(?:DELETE FROM|TRUNCATE|DROP TABLE)\b/i);
  });

  it("propagates the authenticated vendor into every production writer", () => {
    // Inspect both production writers after extraction, independent of formatting.
    const vendorExpressions: string[] = [];
    for (const [filename, text] of [["actions.ts", actions], ["live-product-bindings.ts", bindings]] as const) {
      const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isPropertyAssignment(node) && node.name.getText(source) === "products"
          && ts.isObjectLiteralExpression(node.initializer)
          && node.initializer.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText(source) === "create")) {
          const create = node.initializer.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === "create");
          expect(create && ts.isPropertyAssignment(create) && ts.isCallExpression(create.initializer)).toBe(true);
          if (!create || !ts.isPropertyAssignment(create) || !ts.isCallExpression(create.initializer)) return;
          const projection = create.initializer.arguments[0];
          expect(projection && ts.isArrowFunction(projection)).toBe(true);
          if (!projection || !ts.isArrowFunction(projection)) return;
          const body = ts.isParenthesizedExpression(projection.body) ? projection.body.expression : projection.body;
          expect(ts.isObjectLiteralExpression(body)).toBe(true);
          if (!ts.isObjectLiteralExpression(body)) return;
          const vendor = body.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === "vendorId");
          expect(vendor && ts.isPropertyAssignment(vendor)).toBe(true);
          if (vendor && ts.isPropertyAssignment(vendor)) vendorExpressions.push(vendor.initializer.getText(source));
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === "create"
          && ts.isPropertyAccessExpression(node.expression.expression)
          && node.expression.expression.name.text === "liveProduct") {
          const argument = node.arguments[0];
          expect(argument && ts.isObjectLiteralExpression(argument)).toBe(true);
          if (!argument || !ts.isObjectLiteralExpression(argument)) return;
          const data = argument.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === "data");
          expect(data && ts.isPropertyAssignment(data) && ts.isObjectLiteralExpression(data.initializer)).toBe(true);
          if (!data || !ts.isPropertyAssignment(data) || !ts.isObjectLiteralExpression(data.initializer)) return;
          const vendor = data.initializer.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === "vendorId");
          expect(vendor && ts.isPropertyAssignment(vendor)).toBe(true);
          if (vendor && ts.isPropertyAssignment(vendor)) vendorExpressions.push(vendor.initializer.getText(source));
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(vendorExpressions).toEqual(["input.vendorId", "input.vendorId"]);
    expect(actions).toContain("replaceLiveProductBindings(tx, { vendorId: input.vendorId, liveId: input.liveId!, productIds: input.productIds })");
    expect(seed).toContain("create: products.map((product, index) => ({\n          vendorId: vendor.id,");
  });
});
