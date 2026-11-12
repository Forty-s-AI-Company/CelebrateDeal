# 後台共用 UI 元件

後台頁面先用這裡的元件，再考慮手寫。設計原則（中性後台、橘紅只給主要動作、狀態不能只靠顏色、尊重 reduced motion）見 [domain-workflows.md 的「設計與互動」](../domain-workflows.md#設計與互動)；色彩 token 在 [globals.css](../../src/app/globals.css)。

| 元件 | 檔案 | 用途 |
|---|---|---|
| `PageHeader`、`Card`、`ButtonLink`、`SubmitButton`、`DangerButton`、`Badge`、`EmptyState` | [ui.tsx](../../src/components/ui.tsx) | 頁首、卡片、按鈕、徽章、空狀態 |
| `Field`、`TextArea`、`SelectField`、`useFieldMessages`、`FormErrorSummary`、`focusFirstInvalidField` | [ui.tsx](../../src/components/ui.tsx) | 表單欄位與錯誤（見下方「欄位錯誤」） |
| `Stepper` | [stepper.tsx](../../src/components/stepper.tsx) | 多步驟精靈的步驟導覽 |
| `Tabs`、`TabPanel`、`tabId`、`tabPanelId` | [tabs.tsx](../../src/components/tabs.tsx) | 同一頁內切換幾組內容 |
| `Toast`、`useToast` | [toast.tsx](../../src/components/toast.tsx) | 不打斷操作的短暫確認（「已儲存」「已複製」） |
| `SideDrawer` | [side-drawer.tsx](../../src/components/side-drawer.tsx) | 就地建立或編輯，不離開目前頁面（例如漏斗編輯器的發布檢查抽屜 [funnel-publish-drawer.tsx](../../src/components/landing-pages/funnel-publish-drawer.tsx)） |
| `useDialogBehavior` | [use-dialog-behavior.ts](../../src/lib/use-dialog-behavior.ts) | 自製 modal 的 Escape、焦點圈限與還原 |

`ui.tsx` 不是 Client Component，Server Component 也能直接用；`stepper.tsx`、`tabs.tsx`、`toast.tsx` 有 `"use client"`，事件處理函式只能從 Client Component 傳入。

## Stepper

多步驟精靈（例如直播精靈）的步驟導覽：`<nav aria-label>` 內一個 `<ol>`，每一步是一個原生 `<button>`。

```tsx
import { Stepper } from "@/components/stepper";

<Stepper
  label="直播設定步驟"
  activeKey={activeStep}
  onSelect={moveToStep}
  steps={[
    { key: "content", label: "內容", description: "標題、影片與開播時間", icon: FileVideo, panelId: "live-step-panel-content",
      status: { label: "尚有必填", shortLabel: "待補", icon: CircleAlert, className: "border-amber-300 bg-amber-50 text-amber-900" } },
    // …
  ]}
/>
```

| Prop | 說明 |
|---|---|
| `label` | 導覽區的無障礙名稱。 |
| `steps` | `{ key, label, description?, icon?, status?, panelId?, disabled? }[]`。`panelId` 會成為按鈕的 `aria-controls`。 |
| `activeKey` | 目前步驟；由呼叫端持有。 |
| `onSelect(key)` | 按下步驟時呼叫。能不能跳過去（例如前一步還有必填）由呼叫端決定。 |
| `showPosition` | 預設 `true`：手機版顯示「第 n 步／共 N 步：…」，`md` 以上隱藏。 |

- 無障礙：目前步驟 `aria-current="step"`；每一步都在 Tab 順序裡，Enter／Space 啟動；按下後焦點留在按鈕上，要不要把焦點移進面板由呼叫端決定。
- 狀態徽章一定有文字（`label`；有 `shortLabel` 時手機顯示短字、`label` 留給輔助科技），圖示 `aria-hidden`。
- 版面：1–6 步各自等寬一列；超過 6 步改成會換行的格狀。按鈕最小高度 56px。
- 不持有狀態、不用 hook，所以也能在測試中直接當函式呼叫展開。

## Tabs

WAI-ARIA [tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)，自動啟用（焦點移到哪個分頁就選哪個）。

```tsx
import { TabPanel, Tabs } from "@/components/tabs";

<Tabs idPrefix="template" label="範本來源" className="mb-5" value={tab} onChange={setTab} items={[
  { key: "platform", label: <>平台範本 <span className="ml-1 text-xs font-normal text-slate-500">{count}</span></> },
  { key: "mine", label: "我的範本" },
]} />
{tab === "platform" ? <TabPanel idPrefix="template" tabKey="platform">…</TabPanel> : <TabPanel idPrefix="template" tabKey="mine">…</TabPanel>}
```

| Prop | 說明 |
|---|---|
| `idPrefix` | 分頁 id 為 `${idPrefix}-tab-${key}`、面板 id 為 `${idPrefix}-panel-${key}`（`tabId()`／`tabPanelId()`）；同一頁要唯一。 |
| `label` | tablist 的無障礙名稱。 |
| `items` | `{ key, label, disabled? }[]`。 |
| `value`／`onChange(key)` | 受控的選取值。 |
| `orientation` | `"horizontal"`（預設）或 `"vertical"`（設 `aria-orientation`，改用 ↑／↓）。 |
| `className` | 加在 tablist 上，例如外距。 |

`TabPanel` 的 props：`idPrefix`、`tabKey`、`className`、`focusable`（面板裡沒有可聚焦內容時設 `true`，讓面板本身可用 Tab 進入）。

- 鍵盤：←／→（垂直時 ↑／↓）移到上一個／下一個可用分頁並循環；Home／End 到第一個／最後一個可用分頁；停用的分頁會被略過。其他按鍵不攔截。
- roving tabindex：只有選取中的分頁 `tabIndex=0`，Tab 會直接從分頁列進到面板；選取中的分頁若停用，改由第一個可用分頁接收焦點。
- 面板可以只掛載選取中的那一個（範本庫的做法），也可以全部掛載再用 `hidden` 隱藏。
- 目前只有底線樣式；需要膠囊（segmented）樣式時再加 `variant`，不要另外手寫一份 tablist。

## Toast

不打斷操作的短暫確認。一次只顯示一則，新的會取代舊的。

```tsx
import { Toast, useToast } from "@/components/toast";

const { toast, showToast, dismissToast } = useToast();
// 成功之後：
showToast(`範本已改名為「${name}」。`);
showToast("已複製連結。", { tone: "info", duration: 3_000 });
showToast("設定已套用，重新整理後生效。", { duration: null }); // 不自動消失
showToast(`已發布版本 v2。公開網址：${url}`, { link: { href: "/lp/spring", label: "開啟公開頁", external: true } });
// 同一個元件內一定要渲染：
<Toast toast={toast} onDismiss={dismissToast} />
```

| API | 說明 |
|---|---|
| `useToast()` | 回傳 `{ toast, showToast(text, { tone?, duration?, link? }), dismissToast }`。`tone` 為 `"success"`（預設）或 `"info"`；`duration` 預設 `DEFAULT_TOAST_DURATION_MS`（5000 ms），`null` 為不自動消失；`link`（`{ href, label, external? }`）在文字後加一個後續連結（例如剛發布的公開頁），文字本身仍要完整說明結果。 |
| `<Toast toast onDismiss dismissLabel? />` | 顯示區域；`dismissLabel` 預設「關閉通知」。 |

- 無障礙：`role="status"`、`aria-live="polite"`、`aria-atomic="true"` 的區域從第一次渲染就存在，訊息插入同一區域才會被可靠朗讀；同一句話再顯示一次也會重新朗讀。
- 不搶焦點。滑鼠停在上面或焦點在裡面時暫停計時；關閉按鈕（44px）或 Escape 可關閉，從鍵盤關閉時焦點回到進入前的元素。
- 連結：放在 `role="status"` 區域之外，不會被朗讀成訊息的一部分；可用 Tab 進入（進入時暫停計時）。`external` 會開新分頁。
- 動態：只用 transform 進場（`.ui-toast-card`），`prefers-reduced-motion: reduce` 時不動。
- 位置：桌面左下；手機置底並避開「最新消息」按鈕與底部主要導覽（見 `globals.css` 的 `.ui-toast-region`）。不使用 portal，所以祖先元素不能有 `transform`／`filter`，否則 `position: fixed` 會失準。
- 不要用 Toast 顯示錯誤或需要使用者處理的事：錯誤留在頁內，用 `role="alert"` 或下方的欄位錯誤模式。

## 欄位錯誤

一個表單的錯誤分兩層：欄位旁的訊息，加上表單上方一個摘要。

```tsx
import { Field, FormErrorSummary, focusFirstInvalidField, useFieldMessages } from "@/components/ui";

<form ref={formRef}>
  <FormErrorSummary message={state.message} errors={state.fieldErrors} />
  <Field label="商品名稱" name="name" error={state.fieldErrors.name} hint="最多 200 字" />
</form>

// 錯誤渲染、欄位恢復可編輯之後：
useEffect(() => { if (errorVersion) focusFirstInvalidField(formRef.current); }, [errorVersion]);
```

| API | 說明 |
|---|---|
| `Field`／`TextArea`／`SelectField` 的 `error`、`hint` | 有 `error` 時控制項加 `aria-invalid="true"` 與紅框；`aria-describedby` 依序指向錯誤與提示。訊息放在 `<label>` 外，標籤本身仍是唯一的無障礙名稱；外層元素固定，切換錯誤不會重新掛載（清空）輸入框。 |
| `useFieldMessages(error, hint)` | 給手寫控制項用：回傳 `controlProps`（展開到控制項上）、`controlClass`（邊框色）與 `messages`（放在 label 之後）。 |
| `FormErrorSummary({ message, errors? })` | 沒有 `message` 時不渲染；有時是 `role="alert"`、`tabIndex={-1}`、`data-form-error-summary` 的摘要，`errors` 中非空的欄位訊息列成清單。 |
| `focusFirstInvalidField(scope)` | 聚焦 `scope` 內第一個 `aria-invalid="true"` 的控制項；沒有的話聚焦摘要；都沒有就不動。回傳被聚焦的元素。 |

- 伺服器回傳的欄位錯誤與瀏覽器原生驗證都用同一組 `error` prop 顯示。
- 欄位停用（送出中）時不要聚焦；等 pending 結束再呼叫 `focusFirstInvalidField`。

## 後續遷移清單

本次只遷移示範點（直播精靈→`Stepper`、範本庫→`Tabs`／`Toast`、商品表單→`FormErrorSummary`）。可以接著改用新元件的地方：

- `Tabs`：[funnel-editor-library.tsx](../../src/components/landing-pages/funnel-editor-library.tsx) 的「新增內容」分頁（目前沒有方向鍵與 roving tabindex；需要先加膠囊樣式 `variant`）。
- `Toast`：用 `role="status"` 段落顯示短暫確認的 Client Component，例如 [referral-share-controls.tsx](../../src/components/referral-share-controls.tsx)、[team-template-list.tsx](../../src/components/team-template-list.tsx)、[recovery-codes-actions.tsx](../../src/components/recovery-codes-actions.tsx) 的「已複製」，以及 [line-rich-menu-studio.tsx](../../src/components/line-rich-menu-studio.tsx) 的「草稿已儲存」。由 query string 帶出、在 Server Component 渲染的「已儲存」提示（例如各 `settings/*` 頁）不適合直接改，需先改成 Client Component。
- 欄位錯誤：[live-resource-drawers.tsx](../../src/components/live-resource-drawers.tsx) 的 `FieldError`／`RootError`／`useFocusFirstError`、[product-form-client.tsx](../../src/components/product-form-client.tsx) 的 `useFocusFirstInvalid` 可改用 `useFieldMessages` 與 `focusFirstInvalidField`；其餘手寫輸入框另案處理。
- `Stepper`：[commerce-checkout-form.tsx](../../src/components/commerce-checkout-form.tsx) 的結帳進度是純文字 `aria-current="step"`，不是可點的步驟，不需要改；U5 表單分段可直接使用 `Stepper`。
