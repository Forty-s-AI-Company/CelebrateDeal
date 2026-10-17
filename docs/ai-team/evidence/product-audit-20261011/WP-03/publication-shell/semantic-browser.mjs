import { build } from "esbuild";
import { chromium, firefox } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const output = path.join(root, "docs/ai-team/evidence/product-audit-20261011/WP-03/publication-shell/browser-result.json");
const bundle = path.join(root, ".ai-team/tmp/wp03-policy-semantic.cjs");
await mkdir(path.dirname(bundle), { recursive: true });
const result = { status: "FAIL", scope: "Static SSR semantic accessibility only; production CSS and running Next server NOT_RUN", pages: [] };
try {
  await build({ stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {PolicyDocument} from './src/components/public-policy'; import {policyDrafts} from './src/lib/public-policy-content'; export const pages = Object.values(policyDrafts).map(draft => ({slug:draft.slug,html:renderToStaticMarkup(<PolicyDocument draft={draft}/>)}));`, resolveDir: root, loader: "tsx" }, bundle: true, platform: "node", format: "cjs", jsx: "automatic", outfile: bundle, external: ["react", "react-dom/server", "react/jsx-runtime", "next/link"], logLevel: "silent" });
  const { pages } = createRequire(import.meta.url)(bundle);
  for (const [engine, browserType] of [["chromium",chromium],["firefox",firefox]]) {
    const browser = await browserType.launch({ headless:true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.route("**/*", route => route.abort());
      for (const fixture of pages) {
        await page.setContent(`<!doctype html><html lang="zh-Hant"><head><title>政策草稿驗證</title></head><body>${fixture.html}</body></html>`);
        assert.equal(await page.getByRole("status").count(), 1);
        assert.match(await page.getByRole("status").innerText(), /政策尚未正式發布/);
        assert.equal(await page.locator("time").count(), 0);
        const axe = await new AxeBuilder({page}).analyze();
        result.lastCheck = {engine, slug:fixture.slug, violations:axe.violations.map(item => ({id:item.id, impact:item.impact, targets:item.nodes.map(node => node.target)}))};
        assert.equal(axe.violations.length, 0);
        result.pages.push({engine,slug:fixture.slug,status:"PASS",violations:0,publishedDateInvented:false});
      }
    } finally { await browser.close(); }
  }
  result.status = "PASS";
} finally {
  await unlink(bundle).catch(error => { if (error.code !== "ENOENT") throw error; });
  await writeFile(output, JSON.stringify(result,null,2));
}
console.log(JSON.stringify({status:result.status,pages:result.pages.length}));
