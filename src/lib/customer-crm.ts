import { getDb } from "@/lib/db";
import { automationCustomerKeyHash } from "@/lib/automation-workflow";

export type JourneyEventKind = "registration" | "watch" | "chat" | "prize" | "consultation" | "order" | "invoice" | "tag" | "voucher" | "automation" | "note";
export type CustomerJourneyEvent = { id: string; kind: JourneyEventKind; occurredAt: Date; title: string; detail?: string };
export type CrmSourceBundle = {
  vendorId: string;
  customerKeyHash: string;
  registrations?: Array<{ id: string; createdAt: Date; formName: string; source?: string | null; attribution?: unknown }>;
  watches?: Array<{ id: string; capturedAt: Date; liveTitle: string; seconds: number; entryCount?: number }>;
  chats?: Array<{ id: string; createdAt: Date; liveTitle: string; body: string }>;
  prizes?: Array<{ id: string; createdAt: Date; liveTitle: string; title: string; claimed: boolean }>;
  bookings?: Array<{ id: string; createdAt: Date; startTime: Date; eventTitle: string; status: string; answers?: unknown }>;
  orders?: Array<{ id: string; occurredAt: Date; orderNumber: string; amountCents: number; productNames: string[]; paymentMethod?: string | null }>;
  invoices?: Array<{ id: string; occurredAt: Date; invoiceNumber?: string | null; amountCents: number }>;
  tags?: Array<{ id: string; createdAt: Date; tag: string }>;
  vouchers?: Array<{ id: string; createdAt: Date; discountType: string; discountValue: number; redeemedAt?: Date | null }>;
  automations?: Array<{ id: string; createdAt: Date; trigger: string; status: string }>;
  notes?: Array<{ id: string; createdAt: Date; actorLabel: string; body: string }>;
};

