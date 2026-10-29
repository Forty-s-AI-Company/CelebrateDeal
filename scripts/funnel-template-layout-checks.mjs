/**
 * 瀏覽器內執行的「不跑版」檢查（docs/product/webinar-templates/qa-standards.md §2、§3.1）。
 *
 * `runLayoutChecks` 會被 Playwright 序列化後在頁面內執行，所以必須完全自包含：
 * 不能引用模組層級的變數或 import。回傳 `{ rule, nodeId, nodeType, detail }[]`。
 *
 * 判定上的取捨（與規範文字的差異）：
 * - L-2：被祖先 `overflow-x: hidden/clip` 裁掉、而且該祖先本身在視窗內的元素，視為「沒有跑出視窗」
 *   （例如跑馬燈、裝飾性背景）；真正的文字被裁掉由 L-3、L-4 抓。
 * - 動畫以 `prefers-reduced-motion: reduce` 載入，避免數字跳動與跑馬燈造成量測不穩定。
 */
export function runLayoutChecks(options) {
  const { width: viewportWidth, height: viewportHeight, rules: enabledRules, perRuleLimit = 25 } = options;
  const enabled = new Set(enabledRules);
  const root = document.querySelector("[data-design-harness]") || document.body;
  const failures = [];
  const counts = {};
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META", "HEAD", "TITLE", "OPTION", "OPTGROUP"]);
  const NON_TEXT_INPUT = new Set(["hidden", "checkbox", "radio", "submit", "button", "reset", "range", "file", "image", "color"]);

  const px = (value) => Number.parseFloat(value) || 0;
  const round = (value) => Math.round(value * 10) / 10;

  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const cls = typeof el.className === "string" ? el.className.split(/\s+/u).filter(Boolean).slice(0, 2).join(".") : "";
    const text = (el.textContent || "").replace(/\s+/gu, " ").trim().slice(0, 24);
    return `<${tag}${cls ? `.${cls}` : ""}>${text ? ` 「${text}」` : ""}`;
  }

  function nodeOf(el) {
    const node = el ? el.closest("[data-funnel-node-id]") : null;
    return node ? { nodeId: node.getAttribute("data-funnel-node-id"), nodeType: node.getAttribute("data-funnel-node-type") } : { nodeId: null, nodeType: null };
  }

  function fail(rule, el, detail) {
    counts[rule] = (counts[rule] || 0) + 1;
    if (counts[rule] > perRuleLimit) return;
    failures.push({ rule, ...nodeOf(el), detail: `${describe(el)} ${detail}` });
  }

  function visible(el) {
    if (SKIP_TAGS.has(el.tagName)) return false;
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  const isSvgInternal = (el) => {
    const svg = el.closest("svg");
    return Boolean(svg) && svg !== el;
  };

  /** 回傳 "scroll"（內部捲動容器）、"clip"（被視窗內的 overflow hidden 祖先裁切）或 null。 */
  function containment(el) {
    if (getComputedStyle(el).position === "fixed") return null;
    for (let parent = el.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
      const overflowX = getComputedStyle(parent).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return "scroll";
      if (overflowX === "hidden" || overflowX === "clip") {
        const rect = parent.getBoundingClientRect();
        if (rect.left >= -0.5 && rect.right <= viewportWidth + 0.5) return "clip";
      }
      if (parent === root) break;
    }
    return null;
  }

  const hasOwnText = (el) => Array.from(el.childNodes).some((child) => child.nodeType === 3 && child.nodeValue.trim());
  const all = Array.from(root.querySelectorAll("*")).filter((el) => !SKIP_TAGS.has(el.tagName) && !isSvgInternal(el));
  const shown = all.filter(visible);
  const formFields = shown.filter((el) => ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) && !(el.tagName === "INPUT" && NON_TEXT_INPUT.has((el.getAttribute("type") || "text").toLowerCase())));
  const mobile = viewportWidth < 640;

  /* L-1 沒有水平捲動 */
  if (enabled.has("L-1")) {
    const scrollWidth = document.documentElement.scrollWidth;
    if (scrollWidth > viewportWidth) fail("L-1", document.documentElement, `scrollWidth=${scrollWidth} > innerWidth=${viewportWidth}（超出 ${scrollWidth - viewportWidth}px）`);
  }

  /* L-2 元素不超出視窗 */
  if (enabled.has("L-2")) {
    const reported = new Set();
    for (const el of shown) {
      const rect = el.getBoundingClientRect();
      if (rect.right <= viewportWidth + 0.5 && rect.left >= -0.5) continue;
      if (el.parentElement && reported.has(el.parentElement)) continue; // 只回報最上層的元素
      const kind = containment(el);
      if (kind) continue;
      if (el.closest('[aria-hidden="true"]')) {
        const decorativeParent = el.parentElement ? getComputedStyle(el.parentElement).overflowX : "visible";
        if (decorativeParent === "hidden" || decorativeParent === "clip") continue;
      }
      reported.add(el);
      fail("L-2", el, `left=${round(rect.left)} right=${round(rect.right)} 超出視窗 0–${viewportWidth}`);
    }
  }

  /* L-3 文字不被裁切 */
  if (enabled.has("L-3")) {
    for (const el of shown) {
      const style = getComputedStyle(el);
      const own = hasOwnText(el);
      const inline = style.display === "inline";
      const isHeadingLike = /^H[1-6]$/u.test(el.tagName) || el.tagName === "BUTTON" || el.tagName === "LABEL" || ["headline", "button"].includes(nodeOf(el).nodeType || "");
      if (isHeadingLike && style.textOverflow === "ellipsis") fail("L-3", el, "標題／按鈕／標籤使用了 text-overflow: ellipsis");
      if (!own || inline) continue;
      if (el.clientWidth <= 1 && el.clientHeight <= 1) continue; // sr-only 視覺隱藏文字
      const clips = style.overflowX !== "visible" || style.overflowY !== "visible";
      if (clips && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
        fail("L-3", el, `文字被裁切：scroll ${el.scrollWidth}×${el.scrollHeight} > client ${el.clientWidth}×${el.clientHeight}（overflow ${style.overflowX}/${style.overflowY}）`);
      }
    }
  }

  /* L-4 headline／text／button 落在最近 section 的內容寬度內 */
  if (enabled.has("L-4")) {
    const textNodes = Array.from(root.querySelectorAll('[data-funnel-node-type="headline"], [data-funnel-node-type="text"], [data-funnel-node-type="button"]')).filter(visible);
    for (const node of textNodes) {
      const section = node.parentElement ? node.parentElement.closest('[data-funnel-node-type="section"]') : null;
      if (!section) continue;
      const boxes = [section, section.querySelector(":scope > section")].filter(Boolean).map((box) => {
        const rect = box.getBoundingClientRect();
        const style = getComputedStyle(box);
        return { left: rect.left + px(style.borderLeftWidth) + px(style.paddingLeft), right: rect.right - px(style.borderRightWidth) - px(style.paddingRight) };
      });
      const limitLeft = Math.max(...boxes.map((box) => box.left));
      const limitRight = Math.min(...boxes.map((box) => box.right));
      const rect = node.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(node);
      const textRect = range.getBoundingClientRect();
      const left = textRect.width > 0 ? Math.min(rect.left, textRect.left) : rect.left;
      const right = textRect.width > 0 ? Math.max(rect.right, textRect.right) : rect.right;
      if (left < limitLeft - 1 || right > limitRight + 1) fail("L-4", node, `left=${round(left)} right=${round(right)} 超出 section 內容寬 ${round(limitLeft)}–${round(limitRight)}`);
    }
  }

  /* L-6 圖片不變形 */
  if (enabled.has("L-6")) {
    for (const img of shown.filter((el) => el.tagName === "IMG")) {
      const fit = getComputedStyle(img).objectFit;
      if (fit === "cover" || fit === "contain") continue;
      if (!img.complete || !img.naturalWidth || !img.naturalHeight) continue;
      const rect = img.getBoundingClientRect();
      const natural = img.naturalWidth / img.naturalHeight;
      const drift = Math.abs(rect.width / rect.height - natural) / natural;
      if (drift > 0.02) fail("L-6", img, `渲染 ${round(rect.width)}×${round(rect.height)}（${round(rect.width / rect.height * 1000) / 1000}）與原圖 ${img.naturalWidth}×${img.naturalHeight}（${round(natural * 1000) / 1000}）比例差 ${round(drift * 1000) / 10}%`);
    }
  }

  /* L-10 多欄子項寬度 ≥ 240（僅 ≥ 640 寬） */
  if (enabled.has("L-10") && viewportWidth >= 640) {
    const seen = new Set();
    const check = (child, origin) => {
      if (seen.has(child) || !visible(child)) return;
      seen.add(child);
      const rect = child.getBoundingClientRect();
      if (rect.width < 240) fail("L-10", child, `${origin} 子項寬度 ${round(rect.width)}px < 240px`);
    };
    for (const child of root.querySelectorAll('[data-funnel-node-type^="columns_"] > div > *')) check(child, "多欄容器");
    for (const list of shown.filter((el) => ["UL", "OL", "DL"].includes(el.tagName))) {
      const style = getComputedStyle(list);
      if (style.display !== "grid") continue;
      const tracks = style.gridTemplateColumns.split(/\s+/u).filter((track) => track && track !== "none").length;
      if (tracks > 1) for (const child of Array.from(list.children)) check(child, `${tracks} 欄清單`);
    }
  }

  /* L-11 表單可用 */
  if (enabled.has("L-11")) {
    const minimum = viewportWidth <= 320 ? 0 : viewportWidth <= 360 ? 280 : 260;
    for (const field of formFields) {
      const rect = field.getBoundingClientRect();
      if (rect.right > viewportWidth + 0.5 || rect.left < -0.5) fail("L-11", field, `欄位超出視窗：left=${round(rect.left)} right=${round(rect.right)}`);
      else if (minimum && rect.width < minimum) fail("L-11", field, `欄位寬度 ${round(rect.width)}px < ${minimum}px`);
    }
  }

  /* §3.1 手機字級 */
  if (enabled.has("F-3.1") && mobile) {
    const floor = 14;
    for (const field of formFields) {
      const size = px(getComputedStyle(field).fontSize);
      if (size < 16) fail("F-3.1", field, `表單輸入字級 ${round(size)}px < 16px（iOS 會自動放大）`);
    }
    for (const el of shown) {
      if (!hasOwnText(el) || el.closest('[aria-hidden="true"]')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      const style = getComputedStyle(el);
      const size = px(style.fontSize);
      const text = (el.textContent || "").trim();
      const spacing = px(style.letterSpacing) / (size || 1);
      const eyebrow = (spacing >= 0.08 && text.length <= 40) || /eyebrow/iu.test(typeof el.className === "string" ? el.className : "");
      const minimum = eyebrow ? 13 : floor;
      if (size < minimum) fail("F-3.1", el, `字級 ${round(size)}px < ${minimum}px${eyebrow ? "（eyebrow）" : ""}`);
    }
  }

  /* L-7 首屏有報名入口（要在捲動前量測） */
  if (enabled.has("L-7")) {
    const firstField = formFields[0] || null;
    const firstButtonNode = Array.from(root.querySelectorAll('[data-funnel-node-type="button"]')).find(visible) || null;
    const sticky = Array.from(document.querySelectorAll("[data-funnel-sticky-cta]")).find(visible) || null;
    // 銷售頁：報價卡的結帳按鈕（payment_button）本身就是主要入口。
    const checkout = Array.from(root.querySelectorAll('[data-funnel-node-type="payment_button"] a, [data-funnel-node-type="payment_button"] button')).find(visible) || null;
    const candidates = [["表單第一個欄位", firstField], ["主要 CTA 按鈕", firstButtonNode], ["結帳按鈕", checkout], ["固定報名列", sticky]].filter(([, el]) => el);
    const inView = candidates.filter(([, el]) => el.getBoundingClientRect().top < viewportHeight);
    if (!inView.length) {
      const anchor = candidates[0] ? candidates[0][1] : root;
      fail("L-7", anchor, candidates.length ? `首屏（高 ${viewportHeight}）沒有報名入口：${candidates.map(([label, el]) => `${label} top=${round(el.getBoundingClientRect().top)}`).join("、")}` : "找不到表單欄位或主要 CTA 按鈕");
    }
  }

  /* L-5 按鈕完整可見且可點（會捲動頁面，放在最後） */
  if (enabled.has("L-5")) {
    const targets = new Set();
    for (const el of root.querySelectorAll('button, a[role="button"], [role="button"], input[type="submit"], input[type="button"]')) targets.add(el);
    for (const node of root.querySelectorAll('[data-funnel-node-type="button"]')) {
      targets.add(node.querySelector('button, a, [role="button"]') || node);
    }
    const firstCtaNode = Array.from(root.querySelectorAll('[data-funnel-node-type="button"]')).find(visible) || null;
    const primary = new Set([firstCtaNode ? firstCtaNode.querySelector('button, a, [role="button"]') || firstCtaNode : null, ...document.querySelectorAll("[data-funnel-sticky-cta]")].filter(Boolean));
    for (const el of targets) {
      if (!visible(el) || el.closest('[aria-hidden="true"]') || isSvgInternal(el)) continue;
      el.scrollIntoView({ block: "center", inline: "nearest" });
      const rect = el.getBoundingClientRect();
      const problems = [];
      if (rect.width < 44 || rect.height < 44) problems.push(`尺寸 ${round(rect.width)}×${round(rect.height)} < 44×44`);
      if (primary.has(el) && rect.height < 48) problems.push(`主要 CTA 高度 ${round(rect.height)} < 48`);
      if (rect.left < -0.5 || rect.right > viewportWidth + 0.5) problems.push(`水平超出視窗 left=${round(rect.left)} right=${round(rect.right)}`);
      const cx = Math.min(Math.max(rect.left + rect.width / 2, 0), viewportWidth - 1);
      const cy = Math.min(Math.max(rect.top + rect.height / 2, 0), viewportHeight - 1);
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || !(hit === el || el.contains(hit))) problems.push(`中心點被 ${hit ? describe(hit) : "（無元素）"} 蓋住`);
      const style = getComputedStyle(el);
      const lineHeight = Number.isFinite(px(style.lineHeight)) && px(style.lineHeight) > 0 ? px(style.lineHeight) : px(style.fontSize) * 1.3;
      const contentHeight = rect.height - px(style.paddingTop) - px(style.paddingBottom) - px(style.borderTopWidth) - px(style.borderBottomWidth);
      if (hasOwnText(el) || (el.textContent || "").trim()) {
        const lines = Math.round(contentHeight / lineHeight);
        if (lines > 2) problems.push(`文字約 ${lines} 行（上限 2 行）`);
      }
      if (problems.length) fail("L-5", el, problems.join("；"));
    }
    window.scrollTo(0, 0);
  }

  // 超過上限的規則補一筆說明，讓摘要能算出完整數量。
  for (const [rule, count] of Object.entries(counts)) {
    if (count > perRuleLimit) failures.push({ rule, nodeId: null, nodeType: null, detail: `（另有 ${count - perRuleLimit} 筆同規則失敗已省略）`, omitted: count - perRuleLimit });
  }
  return failures;
}
