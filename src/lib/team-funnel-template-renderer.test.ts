import { describe, expect, it } from "vitest";
import {
  renderTeamFunnelTemplateText,
  type TeamFunnelTemplateTokenResult,
} from "./team-funnel-template-renderer";

describe("renderTeamFunnelTemplateText", () => {
  const context = {
    partner: { name: "CelebrateDeal" },
    webinar: { title: "Turn viewers into customers" },
  };

  it("replaces multiple tokens from the allowlisted resolver in source order", () => {
    const result = renderTeamFunnelTemplateText(
      "Hello {{partner.name}} — {{webinar.title}}",
      context,
    );

    expect(result).toEqual({
      text: "Hello CelebrateDeal — Turn viewers into customers",
      tokens: [
        {
          placeholder: "{{partner.name}}",
          field: "partner.name",
          result: {
            status: "resolved",
            field: "partner.name",
            source: "partner",
            value: "CelebrateDeal",
          },
        },
        {
          placeholder: "{{webinar.title}}",
          field: "webinar.title",
          result: {
            status: "resolved",
            field: "webinar.title",
            source: "webinar",
            value: "Turn viewers into customers",
          },
        },
      ] satisfies TeamFunnelTemplateTokenResult[],
    });
  });

  it("records and replaces repeated tokens independently", () => {
    const result = renderTeamFunnelTemplateText(
      "{{partner.name}} / {{partner.name}}",
      context,
    );

    expect(result.text).toBe("CelebrateDeal / CelebrateDeal");
    expect(result.tokens).toHaveLength(2);
    expect(result.tokens.map(({ field, result: fieldResult }) => [field, fieldResult.status])).toEqual([
      ["partner.name", "resolved"],
      ["partner.name", "resolved"],
    ]);
  });

  it("trims whitespace inside token braces before resolving the field", () => {
    expect(renderTeamFunnelTemplateText("Welcome {{  partner.name\t }}", context)).toEqual({
      text: "Welcome CelebrateDeal",
      tokens: [
        {
          placeholder: "{{  partner.name\t }}",
          field: "partner.name",
          result: {
            status: "resolved",
            field: "partner.name",
            source: "partner",
            value: "CelebrateDeal",
          },
        },
      ],
    });
  });

  it("leaves plain text unchanged without creating token results", () => {
    expect(renderTeamFunnelTemplateText("No dynamic fields here.", context)).toEqual({
      text: "No dynamic fields here.",
      tokens: [],
    });
  });

  it("keeps an explicit fallback when an allowlisted value is missing", () => {
    expect(renderTeamFunnelTemplateText("Hello {{ partner.name }}", {})).toEqual({
      text: "Hello [Missing partner.name]",
      tokens: [
        {
          placeholder: "{{ partner.name }}",
          field: "partner.name",
          result: {
            status: "missing",
            field: "partner.name",
            source: "partner",
            value: "[Missing partner.name]",
          },
        },
      ],
    });
  });

  it("fails closed for unsupported and prototype-like fields", () => {
    expect(
      renderTeamFunnelTemplateText("{{ partner.__proto__.polluted }}", context),
    ).toEqual({
      text: "[Unsupported field: partner.__proto__.polluted]",
      tokens: [
        {
          placeholder: "{{ partner.__proto__.polluted }}",
          field: "partner.__proto__.polluted",
          result: {
            status: "unsupported",
            field: "partner.__proto__.polluted",
            value: "[Unsupported field: partner.__proto__.polluted]",
          },
        },
      ],
    });
  });

  it("returns script-like replacement values as ordinary text", () => {
    const scriptLikeText = "<script>alert('not executed')</script>";

    expect(
      renderTeamFunnelTemplateText("Title: {{webinar.title}}", {
        webinar: { title: scriptLikeText },
      }),
    ).toMatchObject({
      text: `Title: ${scriptLikeText}`,
      tokens: [{ result: { status: "resolved", value: scriptLikeText } }],
    });
  });

  it("does not recursively resolve tokens contained in replacement values", () => {
    expect(
      renderTeamFunnelTemplateText("{{partner.name}}", {
        partner: { name: "{{webinar.title}}" },
        webinar: { title: "This must not be used" },
      }),
    ).toMatchObject({
      text: "{{webinar.title}}",
      tokens: [
        {
          field: "partner.name",
          result: { status: "resolved", value: "{{webinar.title}}" },
        },
      ],
    });
  });
});
