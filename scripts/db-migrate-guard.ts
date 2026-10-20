import { classifyLocalTestDatabase } from "./local-database-safety";

/**
 * Target guards for `npm run db:migrate` and `npm run db:migrate:deploy` (F-065).
 *
 * `prisma.config.ts` loads `.env.local` and `.env`, which is exactly where
 * `vercel env pull` writes Preview/Production credentials. These guards only
 * read the injected process environment, validate the URL Prisma will use, and
 * pin both DATABASE_URL and DIRECT_URL in the child environment so dotenv can
 * never fill in a different (remote) target afterwards. Errors carry only a
 * safe category: never the URL, host, user, password or database name.
 */
export type MigrateEnvironment = Readonly<Record<string, string | undefined>>;

export type MigrateTarget = {
  /** Environment overrides to pass to the Prisma child process. */
  childEnvironment: { DATABASE_URL: string; DIRECT_URL: string };
  remote: boolean;
};

export class MigrateTargetError extends Error {
  constructor(readonly category: string) {
    super(`[migrate_target_safety] rejected; category=${category}`);
    this.name = "MigrateTargetError";
  }
}

function present(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * `prisma migrate dev` may offer to reset the target database, so it only
 * ever runs against a disposable loopback `celebratedeal_*` database.
 */
export function resolveDevMigrateTarget(environment: MigrateEnvironment): MigrateTarget {
  const databaseUrl = present(environment.DATABASE_URL);
  if (!databaseUrl) throw new MigrateTargetError("missing");
  const directUrl = present(environment.DIRECT_URL) ?? databaseUrl;
  for (const value of [databaseUrl, directUrl]) {
    const safety = classifyLocalTestDatabase(value);
    if (!safety.safe) throw new MigrateTargetError(safety.category);
  }
  return { childEnvironment: { DATABASE_URL: databaseUrl, DIRECT_URL: directUrl }, remote: false };
}

/**
 * `prisma migrate deploy` is forward-only, but it still writes the schema of
 * whatever database it reaches. Loopback disposable databases are always
 * allowed; any other target needs ALLOW_REMOTE_MIGRATE_DEPLOY=1 inside a
 * GitHub Actions or Vercel build environment, never a developer shell.
 */
export function resolveDeployMigrateTarget(environment: MigrateEnvironment): MigrateTarget {
  const directUrl = present(environment.DIRECT_URL);
  const databaseUrl = present(environment.DATABASE_URL);
  // Mirror prisma.config.ts: DIRECT_URL first, then a non-SQLite DATABASE_URL.
  const target = directUrl ?? (databaseUrl && !databaseUrl.startsWith("file:") ? databaseUrl : undefined);
  if (!target) throw new MigrateTargetError("missing");
  const childEnvironment = { DATABASE_URL: databaseUrl ?? target, DIRECT_URL: target };
  if (classifyLocalTestDatabase(target).safe) return { childEnvironment, remote: false };

  const explicitlyAllowed = environment.ALLOW_REMOTE_MIGRATE_DEPLOY === "1";
  const workflowEnvironment = environment.GITHUB_ACTIONS === "true" || environment.VERCEL === "1";
  if (!explicitlyAllowed) throw new MigrateTargetError("remote-not-allowed");
  if (!workflowEnvironment) throw new MigrateTargetError("remote-outside-workflow");
  return { childEnvironment, remote: true };
}
