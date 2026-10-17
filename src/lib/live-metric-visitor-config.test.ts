import { expect, it } from "vitest";
import { metricVisitorProofsFromConfig } from "./live-metric-visitor-config";

it.each([undefined, "", "{", "x".repeat(2049), JSON.stringify({ current: { id: "a", key: "short" } })])("rejects invalid key config without throwing %#", value => {
  expect(metricVisitorProofsFromConfig(value)).toBeNull();
});
it("accepts synthetic injected keys and rejects duplicate identifiers", () => {
  const current = { id: "a", key: "07".repeat(32) };
  const service = metricVisitorProofsFromConfig(JSON.stringify({ current }))!;
  const scope = { vendorId: "v", liveId: "l", versionId: "version" };
  const issued = service.issue(scope, 100, 200);
  expect(service.verify(issued.proof, scope, 150)).toBe(issued.visitorId);
  expect(metricVisitorProofsFromConfig(JSON.stringify({ current, previous: [current] }))).toBeNull();
});
