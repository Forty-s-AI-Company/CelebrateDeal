import { describe, expect, it } from "vitest";
import { createLandingPageContent, LANDING_PAGE_MAX_DEPTH, LandingPageContentSchema, parseLandingPageContent } from "@/lib/landing-page-content";

describe("landing page content", () => {
  it("creates a valid webinar starter envelope", () => {
    const content = createLandingPageContent("webinar", "form_123");
    expect(LandingPageContentSchema.safeParse(content).success).toBe(true);
    expect(content.data.content[0]?.type).toBe("Hero");
  });

  it("accepts bounded nested sections and typed actions", () => {
    const content = {
      schemaVersion: 1,
      data: {
        root: { props: { title: "活動頁", description: "活動說明", shareImage: "https://cdn.example.com/share.png" } },
        content: [{ type: "Section", props: { id: "section", anchorId: "register", children: [{ type: "Button", props: { id: "button", label: "報名", action: { type: "registration", formId: "form_123" } } }] } }],
      },
    };
    const parsed = parseLandingPageContent(content);
    expect(parsed?.data.content[0]?.type).toBe("Section");
  });

  it("rejects arbitrary html/css, unsafe URLs, untyped actions and legacy zones", () => {
    const content = createLandingPageContent("blank");
    const button = { type: "Button", props: { id: "button", label: "開啟", action: { type: "external", href: "javascript:alert(1)" }, html: "<script>alert(1)</script>" } };
    expect(LandingPageContentSchema.safeParse({ ...content, data: { ...content.data, content: [button] } }).success).toBe(false);
    expect(LandingPageContentSchema.safeParse({ ...content, data: { ...content.data, zones: { "legacy-zone": [] } } }).success).toBe(false);
    expect(parseLandingPageContent({ ...content, data: { ...content.data, content: [{ type: "Text", props: { id: "text", text: "內容", style: { color: "url(https://evil.example)" } } }] } })).toBeNull();
    expect(parseLandingPageContent({ ...content, data: { ...content.data, content: [{ type: "Image", props: { id: "image", src: "/\\evil.example/image.png", alt: "" } }] } })).toBeNull();
  });

  it("enforces slot nesting and node bounds before rendering", () => {
    let node: unknown = { type: "Text", props: { id: "leaf", text: "內容" } };
    for (let index = 0; index <= LANDING_PAGE_MAX_DEPTH; index += 1) node = { type: "Section", props: { id: `section_${index}`, children: [node] } };
    expect(parseLandingPageContent({ schemaVersion: 1, data: { root: {}, content: [node] } })).toBeNull();
  });

  it("rejects duplicate ids anywhere in the component tree and requires fixed countdown dates", () => {
    const duplicate = { schemaVersion: 1, data: { root: {}, content: [{ type: "Section", props: { id: "same", children: [{ type: "Text", props: { id: "same", text: "重複" } }] } }] } };
    expect(parseLandingPageContent(duplicate)).toBeNull();
    expect(parseLandingPageContent({ schemaVersion: 1, data: { root: {}, content: [{ type: "Countdown", props: { id: "timer", mode: "fixed_date", expiredMessage: "結束" } }] } })).toBeNull();
    expect(parseLandingPageContent({ schemaVersion: 1, data: { root: {}, content: [{ type: "Countdown", props: { id: "timer", mode: "live_linked", expiredMessage: "結束" } }] } })?.data.content[0]?.type).toBe("Countdown");
  });
});
