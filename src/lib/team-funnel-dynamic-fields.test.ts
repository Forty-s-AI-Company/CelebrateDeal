import { describe, expect, it } from "vitest";
import { resolveTeamFunnelDynamicField } from "./team-funnel-dynamic-fields";

describe("resolveTeamFunnelDynamicField", () => {
  const context = {
    partner: {
      name: "CelebrateDeal",
      productUrl: "https://example.com/product",
    },
    webinar: {
      title: "Turn viewers into customers",
    },
  };

  it("resolves partner.name from the partner source", () => {
    expect(resolveTeamFunnelDynamicField("partner.name", context)).toEqual({
      status: "resolved",
      field: "partner.name",
      source: "partner",
      value: "CelebrateDeal",
    });
  });

  it("resolves partner.productUrl from the partner source", () => {
    expect(resolveTeamFunnelDynamicField("partner.productUrl", context)).toEqual({
      status: "resolved",
      field: "partner.productUrl",
      source: "partner",
      value: "https://example.com/product",
    });
  });

  it("resolves webinar.title from the webinar source", () => {
    expect(resolveTeamFunnelDynamicField("webinar.title", context)).toEqual({
      status: "resolved",
      field: "webinar.title",
      source: "webinar",
      value: "Turn viewers into customers",
    });
  });

  it("returns an explicit fallback for a missing allowlisted value", () => {
    expect(resolveTeamFunnelDynamicField("partner.name", {})).toEqual({
      status: "missing",
      field: "partner.name",
      source: "partner",
      value: "[Missing partner.name]",
    });
  });

  it("fails closed when a known field has a non-text runtime value", () => {
    expect(
      resolveTeamFunnelDynamicField("partner.name", {
        partner: { name: 123 as unknown as string },
      }),
    ).toEqual({
      status: "missing",
      field: "partner.name",
      source: "partner",
      value: "[Missing partner.name]",
    });
  });

  it("reports unsupported fields without traversing an object path", () => {
    expect(resolveTeamFunnelDynamicField("partner.__proto__.polluted", context)).toEqual({
      status: "unsupported",
      field: "partner.__proto__.polluted",
      value: "[Unsupported field: partner.__proto__.polluted]",
    });
  });

  it("returns script-like content as ordinary text", () => {
    const scriptLikeText = "<script>alert('not executed')</script>";

    expect(
      resolveTeamFunnelDynamicField("webinar.title", {
        webinar: { title: scriptLikeText },
      }),
    ).toEqual({
      status: "resolved",
      field: "webinar.title",
      source: "webinar",
      value: scriptLikeText,
    });
  });
});
