import { Prisma } from "@prisma/client";

/** Recognize only database serialization/deadlock failures. Callers retain
 * their existing bounded attempt count and must restart the whole transaction.
 */
export function isDatabaseWriteConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") return true;
    // Raw queries expose PostgreSQL SQLSTATE rather than Prisma's P2034.
    return error.code === "P2010" && (error.meta?.code === "40001" || error.meta?.code === "40P01");
  }
  // The installed connector can expose a real deadlock as UnknownRequestError.
  // Scope text classification to that driver class; arbitrary application errors,
  // lock timeouts, unique violations and validation failures are not retryable here.
  return error instanceof Prisma.PrismaClientUnknownRequestError
    && /(?:kind:\s*Deadlock\b|\bdeadlock detected\b)/iu.test(error.message);
}
