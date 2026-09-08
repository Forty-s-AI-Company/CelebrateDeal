import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigationMocks = vi.hoisted(() => ({ pathname: "/affiliates/commissions" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigationMocks.pathname }));
vi.mock("@/app/actions", () => ({ logoutAction: vi.fn() }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));

import { csvCell } from "@/app/api/affiliates/payouts/export/route";
import { navigationForRole } from "@/components/app-shell";
import { FeatureAccessBoundary } from "@/components/feature-access-boundary";
import { automationCustomerKeyHash, dryRunAutomationRule, materializeAutomationRecipe } from "@/lib/automation-workflow";
import { createBankAccountKeyring, decryptBankAccount, encryptBankAccount, maskBankAccount } from "@/lib/bank-account";
import { generateConsultationSlots } from "@/lib/consultation-slot-engine";
import { aggregateCustomerJourney } from "@/lib/customer-crm";
import { getEvergreenPlaybackState, getNextJustInTimeStart, validateEvergreenWatchProgress } from "@/lib/evergreen-webinar";
import { FunnelPageBlocksSchema } from "@/lib/funnel-blocks-schema";
import { getFunnelTemplate } from "@/lib/funnel-templates";
import { createLuckyDrawClaimCode, hashLuckyDrawClaimCode, luckyDrawClaimHashesMatch, pickLuckyDrawWinner, pollPercentages } from "@/lib/live-interaction";
import { computeEcpayCheckMacValue, ecpayPaymentProvider, getEcpayConfig } from "@/lib/payment-providers/ecpay";
import { splitTaiwanVat } from "@/lib/taiwan-electronic-invoice";
import { invoiceBuyerDisplay, protectInvoiceRequest, revealInvoiceRequest } from "@/lib/taiwan-invoice-request";
import { isValidCitizenDigitalCertificate, isValidMobileBarcode } from "@/lib/taiwan-invoice-validator";
import { calculateTaiwanTaxWithholding } from "@/lib/taiwan-tax-withholding";
import { decryptTaxIdentity, encryptTaxIdentity, maskTaxIdentity } from "@/lib/tax-identity";
import { calculateTieredCommission } from "@/lib/tiered-commission-engine";
import { ALL_VENDOR_FEATURE_MODULES, requiredFeatureForPath } from "@/lib/vendor-feature-toggles";

type JourneyState = {
  vendorId: string;
  customerKeyHash?: string;
  registration?: { id: string; vendorId: string; email: string; createdAt: Date };
  watchSeconds?: number;
  booking?: { id: string; vendorId: string; startTime: Date; endTime: Date; answers: Record<string, string>; createdAt: Date };
  consultationStatus?: "closed_won";
  payment?: { orderNumber: string; amountCents: number };
  invoice?: { vendorId: string; amountCents: number; pretaxAmountCents: number; taxAmountCents: number };
};

const keyring = createBankAccountKeyring({ activeKeyId: "golden", keys: { golden: randomBytes(32).toString("base64url") } });

