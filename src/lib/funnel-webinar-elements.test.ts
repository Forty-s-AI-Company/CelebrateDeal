import { describe, expect, it } from "vitest";
import {
  agendaItems, calloutParagraphs, countdownParts, formatCountdownInline, formatCountdownSpoken, galleryImages, highlightCode, scheduleSessions, sessionStatus,
  speakerInitials, speakerTags, valueStackItems, webinarLines, webinarSpeakers, webinarStateKey,
} from "./funnel-webinar-elements";
import { funnelPublicRenderEvent, funnelViewportHint } from "./funnel-public-render-hints";
import { funnelViewportForWidth } from "./funnel-typography";

describe("webinar element prop readers", () => {
  it("keeps only safe links and images and caps lists", () => {
    const speakers = webinarSpeakers([{ name: "林予安", photo: "javascript:alert(1)", href: "http://insecure.example", tags: "一,二、三\n四" }, { bio: "" }, "x"]);
    expect(speakers).toEqual([{ photo: null, alt: "林予安", name: "林予安", role: "", bio: "", tags: ["一", "二", "三"], href: null, linkLabel: "" }]);
    expect(galleryImages([{ src: "/funnel-illustrations/webinar/17/a.svg" }, { src: "https://cdn.example/a.png" }, { src: "data:image/png;base64,AA" }]).map((image) => image.src)).toEqual(["/funnel-illustrations/webinar/17/a.svg", "https://cdn.example/a.png"]);
    expect(agendaItems(Array.from({ length: 20 }, (_, index) => ({ title: `第 ${index}` })))).toHaveLength(12);
    expect(webinarLines("a\n\n b \nc", 2)).toEqual(["a", "b"]);
    expect(speakerTags(["甲", "乙"])).toEqual(["甲", "乙"]);
    expect(calloutParagraphs("一\n\n二\n\n三\n\n四")).toEqual(["一", "二", "三"]);
  });

  it("builds gradient-avatar initials for CJK and Latin names", () => {
    expect(speakerInitials("林予安")).toBe("林");
    expect(speakerInitials("Alexandria Montgomery-Christensen")).toBe("AM");
    expect(speakerInitials(" ")).toBe("★");
  });

  it("formats countdown parts with tabular text and minute-precision speech", () => {
    const parts = countdownParts(2 * 86_400_000 + 3 * 3_600_000 + 12 * 60_000 + 45_000);
    expect(parts).toEqual({ days: 2, hours: 3, minutes: 12, seconds: 45 });
    expect(formatCountdownInline(parts)).toBe("2 天 03:12:45");
    expect(formatCountdownInline({ ...parts, days: 0 }, false)).toBe("03:12");
    expect(formatCountdownSpoken(parts)).toBe("2 天 3 小時 12 分鐘");
    expect(countdownParts(-5)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });

  it("value stack keeps values as display text only", () => {
    expect(valueStackItems([{ title: "講義", value: "NT$1,980" }, { value: "NT$1" }])).toEqual([{ title: "講義", text: "", value: "NT$1,980" }]);
  });

  it("derives session status from dates only", () => {
    const now = Date.parse("2026-11-01T00:00:00Z");
    const [past, soon, later, undated] = scheduleSessions([{ title: "a", startsAt: "2026-10-31T20:00:00Z" }, { title: "b", startsAt: "2026-11-01T12:00:00Z" }, { title: "c", startsAt: "2026-11-10T12:00:00Z" }, { title: "d", status: "額滿" }]);
    expect([past, soon, later].map((session) => sessionStatus(session!.startsAt, now))).toEqual(["ended", "soon", "open"]);
    expect(sessionStatus(undated!.startsAt, now)).toBeNull();
  });

  it("accepts only known webinar states", () => {
    expect(webinarStateKey("replay")).toBe("replay");
    expect(webinarStateKey("full")).toBeNull();
  });

  it("highlights code as plain tokens and never alters the source text", () => {
    const code = 'const a = "<script>"; // note\nreturn 42;';
    const tokens = highlightCode(code, "javascript");
    expect(tokens.map((token) => token.text).join("")).toBe(code);
    expect(tokens).toContainEqual({ text: "const", kind: "keyword" });
    expect(tokens).toContainEqual({ text: '"<script>"', kind: "string" });
    expect(tokens).toContainEqual({ text: "// note", kind: "comment" });
    expect(highlightCode("<div>", "html")[0]).toEqual({ text: "<div", kind: "tag" });
    expect(highlightCode("x".repeat(7_000), "plain")[0]!.text).toHaveLength(6_000);
  });
});

describe("public render hints (I-1, I-5)", () => {
  it("maps widths and User-Agents to the three viewports", () => {
    expect([360, 639, 640, 1024, 1079, 1080, 1440].map(funnelViewportForWidth)).toEqual(["mobile", "mobile", "tablet", "tablet", "tablet", "desktop", "desktop"]);
    expect(funnelViewportHint("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148")).toBe("mobile");
    expect(funnelViewportHint("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537.36")).toBe("mobile");
    expect(funnelViewportHint("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(funnelViewportHint("Mozilla/5.0 (Linux; Android 14; SM-X710) Chrome/120 Safari/537.36")).toBe("tablet");
    expect(funnelViewportHint("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120")).toBe("desktop");
    expect(funnelViewportHint(null)).toBe("desktop");
  });

  it("exposes the registration deadline only when it is enabled", () => {
    const operations = { schemaVersion: 1, experiment: null, deadline: { enabled: true, timezone: "Asia/Taipei", expiresAt: "2026-11-05T11:00:00.000Z", behavior: "closed", redirectPath: "" }, reports: { stats: { stepId: "", days: 30 }, leads: { stepId: "", days: 30 }, sales: { stepId: "", days: 30 } } };
    expect(funnelPublicRenderEvent(operations, 5)).toEqual({ registrationClosesAt: "2026-11-05T11:00:00.000Z", renderedAt: 5 });
    expect(funnelPublicRenderEvent({ ...operations, deadline: { ...operations.deadline, enabled: false } }, 5).registrationClosesAt).toBeNull();
    expect(funnelPublicRenderEvent(null, 5).registrationClosesAt).toBeNull();
  });
});
