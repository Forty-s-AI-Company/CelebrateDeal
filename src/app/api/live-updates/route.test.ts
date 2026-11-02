import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  vendorId: string;
  liveId: string;
  formSubmissionId: string | null;
  roleId: string | null;
  authorName: string;
  body: string;
  source: string;
  status: string;
  isSimulated: boolean;
  createdAt: Date;
};

type FindManyArgs = {
  where: {
    vendorId: string;
    liveId: string;
    source: string;
    status: string;
    isSimulated: boolean;
    OR?: Array<{ createdAt: { gt: Date } } | { createdAt: Date; id: { gt: string } }>;
  };
  take: number;
};

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  checkRateLimit: vi.fn(),
  getRequestClientIp: vi.fn(),
  hasActiveLiveViewerSession: vi.fn(),
  findMessages: vi.fn(),
  findSubmission: vi.fn(),
  findBlacklist: vi.fn(),
  findRuns: vi.fn(),
  findSpotlight: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/request-client-ip", async (original) => ({
  ...await original<typeof import("@/lib/request-client-ip")>(),
  getRequestClientIp: mocks.getRequestClientIp,
}));
vi.mock("@/lib/live-quota-admission", async (original) => ({
  ...await original<typeof import("@/lib/live-quota-admission")>(),
  hasActiveLiveViewerSession: mocks.hasActiveLiveViewerSession,
}));

import { clearLiveChatBlacklistCache, encodeLiveChatCursor, encodeLiveUpdatesCursor } from "@/lib/live-chat";
import { FORM_SUBMISSION_CHAT_SESSION_COOKIE } from "@/lib/form-submission-chat-session";
import { LIVE_VIEWER_SESSION_COOKIE } from "@/lib/live-quota-admission";
import { createLiveViewerPass, LIVE_VIEWER_PASS_COOKIE } from "@/lib/live-viewer-pass";
import { GET } from "./route";

const admissionToken = "A".repeat(43);
const t0 = new Date("2026-08-17T10:00:00.000Z");

function row(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    vendorId: "v1",
    liveId: "l1",
    formSubmissionId: "submission-1",
    roleId: null,
    authorName: "王小明",
    body: `message ${id}`,
    source: "viewer",
    status: "visible",
    isSimulated: false,
    createdAt: t0,
    ...overrides,
  };
}

let store: Row[] = [];

/** Evaluates the route's real keyset filter against the in-memory rows. */
function runFindMany({ where, take }: FindManyArgs) {
  return store
    .filter((message) => message.vendorId === where.vendorId
      && message.liveId === where.liveId
      && message.source === where.source
      && message.status === where.status
      && message.isSimulated === where.isSimulated
      && (!where.OR || where.OR.some((clause) => "gt" in clause.createdAt
        ? message.createdAt > clause.createdAt.gt
        : message.createdAt.getTime() === clause.createdAt.getTime() && message.id > (clause as { id: { gt: string } }).id.gt)))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || (left.id < right.id ? 1 : -1))
    .slice(0, take);
}

function cookie(options: { chat?: boolean; admission?: boolean; pass?: string } = {}) {
  const parts: string[] = [];
  if (options.admission !== false) parts.push(`${LIVE_VIEWER_SESSION_COOKIE}=${admissionToken}`);
  if (options.chat) parts.push(`${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=fss1.submission-1.1784332800.${"a".repeat(43)}`);
  if (options.pass) parts.push(`${LIVE_VIEWER_PASS_COOKIE}=${encodeURIComponent(options.pass)}`);
  return parts.join("; ");
}

