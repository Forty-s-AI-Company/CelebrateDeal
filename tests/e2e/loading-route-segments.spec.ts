import { randomUUID } from "node:crypto";
import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Loading-Segments-Test-Password-123!";
const runId = randomUUID();
const fixture = {
  email: `loading-segments-${runId}@celebratedeal.local`,
  slug: `loading-segments-${runId}`,
  vendorId: "",
  userId: "",
};

type RscGate = {
  matched: Promise<void>;
  dispose: () => Promise<void>;
};

/**
 * Aborts target prefetches and adds a bounded server-side delay to the first
 * real target RSC navigation, allowing the browser to render its real fallback.
 */
async function installRscGate(page: Page, targetPath: string, baseURL: string | undefined): Promise<RscGate> {
  if (!baseURL) throw new Error("loading segment evidence requires a configured Playwright baseURL.");
  const parsedBaseURL = new URL(baseURL);
  if (parsedBaseURL.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsedBaseURL.hostname)) {
    throw new Error("loading segment evidence requires a loopback HTTP Playwright baseURL.");
  }
  const targetOrigin = parsedBaseURL.origin;
  let resolveMatched!: () => void;
  const matched = new Promise<void>((resolve) => {
    resolveMatched = resolve;
  });

  const handler = async (route: Route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const headers = request.headers();
    const isRscRequest = headers.rsc === "1" || headers.accept?.includes("text/x-component") === true;
    const isTargetRscRequest = requestUrl.origin === targetOrigin
      && requestUrl.pathname === targetPath
      && isRscRequest;

    if (isTargetRscRequest) {
      if (headers["next-router-prefetch"] === "1") {
        await route.abort("blockedbyclient");
        return;
      }
      resolveMatched();
      await route.continue({
        headers: {
          ...headers,
          "x-e2e-loading-delay-ms": "1500",
        },
      });
      return;
    }

    await route.continue();
  };

  await page.route("**/*", handler);
  return {
    matched,
    dispose: async () => {
      if (!page.isClosed()) await page.unroute("**/*", handler);
    },
  };
}

async function loginOwner(page: Page) {
  await page.goto("/login", { waitUntil: "load" });
  await page.getByLabel("Email").fill(fixture.email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/u);
  await expect(page.locator('[data-dashboard-scope="kpis"]')).toBeVisible();
  await expect(page.locator('[data-dashboard-scope="details"]')).toBeVisible();
}

async function navigateWithLoadingGate(input: {
  page: Page;
  testInfo: TestInfo;
  targetPath: string;
  linkName: string;
  setup: () => Promise<void>;
  loading: () => Promise<void>;
  final: () => Promise<void>;
}) {
  const gate = await installRscGate(input.page, input.targetPath, input.testInfo.project.use.baseURL);
  try {
    await input.setup();
    await input.page.getByRole("link", { name: input.linkName, exact: true }).first().click({ noWaitAfter: true });
    await gate.matched;
    await input.loading();
    await input.final();
  } finally {
    await gate.dispose();
  }
}

test.beforeAll(async () => {
  const vendor = await db.vendor.create({
    data: {
      name: "Loading Segments Test Vendor",
      slug: fixture.slug,
      email: fixture.email,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: { create: {} },
    },
  });
  const user = await db.user.create({
    data: {
      email: fixture.email,
      name: "Loading Segments Test Owner",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: {
        create: {
          vendorId: vendor.id,
          role: "owner",
          status: "active",
        },
      },
    },
  });

  fixture.vendorId = vendor.id;
  fixture.userId = user.id;
});

test.afterAll(async () => {
  if (fixture.vendorId) await db.vendor.deleteMany({ where: { id: fixture.vendorId } });
  if (fixture.userId) await db.user.deleteMany({ where: { id: fixture.userId } });
  await db.$disconnect();
});

