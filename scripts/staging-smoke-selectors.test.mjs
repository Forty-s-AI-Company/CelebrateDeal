import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DELIVERY_GROUP_NAME, FULFILLMENT_SELECT, PRODUCTS_HEADING, ROUTES, appNavigationSelectorForViewport } from "./staging-browser-smoke.mjs";
import { CREATE_NAME_LABEL, CREATE_SLUG_LABEL, CREATE_SUBMIT_LABEL, PUBLICATION_CHIP_DRAFT_LABEL, PUBLICATION_REGION_LABEL, PUBLISH_BUTTON_LABEL, PUBLISH_DIAGNOSIS_FRAGMENTS } from "./staging-funnel-smoke.mjs";

// The staging smoke runners only execute against a deployed alias, so a renamed heading or
// label surfaces there as an opaque BROWSER_EXECUTION_FAILED. These checks run in CI
// (npm run test:contracts) and fail on the PR that renames the copy instead.
const source = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("browser smoke route headings match the page titles they assert", () => {
  const pages = {
    dashboard: "src/app/(app)/dashboard/page.tsx",
    products: "src/app/(app)/products/page.tsx",
    product_preview: "src/app/(app)/products/[id]/preview/page.tsx",
    product_edit: "src/app/(app)/products/[id]/edit/page.tsx",
    billing_plans: "src/app/(app)/billing/plans/page.tsx",
  };
  assert.deepEqual(ROUTES.map((route) => route.id).sort(), Object.keys(pages).sort());
  for (const route of ROUTES) {
    const file = source(pages[route.id]);
    assert.ok(file.includes(`title="${route.heading}"`), `${route.id} heading "${route.heading}" is not a PageHeader title in ${pages[route.id]}`);
  }
});

test("product-edit hydration interaction targets the rendered fulfillment select and delivery group", () => {
  const form = source("src/components/product-form-client.tsx");
  assert.equal(FULFILLMENT_SELECT, 'select[name="fulfillmentType"]');
  assert.match(form, /name="fulfillmentType"/u);
  assert.match(form, /<option value="digital">/u);
  assert.match(form, /<option value="physical">/u);
  // The delivery fieldset is rendered only for non-physical types (React state, not server HTML).
  assert.match(form, /selectedFulfillmentType !== "physical"/u);
  assert.ok(form.includes(`<legend className="px-1 text-sm font-semibold text-emerald-950">${DELIVERY_GROUP_NAME}</legend>`));
  // A controlled select: the fieldset appears only after React hydrated it, which the runner waits for.
  assert.match(form, /^"use client";/u);
  assert.match(form, /value=\{selectedFulfillmentType\}/u);
  assert.match(form, /onChange=\{\(event\) => setSelectedFulfillmentType\(event\.target\.value\)\}/u);
});

test("app navigation lands on the product list heading the route check asserts", () => {
  assert.equal(PRODUCTS_HEADING, "商品");
  assert.ok(source("src/app/(app)/products/page.tsx").includes(`title="${PRODUCTS_HEADING}"`));
});

test("app navigation selectors match the app shell landmarks", () => {
  const shell = source("src/components/app-shell.tsx");
  const mobile = source("src/components/app-shell-mobile-nav.tsx");
  assert.ok(shell.includes('aria-label="主要導覽"'));
  assert.ok(mobile.includes('aria-label="行動版主要導覽"'));
  assert.ok(mobile.includes("更多功能"));
  assert.ok(mobile.includes('aria-haspopup="dialog"'));
  assert.equal(appNavigationSelectorForViewport("mobile"), 'nav[aria-label="行動版主要導覽"]:visible');
});

test("funnel smoke create step uses the goal picker labels and submit button", () => {
  const picker = source("src/components/landing-pages/funnel-goal-picker.tsx");
  assert.ok(picker.includes(`>${CREATE_NAME_LABEL}<input`), "name label");
  assert.ok(picker.includes(`>${CREATE_SLUG_LABEL}<div`), "slug label");
  assert.ok(picker.includes(`"建立中…" : "${CREATE_SUBMIT_LABEL}"`), "create button");
  assert.ok(picker.includes('title: "建立名單"'), "audience goal");
  assert.ok(picker.includes("建立新的一頁式網站"), "create heading");
  // The CI journey drives the same labels against a production build.
  const journey = source("tests/e2e/landing-page-flow.spec.ts");
  assert.ok(journey.includes(`getByLabel("${CREATE_NAME_LABEL}")`));
  assert.ok(journey.includes(`getByLabel("${CREATE_SLUG_LABEL}")`));
  assert.ok(journey.includes(`getByRole("button", { name: "${CREATE_SUBMIT_LABEL}", exact: true })`));
});

test("funnel smoke publish stage reads the chip, region, button and server diagnosis it classifies", () => {
  const chip = source("src/components/landing-page-publication-chip.tsx");
  assert.ok(chip.includes("aria-label={`發布狀態：${state.label}`}"), "chip accessible name");
  assert.ok(chip.includes('{ label: "草稿", tone: "draft" }'), "draft chip label");
  assert.equal(PUBLICATION_CHIP_DRAFT_LABEL, "發布狀態：草稿");
  assert.ok(chip.includes(`role="region" aria-label="${PUBLICATION_REGION_LABEL}"`), "diagnosis popover");
  assert.ok(chip.includes("{publication.message}"), "popover shows the server diagnosis");
  const panel = source("src/components/landing-pages/funnel-operations-panel.tsx");
  assert.ok(panel.includes(`{published ? "重新發布" : "${PUBLISH_BUTTON_LABEL}"}`), "publish button");
  assert.ok(panel.includes('<p role="status"'), "action feedback is a status");
  // Every fragment must be verbatim server copy, or the classification silently degrades to OTHER.
  const copy = [
    source("src/lib/independent-publish-limit.ts"),
    source("src/lib/landing-page-service.ts"),
    source("src/app/actions/landing-page-actions.ts"),
  ].join("\n");
  for (const [category, fragment] of PUBLISH_DIAGNOSIS_FRAGMENTS) assert.ok(copy.includes(fragment), `${category} fragment`);
  const journey = source("tests/e2e/landing-page-flow.spec.ts");
  assert.ok(journey.includes(`getByRole("button", { name: "${PUBLISH_BUTTON_LABEL}", exact: true })`));
});
