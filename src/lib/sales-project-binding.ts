import type { Prisma } from "@prisma/client";

export class SalesProjectBindingError extends Error {
  constructor() { super("Invalid project binding"); }
}

/** Resolve explicit form scope inside the same transaction as the resource write. */
export async function resolveSalesProjectBinding(
  db: Pick<Prisma.TransactionClient, "salesProject">,
  vendorId: string,
  value: FormDataEntryValue | null,
): Promise<string | null> {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(value)) {
    throw new SalesProjectBindingError();
  }
  const project = await db.salesProject.findFirst({
    where: { id: value, vendorId, status: { not: "archived" } },
    select: { id: true },
  });
  if (!project) throw new SalesProjectBindingError();
  return project.id;
}
