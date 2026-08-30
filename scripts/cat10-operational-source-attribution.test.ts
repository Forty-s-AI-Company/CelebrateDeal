import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildReceipt as buildOnboardingReceipt,
  expectedStageIds,
  loadJson,
  validateOnboardingContract,
} from "./wp122-merchant-onboarding-validator.mjs";
import {
  baselinePacket,
  evaluatePacket,
  runDryRun,
  validateContract as validateOwnerContract,
  validateReceipt as validateOwnerReceipt,
} from "./wp195-launch-owner-acceptance.mjs";

const root = path.resolve(".");
const onboardingContract = JSON.parse(fs.readFileSync(path.join(root, "docs/launch/wp122-merchant-onboarding-contract.json"), "utf8"));
const onboardingFixture = JSON.parse(fs.readFileSync(path.join(root, "scripts/wp122-merchant-onboarding-fixture.json"), "utf8"));
const ownerContract = JSON.parse(fs.readFileSync(path.join(root, "docs/launch/wp195-launch-owner-acceptance-contract.json"), "utf8"));
const ownerFixtures = JSON.parse(fs.readFileSync(path.join(root, "scripts/wp195-launch-owner-acceptance-fixtures.json"), "utf8"));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("CAT10 WP122 onboarding source attribution", () => {
  it("accepts the local contract while keeping human acceptance pending", () => {
    const result = validateOnboardingContract(onboardingContract, onboardingFixture);
    expect(result).toMatchObject({
      status: "PASS",
      stageCount: expectedStageIds.length,
      roleCount: 6,
      manualRehearsal: "PENDING",
      legalApproval: "PENDING",
      supportReadiness: "PENDING",
      overallReadiness: "NOT_READY",
    });
    expect(buildOnboardingReceipt(result)).toMatchObject({
      workPackage: "WP-122",
      overallReadiness: "NOT_READY",
      labels: { SANDBOX_READY: false, PRODUCTION_READY: false },
      externalSideEffects: false,
      productionOperation: false,
    });
  });

  it("keeps JSON loading object-only and cloning input values", () => {
    const loaded = loadJson(JSON.stringify(onboardingContract), "contract");
    expect(loaded).toEqual(onboardingContract);
    expect(loaded).not.toBe(onboardingContract);
    expect(() => loadJson("not-json", "contract")).toThrow();
    expect(() => loadJson([], "contract")).toThrow(/JSON object/);
  });

  it("rejects contract identity, role, stage and fixture drift", () => {
    const invalidCases = [
      () => ({ ...clone(onboardingContract), schemaVersion: "wrong" }),
      () => ({ ...clone(onboardingContract), contractStatus: "READY" }),
      () => ({ ...clone(onboardingContract), roles: clone(onboardingContract.roles).slice(0, 5) }),
      () => ({
        ...clone(onboardingContract),
        roles: [clone(onboardingContract.roles[0]), ...clone(onboardingContract.roles.slice(2))],
      }),
      () => ({
        ...clone(onboardingContract),
        stages: [{ ...clone(onboardingContract.stages[0]), id: "wrong-stage" }, ...clone(onboardingContract.stages.slice(1))],
      }),
      () => ({
        ...clone(onboardingContract),
        stages: [{ ...clone(onboardingContract.stages[0]), ownerRoles: ["unknown-role"] }, ...clone(onboardingContract.stages.slice(1))],
      }),
    ];

    for (const makeContract of invalidCases) {
      expect(() => validateOnboardingContract(makeContract(), onboardingFixture)).toThrow();
    }

    for (const mutateFixture of [
      (fixture: Record<string, unknown>) => { fixture.schemaVersion = "wrong"; },
      (fixture: Record<string, unknown>) => { fixture.localContract = "BLOCKED"; },
      (fixture: Record<string, unknown>) => { fixture.manualRehearsal = "PASS"; },
      (fixture: Record<string, unknown>) => { fixture.overallReadiness = "READY"; },
      (fixture: Record<string, unknown>) => { fixture.SANDBOX_READY = true; },
      (fixture: Record<string, unknown>) => { delete fixture.stageEvidence; },
    ]) {
      const fixture = clone(onboardingFixture) as Record<string, unknown>;
      mutateFixture(fixture);
      expect(() => validateOnboardingContract(onboardingContract, fixture)).toThrow();
    }
  });

  it("rejects sensitive, placeholder and invalid stage evidence values", () => {
    const sensitive = clone(onboardingFixture);
    sensitive.evidenceRefs = ["Bearer synthetic-value"];
    expect(() => validateOnboardingContract(onboardingContract, sensitive)).toThrow();

    const placeholder = clone(onboardingFixture);
    placeholder.evidenceRefs = ["TODO: assign owner"];
    expect(() => validateOnboardingContract(onboardingContract, placeholder)).toThrow();

    const invalidStatus = clone(onboardingFixture);
    invalidStatus.stageEvidence[expectedStageIds[0]] = "UNKNOWN";
    expect(() => validateOnboardingContract(onboardingContract, invalidStatus)).toThrow();
  });
});

