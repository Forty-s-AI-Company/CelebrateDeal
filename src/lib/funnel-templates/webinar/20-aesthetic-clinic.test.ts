import { describe, expect, it } from "vitest";
import { AESTHETIC_CLINIC_BANNED_WORDS, template } from "./20-aesthetic-clinic";
import { webinarTemplateIssues, webinarTemplateNodeSignature } from "./template-checks";

const strings = (value: unknown): string[] => typeof value === "string" ? [value]
  : Array.isArray(value) ? value.flatMap(strings)
    : value && typeof value === "object" ? Object.values(value as Record<string, unknown>).flatMap(strings) : [];

describe("webinar template: 20-aesthetic-clinic", () => {
  it("passes the shared template checks (qa-standards §5.3)", () => {
    expect(webinarTemplateIssues(template)).toEqual([]);
  });

  it("keeps node ids, types and order stable", () => {
    expect(webinarTemplateNodeSignature(template)).toMatchSnapshot();
  });

  // specs/20 §11：醫療廣告禁用詞（療效保證、最高級、術前術後、優惠促銷）不得出現在任何文字。
  it("never uses words banned in medical advertising", () => {
    const { build, ...meta } = template;
    const texts = [...strings(meta), ...build("check").flatMap((node) => strings(node))];
    const hits = texts.flatMap((text) => AESTHETIC_CLINIC_BANNED_WORDS.filter((word) => text.includes(word)).map((word) => `${word}：${text.slice(0, 40)}`));
    expect(hits).toEqual([]);
  });
});
