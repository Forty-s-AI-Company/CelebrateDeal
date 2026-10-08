import { defineConfig } from "@playwright/test";
import base from "./playwright.course-community.config";

// Reuse the same runner-owned DB, source mirror and server as community QA.
// The entire direct-URL guard matrix runs; no authorization case is filtered.
export default defineConfig({ ...base, testMatch: "wp88-direct-url-guard-matrix.spec.ts" });
