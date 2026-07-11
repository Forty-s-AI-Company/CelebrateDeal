# CelebrateDeal Design Tokens

## Color

| Token | 建議值 | 用途 |
| --- | --- | --- |
| `surface-canvas` | `#F5F7FB` | 後台背景 |
| `surface-default` | `#FFFFFF` | 表單、table、工具表面 |
| `surface-subtle` | `#F8FAFC` | 次要分區、hover |
| `text-strong` | `#172033` | 標題、主要內容 |
| `text-default` | `#334155` | 一般文字 |
| `text-muted` | `#64748B` | 輔助資訊 |
| `border-default` | `#DBE3EF` | 一般邊界 |
| `action-primary` | `#2563EB` | 主要控制/選取 |
| `action-primary-hover` | `#1D4ED8` | 主色 hover |
| `action-conversion` | `#C2410C` | 成交與高優先 CTA；白字可讀性優於亮橘 |
| `state-success` | `#047857` | 成功/paid |
| `state-warning` | `#B45309` | 待處理/風險 |
| `state-danger` | `#B91C1C` | 刪除/失敗 |
| `state-info` | `#0369A1` | provider/系統資訊 |
| `focus-ring` | `#60A5FA` | 鍵盤 focus |

## Type

- 繁體中文 UI：`Geist`, `Noto Sans TC`, system sans-serif。
- Body 14–16px，line-height 1.5–1.7；table metadata 12–13px。
- Page title 24px；section title 16–18px；卡片內不使用 hero 尺寸。
- Letter spacing 固定 0；數據可使用 tabular numerals。

## Space and shape

- 間距基準：4px；常用 8/12/16/20/24/32。
- Control height：40px；icon button 36–40px。
- Radius：control 6px、card 8px、modal 8px；不用 24px/32px 作後台預設。
- Shadow：card 只用細微 shadow；table/page band 以 border 和 spacing 分層。

## State contract

每個 interactive component 必須定義 default、hover、focus-visible、active/selected、disabled、loading 與 error。狀態不可只靠顏色；至少搭配文字、icon、`aria-*` 或 shape。

