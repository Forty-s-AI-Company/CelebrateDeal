import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import BuyerDeliveryNotFound from "./not-found";

describe("buyer delivery unavailable state", () => {
  it("explains recovery without rendering any delivery destination or encrypted content", () => {
    const html = renderToStaticMarkup(<BuyerDeliveryNotFound />);

    expect(html).toContain("付款後內容目前無法使用");
    expect(html).toContain("返回我的訂單");
    expect(html).toContain("建立客服案件");
    expect(html).toContain("本頁不會顯示已撤銷的入口");
    expect(html).not.toContain("destinationEncryptedEnvelope");
  });
});
