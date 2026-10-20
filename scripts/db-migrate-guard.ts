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
 * Remote `migrate deploy` callers, each named by a workflow-specific
 * MIGRATE_DEPLOY_WORKFLOW value set only in that workflow's own command, plus
 * the platform marker it must run under. Adding a caller (for example a
 * GitHub Environment-protected production migrate workflow) is a reviewed
 * change to this table. This is a guard against mistakes, not an access
 * control: anyone holding the database credentials can bypass it.
 */
const APPROVED_REMOTE_MIGRATE_WORKFLOWS: Readonly<Record<string, (environment: MigrateEnvironment) => boolean>> = {
  // vercel.staging.json buildCommand.
  "vercel-staging-build": (environment) => environment.VERCEL === "1",
};

/**
 * `prisma migrate deploy` is forward-only, but it still writes the schema of
 * whatever database it reaches. Loopback disposable databases are always
 * allowed; any other target needs ALLOW_REMOTE_MIGRATE_DEPLOY=1 together with
 * an approved MIGRATE_DEPLOY_WORKFLOW running on its platform, never a
 * developer shell.
 */
export function resolveDeployMigrateTarget(environment: MigrateEnvironment): MigrateTarget {
  const directUrl = present(environment.DIRECT_URL);
  const databaseUrl = present(environment.DATABASE_URL);
  // Mirror prisma.config.ts: DIRECT_URL first, then a non-SQLite DATABASE_URL.
  const target = directUrl ?? (databaseUrl && !databaseUrl.startsWith("file:") ? databaseUrl : undefined);
  if (!target) throw new MigrateTargetError("missing");
  const childEnvironment = { DATABASE_URL: databaseUrl ?? target, DIRECT_URL: target };
  if (classifyLocalTestDatabase(target).safe) return { childEnvironment, remote: false };

  if (environment.ALLOW_REMOTE_MIGRATE_DEPLOY !== "1") throw new MigrateTargetError("remote-not-allowed");
  const workflow = environment.MIGRATE_DEPLOY_WORKFLOW ?? "";
  const platformMatches = Object.hasOwn(APPROVED_REMOTE_MIGRATE_WORKFLOWS, workflow)
    && APPROVED_REMOTE_MIGRATE_WORKFLOWS[workflow]!(environment);
  if (!platformMatches) throw new MigrateTargetError("remote-outside-workflow");
  return { childEnvironment, remote: true };
}

const DEV_FLAGS_WITH_VALUE = new Set(["--name", "-n"]);
const DEV_FLAGS = new Set(["--create-only", "--skip-seed", "--skip-generate"]);

/**
 * Extra CLI arguments are forwarded to Prisma only from a closed allowlist:
 * `--schema`, `--config` or `--url` could otherwise retarget the validated
 * database (PR #454 A-8). `migrate deploy` takes no extra arguments.
 */
export function validateMigrateArguments(command: "dev" | "deploy", args: readonly string[]) {
  if (command === "deploy") {
    if (args.length > 0) throw new MigrateTargetError("argument-not-allowed");
    return [...args];
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const [flag, inlineValue] = arg.split("=", 2) as [string, string | undefined];
    if (DEV_FLAGS_WITH_VALUE.has(flag)) {
      const value = inlineValue ?? args[++index];
      if (!value || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new MigrateTargetError("argument-not-allowed");
      continue;
    }
    if (DEV_FLAGS.has(arg)) continue;
    throw new MigrateTargetError("argument-not-allowed");
  }
  return [...args];
}
