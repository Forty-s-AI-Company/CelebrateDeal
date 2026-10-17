import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { isDatabaseWriteConflict } from "./database-write-conflict";
const known = (code: string, state?: string) => new Prisma.PrismaClientKnownRequestError("synthetic", {
  code, clientVersion: "synthetic", meta: state ? { code: state } : undefined,
});
describe("bounded transaction retry classification", () => {
  it("accepts serialization and explicit PostgreSQL raw-query deadlocks", () => {
    for (const error of [known("P2034"), known("P2010", "40001"), known("P2010", "40P01")]) {
      expect(isDatabaseWriteConflict(error)).toBe(true);
    }
  });
  it("accepts the observed unknown-request deadlock representation", () => {
    const error = new Prisma.PrismaClientUnknownRequestError("Error occurred: ERROR: deadlock detected", { clientVersion: "synthetic" });
    expect(isDatabaseWriteConflict(error)).toBe(true);
    expect(isDatabaseWriteConflict(new Prisma.PrismaClientUnknownRequestError("ConnectorError { kind: Deadlock }", { clientVersion: "synthetic" }))).toBe(true);
  });
  it("does not retry unrelated failures or arbitrary application messages", () => {
    for (const error of [known("P2002"), known("P2010", "55P03"), known("P2010", "23514"),
      known("P2028"), new Error("deadlock detected"), { code: "P2034" },
      new Prisma.PrismaClientUnknownRequestError("synthetic unrelated failure", { clientVersion: "synthetic" }),
      new Prisma.PrismaClientUnknownRequestError("lock timeout 55P03", { clientVersion: "synthetic" }),
      new Prisma.PrismaClientUnknownRequestError("could not obtain lock", { clientVersion: "synthetic" })]) {
      expect(isDatabaseWriteConflict(error)).toBe(false);
    }
  });
});
