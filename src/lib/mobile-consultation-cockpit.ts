import { z } from "zod";

const HttpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:");

export type MobileConsultationBooking = {
  id: string;
  startTime: Date;
  endTime: Date;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  clientName: string;
  clientPhone: string;
  customerKeyHash: string | null;
  meetingUrl: string | null;
  event: { title: string };
};

export type MobileConsultationDatabase = {
  consultationBooking: {
    findMany: (args: unknown) => Promise<MobileConsultationBooking[]>;
  };
};

/** 以指定時區切出今日 UTC 邊界，避免伺服器所在國家影響顧問行程。 */
export function consultantDayRange(now: Date, timeZone = "Asia/Taipei") {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const localMidnight = new Date(`${date}T00:00:00.000Z`);
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(localMidnight).find((part) => part.type === "timeZoneName")?.value;
  const match = offset?.match(/^GMT([+-])(\d{2}):(\d{2})$/u);
  const minutes = match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "+" ? 1 : -1) : 0;
  const from = new Date(localMidnight.getTime() - minutes * 60_000);
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

/** 僅回傳該商家的今日預約，並在邊界再次穩定排序。 */
export async function listTodayConsultations(
  database: MobileConsultationDatabase,
  vendorId: string,
  now = new Date(),
  timeZone = "Asia/Taipei",
) {
  const range = consultantDayRange(now, timeZone);
  const rows = await database.consultationBooking.findMany({
    where: { vendorId, startTime: { gte: range.from, lt: range.to }, status: { in: ["scheduled", "completed"] } },
    orderBy: [{ startTime: "asc" }, { createdAt: "asc" }],
    take: 100,
    select: {
      id: true, startTime: true, endTime: true, status: true, clientName: true,
      clientPhone: true, customerKeyHash: true, meetingUrl: true, event: { select: { title: true } },
    },
  });
  return rows
    .map((row) => ({ ...row, meetingUrl: row.meetingUrl && HttpsUrl.safeParse(row.meetingUrl).success ? row.meetingUrl : null }))
    .sort((left, right) => left.startTime.getTime() - right.startTime.getTime());
}

/** tel: 僅保留 E.164 可用字元，避免把任意 URI 帶進 href。 */
export function safeTelHref(phone: string) {
  const compact = phone.replace(/[\s().-]/gu, "");
  return /^\+[1-9]\d{7,14}$/u.test(compact) ? `tel:${compact}` : null;
}