describe("CAT10 WP195 owner acceptance source attribution", () => {
  it("keeps five responsibility roles while allowing one shared holder", () => {
    expect(validateOwnerContract(ownerContract)).toEqual({ ok: true, errors: [] });
    const packet = baselinePacket(ownerContract, ownerFixtures.fixedTimestamp);
    expect(evaluatePacket(ownerContract, packet)).toEqual({ inputRejected: false, blockers: [] });

    const receipt = runDryRun(ownerContract, ownerFixtures);
    expect(receipt).toMatchObject({
      status: "WP195_COMPLETE_CANDIDATE",
      aggregation: {
        manualSignatures: "PENDING",
        releaseStatus: "HOLD_NOT_READY",
        productionReady: false,
        overallCommercialReadiness: "NOT_READY",
      },
      scoreImpact: { applied: false },
    });
    expect(receipt.ownerMatrix).toMatchObject({
      requiredRoleCount: 5,
      coveredRoleCount: 5,
      sameHumanMultipleRoles: true,
      distinctHumanRequired: false,
      holderRefCount: 1,
    });
    expect(validateOwnerReceipt(receipt)).toEqual({ ok: true, errors: [] });
  });

  it("rejects owner contract and packet identity drift before acceptance", () => {
    const wrongSchema = { ...clone(ownerContract), schemaVersion: "wrong" };
    expect(validateOwnerContract(wrongSchema).errors).toContain("SCHEMA");

    const missingOwner = { ...clone(ownerContract), owners: clone(ownerContract.owners).slice(1) };
    expect(validateOwnerContract(missingOwner).errors).toContain("ROLE_SET");

    const badStates = { ...clone(ownerContract), allowedDecisionStates: ["ACCEPTED"] };
    expect(validateOwnerContract(badStates).errors).toContain("DECISION_STATES");

    const packet = baselinePacket(ownerContract, ownerFixtures.fixedTimestamp);
    expect(evaluatePacket(ownerContract, { productionReady: true })).toEqual({
      inputRejected: true,
      blockers: ["PRODUCTION_READY_CLAIM_REJECTED"],
    });
    expect(evaluatePacket(ownerContract, [...packet, { ownerId: "unknown", decision: "ACCEPTED", manualSignature: "PENDING", evidence: [] }]).blockers)
      .toContain("ROLE_SET_INVALID");
  });

  it("preserves explicit blockers for missing evidence, state, signature and sensitive data", () => {
    const packet = baselinePacket(ownerContract, ownerFixtures.fixedTimestamp);
    const missing = clone(packet);
    missing[0].evidence = [];
    expect(evaluatePacket(ownerContract, missing).blockers.some((item: string) => item.startsWith("EVIDENCE_MISSING:"))).toBe(true);

    const invalid = clone(packet);
    const finance = invalid.find((item: { ownerId: string }) => item.ownerId === "finance_owner");
    expect(finance).toBeDefined();
    finance!.decision = "UNKNOWN";
    finance!.manualSignature = "SIGNED";
    finance!.evidence[0].sourceRef = "invalid-source";
    finance!.evidence[0].capturedAt = "2026-01-01T00:00:00Z";
    finance!.evidence[0].sanitized = false;
    expect(evaluatePacket(ownerContract, invalid).blockers).toEqual(expect.arrayContaining([
      "STATE_INVALID:finance_owner",
      "SIGNATURE_INVALID:finance_owner",
    ]));

    const sensitive = clone(packet);
    sensitive[0].evidence[0].sourceRef = "secret:unsafe";
    expect(evaluatePacket(ownerContract, sensitive)).toEqual({
      inputRejected: true,
      blockers: ["SENSITIVE_INPUT_REJECTED"],
    });
  });

  it("rejects receipt drift without turning local evidence into release approval", () => {
    const receipt = runDryRun(ownerContract, ownerFixtures);
    const invalid = clone(receipt);
    invalid.status = "WP195_FAIL_CLOSED";
    invalid.sideEffects.network = 1;
    invalid.aggregation.productionReady = true;
    invalid.scoreImpact.applied = true;
    expect(validateOwnerReceipt(invalid).errors).toEqual(expect.arrayContaining([
      "STATUS",
      "AGGREGATION",
      "SIDE_EFFECTS",
      "SCORE_APPLIED",
    ]));
  });
});
