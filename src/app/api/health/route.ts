import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

type SafePrismaDiagnostic = {
  category: "tls" | "authentication" | "network-timeout" | "connection-refused" | "unknown";
  code: string;
};

type SafeVercelEnvironment = "preview" | "production";

function safePrismaCode(code: string | undefined) {
  // Prisma engine codes are fixed identifiers such as P1001. Do not log an
  // arbitrary error property because it could contain connection details.
  return code && /^P\d{4}$/.test(code) ? code : "unavailable";
}

function getInitializationCategory(message: string): SafePrismaDiagnostic["category"] {
  if (/\b(tls|ssl|certificate|x509|handshake)\b/i.test(message)) return "tls";
  if (/\b(authentication failed|password authentication failed|invalid password|role .* does not exist)\b/i.test(message)) return "authentication";
  if (/\b(timeout|timed out|deadline has elapsed)\b/i.test(message)) return "network-timeout";
  if (/\b(connection refused|econnrefused)\b/i.test(message)) return "connection-refused";
  return "unknown";
}

function getKnownRequestCategory(code: string): SafePrismaDiagnostic["category"] {
  // `$queryRaw` can surface a connection-pool timeout as a known request
  // error instead of an initialization error. Classify only fixed Prisma
  // codes here; never inspect or log the accompanying message or metadata.
  if (code === "P1000") return "authentication";
  if (code === "P1001") return "connection-refused";
  if (code === "P1002" || code === "P2024") return "network-timeout";
  if (code === "P1011") return "tls";
  return "unknown";
}

function getSafePrismaDiagnostic(error: unknown): SafePrismaDiagnostic {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    // The message is inspected only to select a fixed category. It is never
    // passed to the logger, response, or any other observable output.
    return {
      category: getInitializationCategory(error.message),
      code: safePrismaCode(error.errorCode),
    };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return {
      category: getKnownRequestCategory(error.code),
      code: safePrismaCode(error.code),
    };
  }

  return { category: "unknown", code: "unavailable" };
}

function getSafeVercelEnvironment(): SafeVercelEnvironment | null {
  if (process.env.VERCEL_ENV === "preview") return "preview";
  if (process.env.VERCEL_ENV === "production") return "production";
  return null;
}

type DeploymentIdentity = {
  commitSha: string | null;
  deploymentId: string | null;
  vercelUrl: string | null;
};

const SAFE_COMMIT_SHA = /^[a-f0-9]{40}$/;
const SAFE_DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{1,64}$/;
const SAFE_VERCEL_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+vercel\.app$/;

function allowlisted(value: string | undefined, pattern: RegExp) {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

// Non-secret deployment identity injected by Vercel (VERCEL_GIT_COMMIT_SHA,
// VERCEL_DEPLOYMENT_ID, VERCEL_URL). The protected staging runner compares it,
// fetched through the fixed alias, with the GitHub deployment lineage record.
// Values outside the fixed shapes are reported as null, never echoed.
function getDeploymentIdentity(): DeploymentIdentity {
  return {
    commitSha: allowlisted(process.env.VERCEL_GIT_COMMIT_SHA, SAFE_COMMIT_SHA),
    deploymentId: allowlisted(process.env.VERCEL_DEPLOYMENT_ID, SAFE_DEPLOYMENT_ID),
    vercelUrl: allowlisted(process.env.VERCEL_URL?.toLowerCase(), SAFE_VERCEL_HOST),
  };
}

const NO_STORE = { "Cache-Control": "no-store" } as const;

function logDatabaseDiagnostic(error: unknown) {
  const environment = getSafeVercelEnvironment();
  if (!environment) return;

  // Keep the log payload allowlisted. In particular, never spread or serialize
  // the original error because Prisma messages and metadata can contain URLs,
  // hosts, usernames, or credentials.
  console.warn("health_database_error", {
    ...getSafePrismaDiagnostic(error),
    environment,
  });
}

export async function GET() {
  const startedAt = Date.now();
  const deployment = getDeploymentIdentity();

  try {
    await getDb().$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      database: "ok",
      latencyMs: Date.now() - startedAt,
      deployment,
    }, { headers: NO_STORE });
  } catch (error) {
    logDatabaseDiagnostic(error);
    return NextResponse.json({
      ok: false,
      database: "failed",
      latencyMs: Date.now() - startedAt,
      error: "Database health check failed",
      deployment,
    }, { status: 503, headers: NO_STORE });
  }
}