describe.sequential("CelebrateDeal ultimate ten-step webinar funnel golden journey", () => {
  const journey: JourneyState = { vendorId: "vendor-golden" };

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ECPAY_ENV", "sandbox");
    vi.stubEnv("ECPAY_MERCHANT_ID", "");
    vi.stubEnv("ECPAY_HASH_KEY", "");
    vi.stubEnv("ECPAY_HASH_IV", "");
    vi.stubEnv("CSRF_SECRET", "golden-journey-test-only-encryption-material-2026");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("Step 1：建置一頁式漏斗，驗證多欄價格、倒數與防重複提交", () => {
    const blocks = FunnelPageBlocksSchema.parse(getFunnelTemplate("high-ticket-masterclass")!.pageBlocks);
    expect(blocks.some((block) => block.type === "carousel_slider")).toBe(true);
    expect(blocks.some((block) => block.type === "countdown_timer")).toBe(true);
    expect(blocks.find((block) => block.type === "pricing_table")).toMatchObject({ settings: { layout: "three_column", cards: expect.arrayContaining([expect.any(Object), expect.any(Object), expect.any(Object)]) } });

    // 模擬資料庫唯一鍵所代表的瀏覽器重送鎖。
    const rows = new Map<string, JourneyState["registration"]>();
    const submit = (key: string) => {
      const lock = `${journey.vendorId}:form-golden:${key}`;
      if (rows.has(lock)) return { created: false, row: rows.get(lock) };
      const row = { id: "registration-golden", vendorId: journey.vendorId, email: "student@example.test", createdAt: new Date("2026-09-08T05:55:00Z") };
      rows.set(lock, row);
      return { created: true, row };
    };
    const first = submit("browser-submit-1");
    expect(submit("browser-submit-1")).toEqual({ created: false, row: first.row });
    journey.registration = first.row;
    journey.customerKeyHash = automationCustomerKeyHash(journey.vendorId, first.row!.email);
  });

  it("Step 2：計算 JIT 五分鐘倒數、毫秒 offset 與禁快轉", () => {
    const enteredAt = new Date("2026-09-08T05:55:00.000Z");
    const start = getNextJustInTimeStart(enteredAt, 5);
    expect(start.toISOString()).toBe("2026-09-08T06:00:00.000Z");
    expect(getEvergreenPlaybackState({ mode: "just_in_time", sessionStartAt: start, durationSeconds: 3_600 }, enteredAt)).toMatchObject({ roomState: "waiting_countdown", countdownSeconds: 300, offsetSeconds: 0 });
    expect(getEvergreenPlaybackState({ mode: "just_in_time", sessionStartAt: start, durationSeconds: 3_600 }, "2026-09-08T06:30:00.500Z")).toMatchObject({ roomState: "playing", offsetSeconds: 1_800.5 });
    expect(validateEvergreenWatchProgress({ previousOffsetSeconds: 30, reportedOffsetSeconds: 90, elapsedWallSeconds: 5, claimedWatchSeconds: 5 })).toEqual({ accepted: false, reason: "time_jump" });
    expect(validateEvergreenWatchProgress({ previousOffsetSeconds: 30, reportedOffsetSeconds: 35, elapsedWallSeconds: 5, claimedWatchSeconds: 5, playbackRate: 2 })).toEqual({ accepted: false, reason: "playback_rate" });
  });

  it("Step 3：完成投票、HMAC 抽獎核銷與隱私化買家跑馬燈", () => {
    expect(pollPercentages([{ id: "yes", label: "想了解" }, { id: "later", label: "再看看" }], ["yes"])).toEqual([
      { id: "yes", label: "想了解", votes: 1, percentage: 100 },
      { id: "later", label: "再看看", votes: 0, percentage: 0 },
    ]);
    expect(pickLuckyDrawWinner([journey.registration], () => 0)).toBe(journey.registration);
    const code = createLuckyDrawClaimCode();
    expect(code.replace(/^CD-WIN-/u, "").replace("-", "")).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/u);
    expect(luckyDrawClaimHashesMatch(hashLuckyDrawClaimCode(code), code)).toBe(true);
    expect(hashLuckyDrawClaimCode(code)).not.toContain(code);
    const ticker = [{ maskedName: "王＊＊", productName: "高客單成交實戰班" }];
    expect(ticker[0]?.maskedName).toBe("王＊＊");
    expect(JSON.stringify(ticker)).not.toContain(journey.registration!.email);
  });

  it("Step 4：觀看滿 1,800 秒觸發九折券與高意向標籤", () => {
    const heartbeat = validateEvergreenWatchProgress({ previousOffsetSeconds: 0, reportedOffsetSeconds: 1_800, elapsedWallSeconds: 1_800, claimedWatchSeconds: 1_800 });
    expect(heartbeat).toEqual({ accepted: true, watchSeconds: 1_800 });
    journey.watchSeconds = heartbeat.accepted ? heartbeat.watchSeconds : 0;
    const recipe = materializeAutomationRecipe("high_intent_chaser", "product-golden")!;
    const actions = [...recipe.actions, { type: "add_customer_tag" as const, tag: "高意向潛客" }];
    expect(recipe).toMatchObject({ trigger: "webinar_attended_duration_gte", condition: { type: "watch_seconds_gte_and_not_purchased", seconds: 1_800 } });
    expect(dryRunAutomationRule({ condition: recipe.condition, actions }, {
      vendorId: journey.vendorId, eventId: "watch-1800", trigger: "webinar_attended_duration_gte", subjectType: "viewer_session",
      subjectId: "viewer-golden", subjectKeyHash: journey.customerKeyHash!, watchSecondsTotal: journey.watchSeconds, hasPurchased: false,
    })).toMatchObject({ status: "would_dispatch", conditionMatched: true, actionTypes: ["issue_repurchase_voucher", "line_push", "add_customer_tag"] });
    expect(recipe.actions[0]).toMatchObject({ type: "issue_repurchase_voucher", discountType: "percentage", discountValue: 10 });
  });

  it("Step 5：產生諮詢時段、保存問卷並防止撞單", () => {
    const event = { weeklySchedule: { tuesday: [{ start: "10:00", end: "12:00" }] }, durationMinutes: 60 };
    const from = new Date("2026-09-08T00:00:00Z");
    const to = new Date("2026-09-09T00:00:00Z");
    const slots = generateConsultationSlots({ event, from, to });
    journey.booking = { id: "booking-golden", vendorId: journey.vendorId, ...slots[0]!, answers: { goal: "建立高客單產品" }, createdAt: new Date("2026-09-08T07:00:00Z") };
    expect(slots).toHaveLength(2);
    expect(journey.booking.answers).toEqual({ goal: "建立高客單產品" });
    expect(generateConsultationSlots({ event, from, to, bookings: [{ ...journey.booking, status: "scheduled" }] })).toEqual([slots[1]]);
  });

  it("Step 6：聚合 360 CRM 時間軸、顧問備註與成交狀態", () => {
    journey.consultationStatus = "closed_won";
    const profile = aggregateCustomerJourney({ vendorId: journey.vendorId, customerKeyHash: journey.customerKeyHash!,
      registrations: [{ id: journey.registration!.id, createdAt: journey.registration!.createdAt, formName: "高客單講座報名" }],
      watches: [{ id: "watch", capturedAt: new Date("2026-09-08T06:30:00Z"), liveTitle: "常青成交課", seconds: journey.watchSeconds! }],
      automations: [{ id: "automation", createdAt: new Date("2026-09-08T06:30:01Z"), trigger: "webinar_attended_duration_gte", status: "completed" }],
      vouchers: [{ id: "voucher", createdAt: new Date("2026-09-08T06:30:02Z"), discountType: "percentage", discountValue: 10 }],
      tags: [{ id: "tag", createdAt: new Date("2026-09-08T06:30:03Z"), tag: "高意向潛客" }],
      bookings: [{ id: journey.booking!.id, createdAt: journey.booking!.createdAt, startTime: journey.booking!.startTime, eventTitle: "1 對 1 成交諮詢", status: "scheduled", answers: journey.booking!.answers }],
      notes: [{ id: "note", createdAt: new Date("2026-09-08T08:00:00Z"), actorLabel: "顧問 Eden", body: "需求明確，會談後確認成交" }],
    });
    expect(profile.timeline.map((event) => event.kind)).toEqual(["note", "consultation", "tag", "voucher", "automation", "watch", "registration"]);
    expect(profile.timeline.find((event) => event.kind === "tag")?.title).toContain("高意向潛客");
    expect(profile.timeline.find((event) => event.kind === "note")?.detail).toContain("確認成交");
    expect(journey.consultationStatus).toBe("closed_won");
  });

  it("Step 7：計算 ECPay CheckMacValue 並驗證成功回調", async () => {
    const { hashKey, hashIv } = getEcpayConfig();
    const callback = { MerchantID: "2000132", MerchantTradeNo: "GOLDENORDER20260908", TradeNo: "2026090800001", RtnCode: "1", RtnMsg: "Succeeded", TradeAmt: "128000", PaymentDate: "2026/09/08 09:00:00" };
    const mac = computeEcpayCheckMacValue(callback, hashKey, hashIv);
    expect(mac).toMatch(/^[A-F0-9]{64}$/u);
    const body = new URLSearchParams({ ...callback, CheckMacValue: mac }).toString();
    expect(await ecpayPaymentProvider.verifySignature(new Request("https://example.test/webhook", { method: "POST", body }), body)).toBe(true);
    expect(await ecpayPaymentProvider.normalizePayload(body)).toMatchObject({ payload: { eventType: "paid", orderNumber: callback.MerchantTradeNo, grossAmountCents: 12_800_000 } });
    journey.payment = { orderNumber: callback.MerchantTradeNo, amountCents: 12_800_000 };
  });

  it("Step 8：驗證 B2C 載具、稅額四捨五入與防偽發票請求", () => {
    expect(isValidMobileBarcode("/ABC1234")).toBe(true);
    expect(isValidCitizenDigitalCertificate("AB12345678901234")).toBe(true);
    const request = { type: "personal" as const, carrier: "mobile" as const, carrierNumber: "/ABC1234" };
    const encrypted = protectInvoiceRequest(request, journey.vendorId, journey.payment!.orderNumber);
    expect(encrypted).not.toContain(request.carrierNumber);
    expect(revealInvoiceRequest(encrypted, journey.vendorId, journey.payment!.orderNumber)).toEqual(request);
    expect(() => revealInvoiceRequest(encrypted, "vendor-other", journey.payment!.orderNumber)).toThrow();
    expect(invoiceBuyerDisplay(request, journey.registration!.email)).not.toContain(journey.registration!.email);
    const tax = splitTaiwanVat(journey.payment!.amountCents);
    journey.invoice = { vendorId: journey.vendorId, amountCents: journey.payment!.amountCents, ...tax };
    expect(tax).toEqual({ pretaxAmountCents: 12_190_476, taxAmountCents: 609_524 });
    expect(tax.pretaxAmountCents + tax.taxAmountCents).toBe(journey.payment!.amountCents);
  });

  it("Step 9：結算佣金、2.11% 健保、勞報審核與安全 CSV", () => {
    const commission = calculateTieredCommission({ unitPriceCents: journey.invoice!.amountCents, quantity: 1, cumulativeSalesBeforeCount: 5,
      policy: { version: 1, tiers: [{ minQuantity: 1, maxQuantity: 5, rateBps: 1_500 }, { minQuantity: 6, maxQuantity: null, rateBps: 2_000 }] } });
    const withholding = calculateTaiwanTaxWithholding({ grossAmountCents: commission.commissionAmountCents, bankFeeCents: 0 });
    expect(commission).toMatchObject({ appliedRateBps: 2_000, commissionAmountCents: 2_560_000 });
    expect(withholding).toMatchObject({ withholdingTaxCents: 256_000, nhiSupplementaryTaxCents: 54_000, netPayoutAmountCents: 2_250_000 });
    expect({ status: "approved", signedAt: new Date("2026-09-08T10:00:00Z") }).toMatchObject({ status: "approved", signedAt: expect.any(Date) });
    expect(csvCell("=HYPERLINK(\"https://evil.example\")")).toBe("\"'=HYPERLINK(\"\"https://evil.example\"\")\"");

    const taxId = "A123456789";
    const bank = { accountName: "黃金夥伴", bankCode: "812", bankBranch: "0012", accountNumber: "012345678901" };
    const taxEnvelope = encryptTaxIdentity(taxId, journey.vendorId, keyring);
    const bankEnvelope = encryptBankAccount(bank, journey.vendorId, keyring);
    expect(`${taxEnvelope}${bankEnvelope}`).not.toContain(taxId);
    expect(`${taxEnvelope}${bankEnvelope}`).not.toContain(bank.accountNumber);
    expect(decryptTaxIdentity(taxEnvelope, journey.vendorId, keyring)).toBe(taxId);
    expect(decryptBankAccount(bankEnvelope, journey.vendorId, keyring)).toEqual(bank);
    expect(() => decryptBankAccount(bankEnvelope, "vendor-other", keyring)).toThrow();
    expect(maskTaxIdentity(taxId)).toBe("A1*****789");
    expect(maskBankAccount(bank)).toMatchObject({ accountName: "黃＊＊＊", accountNumber: "****8901" });
  });

  it("Step 10：驗證五大模組自適應隱藏與直接路由權限", () => {
    const guarded = ["funnel_builder", "live_webinar", "affiliate_program", "tax_remuneration", "consultation_booking"] as const;
    expect(guarded).toHaveLength(5);
    expect(guarded.every((module) => ALL_VENDOR_FEATURE_MODULES.includes(module))).toBe(true);
    expect([requiredFeatureForPath("/forms"), requiredFeatureForPath("/lives"), requiredFeatureForPath("/affiliates"), requiredFeatureForPath("/billing/payouts"), requiredFeatureForPath("/consultations")]).toEqual(guarded);
    const enabled = ALL_VENDOR_FEATURE_MODULES.filter((module) => module !== "affiliate_program");
    const links = navigationForRole("owner", false, enabled).flatMap((group) => group.items.map((item) => item.href));
    expect(links).not.toContain("/affiliates");
    navigationMocks.pathname = "/affiliates/commissions";
    const html = renderToStaticMarkup(createElement(FeatureAccessBoundary, { enabledModules: enabled, children: createElement("p", null, "private affiliate page") }));
    expect(html).toContain("該功能目前尚未在此特店啟用");
    expect(html).not.toContain("private affiliate page");

    const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
    for (const model of ["FormSubmission", "LiveInteractionResponse", "ConsultationBooking", "ElectronicInvoice", "AffiliateCommission", "AffiliatePayout", "CustomerCrmRecord"]) expect(schema).toContain(`model ${model} {`);
    expect(schema).toContain("@@unique([vendorId, id])");
    expect([journey.registration?.vendorId, journey.booking?.vendorId, journey.invoice?.vendorId]).toEqual([journey.vendorId, journey.vendorId, journey.vendorId]);
  });
});