test("root loading segment is visible during a controlled public RSC navigation", async ({ page }, testInfo) => {
  await navigateWithLoadingGate({
    page,
    testInfo,
    targetPath: "/password-reset/request",
    linkName: "忘記密碼",
    setup: () => page.goto("/login", { waitUntil: "load" }).then(() => undefined),
    loading: async () => {
      const loading = page.locator("main[aria-busy=\"true\"][aria-labelledby=\"root-loading-title\"]");
      await expect(loading).toBeVisible();
      await expect(loading).toHaveAttribute("aria-busy", "true");
      const status = loading.locator('[role="status"]');
      await expect(status).toHaveCount(1);
      await expect(status).toBeAttached();
      await expect(status).toHaveAttribute("role", "status");
      await expect(status).toHaveText("正在載入頁面，請稍候。");
    },
    final: async () => {
      await expect(page).toHaveURL(/\/password-reset\/request$/u);
      await expect(page.getByRole("heading", { name: "申請密碼重設", exact: true })).toBeVisible();
      await expect(page.getByLabel("Email")).toBeVisible();
    },
  });
});

test("protected app loading segment is visible during a controlled RSC navigation", async ({ page }, testInfo) => {
  await navigateWithLoadingGate({
    page,
    testInfo,
    targetPath: "/settings/security",
    linkName: "安全",
    setup: () => loginOwner(page),
    loading: async () => {
      const loading = page.locator("section[aria-busy=\"true\"][aria-labelledby=\"protected-app-loading-title\"]");
      await expect(loading).toBeVisible();
      await expect(loading).toHaveAttribute("aria-busy", "true");
      await expect(loading.getByRole("heading", { name: "正在載入工作區", exact: true })).toBeVisible();
      const status = loading.locator('[role="status"]');
      await expect(status).toHaveCount(1);
      await expect(status).toBeAttached();
      await expect(status).toHaveAttribute("role", "status");
      await expect(status).toHaveText("正在載入工作區內容，請稍候。");
    },
    final: async () => {
      await expect(page).toHaveURL(/\/settings\/security$/u);
      await expect(page.getByRole("heading", { name: "安全設定", exact: true })).toBeVisible();
    },
  });
});

test("dashboard loading segment is visible during a controlled RSC navigation", async ({ page }, testInfo) => {
  await navigateWithLoadingGate({
    page,
    testInfo,
    targetPath: "/dashboard",
    linkName: "Dashboard",
    setup: async () => {
      await loginOwner(page);
      await page.goto("/videos", { waitUntil: "load" });
      await expect(page.getByRole("heading", { name: "影片庫", exact: true })).toBeVisible();
    },
    loading: async () => {
      const loading = page.locator("main[data-dashboard-scope=\"route-shell\"][aria-busy=\"true\"]");
      await expect(loading).toBeVisible();
      await expect(loading).toHaveAttribute("aria-busy", "true");
      await expect(loading.getByRole("heading", { name: "正在載入營運總覽", exact: true })).toBeVisible();
      const status = loading.locator('[role="status"]');
      await expect(status).toHaveCount(1);
      await expect(status).toBeAttached();
      await expect(status).toHaveAttribute("role", "status");
      await expect(status).toHaveText("正在載入 Dashboard，請稍候。");
    },
    final: async () => {
      await expect(page).toHaveURL(/\/dashboard$/u);
      await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
      await expect(page.locator('[data-dashboard-scope="kpis"]')).toBeVisible();
      await expect(page.locator('[data-dashboard-scope="details"]')).toBeVisible();
    },
  });
});

test("videos loading segment is visible during a controlled RSC navigation", async ({ page }, testInfo) => {
  await navigateWithLoadingGate({
    page,
    testInfo,
    targetPath: "/videos",
    linkName: "影片",
    setup: () => loginOwner(page),
    loading: async () => {
      const loading = page.locator("section[aria-busy=\"true\"][aria-labelledby=\"videos-loading-title\"]");
      await expect(loading).toBeVisible();
      await expect(loading).toHaveAttribute("aria-busy", "true");
      await expect(loading.getByRole("heading", { name: "正在載入影片庫", exact: true })).toBeVisible();
      const status = loading.locator('[role="status"]');
      await expect(status).toHaveCount(1);
      await expect(status).toBeAttached();
      await expect(status).toHaveAttribute("role", "status");
      await expect(status).toHaveText("正在載入影片庫，請稍候。");
    },
    final: async () => {
      await expect(page).toHaveURL(/\/videos$/u);
      await expect(page.getByRole("heading", { name: "影片庫", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "套用篩選", exact: true })).toBeVisible();
    },
  });
});
