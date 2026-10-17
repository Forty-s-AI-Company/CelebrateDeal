import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { createDashboardQueryMeasurement, readDashboardKpiCounts } from "./dashboard-read-model";

type QueryOutcome = "success" | "prisma-pool-timeout" | "blocked/unsupported" | "error";

type QueryEvidence = {
  outcome: QueryOutcome;
  queryEvents: {
    count: number;
    aggregateDurationMs: number;
  };
  readOperationMeasurement: {
    count: number;
    durationMs: number;
  };
};

function classifyDatabaseFailure(error: unknown): Exclude<QueryOutcome, "success"> {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : null;
  if (code === "P2024") {
    return "prisma-pool-timeout";
  }
  if (["P1000", "P1001", "P1002", "P1003", "P1010", "P1011", "P1012", "P1013", "P1017", "P2021", "P2022"].includes(code ?? "")) {
    return "blocked/unsupported";
  }
  if (error instanceof Error && error.name === "PrismaClientInitializationError") return "blocked/unsupported";
  return "error";
}

function emitSanitizedEvidence(evidence: QueryEvidence) {
  // Keep this evidence aggregate-only. Never include SQL, params, rows, or fixture identity.
  console.info("[dashboard.query-event.evidence]", JSON.stringify(evidence));
}

function poolOneDatabaseUrl() {
  const configuredUrl = process.env.DATABASE_URL;
  if (!configuredUrl) throw new Error("dashboard query evidence database configuration missing");
  try {
    const url = new URL(configuredUrl);
    url.searchParams.set("connection_limit", "1");
    return url.toString();
  } catch {
    throw new Error("dashboard query evidence database configuration invalid");
  }
}

function createInstrumentedClient(datasourceUrl?: string) {
  return datasourceUrl
    ? new PrismaClient({
      datasources: { db: { url: datasourceUrl } },
      log: [{ level: "query", emit: "event" }],
    })
    : new PrismaClient({
      log: [{ level: "query", emit: "event" }],
    });
}

function createEvidence(
  outcome: QueryOutcome,
  queryEvents: Array<{ durationMs: number }>,
  measurement: { readOperationCount: number; durationMs: number },
): QueryEvidence {
  return {
    outcome,
    queryEvents: {
      count: queryEvents.length,
      aggregateDurationMs: queryEvents.reduce((total, event) => total + event.durationMs, 0),
    },
    readOperationMeasurement: {
      count: measurement.readOperationCount,
      durationMs: Math.max(0, measurement.durationMs),
    },
  };
}

async function runDashboardKpiEvidence({ poolOne, expectedReadOperationCount }: {
  poolOne: boolean;
  expectedReadOperationCount?: number;
}) {
  const queryEvents: Array<{ durationMs: number }> = [];
  const measurement = createDashboardQueryMeasurement();
  let instrumentedDb: ReturnType<typeof createInstrumentedClient> | null = null;
  let vendorId: string | null = null;

  try {
    instrumentedDb = createInstrumentedClient(poolOne ? poolOneDatabaseUrl() : undefined);
    const onQuery = (event: Prisma.QueryEvent) => {
      queryEvents.push({ durationMs: Math.max(0, event.duration) });
    };
    instrumentedDb.$on("query", onQuery);
    await instrumentedDb.$connect();

    const suffix = randomUUID();
    const vendor = await instrumentedDb.vendor.create({
      data: {
        name: `dashboard-query-event-${suffix}`,
        slug: `dashboard-query-event-${suffix}`,
        email: `dashboard-query-event-${suffix}@example.test`,
        passwordHash: "disposable-test-only",
      },
    });
    vendorId = vendor.id;

    // Exclude fixture setup so the evidence describes only the KPI read operation.
    queryEvents.splice(0);
    const createdAt = new Date("2099-01-01T00:00:00.000Z");
    let result: Awaited<ReturnType<typeof readDashboardKpiCounts>>;
    try {
      result = await readDashboardKpiCounts(instrumentedDb, vendor.id, createdAt, measurement);
    } catch (error) {
      const outcome = classifyDatabaseFailure(error);
      emitSanitizedEvidence(createEvidence(outcome, queryEvents, measurement));
      throw new Error(`dashboard KPI read failed: ${outcome}`);
    }

    const evidence = createEvidence("success", queryEvents, result.measurement);
    emitSanitizedEvidence(evidence);

    expect(result.counts).toEqual({
      registrations: 0,
      verifiedRegistrations: 0,
      views: 0,
      productClicks: 0,
      ctaClicks: 0,
      orders: 0,
      emailSent: 0,
      emailFailed: 0,
      realViewerMessages: 0,
      scheduledMessages: 0,
    });
    expect(evidence.outcome).toBe("success");
    expect(evidence.queryEvents.count).toBeGreaterThan(0);
    expect(evidence.queryEvents.aggregateDurationMs).toBeGreaterThanOrEqual(0);
    expect(evidence.readOperationMeasurement.count).toBeGreaterThan(0);
    expect(evidence.readOperationMeasurement.durationMs).toBeGreaterThanOrEqual(0);
    if (expectedReadOperationCount !== undefined) {
      expect(evidence.readOperationMeasurement.count).toBe(expectedReadOperationCount);
    }
    return evidence;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("dashboard KPI read failed: ")) throw error;
    const outcome = classifyDatabaseFailure(error);
    emitSanitizedEvidence(createEvidence(outcome, queryEvents, measurement));
    throw new Error(`dashboard KPI evidence failed: ${outcome}`);
  } finally {
    try {
      if (instrumentedDb && vendorId) {
        await instrumentedDb.vendor.delete({ where: { id: vendorId } });
      }
    } finally {
      await instrumentedDb?.$disconnect();
    }
  }
}

describe("dashboard read model raw Prisma query evidence", () => {
  it("measures query events separately from read-operation timing on disposable PostgreSQL", async () => {
    // vitest.config.ts validates the loopback-only disposable database before this client starts.
    await runDashboardKpiEvidence({ poolOne: false });
  });

  it("keeps the KPI read bounded and measurable with a pool of one connection", async () => {
    await runDashboardKpiEvidence({ poolOne: true, expectedReadOperationCount: 6 });
  });
});
