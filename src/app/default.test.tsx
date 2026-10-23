import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => navigation);

import RootChildrenDefault from "./default";

// Next 16.4 strict route matching 要求根 layout 的 children slot 有明確 default；
// 它只能回 404，不可讓 @checkout 的 catch-all 把無頁面網址渲染成空白頁。
describe("root children default", () => {
  it("renders the not-found boundary instead of an empty page", () => {
    expect(() => RootChildrenDefault()).toThrow("NEXT_NOT_FOUND");
    expect(navigation.notFound).toHaveBeenCalledTimes(1);
  });
});
