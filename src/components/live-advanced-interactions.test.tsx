import { describe, expect, it } from "vitest";
import { canUseLiveAdvancedInteractions, LiveAdvancedInteractions } from "./live-advanced-interactions";

describe("advanced interaction admission", () => {
  it("hides floating controls when another panel owns interaction space without changing the state key", () => {
    const props = { vendorId: "vendor", liveId: "live", currentSeconds: 0, events: [], enabled: true };
    const visible = LiveAdvancedInteractions(props)!;
    const obscured = LiveAdvancedInteractions({ ...props, obscured: true })!;
    expect(obscured.props.hidden).toBe(true);
    expect(obscured.key).toBe(visible.key);
    expect(obscured.props.children).toBeTruthy();
  });

  it.each([
    [true, "checking", true],
    [true, "blocked", true],
    [false, "admitted", true],
    [true, "admitted", false],
    [true, "admitted", undefined],
  ] as const)("does not enable requests for playable=%s admission=%s required=%s", (playable, status, required) => {
    expect(canUseLiveAdvancedInteractions(playable, status, required)).toBe(false);
  });
  it("enables an admitted playable live", () => {
    expect(canUseLiveAdvancedInteractions(true, "admitted", true)).toBe(true);
  });
  it("unmounts all interaction state when admission is lost", () => {
    expect(LiveAdvancedInteractions({ vendorId: "vendor", liveId: "live", currentSeconds: 0, events: [], enabled: false })).toBeNull();
  });
  it("keys the stateful component by both tenant and live", () => {
    const render = (vendorId: string, liveId: string) => LiveAdvancedInteractions({ vendorId, liveId, currentSeconds: 0, events: [], enabled: true });
    expect(render("vendor-1", "live-1")?.key).not.toBe(render("vendor-2", "live-1")?.key);
    expect(render("vendor-1", "live-1")?.key).not.toBe(render("vendor-1", "live-2")?.key);
  });
});
