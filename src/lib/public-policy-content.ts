export type PolicySection = {
  heading: string;
  paragraphs: string[];
};

export type PolicyDraft = {
  slug: string;
  title: string;
  summary: string;
  status: string;
  owner: string;
  sections: PolicySection[];
};

// 這些內容是產品可見的草稿骨架，不代表法務、客服或 release owner 已核准。
export const policyDrafts: Record<string, PolicyDraft> = {
  terms: {
    slug: "terms",
    title: "使用條款（草稿）",
    summary: "說明 CelebrateDeal 平台、帳號、內容、方案與服務變更的基本邊界。",
    status: "DRAFT — HUMAN LEGAL REVIEW REQUIRED",
    owner: "privacy／legal owner、release owner",
    sections: [
      {
        heading: "服務與帳號責任",
        paragraphs: [
          "正式條款需要由產品與法務 owner 確認服務範圍、商家責任、帳號安全、授權成員與停用條件。",
          "目前產品只提供登入、角色、MFA 與商家營運功能；本頁不取代正式合約或個別商家約定。",
        ],
      },
      {
        heading: "方案、付款與內容",
        paragraphs: [
          "方案、付款、退款、內容使用權與第三方服務的正式文字尚待核准，不能以本機或 Sandbox 結果推論為正式承諾。",
        ],
      },
      {
        heading: "版本、變更與聯絡",
        paragraphs: [
          "正式版本應標示生效日期、變更摘要、適用環境與申訴／聯絡路徑；目前尚未完成真人 owner acceptance。",
        ],
      },
    ],
  },
  privacy: {
    slug: "privacy",
    title: "隱私與資料請求（草稿）",
    summary: "整理資料用途、保存、第三方服務與資料請求流程的待核准入口。",
    status: "DRAFT — HUMAN PRIVACY REVIEW REQUIRED",
    owner: "privacy／legal owner、平台 owner",
    sections: [
      {
        heading: "資料類型與用途",
        paragraphs: [
          "正式隱私通知需要逐項盤點帳號、商家設定、公開頁互動、付款／退款參照、稽核與安全事件資料，並由 owner 確認每項用途與必要性。",
          "產品與測試 evidence 只保存最小化、去識別或 synthetic 參照；不在此頁顯示憑證、Token、Cookie、完整付款資料或原始 provider payload。",
        ],
      },
      {
        heading: "保存、刪除與資料請求",
        paragraphs: [
          "保存期限、刪除例外、資料匯出、更正與其他請求的正式流程尚待隱私／法務 owner review；在核准前，本頁不承諾特定期限或法定結論。",
        ],
      },
      {
        heading: "第三方服務與事件通知",
        paragraphs: [
          "PayUni、Cloudflare、監控與分析服務的實際啟用範圍、資料流向與事件通知文字，仍需要外部設定 evidence 與真人核准。",
        ],
      },
    ],
  },
  refunds: {
    slug: "refunds",
    title: "退款與付款支援政策（草稿）",
    summary: "讓使用者先看到退款申請、狀態不明與升級處理的產品邊界。",
    status: "DRAFT — FINANCE／SUPPORT／LEGAL REVIEW REQUIRED",
    owner: "finance owner、support owner、privacy／legal owner",
    sections: [
      {
        heading: "申請與狀態判讀",
        paragraphs: [
          "退款應依可追溯的交易／退款參照與核准流程處理；不以客服敘述、截圖或單一通知直接重送退款或改寫帳務狀態。",
          "部分退款、全額退款、重複請求與付款狀態不明的產品狀態可在本機與受控 Sandbox 流程驗證，但不代表正式 provider 或商家政策已核准。",
        ],
      },
      {
        heading: "客服交接與禁止事項",
        paragraphs: [
          "客服不應要求完整卡號、CVV、密碼、Token、Cookie 或原始 provider payload；狀態衝突時應停止自動操作並升級財務／平台 owner。",
          "正式退款資格、時間、例外、付款方式差異與法定權利，尚待 finance／support／legal owner 共同核准。",
        ],
      },
    ],
  },
};

export const publicPolicyLinks = [
  { href: "/policies", label: "政策與協助中心" },
  { href: "/policies/terms", label: "使用條款（草稿）" },
  { href: "/policies/privacy", label: "隱私通知（草稿）" },
  { href: "/policies/refunds", label: "退款政策（草稿）" },
  { href: "/support", label: "客服與付款協助" },
  { href: "/merchant-onboarding", label: "商家 onboarding" },
] as const;