export function maskEmail(value: string) {
  const [local = "", domain = ""] = value.trim().split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}${"*".repeat(Math.max(2, Math.min(6, local.length - 2)))}@${domain}`;
}

export function maskPhone(value?: string | null) {
  if (!value) return "—";
  const compact = value.replace(/\s+/gu, "");
  return compact.length <= 5 ? "***" : `${compact.slice(0, 3)}***${compact.slice(-3)}`;
}

export function aggregateCustomerJourney(bundle: CrmSourceBundle) {
  if (!bundle.vendorId || !bundle.customerKeyHash) throw new Error("Tenant-qualified customer identity is required.");
  const events: CustomerJourneyEvent[] = [
    ...(bundle.registrations ?? []).map((item) => ({ id: `registration:${item.id}`, kind: "registration" as const, occurredAt: item.createdAt, title: `報名 ${item.formName}`, detail: registrationSourceDetail(item.source, item.attribution) })),
    ...(bundle.watches ?? []).map((item) => ({ id: `watch:${item.id}`, kind: "watch" as const, occurredAt: item.capturedAt, title: `觀看 ${item.liveTitle}`, detail: `${item.seconds} 秒${item.entryCount ? ` · ${item.entryCount} 次進場` : ""}` })),
    ...(bundle.chats ?? []).map((item) => ({ id: `chat:${item.id}`, kind: "chat" as const, occurredAt: item.createdAt, title: `在 ${item.liveTitle} 留言`, detail: item.body })),
    ...(bundle.prizes ?? []).map((item) => ({ id: `prize:${item.id}`, kind: "prize" as const, occurredAt: item.createdAt, title: `抽獎中獎：${item.title}`, detail: `${item.liveTitle} · ${item.claimed ? "已領取" : "待領取"}` })),
    ...(bundle.bookings ?? []).map((item) => ({ id: `consultation:${item.id}`, kind: "consultation" as const, occurredAt: item.createdAt, title: `預約 ${item.eventTitle}`, detail: `${item.status} · ${item.startTime.toISOString()}` })),
    ...(bundle.orders ?? []).map((item) => ({ id: `order:${item.id}`, kind: "order" as const, occurredAt: item.occurredAt, title: `訂單 ${item.orderNumber}`, detail: `${item.productNames.join("、")} · NT$${Math.round(item.amountCents / 100).toLocaleString("zh-TW")}` })),
    ...(bundle.invoices ?? []).map((item) => ({ id: `invoice:${item.id}`, kind: "invoice" as const, occurredAt: item.occurredAt, title: `發票 ${item.invoiceNumber ?? "處理中"}`, detail: `NT$${Math.round(item.amountCents / 100).toLocaleString("zh-TW")}` })),
    ...(bundle.tags ?? []).map((item) => ({ id: `tag:${item.id}`, kind: "tag" as const, occurredAt: item.createdAt, title: `加入標籤：${item.tag}` })),
    ...(bundle.vouchers ?? []).map((item) => ({ id: `voucher:${item.id}`, kind: "voucher" as const, occurredAt: item.createdAt, title: "取得專屬優惠券", detail: `${item.discountType === "percentage" ? `${item.discountValue}%` : `NT$${Math.round(item.discountValue / 100)}`} · ${item.redeemedAt ? "已兌換" : "未兌換"}` })),
    ...(bundle.automations ?? []).map((item) => ({ id: `automation:${item.id}`, kind: "automation" as const, occurredAt: item.createdAt, title: `自動化：${item.trigger}`, detail: item.status })),
    ...(bundle.notes ?? []).map((item) => ({ id: `note:${item.id}`, kind: "note" as const, occurredAt: item.createdAt, title: `${item.actorLabel} 新增顧問備註`, detail: item.body })),
  ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || a.id.localeCompare(b.id));
  return { ...bundle, timeline: events };
}

function registrationSourceDetail(source: string | null | undefined, attribution: unknown) {
  if (!attribution || typeof attribution !== "object" || Array.isArray(attribution)) return source ?? undefined;
  const utm = (attribution as { utm?: unknown }).utm;
  if (!utm || typeof utm !== "object" || Array.isArray(utm)) return source ?? undefined;
  const data = utm as Record<string, unknown>;
  const parts = [data.source, data.medium, data.campaign].filter((value): value is string => typeof value === "string" && Boolean(value));
  return [source, parts.length ? `UTM ${parts.join(" / ")}` : null].filter(Boolean).join(" · ") || undefined;
}

export type CustomerListItem = {
  id: string; customerKeyHash: string; name: string; maskedEmail: string; maskedPhone: string;
  latestActivityAt: Date; watchSeconds: number; bookingStatus: string | null; tags: string[]; lifetimeValueCents: number; consultationStatus: string;
};

/** Builds a tenant-scoped identity union from every CRM source, including hash-only facts. */
export async function listCustomers(vendorId: string, query = "", tag = ""): Promise<CustomerListItem[]> {
  if (!vendorId) throw new Error("vendorId is required");
  const db = getDb();
  const [submissions, bookings, orders, watches, tags, vouchers, automations, records] = await Promise.all([
    db.formSubmission.findMany({ where: { form: { vendorId } }, select: { name: true, email: true, phone: true, customerKeyHash: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
    db.consultationBooking.findMany({ where: { vendorId }, select: { clientName: true, clientEmail: true, clientPhone: true, customerKeyHash: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
    db.commerceOrder.findMany({ where: { vendorId, automationCustomerKeyHash: { not: null }, status: { in: ["paid", "partially_refunded", "refunded"] } }, select: { automationCustomerKeyHash: true, buyerMaskedName: true, buyerMaskedEmail: true, buyerMaskedPhone: true, paidAmountCents: true, refundedAmountCents: true, paidAt: true, createdAt: true } }),
    db.streamUsageLedgerEntry.groupBy({ by: ["customerKeyHash"], where: { vendorId, customerKeyHash: { not: null } }, _sum: { watchSeconds: true }, _max: { capturedAt: true } }),
    db.customerTagAssignment.findMany({ where: { vendorId } }),
    db.automationVoucherGrant.findMany({ where: { vendorId }, select: { customerKeyHash: true, createdAt: true } }),
    db.automationExecutionLog.findMany({ where: { vendorId, subjectKeyHash: { not: null } }, select: { subjectKeyHash: true, createdAt: true } }),
    db.customerCrmRecord.findMany({ where: { vendorId } }),
  ]);
  const identities = new Map<string, { name: string; maskedEmail: string; maskedPhone: string; latest: Date; bookingStatus: string | null }>();
  const queryMatches = new Set<string>();
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-TW");
  const epoch = new Date(0);
  const ensure = (hash: string, latest = epoch) => {
    const current = identities.get(hash);
    if (!current) identities.set(hash, { name: "未命名學員", maskedEmail: "—", maskedPhone: "—", latest, bookingStatus: null });
    else if (latest > current.latest) current.latest = latest;
    return identities.get(hash)!;
  };
  for (const row of submissions) {
    const hash = row.customerKeyHash ?? automationCustomerKeyHash(vendorId, row.email);
    if (normalizedQuery && [row.name, row.email, row.phone ?? ""].some((item) => item.toLocaleLowerCase("zh-TW").includes(normalizedQuery))) queryMatches.add(hash);
    const old = identities.get(hash);
    if (!old || row.createdAt > old.latest) identities.set(hash, { name: row.name, maskedEmail: maskEmail(row.email), maskedPhone: maskPhone(row.phone), latest: row.createdAt, bookingStatus: old?.bookingStatus ?? null });
  }
  for (const row of bookings) {
    const hash = row.customerKeyHash ?? automationCustomerKeyHash(vendorId, row.clientEmail);
    if (normalizedQuery && [row.clientName, row.clientEmail, row.clientPhone ?? ""].some((item) => item.toLocaleLowerCase("zh-TW").includes(normalizedQuery))) queryMatches.add(hash);
    const old = identities.get(hash);
    if (!old) identities.set(hash, { name: row.clientName, maskedEmail: maskEmail(row.clientEmail), maskedPhone: maskPhone(row.clientPhone), latest: row.createdAt, bookingStatus: row.status });
    else identities.set(hash, { ...old, ...(row.createdAt > old.latest ? { name: row.clientName, maskedEmail: maskEmail(row.clientEmail), maskedPhone: maskPhone(row.clientPhone), latest: row.createdAt } : {}), bookingStatus: old.bookingStatus ?? row.status });
  }
  for (const row of orders) {
    const hash = row.automationCustomerKeyHash!;
    const at = row.paidAt ?? row.createdAt;
    const person = ensure(hash, at);
    if (person.name === "未命名學員") Object.assign(person, { name: row.buyerMaskedName, maskedEmail: row.buyerMaskedEmail, maskedPhone: row.buyerMaskedPhone ?? "—" });
  }
  for (const row of watches) if (row.customerKeyHash) ensure(row.customerKeyHash, row._max.capturedAt ?? epoch);
  for (const row of tags) ensure(row.customerKeyHash, row.createdAt);
  for (const row of vouchers) ensure(row.customerKeyHash, row.createdAt);
  for (const row of automations) if (row.subjectKeyHash) ensure(row.subjectKeyHash, row.createdAt);
  for (const row of records) ensure(row.customerKeyHash, row.updatedAt);
  const hashes = [...identities.keys()];
  const tagMap = new Map<string, string[]>();
  for (const row of tags) tagMap.set(row.customerKeyHash, [...(tagMap.get(row.customerKeyHash) ?? []), row.tag]);
  const orderMap = new Map<string, number>();
  for (const row of orders) orderMap.set(row.automationCustomerKeyHash!, (orderMap.get(row.automationCustomerKeyHash!) ?? 0) + Math.max(0, row.paidAmountCents - row.refundedAmountCents));
  const watchMap = new Map(watches.map((row) => [row.customerKeyHash ?? "", row._sum.watchSeconds ?? 0]));
  const recordMap = new Map(records.map((row) => [row.customerKeyHash, row]));
  return hashes.filter((hash) => {
    if (tag && !(tagMap.get(hash) ?? []).includes(tag)) return false;
    if (!normalizedQuery) return true;
    const person = identities.get(hash)!;
    return queryMatches.has(hash) || [person.name, person.maskedEmail, person.maskedPhone].some((item) => item.toLocaleLowerCase("zh-TW").includes(normalizedQuery));
  }).map((hash) => {
    const person = identities.get(hash)!;
    const orderActivity = orders.filter((row) => row.automationCustomerKeyHash === hash).map((row) => row.paidAt ?? row.createdAt).sort((a, b) => b.getTime() - a.getTime())[0];
    const watchActivity = watches.find((row) => row.customerKeyHash === hash)?._max.capturedAt;
    const latestActivityAt = [person.latest, orderActivity, watchActivity].filter((date): date is Date => Boolean(date)).reduce((latest, date) => date > latest ? date : latest, person.latest);
    return { id: recordMap.get(hash)?.id ?? hash, customerKeyHash: hash, name: person.name, maskedEmail: person.maskedEmail, maskedPhone: person.maskedPhone, latestActivityAt, watchSeconds: watchMap.get(hash) ?? 0, bookingStatus: person.bookingStatus, tags: tagMap.get(hash) ?? [], lifetimeValueCents: orderMap.get(hash) ?? 0, consultationStatus: recordMap.get(hash)?.consultationStatus ?? "following_up" };
  }).sort((a, b) => b.latestActivityAt.getTime() - a.latestActivityAt.getTime());
}

export async function getCustomerProfile(vendorId: string, customerKeyHash: string) {
  const db = getDb();
  let personRows = await db.formSubmission.findMany({ where: { form: { vendorId }, customerKeyHash }, include: { form: true }, orderBy: { createdAt: "desc" } });
  let bookingRows = await db.consultationBooking.findMany({ where: { vendorId, customerKeyHash }, include: { event: true }, orderBy: { createdAt: "desc" } });
  // Transitional compatibility for pre-migration rows. New writes and a
  // controlled backfill use indexed hashes; this bounded fallback prevents old
  // CRM links from becoming 404 before that operational backfill is applied.
  if (!personRows.length && !bookingRows.length) {
    const [legacySubmissions, legacyBookings] = await Promise.all([
      db.formSubmission.findMany({ where: { form: { vendorId }, customerKeyHash: null }, include: { form: true }, orderBy: { createdAt: "desc" } }),
      db.consultationBooking.findMany({ where: { vendorId, customerKeyHash: null }, include: { event: true }, orderBy: { createdAt: "desc" } }),
    ]);
    personRows = legacySubmissions.filter((row) => automationCustomerKeyHash(vendorId, row.email) === customerKeyHash);
    bookingRows = legacyBookings.filter((row) => automationCustomerKeyHash(vendorId, row.clientEmail) === customerKeyHash);
  }
  const registrationIdentity = personRows[0];
  const bookingIdentity = bookingRows[0];
  const submissionIds = personRows.map((row) => row.id);
  const [watches, chats, interactions, orders, tags, vouchers, automations, record] = await Promise.all([
    db.streamUsageLedgerEntry.findMany({ where: { vendorId, customerKeyHash }, include: { live: { select: { title: true, video: { select: { durationSec: true } } } } } }),
    db.liveChatMessage.findMany({ where: { vendorId, formSubmissionId: { in: submissionIds }, isSimulated: false, status: "visible" }, include: { live: { select: { title: true } } }, orderBy: { createdAt: "desc" } }),
    db.liveInteractionResponse.findMany({ where: { vendorId, formSubmissionId: { in: submissionIds }, eventType: "lucky_draw" }, include: { live: { select: { title: true } }, run: { select: { title: true, winnerResponseId: true } } } }),
    db.commerceOrder.findMany({ where: { vendorId, automationCustomerKeyHash: customerKeyHash, status: { in: ["paid", "partially_refunded", "refunded"] } }, include: { items: true, electronicInvoice: true, primaryPaymentTransaction: true } }),
    db.customerTagAssignment.findMany({ where: { vendorId, customerKeyHash } }),
    db.automationVoucherGrant.findMany({ where: { vendorId, customerKeyHash } }),
    db.automationExecutionLog.findMany({ where: { vendorId, subjectKeyHash: customerKeyHash } }),
    db.customerCrmRecord.findUnique({ where: { vendorId_customerKeyHash: { vendorId, customerKeyHash } }, include: { notes: { orderBy: { createdAt: "desc" } } } }),
  ]);
  if (!registrationIdentity && !bookingIdentity && !watches.length && !orders.length && !tags.length && !vouchers.length && !automations.length && !record) return null;
  const name = registrationIdentity?.name ?? bookingIdentity?.clientName ?? orders[0]?.buyerMaskedName ?? "未命名學員";
  const maskedEmail = registrationIdentity?.email ? maskEmail(registrationIdentity.email) : bookingIdentity?.clientEmail ? maskEmail(bookingIdentity.clientEmail) : orders[0]?.buyerMaskedEmail ?? "—";
  const maskedPhone = registrationIdentity?.phone ? maskPhone(registrationIdentity.phone) : bookingIdentity?.clientPhone ? maskPhone(bookingIdentity.clientPhone) : orders[0]?.buyerMaskedPhone ?? "—";
  const watchByLive = new Map<string, { id: string; capturedAt: Date; liveTitle: string; seconds: number; viewerKeys: Set<string> }>();
  for (const row of watches) {
    const current = watchByLive.get(row.liveId);
    if (!current) watchByLive.set(row.liveId, { id: row.liveId, capturedAt: row.capturedAt, liveTitle: row.live.title, seconds: row.watchSeconds, viewerKeys: new Set(row.viewerKeyHash ? [row.viewerKeyHash] : []) });
    else {
      current.seconds += row.watchSeconds;
      if (row.capturedAt > current.capturedAt) current.capturedAt = row.capturedAt;
      if (row.viewerKeyHash) current.viewerKeys.add(row.viewerKeyHash);
    }
  }
  const bundle = aggregateCustomerJourney({ vendorId, customerKeyHash,
    registrations: personRows.map((r) => ({ id: r.id, createdAt: r.createdAt, formName: r.form.name, source: r.source, attribution: r.attribution })),
    watches: [...watchByLive.values()].map((row) => ({ id: row.id, capturedAt: row.capturedAt, liveTitle: row.liveTitle, seconds: row.seconds, entryCount: row.viewerKeys.size })),
    chats: chats.map((r) => ({ id: r.id, createdAt: r.createdAt, liveTitle: r.live.title, body: r.body })),
    prizes: interactions.filter((r) => r.run.winnerResponseId === r.id).map((r) => ({ id: r.id, createdAt: r.createdAt, liveTitle: r.live.title, title: r.run.title, claimed: Boolean(r.winnerClaimedAt) })),
    bookings: bookingRows.map((r) => ({ id: r.id, createdAt: r.createdAt, startTime: r.startTime, eventTitle: r.event.title, status: r.status, answers: r.answers })),
    orders: orders.map((r) => ({ id: r.id, occurredAt: r.paidAt ?? r.createdAt, orderNumber: r.orderNumber, amountCents: r.paidAmountCents, productNames: r.items.map((i) => i.productName), paymentMethod: r.primaryPaymentTransaction?.providerName })),
    invoices: orders.flatMap((r) => r.electronicInvoice ? [{ id: r.electronicInvoice.id, occurredAt: r.electronicInvoice.issuedAt ?? r.electronicInvoice.createdAt, invoiceNumber: r.electronicInvoice.invoiceNumber, amountCents: r.electronicInvoice.amountCents }] : []),
    tags, vouchers, automations, notes: record?.notes ?? [],
  });
  const watchSeconds = watches.reduce((sum, row) => sum + row.watchSeconds, 0);
  const durations = new Map(watches.filter((row) => (row.live.video?.durationSec ?? 0) > 0).map((row) => [row.liveId, row.live.video!.durationSec]));
  const totalDuration = [...durations.values()].reduce((sum, seconds) => sum + seconds, 0);
  return { ...bundle, name, maskedEmail, maskedPhone, consultationStatus: record?.consultationStatus ?? "following_up", lifetimeValueCents: orders.reduce((sum, row) => sum + Math.max(0, row.paidAmountCents - row.refundedAmountCents), 0), watchSeconds, watchCompletionRate: totalDuration ? Math.min(100, Math.round(watchSeconds / totalDuration * 100)) : null, entryCount: new Set(watches.map((row) => row.viewerKeyHash).filter(Boolean)).size, bookingAnswers: bookingRows[0]?.answers ?? null };
}
