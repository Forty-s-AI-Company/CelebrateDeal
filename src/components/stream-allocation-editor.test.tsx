import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptyLiveStudioDraft } from "@/lib/live-studio-draft";
import { StreamAllocationEditor } from "./stream-allocation-editor";

const members = [
  { id: "member-1", teamId: "team-1", label: "北區團隊 · 王小明" },
  { id: "member-2", teamId: "team-1", label: "北區團隊 · 李小華" },
];
const pages = [
  { id: "page-1", label: "夏日推廣頁 · /summer" },
];

function initialValues(overrides: Partial<ReturnType<typeof emptyLiveStudioDraft>> = {}) {
  return { ...emptyLiveStudioDraft(), ...overrides };
}

describe("StreamAllocationEditor", () => {
  it("renders an understandable visual policy editor without raw JSON textareas", () => {
    const html = renderToStaticMarkup(
      <StreamAllocationEditor initialValues={initialValues()} members={members} pages={pages} />,
    );

    expect(html).toContain("Stream 用量與額度分配");
    expect(html).toContain("不需要手寫 ID 或 JSON");
    expect(html).toContain("推廣頁流量歸推廣者");
    expect(html).toContain("進階：個別成員與推廣頁額度");
    expect(html).toContain('name="customAllocations"');
    expect(html).toContain('name="memberQuotas"');
    expect(html).toContain('name="pageQuotas"');
    expect(html).not.toContain("CUSTOM 成員分攤 JSON");
    expect(html).not.toContain("<textarea");
  });

  it("restores a custom allocation as named member rows and preserves the server transport", () => {
    const html = renderToStaticMarkup(
      <StreamAllocationEditor
        initialValues={initialValues({
          usageAttributionMode: "CUSTOM",
          customAllocations: JSON.stringify([
            { teamId: "team-1", membershipId: "member-1", bps: 5000 },
            { teamId: "team-1", membershipId: "member-2", bps: 5000 },
          ]),
        })}
        members={members}
        pages={pages}
      />,
    );

    expect(html).toContain("指定成員分攤");
    expect(html).toContain("目前合計 100%／100%");
    expect(html).toContain("北區團隊 · 王小明");
    expect(html).toContain("北區團隊 · 李小華");
    expect(html).toContain("member-1");
    expect(html).toContain("member-2");
    expect(html).toContain("Stream 用量設定完整");
  });

  it("fails visibly when a saved policy references a removed member", () => {
    const html = renderToStaticMarkup(
      <StreamAllocationEditor
        initialValues={initialValues({
          usageAttributionMode: "CUSTOM",
          customAllocations: JSON.stringify([{ teamId: "team-old", membershipId: "member-old", bps: 10_000 }]),
        })}
        members={members}
        pages={pages}
      />,
    );

    expect(html).toContain("原設定已無法使用");
    expect(html).toContain("請為每一筆自訂分攤選擇目前有效的團隊成員");
    expect(html).toContain('role="alert"');
  });

  it("converts a simple split percentage into the existing basis-point contract", () => {
    const html = renderToStaticMarkup(
      <StreamAllocationEditor
        initialValues={initialValues({
          usageAttributionMode: "SPLIT",
          splitOwnerBps: "2500",
          splitPromoterBps: "7500",
        })}
        members={members}
        pages={pages}
      />,
    );

    expect(html).toContain("內容負責人比例（%）");
    expect(html).toContain("75%");
    expect(html).toContain('name="splitOwnerBps" value="2500"');
    expect(html).toContain('name="splitPromoterBps" value="7500"');
  });
});
