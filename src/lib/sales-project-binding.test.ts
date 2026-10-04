import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { resolveSalesProjectBinding, SalesProjectBindingError } from "./sales-project-binding";

function fixture() {
  const findFirst = vi.fn();
  const db = { salesProject: { findFirst } } as unknown as Pick<Prisma.TransactionClient, "salesProject">;
  return { db, findFirst };
}

describe("explicit project binding", () => {
  it.each([null, ""])("preserves workspace-only creation for %s", async (value) => {
    const { db, findFirst } = fixture();
    expect(await resolveSalesProjectBinding(db, "vendor-1", value)).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
  it.each(["../foreign", " ", "x".repeat(192)])("rejects malformed project scope", async (value) => {
    const { db, findFirst } = fixture();
    await expect(resolveSalesProjectBinding(db, "vendor-1", value)).rejects.toBeInstanceOf(SalesProjectBindingError);
    expect(findFirst).not.toHaveBeenCalled();
  });
  it("requires a non-archived project in the authenticated tenant", async () => {
    const { db, findFirst } = fixture();
    findFirst.mockResolvedValue({ id: "project-1" });
    expect(await resolveSalesProjectBinding(db, "vendor-1", "project-1")).toBe("project-1");
    expect(findFirst).toHaveBeenCalledWith({ where: { id: "project-1", vendorId: "vendor-1", status: { not: "archived" } }, select: { id: true } });
  });
  it("rejects missing, foreign or archived project results", async () => {
    const { db, findFirst } = fixture();
    findFirst.mockResolvedValue(null);
    await expect(resolveSalesProjectBinding(db, "vendor-1", "foreign-project")).rejects.toBeInstanceOf(SalesProjectBindingError);
  });
});
