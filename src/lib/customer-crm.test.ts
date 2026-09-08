import { describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/lib/db", () => ({ getDb: () => database.current }));

import { aggregateCustomerJourney, listCustomers, maskEmail, maskPhone } from "./customer-crm";

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

  it("builds a tenant-qualified union from hash-only CRM sources without a row cap", async () => {
    const findMany = (result: unknown[]) => vi.fn(async (_args: unknown) => result);
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
});