function request(query: string, init: { headers?: Record<string, string>; cookie?: string } = {}) {
  return new Request(`https://app.example.test/api/live-updates?${query}`, {
    headers: {
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
      cookie: init.cookie ?? cookie(),
      ...(init.headers ?? {}),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearLiveChatBlacklistCache();
  store = [];
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CSRF_SECRET", "route-test-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("RATE_LIMIT_PROVIDER", "cloudflare_waf");
  vi.stubEnv("LIVE_CHAT_INGRESS_SECRET", "route-test-live-chat-ingress-secret-value-longer-than-32");
  mocks.getDb.mockReturnValue({
    liveChatMessage: { findMany: mocks.findMessages },
    formSubmission: { findFirst: mocks.findSubmission },
    blacklist: { findMany: mocks.findBlacklist },
    liveInteractionRun: { findMany: mocks.findRuns, findUnique: vi.fn() },
    liveInteractionResponse: { count: vi.fn(), findUnique: vi.fn(), groupBy: vi.fn() },
    liveQuestion: { findFirst: mocks.findSpotlight },
  });
  mocks.checkRateLimit.mockResolvedValue(null);
  mocks.getRequestClientIp.mockReturnValue("203.0.113.5");
  mocks.hasActiveLiveViewerSession.mockResolvedValue(true);
  mocks.findMessages.mockImplementation(async (args: FindManyArgs) => runFindMany(args));
  mocks.findSubmission.mockResolvedValue(null);
  mocks.findBlacklist.mockResolvedValue([]);
  mocks.findRuns.mockResolvedValue([]);
  mocks.findSpotlight.mockResolvedValue(null);
});

describe("GET /api/live-updates", () => {
  it("requires the trusted client header and never caches a rejection", async () => {
    const response = await GET(new Request("https://app.example.test/api/live-updates?vendorId=v1&liveId=l1", {
      headers: { origin: "https://app.example.test", cookie: cookie() },
    }));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.hasActiveLiveViewerSession).not.toHaveBeenCalled();
    expect(mocks.findMessages).not.toHaveBeenCalled();
  });

  it("applies the rate limit before touching the database", async () => {
    mocks.checkRateLimit.mockResolvedValueOnce(new Response("{}", { status: 429 }));
    const response = await GET(request("vendorId=v1&liveId=l1"));
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.hasActiveLiveViewerSession).not.toHaveBeenCalled();
  });

  it.each([
    "vendorId=v1&vendorId=v2&liveId=l1",
    "vendorId=v1&liveId=l1&extra=1",
    "vendorId=v1",
    "vendorId=v1&liveId=l1&include=chat,presence",
    "vendorId=v1&liveId=l1&include=",
    "vendorId=v1&liveId=l1&since=not-a-cursor",
  ])("rejects the malformed query %s with 400 and no data", async (query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.findMessages).not.toHaveBeenCalled();
    expect(mocks.findRuns).not.toHaveBeenCalled();
  });

  it("returns 401 without an admission cookie and reads nothing", async () => {
    const response = await GET(request("vendorId=v1&liveId=l1", { cookie: cookie({ admission: false }) }));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.findMessages).not.toHaveBeenCalled();
    expect(mocks.findRuns).not.toHaveBeenCalled();
  });

  it("rejects a viewer admitted to another live or tenant without reading chat or interactions", async () => {
    mocks.hasActiveLiveViewerSession.mockResolvedValue(false);
    const response = await GET(request("vendorId=other-vendor&liveId=other-live"));
    expect(response.status).toBe(401);
    expect(mocks.hasActiveLiveViewerSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      vendorId: "other-vendor",
      liveId: "other-live",
      token: admissionToken,
    }));
    expect(mocks.findMessages).not.toHaveBeenCalled();
    expect(mocks.findRuns).not.toHaveBeenCalled();
    expect(mocks.findSpotlight).not.toHaveBeenCalled();
  });

  it("accepts a valid signed pass without reading the session row", async () => {
    const pass = createLiveViewerPass({
      vendorId: "v1",
      liveId: "l1",
      viewerSessionId: "session-1",
      admissionToken,
      sessionExpiresAt: new Date(Date.now() + 90_000),
    });
    const response = await GET(request("vendorId=v1&liveId=l1", { cookie: cookie({ pass }) }));
    expect(response.status).toBe(200);
    expect(mocks.hasActiveLiveViewerSession).not.toHaveBeenCalled();
  });

  it("falls back to the session row when the pass is bound to another live, and refuses if that fails", async () => {
    const pass = createLiveViewerPass({
      vendorId: "v1",
      liveId: "l1",
      viewerSessionId: "session-1",
      admissionToken,
      sessionExpiresAt: new Date(Date.now() + 90_000),
    });
    mocks.hasActiveLiveViewerSession.mockResolvedValue(false);
    const response = await GET(request("vendorId=v1&liveId=l2", { cookie: cookie({ pass }) }));
    expect(response.status).toBe(401);
    expect(mocks.hasActiveLiveViewerSession).toHaveBeenCalledTimes(1);
    expect(mocks.findMessages).not.toHaveBeenCalled();
  });

  it("refuses an expired pass and consults the session row", async () => {
    const pass = createLiveViewerPass({
      vendorId: "v1",
      liveId: "l1",
      viewerSessionId: "session-1",
      admissionToken,
      sessionExpiresAt: new Date(Date.now() + 90_000),
      now: new Date(Date.now() - 10 * 60_000),
    });
    mocks.hasActiveLiveViewerSession.mockResolvedValue(false);
    const response = await GET(request("vendorId=v1&liveId=l1", { cookie: cookie({ pass }) }));
    expect(response.status).toBe(401);
    expect(mocks.hasActiveLiveViewerSession).toHaveBeenCalledTimes(1);
  });

  describe("since cursor", () => {
    it("returns the latest page oldest-first with a cursor when called without since", async () => {
      store = [row("m1", { createdAt: new Date(t0.getTime() + 1) }), row("m2", { createdAt: new Date(t0.getTime() + 2) })];
      const response = await GET(request("vendorId=v1&liveId=l1&include=chat"));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const body = await response.json();
      expect(body.chat.messages.map((message: { id: string }) => message.id)).toEqual(["m1", "m2"]);
      expect(body.chat.reset).toBe(false);
      expect(body.chat.viewer).toEqual({ canPost: false, displayName: null, reason: "verification_required" });
      expect(typeof body.cursor).toBe("string");
      expect(body.interactions).toBeUndefined();
    });

    it("returns only rows after the cursor and echoes the cursor when nothing is new", async () => {
      store = [row("m1", { createdAt: new Date(t0.getTime() + 1) }), row("m2", { createdAt: new Date(t0.getTime() + 2) })];
      const first = await (await GET(request("vendorId=v1&liveId=l1&include=chat"))).json();

      store.push(row("m3", { createdAt: new Date(t0.getTime() + 3) }));
      const next = await (await GET(request(`vendorId=v1&liveId=l1&include=chat&since=${first.cursor}`))).json();
      expect(next.chat.messages.map((message: { id: string }) => message.id)).toEqual(["m3"]);
      expect(next.cursor).not.toBe(first.cursor);

      const idle = await (await GET(request(`vendorId=v1&liveId=l1&include=chat&since=${next.cursor}`))).json();
      expect(idle.chat.messages).toEqual([]);
      expect(idle.cursor).toBe(next.cursor);
    });

    it("orders rows that share the same millisecond by id and never drops or repeats them", async () => {
      store = [row("a", { createdAt: t0 }), row("b", { createdAt: t0 }), row("c", { createdAt: t0 })];
      const cursorAtB = encodeLiveUpdatesCursor({ liveId: "l1", createdAt: t0, id: "b" });
      const body = await (await GET(request(`vendorId=v1&liveId=l1&include=chat&since=${cursorAtB}`))).json();
      expect(body.chat.messages.map((message: { id: string }) => message.id)).toEqual(["c"]);

      store.push(row("d", { createdAt: t0 }));
      const afterC = await (await GET(request(`vendorId=v1&liveId=l1&include=chat&since=${body.cursor}`))).json();
      expect(afterC.chat.messages.map((message: { id: string }) => message.id)).toEqual(["d"]);
    });

    it("flags a gap longer than one page and returns only the latest page", async () => {
      store = Array.from({ length: 60 }, (_, index) => row(`m${String(index).padStart(2, "0")}`, { createdAt: new Date(t0.getTime() + 1_000 + index) }));
      const since = encodeLiveUpdatesCursor({ liveId: "l1", createdAt: t0, id: "m" });
      const body = await (await GET(request(`vendorId=v1&liveId=l1&include=chat&since=${since}`))).json();
      expect(body.chat.reset).toBe(true);
      expect(body.chat.messages).toHaveLength(50);
      expect(body.chat.messages[0].id).toBe("m10");
      expect(body.chat.messages[49].id).toBe("m59");
    });

    it("rejects a cursor issued for another live, a backward paging cursor, and a tampered cursor", async () => {
      const otherLive = encodeLiveUpdatesCursor({ liveId: "l2", createdAt: t0, id: "a" });
      const backward = encodeLiveChatCursor({ createdAt: t0, id: "a" });
      const own = encodeLiveUpdatesCursor({ liveId: "l1", createdAt: t0, id: "a" });
      for (const since of [otherLive, backward, `${own}x`, `${own.slice(0, -2)}AA`]) {
        const response = await GET(request(`vendorId=v1&liveId=l1&include=chat&since=${since}`));
        expect(response.status).toBe(400);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
      }
      expect(mocks.findMessages).not.toHaveBeenCalled();
    });
  });

  it("never returns scripted-role, simulated, hidden or other-live rows and exposes no viewer count (D-10)", async () => {
    store = [
      row("real", { createdAt: new Date(t0.getTime() + 1) }),
      row("scripted", { source: "scheduled", roleId: "role-1", formSubmissionId: null, createdAt: new Date(t0.getTime() + 2) }),
      row("simulated", { isSimulated: true, createdAt: new Date(t0.getTime() + 3) }),
      row("hidden", { status: "hidden", createdAt: new Date(t0.getTime() + 4) }),
      row("elsewhere", { liveId: "l2", createdAt: new Date(t0.getTime() + 5) }),
      row("other-tenant", { vendorId: "v2", createdAt: new Date(t0.getTime() + 6) }),
    ];
    const response = await GET(request("vendorId=v1&liveId=l1"));
    const body = await response.json();
    expect(body.chat.messages.map((message: { id: string }) => message.id)).toEqual(["real"]);
    expect(mocks.findMessages).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ vendorId: "v1", liveId: "l1", source: "viewer", status: "visible", isSimulated: false }),
    }));
    expect(JSON.stringify(body)).not.toMatch(/viewerCount|onlineCount|presence/u);
  });

  it("reports canPost for a verified viewer and withholds contact data", async () => {
    mocks.findSubmission.mockResolvedValue({
      id: "submission-1",
      name: "王小明",
      email: "lead@example.test",
      phone: "0912345678",
      formId: "form-1",
      live: { formId: "form-1" },
    });
    vi.stubEnv("CSRF_SECRET", "route-test-secret-longer-than-thirty-two-bytes");
    const { createFormSubmissionChatSessionToken } = await import("@/lib/form-submission-chat-session");
    const token = createFormSubmissionChatSessionToken({ submissionId: "submission-1" });
    const headers = { cookie: `${LIVE_VIEWER_SESSION_COOKIE}=${admissionToken}; ${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${encodeURIComponent(token)}` };
    const response = await GET(request("vendorId=v1&liveId=l1&include=chat", { headers, cookie: headers.cookie }));
    const body = await response.json();
    expect(body.chat.viewer).toEqual({ canPost: true, displayName: "王小明", reason: null });
    expect(JSON.stringify(body)).not.toContain("lead@example.test");
    expect(mocks.findSubmission).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ liveId: "l1", form: { vendorId: "v1" }, live: { id: "l1", vendorId: "v1" } }),
    }));
  });

  describe("include selection and poll hint", () => {
    it("reads only the requested halves", async () => {
      const chatOnly = await GET(request("vendorId=v1&liveId=l1&include=chat"));
      expect(chatOnly.status).toBe(200);
      expect(mocks.findMessages).toHaveBeenCalledTimes(1);
      expect(mocks.findRuns).not.toHaveBeenCalled();
      expect(mocks.findSpotlight).not.toHaveBeenCalled();

      vi.clearAllMocks();
      mocks.hasActiveLiveViewerSession.mockResolvedValue(true);
      mocks.findRuns.mockResolvedValue([]);
      mocks.findSpotlight.mockResolvedValue(null);
      const interactionsOnly = await GET(request("vendorId=v1&liveId=l1&include=interactions"));
      const body = await interactionsOnly.json();
      expect(interactionsOnly.status).toBe(200);
      expect(mocks.findMessages).not.toHaveBeenCalled();
      expect(body).toEqual({ cursor: null, nextPollMs: 3_000, interactions: { runs: [], spotlight: null } });
    });

    it("scopes the interaction queries to the requested vendor and live and polls faster while something is active", async () => {
      mocks.findSpotlight.mockResolvedValue({ id: "q1", body: "請問可以退款嗎？", displayName: null, spotlightedAt: new Date("2026-08-17T10:01:00.000Z") });
      const response = await GET(request("vendorId=v1&liveId=l1&include=interactions"));
      const body = await response.json();
      expect(mocks.findRuns).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ vendorId: "v1", liveId: "l1", source: "manual" }),
      }));
      expect(mocks.findSpotlight).toHaveBeenCalledWith(expect.objectContaining({
        where: { vendorId: "v1", liveId: "l1", status: "spotlight" },
      }));
      expect(body.nextPollMs).toBe(2_000);
      expect(body.interactions.spotlight.id).toBe("q1");
    });

    it("answers with a generic 500 when a read fails", async () => {
      mocks.findMessages.mockRejectedValueOnce(new Error("database detail"));
      const response = await GET(request("vendorId=v1&liveId=l1"));
      expect(response.status).toBe(500);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(JSON.stringify(await response.json())).not.toContain("database detail");
    });
  });
});
