import { defineConfig } from "vitest/config";
import base from "./vitest.tracking-settings-db.config";

// Run the complete existing suites against the tracking branch's disposable
// migration chain; no payment assertions or test cases are excluded.
export default defineConfig({ ...base, test: { ...base.test,
  include: ["src/lib/payment-webhooks.test.ts", "src/lib/commerce-orders.db.test.ts"],
  testTimeout: 30000,
} });
