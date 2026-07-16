import { describe, expect, it } from "vitest";
import {
  resolveTeamFunnelDynamicField,
  type TeamFunnelDynamicField,
  type TeamFunnelDynamicFieldContext,
} from "./team-funnel-dynamic-fields";

describe("resolveTeamFunnelDynamicField", () => {
  const context: TeamFunnelDynamicFieldContext = {
    partner: {
      name: "CelebrateDeal",
      displayName: "CelebrateDeal Team",
      avatar: "https://example.com/avatar.png",
      phone: "+886-2-1234-5678",
      email: "team@example.com",
      lineUrl: "https://line.me/R/ti/p/example",
      whatsappUrl: "https://wa.me/886212345678",
      bio: "Live commerce specialists",
      productUrl: "https://example.com/product",
      joinUrl: "https://example.com/join",
      referralCode: "CELEBRATE",
    },
    webinar: {
      title: "Turn viewers into customers",
      startAt: "2026-07-17T19:00:00+08:00",
      hostName: "CelebrateDeal Host",
      registrationUrl: "https://example.com/register",
    },
  };

  const allowedFields: Array<{
    field: TeamFunnelDynamicField;
    source: "partner" | "webinar";
    value: string;
  }> = [
    { field: "partner.name", source: "partner", value: "CelebrateDeal" },
    { field: "partner.displayName", source: "partner", value: "CelebrateDeal Team" },
    { field: "partner.avatar", source: "partner", value: "https://example.com/avatar.png" },
    { field: "partner.phone", source: "partner", value: "+886-2-1234-5678" },
    { field: "partner.email", source: "partner", value: "team@example.com" },
    { field: "partner.lineUrl", source: "partner", value: "https://line.me/R/ti/p/example" },
    { field: "partner.whatsappUrl", source: "partner", value: "https://wa.me/886212345678" },
    { field: "partner.bio", source: "partner", value: "Live commerce specialists" },
    { field: "partner.productUrl", source: "partner", value: "https://example.com/product" },
    { field: "partner.joinUrl", source: "partner", value: "https://example.com/join" },
    { field: "partner.referralCode", source: "partner", value: "CELEBRATE" },
    { field: "webinar.title", source: "webinar", value: "Turn viewers into customers" },
    { field: "webinar.startAt", source: "webinar", value: "2026-07-17T19:00:00+08:00" },
    { field: "webinar.hostName", source: "webinar", value: "CelebrateDeal Host" },
    { field: "webinar.registrationUrl", source: "webinar", value: "https://example.com/register" },
  ];

  it.each(allowedFields)("resolves $field from the $source source", ({ field, source, value }) => {
    expect(resolveTeamFunnelDynamicField(field, context)).toEqual({
      status: "resolved",
      field,
      source,
      value,
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

  it("does not resolve a partner field from the webinar source", () => {
    expect(
      resolveTeamFunnelDynamicField("partner.name", {
        webinar: { title: "Webinar-only value" },
      }),
    ).toEqual({
      status: "missing",
      field: "partner.name",
      source: "partner",
      value: "[Missing partner.name]",
    });
  });

  it("does not resolve a webinar field from the partner source", () => {
    expect(
      resolveTeamFunnelDynamicField("webinar.title", {
        partner: { name: "Partner-only value" },
      }),
    ).toEqual({
      status: "missing",
      field: "webinar.title",
      source: "webinar",
      value: "[Missing webinar.title]",
    });
  });
});
