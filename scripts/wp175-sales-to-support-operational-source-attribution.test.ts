import { describe, expect, it } from "vitest";
import {
  buildReceipt,
  digest,
  evaluateScenario,
  loadInputs,
  validateContract,
  validateReceipt,
  verifyProtectedSources,
} from "./wp175-sales-to-support-operational-rehearsal.mjs";

describe("WP175 sales-to-support source attribution", () => {
  it("loads the sanitized contract and verifies every protected source signal", () => {
    const { contract } = loadInputs();
    expect(validateContract(contract)).toEqual([]);
    expect(verifyProtectedSources(contract).missingPlanSignals).toEqual([]);
  });

  it("keeps digest output deterministic and content-sensitive", () => {
    expect(digest("same-input")).toBe(digest("same-input"));
    expect(digest("same-input")).not.toBe(digest("changed-input"));
    expect(digest("same-input")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports malformed contract schema, stage ownership and side-effect boundaries", () => {
    const errors = validateContract({
      schemaVersion: "bad",
      scope: "EXTERNAL",
      roles: [],
      stages: [{
        id: "stage-1",
        owner: "unknown-owner",
        requiredInputs: [],
        allowedEvidence: [],
        decisionState: "",
        prohibitedActions: [],
        nextOwner: "unknown-next-owner",
        stopCondition: [],
        sanitizedProjection: [],
      }],
      boundaries: {
        externalNetwork: true,
        databaseReads: true,
        databaseWrites: true,
        paymentRequests: true,
        refundRequests: true,
        callbackRequests: true,
        productionOperations: true,
      },
    });

    expect(errors).toEqual(expect.arrayContaining([
      "schema_version",
      "scope",
      "roles",
      "stages",
      "stage-1:requiredInputs",
      "stage-1:allowedEvidence",
      "stage-1:decisionState",
      "stage-1:prohibitedActions",
      "stage-1:stopCondition",
      "stage-1:sanitizedProjection",
      "stage-1:owner",
      "boundary:externalNetwork",
      "boundary:databaseReads",
      "boundary:databaseWrites",
      "boundary:paymentRequests",
      "boundary:refundRequests",
      "boundary:callbackRequests",
      "boundary:productionOperations",
    ]));
  });

  it("maps valid, faulted and malformed scenarios to bounded decisions", () => {
    const { contract, fixtures } = loadInputs();
    const positive = fixtures.positive[0];
    expect(evaluateScenario(positive, contract)).toMatchObject({
      id: positive.id,
      decision: positive.expected,
    });
    expect(evaluateScenario({ ...positive, fault: "synthetic fault" }, contract)).toEqual({
      id: positive.id,
      decision: "REJECTED",
      nextOwner: null,
    });
    expect(evaluateScenario({ ...positive, stage: "missing-stage" }, contract)).toEqual({
      id: positive.id,
      decision: "REJECTED",
      nextOwner: null,
    });
    expect(evaluateScenario({ ...positive, severity: "P3" }, contract)).toEqual({
      id: positive.id,
      decision: "REJECTED",
      nextOwner: null,
    });
  });

  it("builds a deterministic local receipt without claiming commercial readiness", () => {
    const { contract, fixtures } = loadInputs();
    const first = buildReceipt(contract, fixtures);
    const second = buildReceipt(contract, fixtures);

    expect(first).toEqual(second);
    expect(first.result).toBe("PASS");
    expect(first.scenarioCounts.failed).toBe(0);
    expect(first.sideEffects).toEqual(expect.objectContaining({
      externalNetwork: 0,
      databaseReads: 0,
      databaseWrites: 0,
      paymentRequests: 0,
      refundRequests: 0,
    }));
    expect(first.readiness).toEqual(expect.objectContaining({
      overallCommercialReadiness: "NOT_READY",
      SANDBOX_READY: false,
      PRODUCTION_READY: false,
    }));
    expect(validateReceipt(first)).toEqual([]);
  });

  it("rejects sensitive receipt keys, side effects and readiness overclaims", () => {
    const { contract, fixtures } = loadInputs();
    const receipt = buildReceipt(contract, fixtures);
    const invalid = {
      ...receipt,
      result: "FAIL_CLOSED",
      email: "synthetic@example.test",
      sideEffects: { ...receipt.sideEffects, databaseReads: 1 },
      readiness: {
        ...receipt.readiness,
        overallCommercialReadiness: "READY",
        SANDBOX_READY: true,
        PRODUCTION_READY: true,
      },
    };

    expect(validateReceipt(invalid)).toEqual(expect.arrayContaining([
      "forbidden_sensitive_key",
      "result_not_pass",
      "side_effect_detected",
      "commercial_readiness_overclaim",
      "readiness_overclaim",
    ]));
  });
});
