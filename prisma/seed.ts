import { Prisma, PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

function roleAvatar(seed: string) {
  return `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(seed)}&backgroundType=gradientLinear&radius=18`;
}

const billingPlanSeeds = [
  {
    name: "Starter",
    code: "starter",
    monthlyPriceCents: 248000,
    includedStreamMinutes: 18000,
    includedStorageMinutes: 1200,
    includedCredits: 5000,
    includedEvents: 20,
    includedAffiliates: 3,
    overageCreditCostCents: 2,
    overflowWatchHourPriceCents: 40000,
    overflowEventUnitPriceCents: 40000,
    overflowAffiliateUnitPriceCents: 30000,
    overflowStorageMinutePriceCents: 150,
    paymentServiceFeeCents: 49900,
    transactionFeeRateBps: 120,
    affiliateManagementFeeCents: 0,
    description: "適合個人講師、小型團購主，支援自帶金流並可加購平台金流。",
  },
  {
    name: "Growth",
    code: "growth",
    monthlyPriceCents: 598000,
    includedStreamMinutes: 90000,
    includedStorageMinutes: 3000,
    includedCredits: 20000,
    includedEvents: 80,
    includedAffiliates: 30,
    overageCreditCostCents: 2,
    overflowWatchHourPriceCents: 40000,
    overflowEventUnitPriceCents: 40000,
    overflowAffiliateUnitPriceCents: 30000,
    overflowStorageMinutePriceCents: 150,
    paymentServiceFeeCents: 99900,
    transactionFeeRateBps: 100,
    affiliateManagementFeeCents: 99000,
    description: "適合穩定開課者與小型代理團隊，內含更高播放與推廣額度。",
  },
  {
    name: "Team / Pro",
    code: "team-pro",
    monthlyPriceCents: 1280000,
    includedStreamMinutes: 300000,
    includedStorageMinutes: 10000,
    includedCredits: 80000,
    includedEvents: 300,
    includedAffiliates: 200,
    overageCreditCostCents: 2,
    overflowWatchHourPriceCents: 40000,
    overflowEventUnitPriceCents: 40000,
    overflowAffiliateUnitPriceCents: 30000,
    overflowStorageMinutePriceCents: 150,
    paymentServiceFeeCents: 0,
    transactionFeeRateBps: 80,
    affiliateManagementFeeCents: 199000,
    description: "適合品牌商、高頻賣課團隊與直銷團隊，可客製平台金流與費率。",
  },
] satisfies Prisma.BillingPlanCreateInput[];

async function seedProductionBootstrap() {
  for (const plan of billingPlanSeeds) {
    await prisma.billingPlan.upsert({
      where: { code: plan.code },
      update: plan,
      create: plan,
    });
  }

  console.log("Production bootstrap completed: billing plans upserted.");
}

async function main() {
  const seedMode = process.env.SEED_MODE ?? "demo";
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && seedMode !== "production-bootstrap") {
    throw new Error("Production seed is locked. Use SEED_MODE=production-bootstrap to upsert non-destructive platform defaults only.");
  }

  if (seedMode === "production-bootstrap") {
    await seedProductionBootstrap();
    return;
  }

  await prisma.webhookEvent.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.payoutBatch.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.user.deleteMany();
  await prisma.billingPlan.deleteMany();

  const [, growthPlan] = await Promise.all(
    billingPlanSeeds.map((plan) => prisma.billingPlan.create({ data: plan })),
  );

  const user = await prisma.user.create({
    data: {
      email: "demo@celebratedeal.local",
      name: "Demo Owner",
      passwordHash: hashPassword("demo1234"),
    },
  });

  const vendor = await prisma.vendor.create({
    data: {
      name: "Wuhe Select",
      slug: "wuhe-select",
      email: "demo@celebratedeal.local",
      passwordHash: hashPassword("demo1234"),
      logoUrl: "https://images.unsplash.com/photo-1556761175-b413da4baf72?q=80&w=400&auto=format&fit=crop",
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      timezone: "Asia/Taipei",
      supportEmail: "support@celebratedeal.local",
      onboardingStatus: "completed",
      onboardingCompletedAt: new Date(),
      tracking: {
        create: {
          facebookPixelId: "1234567890",
          tiktokPixelId: "CDEMO12345",
          googleTagManagerId: "GTM-DEMO",
        },
      },
      members: {
        create: {
          userId: user.id,
          role: "owner",
        },
      },
      usageLimit: {
        create: {
          billingPlanId: growthPlan.id,
          streamMinutesLimit: growthPlan.includedStreamMinutes,
          storageMinutesLimit: growthPlan.includedStorageMinutes,
          creditsLimit: growthPlan.includedCredits,
          notificationEmailsLimit: growthPlan.includedNotificationEmails,
          streamMinutesUsed: 36240,
          storageMinutesUsed: 1460,
          creditsUsed: 7280,
          resetAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 18),
        },
      },
    },
  });

  await prisma.vendorSubscription.create({
    data: {
      vendorId: vendor.id,
      planId: growthPlan.id,
      paymentMode: "platform",
      status: "active",
      billingCycleDay: 5,
      startedAt: new Date("2026-07-01T00:00:00+08:00"),
    },
  });

  const [hostRole, assistantRole] = await Promise.all([
    prisma.interactionRole.create({
      data: {
        vendorId: vendor.id,
        name: "Wuhe AI 主持人",
        avatarUrl: roleAvatar("host-blue"),
        label: "AI 主持人",
        roleType: "ai_host",
        tone: "溫暖、專業、提醒優惠但不催促",
      },
    }),
    prisma.interactionRole.create({
      data: {
        vendorId: vendor.id,
        name: "官方客服助手",
        avatarUrl: roleAvatar("support-green"),
        label: "官方角色",
        roleType: "official",
        tone: "簡潔回覆商品與報名問題",
      },
    }),
  ]);

  const [video, form, products, template, affiliate] = await Promise.all([
    prisma.video.create({
      data: {
        vendorId: vendor.id,
        title: "夏季新品直播回放",
        description: "可重複播放的品牌直播影片，用於新品導購與報名轉換。",
        sourceType: "cloudflare_stream",
        videoUrl: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
        thumbnailUrl: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=1200&auto=format&fit=crop",
        durationSec: 660,
        cloudflareStreamUid: "demo_stream_uid_summer_glow",
        cloudflarePlaybackId: "demo_playback_id_summer_glow",
        cloudflareReadyToStream: true,
        estimatedMinutes: 11,
      },
    }),
    prisma.registrationForm.create({
      data: {
        vendorId: vendor.id,
        name: "直播開播提醒表單",
        slug: "summer-live-reminder",
        headline: "預約直播提醒",
        description: "留下聯絡方式，開播前我們會寄送提醒與專屬優惠。",
        fields: [
          { key: "name", label: "姓名", type: "text", required: true },
          { key: "email", label: "Email", type: "email", required: true },
          { key: "phone", label: "手機", type: "tel", required: false },
        ],
      },
    }),
    Promise.all([
      prisma.product.create({
        data: {
          vendorId: vendor.id,
          name: "亮澤修護精華組",
          slug: "glow-serum-set",
          description: "直播限定雙瓶組，適合想快速補水與提升光澤的日常保養。",
          priceCents: 168000,
          compareAtCents: 228000,
          imageUrl: "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?q=80&w=900&auto=format&fit=crop",
          checkoutUrl: "https://example.com/checkout/glow-serum-set",
          inventory: 120,
        },
      }),
      prisma.product.create({
        data: {
          vendorId: vendor.id,
          name: "旅行保養體驗盒",
          slug: "travel-care-kit",
          description: "低門檻體驗組，適合直播間首次購買與加購。",
          priceCents: 69000,
          compareAtCents: 98000,
          imageUrl: "https://images.unsplash.com/photo-1556228578-8c89e6adf883?q=80&w=900&auto=format&fit=crop",
          checkoutUrl: "https://example.com/checkout/travel-care-kit",
          inventory: 260,
        },
      }),
    ]),
    prisma.messageTemplate.create({
      data: {
        vendorId: vendor.id,
        name: "報名成功通知",
        channel: "email",
        trigger: "registration_confirmed",
        subject: "{{live_title}} 報名成功",
        body: "嗨 {{name}}，你已完成 {{live_title}} 預約。開播前我們會再次提醒你，這次不要像我一樣看到通知才想起還沒泡咖啡。",
      },
    }),
    prisma.affiliate.create({
      data: {
        vendorId: vendor.id,
        name: "美妝社群 KOL A",
        code: "GLOWA",
        source: "instagram",
        contactEmail: "partner-a@example.com",
        commissionRateBps: 800,
      },
    }),
  ]);

  const script = await prisma.interactionScript.create({
    data: {
      vendorId: vendor.id,
      name: "夏季亮膚直播互動節奏",
      description: "依影片秒數推送官方角色訊息、商品浮出與 CTA 切換。",
      status: "published",
      events: {
        create: [
          {
            roleId: hostRole.id,
            eventType: "chat_message",
            triggerSec: 8,
            title: "開場歡迎",
            message: "歡迎來到官方直播間，我是今天的 AI 主持人，會幫大家整理重點與優惠。",
          },
          {
            eventType: "product_spotlight",
            triggerSec: 45,
            title: "主打商品浮出",
            productId: products[0].id,
            ctaLabel: "查看主打組合",
          },
          {
            roleId: assistantRole.id,
            eventType: "chat_message",
            triggerSec: 80,
            title: "提醒報名",
            message: "想收到開播與優惠提醒，可以到報名分頁留下資料，我們只會寄送本場相關通知。",
          },
          {
            eventType: "cta_switch",
            triggerSec: 120,
            title: "CTA 切換",
            ctaLabel: "領取直播優惠",
            ctaUrl: "https://example.com/live-offer",
          },
          {
            eventType: "product_spotlight",
            triggerSec: 180,
            title: "加購商品浮出",
            productId: products[1].id,
            ctaLabel: "看加購推薦",
          },
        ],
      },
    },
  });

  const live = await prisma.live.create({
    data: {
      vendorId: vendor.id,
      videoId: video.id,
      formId: form.id,
      messageTemplateId: template.id,
      interactionScriptId: script.id,
      title: "夏季亮膚新品直播",
      slug: "summer-glow-live",
      description: "結合預錄影片、商品卡、報名表與追蹤事件的示範直播間。",
      scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      status: "scheduled",
      heroImageUrl: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?q=80&w=1400&auto=format&fit=crop",
      accentCopy: "直播限定 72 小時優惠",
      streamMode: "vod",
      cloudflareLiveInputUid: "demo_live_input_uid",
      quotaPolicy: { maxConcurrentViewers: 500, stopWhenCreditsBelow: 300 },
      products: {
        create: products.map((product, index) => ({
          productId: product.id,
          sortOrder: index + 1,
          offerLabel: index === 0 ? "主打組合" : "加購推薦",
          isPinned: index === 0,
        })),
      },
    },
  });

  await prisma.formSubmission.create({
    data: {
      formId: form.id,
      liveId: live.id,
      name: "陳小明",
      email: "ming@example.com",
      phone: "0912345678",
      source: "live",
      answers: { interest: "精華組" },
    },
  });

  await prisma.analyticsEvent.createMany({
    data: [
      { vendorId: vendor.id, liveId: live.id, eventType: "page_view", visitorId: "demo-a", payload: { path: `/live/${live.slug}` } },
      { vendorId: vendor.id, liveId: live.id, eventType: "video_play", visitorId: "demo-a", payload: { seconds: 0 } },
      { vendorId: vendor.id, liveId: live.id, eventType: "play_progress", visitorId: "demo-a", payload: { seconds: 120 } },
      { vendorId: vendor.id, liveId: live.id, eventType: "lead_submit", visitorId: "demo-a", payload: { form: form.slug } },
      { vendorId: vendor.id, liveId: live.id, eventType: "cta_click", visitorId: "demo-a", payload: { label: "領取直播優惠" } },
      { vendorId: vendor.id, liveId: live.id, eventType: "product_click", visitorId: "demo-b", payload: { product: products[0].slug } },
    ],
  });

  await prisma.affiliateClick.createMany({
    data: [
      {
        vendorId: vendor.id,
        affiliateId: affiliate.id,
        liveId: live.id,
        referralCode: affiliate.code,
        visitorId: "demo-aff-1",
        landingPath: `/live/${live.slug}?ref=${affiliate.code}`,
        convertedAt: new Date(),
      },
      {
        vendorId: vendor.id,
        affiliateId: affiliate.id,
        liveId: live.id,
        referralCode: affiliate.code,
        visitorId: "demo-aff-2",
        landingPath: `/live/${live.slug}?ref=${affiliate.code}`,
      },
    ],
  });

  await prisma.blacklist.create({
    data: {
      vendorId: vendor.id,
      identifier: "blocked@example.com",
      identifierType: "email",
      reason: "多次提交無效資料",
      notes: "MVP 示範資料，可在後台解除封鎖。",
    },
  });

  await prisma.usageRecord.createMany({
    data: [
      {
        vendorId: vendor.id,
        monthKey: "2026-07",
        recordType: "stream_minutes",
        quantity: 36240,
        unit: "minute",
        creditsDelta: -3624,
        totalWatchMinutes: 36240,
        totalEvents: 26,
        totalAffiliates: 8,
        totalStorageMinutes: 1460,
        description: "Cloudflare Stream VOD 與 Live 播放估算",
      },
      {
        vendorId: vendor.id,
        monthKey: "2026-07",
        recordType: "storage_minutes",
        quantity: 1460,
        unit: "minute",
        creditsDelta: -146,
        totalWatchMinutes: 36240,
        totalEvents: 26,
        totalAffiliates: 8,
        totalStorageMinutes: 1460,
        description: "影片儲存用量",
      },
      {
        vendorId: vendor.id,
        monthKey: "2026-07",
        recordType: "interaction_events",
        quantity: 480,
        unit: "event",
        creditsDelta: -48,
        totalWatchMinutes: 36240,
        totalEvents: 26,
        totalAffiliates: 8,
        totalStorageMinutes: 1460,
        description: "互動腳本事件推送",
      },
    ],
  });

  await prisma.paymentAccount.createMany({
    data: [
      {
        vendorId: vendor.id,
        mode: "platform",
        providerName: "platform-ecpay",
        accountLabel: "平台統一金流代收",
        status: "verified",
        merchantIdRef: "vault:ecpay:demo-merchant",
        bankAccountName: "五合選品有限公司",
        bankCode: "013",
        bankAccountNumber: "vault:bank:wuhe-main",
      },
      {
        vendorId: vendor.id,
        mode: "byo",
        providerName: "stripe",
        accountLabel: "商家自帶 Stripe",
        status: "pending",
        apiKeyRef: "vault:stripe:demo",
      },
    ],
  });

  const firstTransaction = await prisma.paymentTransaction.create({
    data: {
        vendorId: vendor.id,
        providerName: "platform-ecpay",
        providerTradeNo: "PAY20260701001",
        orderNumber: "ORDER-1001",
        paymentMode: "platform",
        grossAmountCents: 168000,
        gatewayFeeCents: 4200,
        platformFeeCents: 1680,
        netAmountCents: 162120,
        status: "paid",
    },
  });

  const secondTransaction = await prisma.paymentTransaction.create({
    data: {
        vendorId: vendor.id,
        providerName: "platform-ecpay",
        providerTradeNo: "PAY20260701002",
        orderNumber: "ORDER-1002",
        paymentMode: "platform",
        grossAmountCents: 69000,
        gatewayFeeCents: 1725,
        platformFeeCents: 690,
        netAmountCents: 61585,
        status: "partially_refunded",
        refundedAmountCents: 5000,
        refundReason: "客戶取消部分加購",
        refundedAt: new Date("2026-07-10T12:00:00+08:00"),
    },
  });

  await prisma.refundRecord.create({
    data: {
      vendorId: vendor.id,
      paymentTransactionId: secondTransaction.id,
      monthKey: "2026-07",
      refundAmountCents: 5000,
      gatewayFeeRefundCents: 125,
      platformFeeRefundCents: 50,
      reason: "客戶取消部分加購",
    },
  });

  await prisma.affiliateCommission.createMany({
    data: [
      {
        vendorId: vendor.id,
        affiliateId: affiliate.id,
        monthKey: "2026-07",
        sourceType: "product",
        sourceId: products[0].id,
        referralCode: affiliate.code,
        orderNumber: "ORDER-1001",
        orderAmountCents: 168000,
        commissionRateBps: affiliate.commissionRateBps,
        commissionAmountCents: 13440,
        status: "approved",
      },
      {
        vendorId: vendor.id,
        affiliateId: affiliate.id,
        monthKey: "2026-07",
        sourceType: "product",
        sourceId: products[1].id,
        referralCode: affiliate.code,
        orderNumber: "ORDER-1002",
        orderAmountCents: 69000,
        commissionRateBps: affiliate.commissionRateBps,
        commissionAmountCents: 5520,
        status: "pending",
      },
    ],
  });

  const settlement = await prisma.settlement.create({
    data: {
      vendorId: vendor.id,
      monthKey: "2026-07",
      monthlyFeeCents: growthPlan.monthlyPriceCents,
      overflowFeeCents: 0,
      paymentServiceFeeCents: growthPlan.paymentServiceFeeCents,
      transactionServiceFeeCents: 2370,
      affiliateManagementFeeCents: growthPlan.affiliateManagementFeeCents,
      paymentGatewayFeeCents: 5925,
      grossRevenueCents: 237000,
      payoutableAmountCents: 231075,
      adjustmentAmountCents: 0,
      finalPayoutAmountCents: 231075,
      status: "reviewing",
      payoutDate: new Date("2026-08-05T10:00:00+08:00"),
      batchNumber: "PB-20260805-001",
    },
  });

  await prisma.invoice.create({
    data: {
      vendorId: vendor.id,
      monthKey: "2026-07",
      invoiceNumber: "INV-202607-WUHE",
      invoiceType: "monthly",
      monthlyFeeCents: growthPlan.monthlyPriceCents,
      overflowFeeCents: 0,
      paymentServiceFeeCents: growthPlan.paymentServiceFeeCents,
      transactionServiceFeeCents: 2370,
      affiliateManagementFeeCents: growthPlan.affiliateManagementFeeCents,
      subtotalCents: growthPlan.monthlyPriceCents + growthPlan.paymentServiceFeeCents + 2370 + growthPlan.affiliateManagementFeeCents,
      taxCents: 0,
      totalCents: growthPlan.monthlyPriceCents + growthPlan.paymentServiceFeeCents + 2370 + growthPlan.affiliateManagementFeeCents,
      status: "issued",
      dueAt: new Date("2026-08-05T23:59:59+08:00"),
    },
  });

  const payoutBatch = await prisma.payoutBatch.create({
    data: {
      batchNumber: "PB-20260805-001",
      batchDate: new Date("2026-08-05T10:00:00+08:00"),
      totalAmountCents: 231075,
      totalCount: 1,
      status: "reviewing",
      exportedFilePath: "/exports/payouts/PB-20260805-001.csv",
      items: {
        create: {
          vendorId: vendor.id,
          settlementId: settlement.id,
          bankAccountName: "五合選品有限公司",
          bankCode: "013",
          bankAccountNumber: "****7788",
          payoutAmountCents: 231075,
          status: "pending_review",
        },
      },
    },
  });

  await prisma.settlement.update({
    where: { id: settlement.id },
    data: { payoutBatchId: payoutBatch.id },
  });

  await prisma.affiliatePayout.create({
    data: {
      vendorId: vendor.id,
      affiliateId: affiliate.id,
      monthKey: "2026-07",
      commissionAmountCents: 18960,
      adjustmentAmountCents: 0,
      finalAmountCents: 18960,
      status: "pending",
    },
  });

  await prisma.auditLog.createMany({
    data: [
      {
        vendorId: vendor.id,
        actorId: vendor.id,
        actorLabel: "seed",
        action: "generate_settlement",
        targetType: "Settlement",
        targetId: settlement.id,
        after: { monthKey: settlement.monthKey, finalPayoutAmountCents: settlement.finalPayoutAmountCents },
      },
      {
        vendorId: vendor.id,
        actorId: vendor.id,
        actorLabel: "seed",
        action: "refund_payment_transaction",
        targetType: "PaymentTransaction",
        targetId: firstTransaction.id,
        after: { demo: true, note: "稽核紀錄示範" },
      },
    ],
  });

  await prisma.webhookEvent.createMany({
    data: [
      {
        vendorId: vendor.id,
        provider: "platform-ecpay",
        eventId: "evt_demo_paid_1001",
        eventType: "paid",
        status: "processed",
        processedAt: new Date(),
        payload: {
          provider: "platform-ecpay",
          eventId: "evt_demo_paid_1001",
          eventType: "paid",
          vendorSlug: vendor.slug,
          orderNumber: "ORDER-1001",
          grossAmountCents: 168000,
          gatewayFeeCents: 4200,
          platformFeeCents: 1680,
          referralCode: affiliate.code,
        },
      },
      {
        vendorId: vendor.id,
        provider: "platform-ecpay",
        eventId: "evt_demo_refund_failed",
        eventType: "refunded",
        status: "failed",
        errorMessage: "示範：退款事件缺少有效訂單狀態",
        retryCount: 1,
        payload: {
          provider: "platform-ecpay",
          eventId: "evt_demo_refund_failed",
          eventType: "refunded",
          vendorSlug: vendor.slug,
          orderNumber: "ORDER-404",
          refundAmountCents: 10000,
        },
      },
    ],
  });

  console.log("Seeded demo account: demo@celebratedeal.local / demo1234");
  console.log(`Preview live page: /live/${live.slug}`);
  console.log(`Template created: ${template.name}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
