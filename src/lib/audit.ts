import { headers } from "next/headers";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";

export async function requestAuditMeta() {
  try {
    const headerStore = await headers();
    return {
      ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headerStore.get("x-real-ip"),
      userAgent: headerStore.get("user-agent"),
    };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

export async function writeAuditLog(input: {
  vendorId?: string | null;
  actorId?: string | null;
  actorLabel?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
}) {
  const meta = await requestAuditMeta();
  await getDb().auditLog.create({
    data: {
      vendorId: input.vendorId ?? null,
      actorId: input.actorId ?? null,
      actorLabel: input.actorLabel ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      before: input.before ?? undefined,
      after: input.after ?? undefined,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    },
  });
}

export function auditSnapshot<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
