/**
 * Read-only staging inventory (ROADMAP-v2 4.2): lists every vendor with its
 * synthetic-data signals and per-type record counts so the owner can decide
 * what to clean. It never changes or deletes anything:
 *
 * - the whole read runs in one `SET TRANSACTION READ ONLY` repeatable-read
 *   snapshot, so PostgreSQL itself rejects any write;
 * - the output carries ids, a slug masked to 8 characters, timestamps, the
 *   e-mail DOMAIN only, boolean signals and counts. It never prints e-mail
 *   addresses, names, phone numbers, amounts or stream keys.
 *
 * Synthetic signals (any one is enough, all are reported per vendor):
 * - email-domain: vendor e-mail domain is example.com/.org/.net, *.test,
 *   *.local, *.invalid or *.localhost (seed uses celebratedeal.local, tests
 *   use example.test);
 * - email-plus-demo: the e-mail local part contains "+demo";
 * - slug-prefix: slug starts with a known fixture prefix (synthetic-, demo-,
 *   test-, qa-, e2e-, currency-) or equals the seed slug "wuhe-select";
 * - name-marker: the vendor name starts with "Synthetic"/"Demo" or contains
 *   the characters for "synthetic" (合成);
 * - test-orders: the vendor owns CommerceOrder rows with isTestOrder = true.
 * The result is a hint for the owner, not an authorization to delete.
 *
 * Usage (DATABASE_URL must be injected by the approved shell or workflow; this
 * script does not read .env files):
 *
 *   INVENTORY_OUT_DIR=/tmp/out node --import tsx scripts/staging-synthetic-inventory.ts
 *
 * Exit code 0 = inventory printed, 2 = configuration or database failure.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";

export const INVENTORY_SCHEMA_VERSION = "celebratedeal-staging-synthetic-inventory/v1";
const SYNTHETIC_DOMAINS = new Set(["example.com", "example.org", "example.net"]);
const SYNTHETIC_DOMAIN_SUFFIXES = [".test", ".local", ".invalid", ".localhost"];
const SYNTHETIC_SLUG_PREFIXES = ["synthetic-", "demo-", "test-", "qa-", "e2e-", "currency-"];
const SEED_SLUGS = new Set(["wuhe-select"]);

export type SyntheticSignal = "email-domain" | "email-plus-demo" | "slug-prefix" | "name-marker" | "test-orders";
export type VendorCounts = {
  products: number;
  orders: number;
  testOrders: number;
  paymentTransactions: number;
  registrations: number;
  lives: number;
  videos: number;
  customers: number;
};
export type VendorInventory = {
  vendorId: string;
  slugMasked: string;
  createdAt: string;
  emailDomain: string;
  synthetic: boolean;
  signals: SyntheticSignal[];
  counts: VendorCounts;
};
export type StagingSyntheticInventory = {
  schemaVersion: typeof INVENTORY_SCHEMA_VERSION;
  databaseWrites: false;
  vendorTotal: number;
  syntheticVendorTotal: number;
  vendors: VendorInventory[];
  cloudflareStreamVideos: Array<{ vendorId: string; uid: string }>;
};

export const maskSlug = (slug: string) => (slug.length > 8 ? `${slug.slice(0, 8)}…` : slug);

export function emailDomain(email: string) {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).toLowerCase();
}

export function classifyVendor(vendor: { slug: string; email: string; name: string }, testOrders: number): SyntheticSignal[] {
  const signals: SyntheticSignal[] = [];
  const domain = emailDomain(vendor.email);
  if (SYNTHETIC_DOMAINS.has(domain) || SYNTHETIC_DOMAIN_SUFFIXES.some((suffix) => domain.endsWith(suffix))) signals.push("email-domain");
  const at = vendor.email.lastIndexOf("@");
  if ((at < 0 ? vendor.email : vendor.email.slice(0, at)).toLowerCase().includes("+demo")) signals.push("email-plus-demo");
  const slug = vendor.slug.toLowerCase();
  if (SEED_SLUGS.has(slug) || SYNTHETIC_SLUG_PREFIXES.some((prefix) => slug.startsWith(prefix))) signals.push("slug-prefix");
  const name = vendor.name.trim().toLowerCase();
  if (name.startsWith("synthetic") || name.startsWith("demo") || name.includes("合成")) signals.push("name-marker");
  if (testOrders > 0) signals.push("test-orders");
  return signals;
}

type Counted = { vendorId: string; _count: { _all: number } };
const toMap = (rows: Counted[]) => new Map(rows.map((row) => [row.vendorId, row._count._all]));

/** Reads the inventory inside a database-enforced read-only snapshot. */
export async function readStagingSyntheticInventory(db: Pick<PrismaClient, "$transaction">): Promise<StagingSyntheticInventory> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const by: ["vendorId"] = ["vendorId"];
    const count = { _all: true } as const;
    const vendors = await tx.vendor.findMany({
      select: { id: true, slug: true, email: true, name: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const productsRows = await tx.product.groupBy({ by, _count: count });
    const products = toMap(productsRows);
    const ordersRows = await tx.commerceOrder.groupBy({ by, _count: count });
    const orders = toMap(ordersRows);
    const testOrdersRows = await tx.commerceOrder.groupBy({ by, where: { isTestOrder: true }, _count: count });
    const testOrders = toMap(testOrdersRows);
    const paymentsRows = await tx.paymentTransaction.groupBy({ by, _count: count });
    const payments = toMap(paymentsRows);
    const livesRows = await tx.live.groupBy({ by, _count: count });
    const lives = toMap(livesRows);
    const videosRows = await tx.video.groupBy({ by, _count: count });
    const videos = toMap(videosRows);
    const customersRows = await tx.customerCrmRecord.groupBy({ by, _count: count });
    const customers = toMap(customersRows);
    // Registrations hang off a form; map form -> vendor, then count per form.
    const forms = await tx.registrationForm.findMany({ select: { id: true, vendorId: true } });
    const formVendor = new Map(forms.map((form) => [form.id, form.vendorId]));
    const registrations = new Map<string, number>();
    for (const row of await tx.formSubmission.groupBy({ by: ["formId"], _count: { _all: true } })) {
      const vendorId = formVendor.get(row.formId);
      if (vendorId) registrations.set(vendorId, (registrations.get(vendorId) ?? 0) + row._count._all);
    }
    const streamVideos = await tx.video.findMany({
      where: { cloudflareStreamUid: { not: null } },
      select: { vendorId: true, cloudflareStreamUid: true },
      orderBy: [{ vendorId: "asc" }, { id: "asc" }],
    });
    const rows: VendorInventory[] = vendors.map((vendor) => {
      const testOrderCount = testOrders.get(vendor.id) ?? 0;
      const signals = classifyVendor(vendor, testOrderCount);
      return {
        vendorId: vendor.id,
        slugMasked: maskSlug(vendor.slug),
        createdAt: vendor.createdAt.toISOString(),
        emailDomain: emailDomain(vendor.email),
        synthetic: signals.length > 0,
        signals,
        counts: {
          products: products.get(vendor.id) ?? 0,
          orders: orders.get(vendor.id) ?? 0,
          testOrders: testOrderCount,
          paymentTransactions: payments.get(vendor.id) ?? 0,
          registrations: registrations.get(vendor.id) ?? 0,
          lives: lives.get(vendor.id) ?? 0,
          videos: videos.get(vendor.id) ?? 0,
          customers: customers.get(vendor.id) ?? 0,
        },
      };
    });
    return {
      schemaVersion: INVENTORY_SCHEMA_VERSION,
      databaseWrites: false as const,
      vendorTotal: rows.length,
      syntheticVendorTotal: rows.filter((row) => row.synthetic).length,
      vendors: rows,
      cloudflareStreamVideos: streamVideos.flatMap((video) => (video.cloudflareStreamUid ? [{ vendorId: video.vendorId, uid: video.cloudflareStreamUid }] : [])),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 });
}

export function renderMarkdownSummary(inventory: StagingSyntheticInventory): string {
  const lines = [
    "## Staging 合成資料盤點（唯讀，未刪除任何資料）",
    "",
    `- 商家總數：${inventory.vendorTotal}`,
    `- 帶合成標記的商家：${inventory.syntheticVendorTotal}`,
    `- Cloudflare Stream 影片：${inventory.cloudflareStreamVideos.length}`,
    "",
    "| 商家 ID | Slug（前 8 字元） | 建立時間 | Email 網域 | 合成標記 | 商品 | 訂單（測試） | 付款交易 | 報名 | 直播 | 影片 | 客戶 |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...inventory.vendors.map((vendor) => {
      const c = vendor.counts;
      return `| ${vendor.vendorId} | ${vendor.slugMasked} | ${vendor.createdAt.slice(0, 10)} | ${vendor.emailDomain} | ${vendor.signals.join(", ") || "無"} | ${c.products} | ${c.orders}（${c.testOrders}） | ${c.paymentTransactions} | ${c.registrations} | ${c.lives} | ${c.videos} | ${c.customers} |`;
    }),
    "",
    "合成標記只是提示；清理需要 owner 同意、先備份，並另開工作執行。",
  ];
  return `${lines.join("\n")}\n`;
}

export async function main(env: Record<string, string | undefined> = process.env) {
  if (!env.DATABASE_URL) {
    console.error(JSON.stringify({ status: "BLOCKED", reason: "DATABASE_URL must be injected; .env files are not read." }));
    return 2;
  }
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const inventory = await readStagingSyntheticInventory(db);
    const json = JSON.stringify(inventory, null, 2);
    if (env.INVENTORY_OUT_DIR) {
      await mkdir(env.INVENTORY_OUT_DIR, { recursive: true });
      await writeFile(path.join(env.INVENTORY_OUT_DIR, "inventory.json"), `${json}\n`);
      await writeFile(path.join(env.INVENTORY_OUT_DIR, "summary.md"), renderMarkdownSummary(inventory));
    }
    console.log(json);
    return 0;
  } catch {
    // Never print the connection string or a driver message that may echo it.
    console.error(JSON.stringify({ status: "FAILED", reason: "database read failed" }));
    return 2;
  } finally {
    await db.$disconnect().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; });
}
