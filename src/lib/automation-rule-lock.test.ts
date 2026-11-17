import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const monitoring = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: monitoring.capture }));

import { reportCancelledRuleLockWait } from "@/lib/automation-rule-lock";

const known = (code: string, meta?: Record<string, unknown>, message = "raw") =>
  new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: "test", ...(meta ? { meta } : {}) });

beforeEach(() => {
  monitoring.capture.mockClear();
});

describe("reportCancelledRuleLockWait", () => {
  it("reports a cancelled lock wait (57014) once, as a warning with only safe context", () => {
    const error = known("P2010", { code: "57014" }, "Raw query failed. Code: `57014`. Message: `ERROR: canceling statement due to user request`");
    reportCancelledRuleLockWait(error);
    expect(monitoring.capture.mock.calls).toEqual([[error, { source: "automation_rule_write", operation: "lock_wait_cancelled" }, { level: "warning" }]]);
  });

  it("reports a statement_timeout too (57014 by message)", () => {
    reportCancelledRuleLockWait(new Prisma.PrismaClientUnknownRequestError("ERROR: canceling statement due to statement timeout", { clientVersion: "test" }));
    expect(monitoring.capture).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a lock_timeout (55P03)", known("P2010", { code: "55P03" }, "canceling statement due to lock timeout")],
    ["a transaction timeout (P2028)", known("P2028", undefined, "Transaction API error")],
    ["a unique conflict", known("P2002")],
    ["a plain error", new Error("canceling statement due to user request")],
    ["nothing", null],
  ])("stays silent for %s", (_label, error) => {
    reportCancelledRuleLockWait(error);
    expect(monitoring.capture).not.toHaveBeenCalled();
  });
});
