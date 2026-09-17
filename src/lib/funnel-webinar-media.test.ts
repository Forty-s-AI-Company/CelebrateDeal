import { describe, expect, it } from "vitest";
import { createFunnelFlow } from "./funnel-flow";
import { createFunnelStepPages } from "./funnel-step-pages";
import { FunnelPopupSchema, type FunnelNode } from "./funnel-page-document";
import { hasDirectWebinarVideo } from "./funnel-webinar-media";

function state() {
  return createFunnelStepPages(createFunnelFlow({ id: "webinar", name: "Webinar", domain: "webinar", goal: "webinar" })!)!;
}
function video(): FunnelNode {
  return { schemaVersion: 1, id: "unsafe-video", type: "video", props: {}, overrides: { mobile: { props: { src: "https://media.example.test/video.mp4" } }, desktop: { visible: false } }, style: {}, visible: false, attributes: {}, actions: [] };
}
describe("Webinar direct media guard", () => {
  it("permits the default authorized handoff experience", () => expect(hasDirectWebinarVideo(state())).toBe(false));
  it("rejects hidden videos with source only in a device override", () => {
    const content = state(); content.pages.webinar_broadcast.root.push(video());
    expect(hasDirectWebinarVideo(content)).toBe(true);
  });
  it("rejects nested child videos", () => {
    const content = state();
    content.pages.webinar_broadcast.root.push({ ...video(), id: "container", type: "section", children: [video()] });
    expect(hasDirectWebinarVideo(content)).toBe(true);
  });
  it("rejects video inside popup roots and their children", () => {
    const content = state();
    content.pages.webinar_broadcast.popups.push(FunnelPopupSchema.parse({ schemaVersion: 1, id: "popup", name: "Popup", root: [{ ...video(), id: "container", type: "section", children: [video()] }] }));
    expect(hasDirectWebinarVideo(content)).toBe(true);
  });
  it("leaves registration-page promotional media outside the broadcast guard", () => {
    const content = state(); content.pages.webinar_registration.root.push(video());
    expect(hasDirectWebinarVideo(content)).toBe(false);
  });
});
