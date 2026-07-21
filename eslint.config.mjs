import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    // Test coverage is generated output, not source code to lint.
    "coverage/**",
    // Playwright recreates this directory at run start; ignoring it also avoids
    // an ESLint filesystem race when browser tests and lint overlap in CI.
    "test-results/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
