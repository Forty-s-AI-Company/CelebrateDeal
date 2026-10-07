import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { LivePurchaseBroadcastPanel } from "./live-purchase-broadcast-panel";
it("starts with an honest pending state and no synthetic purchase cards", () => {
  const html = renderToStaticMarkup(<LivePurchaseBroadcastPanel vendorId="vendor-1" liveId="live-1" onAdmissionInvalid={vi.fn()} />);
  expect(html).toContain("正在確認購買紀錄"); expect(html).toContain('aria-live="polite"');
  expect(html).toContain("姓名已遮罩"); expect(html).not.toContain("購買了");
});
