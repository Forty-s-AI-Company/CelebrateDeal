import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

/**
 * Shared Prisma client (one per server instance).
 *
 * Pool settings deliberately live in `DATABASE_URL`, not in code, so each
 * environment can tune them without a deploy (F-090 / B06-03):
 * - Runtime traffic uses the Supabase transaction pooler on port 6543 with
 *   `pgbouncer=true` (Prisma disables prepared statements for transaction mode).
 * - `connection_limit=<N>` caps connections per function instance; start at 3–5
 *   and tune with load tests, because Fluid compute scales out instances.
 * - Migrations use `DIRECT_URL` (session mode); see `prisma.config.ts`.
 * `scripts/preflight.ts` warns (never fails) when a Production or Preview build
 * is missing these parameters or the function and database regions differ.
 */
/**
 * Local measurement only (F-015, `scripts/lp-load-probe.mjs`): prints one
 * `prisma:query` line per SQL statement so a load probe can count database
 * round trips per request. Never enabled on Vercel; parameters are not logged.
 */
function localQueryLogOptions() {
  if (process.env.CELEBRATEDEAL_PRISMA_QUERY_LOG !== "stdout" || process.env.VERCEL) return undefined;
  return { log: [{ emit: "stdout" as const, level: "query" as const }] };
}

export function getDb() {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient(localQueryLogOptions());
  }

  return globalForPrisma.prisma;
}
