import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const legacyModule = resolve(root, "lib/rate-limit");
const paymentExceptions = new Set([
  "app/api/payments/checkout/route.ts", "app/api/payments/checkout/admission/route.ts",
  "app/api/payments/checkout/recovery/route.ts", "app/api/checkout/upsell/route.ts",
]);
const normalizedCallers = new Set([
  "app/api/live-chat/instructor/route.ts", "app/api/live-chat/messages/route.ts",
  "app/api/live-chat/private/route.ts", "app/api/live-purchase-broadcasts/route.ts",
  "lib/trusted-entry-rate-limit.ts",
]);
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.tsx?$/u.test(entry.name) && !/\.(?:test|d)\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

// Security boundary: future source limiters cannot silently bypass the trusted resolver.
// Payment behavior is explicitly outside WP11. Subject-only and normalized callers
// remain supported, but their argument shape must not reintroduce raw requests.
function checkBoundary(name: string, source: string) {
  const violations: string[] = [];
    const path = resolve(root, name);
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    function isLegacy(specifier: string) {
      // The project uses @/* plus relative imports; explicit JS extensions resolve to TS.
      const target = specifier.startsWith("@/") ? resolve(root, specifier.slice(2)) : resolve(dirname(path), specifier);
      return target.replace(/\.[cm]?[jt]sx?$/u, "").replace(/[/\\]index$/u, "") === legacyModule;
    }
    const legacyBindings = new Set<string>();
    for (const statement of file.statements) {
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        && isLegacy(statement.moduleSpecifier.text)) violations.push(`${name}: legacy re-export`);
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (!isLegacy(specifier)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) { violations.push(`${name}: opaque legacy import`); continue; }
      for (const binding of bindings.elements) {
        if ((binding.propertyName ?? binding.name).text === "checkRateLimit") legacyBindings.add(binding.name.text);
      }
    }
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        const modulePath = node.arguments[0];
        if (modulePath && ts.isStringLiteral(modulePath) && isLegacy(modulePath.text)) violations.push(`${name}: opaque legacy load`);
      }
      if (paymentExceptions.has(name)) { ts.forEachChild(node, visit); return; }
      if (ts.isIdentifier(node) && legacyBindings.has(node.text) && !ts.isImportSpecifier(node.parent)) {
        const call = node.parent;
        if (!ts.isCallExpression(call) || call.expression !== node) {
          violations.push(`${name}: legacy function escaped its checked call`);
        } else {
          const request = call.arguments[0];
          const normalized = normalizedCallers.has(name) && request && ts.isCallExpression(request)
            && ts.isIdentifier(request.expression) && request.expression.text === "rateLimitRequestWithIdentity";
          const recipientUrl = request && ts.isNewExpression(request) ? request.arguments?.[0] : undefined;
          const canonicalUrl = recipientUrl && ts.isCallExpression(recipientUrl) && ts.isIdentifier(recipientUrl.expression)
            && recipientUrl.expression.text === "getCanonicalAppUrl" && recipientUrl.arguments.length === 0;
          const recipient = canonicalUrl && name === "app/actions/student-portal-actions.ts" && node.text === "checkRecipientRateLimit"
            && request && ts.isNewExpression(request) && ts.isIdentifier(request.expression)
            && request.expression.text === "Request" && request.arguments?.length === 1;
          if (!normalized && !recipient) violations.push(`${name}: unverified legacy request`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  return violations;
}

it("permits legacy limiting only for documented payment, normalized, or recipient-only callers", () => {
  const violations = sourceFiles(root).flatMap(path => checkBoundary(relative(root, path).replaceAll("\\", "/"), readFileSync(path, "utf8")));
  expect(violations).toEqual([]);
});

it.each(["await sourceRequest()", "req"])("rejects a recipient Request clone from %s", argument => {
  expect(checkBoundary("app/actions/student-portal-actions.ts", `import { checkRateLimit as checkRecipientRateLimit } from "@/lib/rate-limit";
    checkRecipientRateLimit(new Request(${argument}), "recipient", 3, 60000);`)).not.toEqual([]);
});
it("accepts only the explicit canonical URL recipient construction", () => {
  expect(checkBoundary("app/actions/student-portal-actions.ts", `import { checkRateLimit as checkRecipientRateLimit } from "@/lib/rate-limit";
    checkRecipientRateLimit(new Request(getCanonicalAppUrl()), "recipient", 3, 60000);`)).toEqual([]);
});
it.each([
  'export { checkRateLimit as limit } from "@/lib/rate-limit";',
  'export * from "./rate-limit";',
  'const legacy = await import("./rate-limit");',
  'const legacy = require("./rate-limit.js");',
  'import { checkRateLimit } from "./rate-limit.js"; checkRateLimit(req, "raw", 1, 1000);',
  'import { checkRateLimit } from "./rate-limit.ts"; checkRateLimit(req, "raw", 1, 1000);',
])("rejects opaque or renamed legacy access: %s", source => {
  expect(checkBoundary("lib/synthetic-caller.ts", source)).not.toEqual([]);
});
