import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

type SafePrismaDiagnostic = {
  category: "tls" | "authentication" | "network_timeout" | "connection_refused" | "unknown";
  code: string;
};

function safePrismaCode(code: string | undefined) {
  // Prisma engine codes are fixed identifiers such as P1001. Do not log an
  // arbitrary error property because it could contain connection details.
  return code && /^P\d{4}$/.test(code) ? code : "unavailable";
}

function getInitializationCategory(message: string): SafePrismaDiagnostic["category"] {
  if (/\b(tls|ssl|certificate|x509|handshake)\b/i.test(message)) return "tls";
  if (/\b(authentication failed|password authentication failed|invalid password|role .* does not exist)\b/i.test(message)) return "authentication";
  if (/\b(timeout|timed out|deadline has elapsed)\b/i.test(message)) return "network_timeout";
  if (/\b(connection refused|econnrefused)\b/i.test(message)) return "connection_refused";
  return "unknown";
}

function getKnownRequestCategory(code: string): SafePrismaDiagnostic["category"] {
  // `$queryRaw` can surface a connection-pool timeout as a known request
  // error instead of an initialization error. Classify only fixed Prisma
  // codes here; never inspect or log the accompanying message or metadata.
  if (code === "P1000") return "authentication";
  if (code === "P1001") return "connection_refused";
  if (code === "P1002" || code === "P2024") return "network_timeout";
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

function logPreviewDatabaseDiagnostic(error: unknown) {
  // Preview is CelebrateDeal's staging runtime. Production must retain the
  // generic public health response and must not receive this extra diagnostic.
  if (process.env.VERCEL_ENV !== "preview") return;

  console.warn("health_database_error", getSafePrismaDiagnostic(error));
}

export async function GET() {
  const startedAt = Date.now();

  try {
    await getDb().$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      database: "ok",
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    logPreviewDatabaseDiagnostic(error);
    return NextResponse.json({
      ok: false,
      database: "failed",
      latencyMs: Date.now() - startedAt,
      error: "Database health check failed",
    }, { status: 503 });
  }
}
