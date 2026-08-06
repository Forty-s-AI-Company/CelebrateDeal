import test from 'node:test';
import assert from 'node:assert/strict';
import { WP146_CONSTANTS, buildReconciliation, serializeWp146Receipt, validateWp146Receipt } from './wp146-payuni-sandbox-reconciliation.mjs';

const sha = `sha256:${'b'.repeat(64)}`;
const base = {
  wp117: { sandboxAction: { productionEndpointUsed: false, productionCredentialUsed: false }, postRefundLocalObservation: { reconciled: false } },
  wp118: { acceptance: { live_sandbox_or_staging_proof: false } },
  wp132Routing: { preflight: { non_production_db_identity_proven: false } },
  wp132Postdeploy: { staging: { route_not_found: false, authenticated_admin_ui: true }, local_snapshot: { pending_reservation_count: 0 } },
  digests: { wp117: sha, wp118: sha, wp132Routing: sha, wp132Postdeploy: sha }
};

test('WP146 declares four sanitized evidence inputs', () => assert.equal(WP146_CONSTANTS.INPUT_COUNT, 4));

test('zero pending reservation is exact no-go with no score change', () => {
  const receipt = buildReconciliation(base);
  assert.equal(receipt.classification, 'EXACT_NO_GO_EXTERNAL_REFRESH_REQUIRED');
  assert.equal(receipt.syntheticPendingReservationCount, 0);
  assert.equal(receipt.scoreImpact.CAT04.after, 6.0);
  assert.equal(receipt.sideEffects.network, 0);
});

test('one pending reservation still fails without current version and DB identity markers', () => {
  const receipt = buildReconciliation({ ...base, wp132Postdeploy: { ...base.wp132Postdeploy, local_snapshot: { pending_reservation_count: 1 } } });
  assert.equal(receipt.classification, 'EXACT_NO_GO_EXTERNAL_REFRESH_REQUIRED');
  assert.equal(receipt.currentIdentity.versionMarker, false);
  assert.equal(receipt.currentIdentity.databaseIdentityMarker, false);
});

test('production identity is always fail-closed', () => {
  const receipt = buildReconciliation({ ...base, wp117: { ...base.wp117, sandboxAction: { productionEndpointUsed: true, productionCredentialUsed: false } } });
  assert.equal(receipt.classification, 'EXACT_NO_GO_EXTERNAL_REFRESH_REQUIRED');
  assert.equal(receipt.currentIdentity.productionIdentityDetected, true);
});

test('sanitized receipt schema rejects unknown or raw fields', () => {
  const receipt = buildReconciliation(base);
  assert.equal(validateWp146Receipt(receipt).ok, true);
  receipt.rawResponse = 'forbidden';
  assert.equal(validateWp146Receipt(receipt).ok, false);
});

test('canonical receipt serialization is deterministic', () => {
  const receipt = buildReconciliation(base);
  assert.equal(serializeWp146Receipt(receipt), serializeWp146Receipt(receipt));
});
