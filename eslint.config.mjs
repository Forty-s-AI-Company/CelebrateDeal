import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      // New production functions must stay below these reviewable defaults.
      // Existing hotspots use file-specific ratchets below, so their current
      // debt cannot grow while they are extracted in small, tested batches.
      complexity: ["error", 30],
      "max-lines-per-function": [
        "error",
        {
          max: 300,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },
  {
    files: ["src/app/api/form-submissions/route.ts"],
    rules: {
      complexity: ["error", 47],
    },
  },
  {
    files: ["src/lib/env.ts"],
    rules: {
      complexity: ["error", 53],
    },
  },
  {
    files: ["src/lib/payment-webhooks.ts"],
    rules: {
      complexity: ["error", 61],
    },
  },
  {
    files: ["src/lib/team-funnel-access.ts"],
    rules: {
      complexity: ["error", 57],
    },
  },
  {
    files: ["src/lib/team-funnel-dynamic-fields.ts"],
    rules: {
      complexity: ["error", 31],
    },
  },
  {
    files: ["src/lib/team-funnel-public-page.ts"],
    rules: {
      complexity: ["error", 32],
    },
  },
  {
    files: ["src/components/interaction-script-form.tsx"],
    rules: {
      "max-lines-per-function": [
        "error",
        {
          max: 312,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },
  {
    files: ["src/components/live-playback.tsx"],
    rules: {
      "max-lines-per-function": [
        "error",
        {
          max: 302,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },
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
