import { describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/lib/db", () => ({ getDb: () => database.current }));

import { automationCustomerKeyHash } from "./automation-workflow";
import { aggregateCustomerJourney, getCustomerProfile, listCustomers, maskEmail, maskPhone } from "./customer-crm";

describe("customer CRM aggregation", () => {
  it("merges multiple sources into a newest-first timeline", () => {
    const result = aggregateCustomerJourney({ vendorId: "vendor-a", customerKeyHash: "hash-a",
      registrations: [{ id: "r1", createdAt: new Date("2026-01-01T00:00:00Z"), formName: "講座報名" }],
      watches: [{ id: "w1", capturedAt: new Date("2026-01-02T00:00:00Z"), liveTitle: "成交課", seconds: 900 }],
      bookings: [{ id: "b1", createdAt: new Date("2026-01-03T00:00:00Z"), startTime: new Date("2026-01-04T00:00:00Z"), eventTitle: "一對一諮詢", status: "scheduled" }],
      orders: [{ id: "o1", occurredAt: new Date("2026-01-05T00:00:00Z"), orderNumber: "CD-1", amountCents: 12_000, productNames: ["實戰班"] }],
    });
    expect(result.timeline.map((event) => event.kind)).toEqual(["order", "consultation", "watch", "registration"]);
  });

  it("requires both tenant and hashed customer identity", () => {
    expect(() => aggregateCustomerJourney({ vendorId: "", customerKeyHash: "hash" })).toThrow(/Tenant-qualified/u);
    expect(() => aggregateCustomerJourney({ vendorId: "vendor", customerKeyHash: "" })).toThrow(/Tenant-qualified/u);
  });

  it("masks PII without exposing the original address or phone", () => {
    expect(maskEmail("student@example.com")).toBe("st*****@example.com");
    expect(maskPhone("0912 345 678")).toBe("091***678");
    expect(maskEmail("local-only")).toBe("***");
    expect(maskPhone(undefined)).toBe("—");
    expect(maskPhone("12345")).toBe("***");
  });

  it("includes append-only consultant notes with actor attribution", () => {
    const result = aggregateCustomerJourney({ vendorId: "vendor", customerKeyHash: "hash", notes: [{ id: "n1", createdAt: new Date("2026-01-01Z"), actorLabel: "owner", body: "下週追蹤" }] });
    expect(result.timeline[0]).toMatchObject({ kind: "note", title: "owner 新增顧問備註", detail: "下週追蹤" });
  });

  it("normalizes UTM, chat and lucky-draw wins into the same timeline", () => {
    const result = aggregateCustomerJourney({ vendorId: "vendor", customerKeyHash: "hash",
      registrations: [{ id: "r", createdAt: new Date("2026-01-01T00:00:00Z"), formName: "說明會", source: "form", attribution: { utm: { source: "facebook", medium: "paid", campaign: "launch" } } }],
      chats: [{ id: "c", createdAt: new Date("2026-01-02T00:00:00Z"), liveTitle: "直播", body: "我想了解方案" }],
      prizes: [{ id: "p", createdAt: new Date("2026-01-03T00:00:00Z"), liveTitle: "直播", title: "限時抽獎", claimed: true }],
    });
    expect(result.timeline.map((event) => event.kind)).toEqual(["prize", "chat", "registration"]);
    expect(result.timeline.at(-1)?.detail).toContain("UTM facebook / paid / launch");
    expect(result.timeline[0]?.detail).toContain("已領取");
  });

  it("keeps source fallback details and formats secondary event variants", () => {
    const result = aggregateCustomerJourney({ vendorId: "vendor", customerKeyHash: "hash",
      registrations: [
        { id: "r1", createdAt: new Date("2026-01-01T00:00:00Z"), formName: "表單", source: "legacy", attribution: { utm: [] } },
        { id: "r2", createdAt: new Date("2026-01-02T00:00:00Z"), formName: "表單", attribution: { utm: {} } },
      ],
      watches: [{ id: "w", capturedAt: new Date("2026-01-03T00:00:00Z"), liveTitle: "直播", seconds: 10, entryCount: 2 }],
      prizes: [{ id: "p", createdAt: new Date("2026-01-04T00:00:00Z"), liveTitle: "直播", title: "獎品", claimed: false }],
      invoices: [{ id: "i", occurredAt: new Date("2026-01-05T00:00:00Z"), amountCents: 100 }],
      vouchers: [
        { id: "v1", createdAt: new Date("2026-01-06T00:00:00Z"), discountType: "percentage", discountValue: 10, redeemedAt: new Date("2026-01-07T00:00:00Z") },
        { id: "v2", createdAt: new Date("2026-01-08T00:00:00Z"), discountType: "fixed", discountValue: 500 },
      ],
      automations: [{ id: "a", createdAt: new Date("2026-01-09T00:00:00Z"), trigger: "follow_up", status: "completed" }],
    });
    expect(result.timeline.find((event) => event.id === "registration:r1")?.detail).toBe("legacy");
    expect(result.timeline.find((event) => event.id === "registration:r2")?.detail).toBeUndefined();
    expect(result.timeline.find((event) => event.id === "watch:w")?.detail).toContain("2 次進場");
    expect(result.timeline.find((event) => event.id === "invoice:i")?.title).toBe("發票 處理中");
    expect(result.timeline.find((event) => event.id === "voucher:v1")?.detail).toContain("已兌換");
    expect(result.timeline.find((event) => event.id === "voucher:v2")?.detail).toContain("NT$5");
  });

  it("builds a tenant-qualified union from hash-only CRM sources without a row cap", async () => {
    const findMany = (result: unknown[]) => vi.fn<(args: unknown) => Promise<unknown[]>>().mockResolvedValue(result);
    const formFind = findMany([]);
    const bookingFind = findMany([]);
    database.current = {
      formSubmission: { findMany: formFind },
      consultationBooking: { findMany: bookingFind },
      commerceOrder: { findMany: findMany([{ automationCustomerKeyHash: "order-hash", buyerMaskedName: "王＊＊", buyerMaskedEmail: "w***@example.test", buyerMaskedPhone: "****5678", paidAmountCents: 20_000, refundedAmountCents: 2_000, paidAt: new Date("2026-01-06Z"), createdAt: new Date("2026-01-05Z") }]) },
      streamUsageLedgerEntry: { groupBy: vi.fn(async () => [{ customerKeyHash: "watch-hash", _sum: { watchSeconds: 900 }, _max: { capturedAt: new Date("2026-01-04Z") } }]) },
      customerTagAssignment: { findMany: findMany([{ customerKeyHash: "tag-hash", tag: "高意向", createdAt: new Date("2026-01-03Z") }]) },
      automationVoucherGrant: { findMany: findMany([{ customerKeyHash: "voucher-hash", createdAt: new Date("2026-01-02Z") }]) },
      automationExecutionLog: { findMany: findMany([{ subjectKeyHash: "automation-hash", createdAt: new Date("2026-01-01Z") }]) },
      customerCrmRecord: { findMany: findMany([{ id: "crm-1", customerKeyHash: "record-hash", consultationStatus: "following_up", updatedAt: new Date("2026-01-07Z") }]) },
    };

    const result = await listCustomers("vendor-a");
    expect(result.map((item) => item.customerKeyHash).sort()).toEqual(["automation-hash", "order-hash", "record-hash", "tag-hash", "voucher-hash", "watch-hash"]);
    expect(result.find((item) => item.customerKeyHash === "order-hash")).toMatchObject({ lifetimeValueCents: 18_000, maskedEmail: "w***@example.test" });
    expect(result.find((item) => item.customerKeyHash === "watch-hash")?.watchSeconds).toBe(900);
    expect(formFind.mock.calls[0]?.[0]).toMatchObject({ where: { form: { vendorId: "vendor-a" } } });
    expect(bookingFind.mock.calls[0]?.[0]).toMatchObject({ where: { vendorId: "vendor-a" } });
    expect(formFind.mock.calls[0]?.[0]).not.toHaveProperty("take");
  });

  it("filters a project view through canonical SalesProjectCustomer memberships", async () => {
    const findMany = (result: unknown[]) => vi.fn<(args: unknown) => Promise<unknown[]>>().mockResolvedValue(result);
    const formFind = findMany([{ name: "專案學員", email: "member@example.test", phone: null, customerKeyHash: "member-hash", createdAt: new Date("2026-01-01Z") }]);
    database.current = {
      salesProjectCustomer: { findMany: vi.fn().mockResolvedValue([{ customerKeyHash: "member-hash" }]) },
      formSubmission: { findMany: formFind },
      consultationBooking: { findMany: findMany([]) },
      commerceOrder: { findMany: findMany([]) },
      streamUsageLedgerEntry: { groupBy: vi.fn().mockResolvedValue([]) },
      customerTagAssignment: { findMany: findMany([]) },
      automationVoucherGrant: { findMany: findMany([]) },
      automationExecutionLog: { findMany: findMany([]) },
      customerCrmRecord: { findMany: findMany([]) },
    };

    await expect(listCustomers("vendor-a", "", "", "project-a"))
      .resolves.toEqual([expect.objectContaining({ customerKeyHash: "member-hash" })]);
    expect(formFind).toHaveBeenCalledWith(expect.objectContaining({
      where: { form: { vendorId: "vendor-a", projectId: "project-a" }, customerKeyHash: { in: ["member-hash"] } },
    }));
  });

  it("returns no rows when a project has no canonical memberships", async () => {
    database.current = { salesProjectCustomer: { findMany: vi.fn().mockResolvedValue([]) } };
    await expect(listCustomers("vendor-a", "", "", "empty-project")).resolves.toEqual([]);
  });

  it("loads a complete profile with scoped activity and derived metrics", async () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const later = new Date("2026-01-02T00:00:00Z");
    database.current = {
      salesProjectCustomer: { findUnique: vi.fn().mockResolvedValue({ id: "membership-1" }) },
      formSubmission: { findMany: vi.fn().mockResolvedValue([{ id: "submission-1", name: "王小明", email: "wang@example.com", phone: "0912345678", source: "web", attribution: null, createdAt, form: { name: "活動報名" } }]) },
      consultationBooking: { findMany: vi.fn().mockResolvedValue([{ id: "booking-1", clientName: "王小明", clientEmail: "wang@example.com", clientPhone: "0912345678", status: "scheduled", createdAt, startTime: later, answers: { goal: "成交" }, event: { title: "顧問諮詢" } }]) },
      streamUsageLedgerEntry: { findMany: vi.fn().mockResolvedValue([
        { id: "watch-1", liveId: "live-1", viewerKeyHash: "viewer-1", capturedAt: createdAt, watchSeconds: 30, live: { title: "直播一", video: { durationSec: 60 } } },
        { id: "watch-2", liveId: "live-1", viewerKeyHash: "viewer-2", capturedAt: later, watchSeconds: 40, live: { title: "直播一", video: { durationSec: 60 } } },
      ]) },
      liveChatMessage: { findMany: vi.fn().mockResolvedValue([{ id: "chat-1", createdAt: later, body: "想了解", live: { title: "直播一" } }]) },
      liveInteractionResponse: { findMany: vi.fn().mockResolvedValue([{ id: "response-1", createdAt: later, winnerClaimedAt: later, live: { title: "直播一" }, run: { title: "抽獎", winnerResponseId: "response-1" } }]) },
      commerceOrder: { findMany: vi.fn().mockResolvedValue([{ id: "order-1", orderNumber: "CD-1", paidAmountCents: 10000, refundedAmountCents: 1000, paidAt: later, createdAt, items: [{ productName: "方案" }], electronicInvoice: { id: "invoice-1", issuedAt: later, createdAt, invoiceNumber: "AB-1", amountCents: 9000 }, primaryPaymentTransaction: { providerName: "demo" } }]) },
      customerTagAssignment: { findMany: vi.fn().mockResolvedValue([{ id: "tag-1", createdAt: later, tag: "高意向" }]) },
      automationVoucherGrant: { findMany: vi.fn().mockResolvedValue([{ id: "voucher-1", createdAt: later, discountType: "fixed", discountValue: 500 }]) },
      automationExecutionLog: { findMany: vi.fn().mockResolvedValue([{ id: "automation-1", createdAt: later, trigger: "follow_up", status: "completed" }]) },
      customerCrmRecord: { findUnique: vi.fn().mockResolvedValue({ consultationStatus: "scheduled", notes: [{ id: "note-1", createdAt: later, actorLabel: "owner", body: "追蹤" }] }) },
    };

    const result = await getCustomerProfile("vendor-a", "customer-hash", "project-a");
    expect(result).toMatchObject({ name: "王小明", consultationStatus: "scheduled", lifetimeValueCents: 9000, watchSeconds: 70, watchCompletionRate: 100, entryCount: 2, bookingAnswers: { goal: "成交" } });
    expect(result?.timeline.map((event) => event.kind)).toEqual(expect.arrayContaining(["registration", "watch", "chat", "prize", "consultation", "order", "invoice", "tag", "voucher", "automation", "note"]));
  });

  it("falls back to legacy unhashed registration rows", async () => {
    vi.stubEnv("CSRF_SECRET", "customer-crm-test-secret-012345678901234567890123456789");
    const customerKeyHash = automationCustomerKeyHash("vendor-a", "legacy@example.com");
    const empty = () => vi.fn().mockResolvedValue([]);
    database.current = {
      formSubmission: { findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "legacy-1", name: "舊資料", email: "legacy@example.com", phone: null, source: null, attribution: null, createdAt: new Date("2026-01-01Z"), form: { name: "舊表單" } }]) },
      consultationBooking: { findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]) },
      streamUsageLedgerEntry: { findMany: empty() },
      liveChatMessage: { findMany: empty() },
      liveInteractionResponse: { findMany: empty() },
      commerceOrder: { findMany: empty() },
      customerTagAssignment: { findMany: empty() },
      automationVoucherGrant: { findMany: empty() },
      automationExecutionLog: { findMany: empty() },
      customerCrmRecord: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    await expect(getCustomerProfile("vendor-a", customerKeyHash)).resolves.toMatchObject({ name: "舊資料", maskedEmail: "le****@example.com" });
    vi.unstubAllEnvs();
  });
});
