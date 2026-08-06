import test from "node:test";
import assert from "node:assert/strict";
import { TARGET_KEYS, buildSterileEnv, countTargetKeys, initialReceipt, validateDiagnosticReceipt } from "./fin08s-sterile-isolation-diagnostic.mjs";

test("FIN-08S keeps the controlled-name inventory explicit", () => {
  assert.equal(TARGET_KEYS.length, 9);
  assert.equal(countTargetKeys({ DATABASE_URL: "synthetic", PAYUNI_ENV: "sandbox" }), 2);
  assert.equal(countTargetKeys({ database_url: "synthetic" }), 0);
});

test("FIN-08S sterile environment contains only approved system names", () => {
  const sterile = buildSterileEnv({ PATH: "synthetic-path", DATABASE_URL: "masked", PAYUNI_ENV: "sandbox", USERPROFILE: "synthetic-user" });
  assert.equal(Object.hasOwn(sterile, "PATH"), true);
  assert.equal(Object.hasOwn(sterile, "USERPROFILE"), true);
  assert.equal(Object.hasOwn(sterile, "DATABASE_URL"), false);
  assert.equal(Object.hasOwn(sterile, "PAYUNI_ENV"), false);
});

test("FIN-08S accepts a zero-side-effect isolation pass only when all layers are clean", () => {
  const receipt = initialReceipt();
  receipt.status = "FIN08S_ISOLATION_PASS";
  receipt.parent.targetKeyPresence = 0;
  receipt.child.targetKeyPresence = 0;
  receipt.child.exitCode = 0;
  receipt.coordinator.targetKeyPresence = 0;
  receipt.coordinator.exitCode = 0;
  assert.equal(validateDiagnosticReceipt(receipt).ok, true);
  assert.equal(validateDiagnosticReceipt({ ...receipt, coordinator: { ...receipt.coordinator, targetKeyPresence: 1 } }).ok, false);
});

test("FIN-08S preserves a contaminated terminal without external credit", () => {
  const receipt = initialReceipt();
  receipt.status = "FIN08S_TERMINAL_NO_GO_CONTAMINATION";
  receipt.parent.targetKeyPresence = 5;
  receipt.child.targetKeyPresence = 1;
  receipt.child.exitCode = 0;
  receipt.coordinator.targetKeyPresence = 1;
  receipt.coordinator.exitCode = 0;
  assert.equal(validateDiagnosticReceipt(receipt).ok, true);
  assert.equal(validateDiagnosticReceipt({ ...receipt, external: { ...receipt.external, httpCalls: 1 } }).ok, false);
});
