export type PolicySection = {
  heading: string;
  paragraphs: string[];
};

export const publicSupportContact = {
  displayName: "Carry Digital Nomad 凱瑞數位",
  email: "a88221144@gmail.com",
} as const;

export const policyCenterPublication = {
  version: "2026.10.18",
  effectiveDate: "2026-11-01",
  effectiveDateLabel: "2026 年 11 月 1 日",
} as const;

export type PolicyPublicationStatus = "scheduled" | "published";

export type PolicyPublication = {
  version: string;
  effectiveDate: string;
  effectiveDateLabel: string;
};

type PolicyDefinition = {
  slug: string;
  title: string;
  summary: string;
  publication: PolicyPublication;
  sections: PolicySection[];
};

export type PublicPolicy = Omit<PolicyDefinition, "publication"> & {
  publication: PolicyPublication & { status: PolicyPublicationStatus };
};

const TAIPEI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 以台灣時間（Asia/Taipei，UTC+8）的日期判斷：到達生效日（含當天）即為已生效。 */
export function resolvePolicyStatus(effectiveDate: string, now: Date = new Date()): PolicyPublicationStatus {
  const taipeiToday = new Date(now.getTime() + TAIPEI_UTC_OFFSET_MS).toISOString().slice(0, 10);
  return taipeiToday >= effectiveDate ? "published" : "scheduled";
}

export function resolvePublication(publication: PolicyPublication, now: Date = new Date()): PublicPolicy["publication"] {
  return { ...publication, status: resolvePolicyStatus(publication.effectiveDate, now) };
}

export function resolvePublicPolicy(policy: PolicyDefinition, now: Date = new Date()): PublicPolicy {
  return { ...policy, publication: resolvePublication(policy.publication, now) };
}

export const publicPolicies: Record<string, PolicyDefinition> = {
  terms: {
    slug: "terms",
    title: "使用條款",
    summary: "說明 CelebrateDeal 的服務範圍、帳號與內容責任、付款、通知及服務變更規則。",
    publication: { ...policyCenterPublication },
    sections: [
      {
        heading: "營運者與服務範圍",
        paragraphs: [
          `${publicSupportContact.displayName}（以下稱「我們」）提供 CelebrateDeal 平台，協助商家建立活動、報名頁、銷售頁、直播或回放，並管理訂單與通知。聯絡信箱為 ${publicSupportContact.email}。`,
          "商家提供的課程、活動、商品或服務，其內容、價格、交付方式、使用期限與個別交易條件，以購買頁及訂單紀錄為準。平台功能不代表我們替商家保證內容成效或專業資格。",
          "部分場次可能是預先錄製、依排程播出的內容；聊天室中的部分互動，也可能是商家預先設定的腳本，不一定是即時真人回覆。",
        ],
      },
      {
        heading: "帳號、權限與內容",
        paragraphs: [
          "使用者應提供必要且正確的資料、妥善保管帳號及驗證資訊，並只在獲授權範圍內操作。未成年人進行付費或其他法律行為時，應依其行為能力取得法定代理人的必要同意。",
          "使用者不得冒用身分、侵害他人權利、上傳違法內容、繞過存取限制或干擾服務。商家應確保其上傳內容及素材具備必要權利；我們僅在提供服務所需範圍內處理該內容，不因此取得內容所有權。",
          "發現違法、侵權、詐欺或重大安全風險時，我們得限制相關功能或帳號，並在合理可行時告知原因及聯絡方式。依法應保存的交易、安全或爭議紀錄不因帳號停用而立即刪除。",
        ],
      },
      {
        heading: "方案、付款與交易狀態",
        paragraphs: [
          "PayUni 為目前主要付款服務。實際可用付款方式、幣別、金額及是否為定期方案，應在交易確認前顯示；付款狀態以平台與金流核對後的訂單紀錄為準，返回付款頁或看到單一通知不代表付款一定完成。",
          "平台方案與商家提供的商品或服務屬不同交易時，各自的內容及責任以購買頁與訂單資料為準。付款結果不明、重複扣款或訂單狀態有疑義時，請先透過客服信箱查詢，避免重複付款。",
          "目前平台方案不會自動扣款，每月帳單會依所選方案產生。若要結束方案，請寄信至客服信箱提出。商家的商品或交易頁若另行提供自動續訂，該頁應同時說明計費週期與金額，並依該頁及訂單所示條件處理；各項條件另有期限者，依各該條件辦理，客服不另承諾固定回覆時間。停止續訂不影響已成立交易依法享有的退款或解除契約權利。",
        ],
      },
      {
        heading: "通知選擇",
        paragraphs: [
          "通知依使用者選擇、平台實際啟用狀態及必要綁定提供，可能包含 Email、LINE，以及商家啟用時的 SMS、WhatsApp 或裝置推播；畫面上未顯示為可選擇的通道即不提供。未啟用、未綁定或未被選擇的通道，不會被視為已送達。",
          "交易、安全與服務必要通知會與行銷訊息分開處理。使用者可以拒絕行銷訊息或調整可選通道；拒絕行銷不影響已購商品或必要交易通知。",
        ],
      },
      {
        heading: "服務變更、終止與責任",
        paragraphs: [
          "我們可能為安全、法令、技術或服務調整而更新功能與條款。涉及價格或重要權益的變更，會在適用前以網站公告、帳號內通知或 Email 等合理方式說明；變更不會溯及剝奪已成立訂單的權益。",
          "因維護、第三方服務、網路或不可抗力造成中斷時，我們會在合理範圍內處理與復原。法律不允許排除或限制的責任，不因本條款而被排除或限制。",
        ],
      },
      {
        heading: "聯絡與爭議處理",
        paragraphs: [
          `帳號、付款、內容申訴或其他問題可寄至 ${publicSupportContact.email}。請勿提供完整卡號、卡片安全碼、密碼、金鑰或一次性驗證碼。`,
          "本條款以中華民國法律為準據法。爭議管轄依適用法律處理，不排除消費者依法享有的管轄及其他權利。",
        ],
      },
    ],
  },
  privacy: {
    slug: "privacy",
    title: "隱私通知",
    summary: "說明 CelebrateDeal 處理的資料、使用目的、共享範圍、保存原則及使用者權利。",
    publication: { ...policyCenterPublication },
    sections: [
      {
        heading: "蒐集者與聯絡方式",
        paragraphs: [
          `${publicSupportContact.displayName} 依本通知處理 CelebrateDeal 平台相關個人資料。個資或隱私申請請寄至 ${publicSupportContact.email}。`,
          "商家為其活動、商品及學員關係另行蒐集資料時，也應就其處理目的與責任提供必要告知。本通知只涵蓋 CelebrateDeal 平台實際處理的範圍。",
        ],
      },
      {
        heading: "資料類型與使用目的",
        paragraphs: [
          "依使用功能，我們可能處理帳號與聯絡資料（含 Email 與電話號碼）、商家設定、角色與權限、報名與預約資料、LINE 綁定與通知選擇、訂單及付款結果參照、收件與發票資料（載具、統一編號、抬頭）、退款與客服紀錄、推薦來源歸因，以及頁面造訪、播放區間與活動互動紀錄。商家綁定付款方式時，我們會保存 PayUni 回傳的付款方式參照碼，不保存完整卡號。商家與推廣夥伴領取報酬時，我們會處理撥款銀行帳戶，以及報酬所需的稅務與扣繳資料。安全稽核紀錄可能包含 IP 位址與裝置資訊。",
          "處理目的包括帳號與身分管理、提供活動及報名服務、履行交易、退款與客服、傳送使用者選擇或服務必要的通知、防止濫用與維護安全，以及提供有來源與限制說明的活動統計。",
          "付款由 PayUni 等付款服務處理時，我們使用交易識別碼、金額、狀態、付款方式參照碼與必要核對資訊，不要求使用者透過客服提供完整卡號或卡片安全碼。",
        ],
      },
      {
        heading: "資料來源、利用對象與地區",
        paragraphs: [
          "資料可能由使用者直接提供，或由使用者操作、商家合法提供、LINE 綁定、PayUni 交易結果及平台安全或使用紀錄產生。若資料並非由本人提供，我們會依適用法律處理應告知事項。",
          "為提供服務，必要資料可能提供給負責該活動或商品的商家，以及付款、雲端託管、影音、Email、LINE、SMS、WhatsApp、產品分析（PostHog）、錯誤監控（Sentry）與安全服務商。這些服務商作為受託處理者，只能在受託範圍內處理資料，不得自行作其他用途。",
          "商家若在追蹤設定中啟用 Meta Conversions API，平台會代商家將雜湊後的 Email、事件識別碼、瀏覽器資訊、來源頁面與訂單金額傳送給 Meta，Meta 依其自身政策處理這些資料。",
          "資料主要用於台灣的服務營運；因雲端、LINE、影音或其他受託服務的基礎設施，部分資料可能在美國、日本或其他服務商營運地區處理。我們會依適用法律及契約要求必要保護。",
        ],
      },
      {
        heading: "保存期間與保護",
        paragraphs: [
          "資料保存在提供帳號、活動、交易與客服服務所需期間，並依會計、稅務、消費爭議、資安或其他法定義務保留必要紀錄。目的消失且無其他合法保存需要時，會刪除、停止利用或去識別化。目前沒有依時間自動刪除的機制，刪除、停止利用或去識別化是在收到申請或定期檢視時以人工處理。",
          "目前未提供一鍵刪除所有紀錄的功能。使用者可透過客服信箱提出查詢、更正、停止利用或刪除請求；依法必須保存或為處理爭議、安全事件所必要的資料，會說明無法立即刪除的理由。",
          "我們採取權限控管、傳輸保護、稽核及其他合理安全措施。若發生依法應通知的資料事故，會依適用法律採取處理與通知。",
        ],
      },
      {
        heading: "瀏覽與活動統計",
        paragraphs: [
          "第一方 Cookie 用於維持登入、結帳與觀看狀態；推薦 Cookie 會記錄訪客來自哪個推薦連結，用來計算商家的推薦報酬。平台可能以第一方識別資訊與可驗證的報名或訂單關係產生造訪、報名、到場及播放統計。不同裝置或無法連結的紀錄可能分開計算，播放區間也不代表本人全程專注觀看。",
          "商家只能在其租戶及授權範圍內查看所屬活動資料。統計無法可靠計算時，平台應顯示不可計算或未歸因，不以猜測值補足。",
        ],
      },
      {
        heading: "當事人權利與通知選擇",
        paragraphs: [
          "使用者得依法請求查詢或閱覽、取得複本、補充或更正、停止蒐集處理或利用，以及刪除個人資料。申請時我們只會要求確認身分與處理範圍所必要的資訊。",
          `請將申請寄至 ${publicSupportContact.email}。我們會依適用法律回覆；若依法得拒絕、必須保存或需要延長處理，會說明理由。`,
          "使用者可以拒絕行銷，並在畫面提供的範圍內選擇已啟用且完成必要綁定的通知通道（可能包含 Email、LINE，以及商家啟用時的 SMS、WhatsApp 或裝置推播）；畫面未顯示為可選擇的通道即不提供。Email 中的退訂連結會停止該商家的報名確認、直播提醒與後續銷售 Email；登入連結、驗證碼等安全必要的 Email 不受影響，退訂也不影響已購買商品的權益。未提供必要資料時，可能無法完成相應的報名、付款、帳號安全或通知功能。",
        ],
      },
    ],
  },
  refunds: {
    slug: "refunds",
    title: "退款與付款支援政策",
    summary: "說明退款申請、通訊交易解除權、數位內容例外、處理狀態與發票現況。",
    publication: { ...policyCenterPublication },
    sections: [
      {
        heading: "適用範圍與申請方式",
        paragraphs: [
          "平台方案由平台依該方案交易內容處理；商家商品、課程或活動由購買頁及訂單所示的商品提供者負責履約。若訂單未清楚顯示處理窗口，可先透過 CelebrateDeal 客服協助確認。",
          `退款或付款疑義請寄至 ${publicSupportContact.email}，並提供訂單編號、交易時間、問題及希望的處理方式。請勿提供網銀密碼、驗證碼、完整卡號或卡片安全碼。`,
        ],
      },
      {
        heading: "通訊交易與數位內容",
        paragraphs: [
          "屬於消費者保護法通訊交易且沒有法定例外時，消費者得在收受商品或接受服務後 7 日內，以退回商品或書面通知解除契約，無須說明理由或負擔費用。Email 可作為可保存的書面通知方式。",
          "非以有形媒介提供的數位內容，或一經提供即完成的線上服務，只有在符合規定、經消費者事先同意始提供，且事前告知排除解除權時，才適用法定例外。平台不以「所有線上課程一律不退」作為通用規則。",
          "尚未提供的直播、課程或服務不會只因屬於線上交易就當然排除解除權。個別交易另有較有利約定或其他法定權利時，依該約定或法律辦理。",
        ],
      },
      {
        heading: "審核、退款與狀態",
        paragraphs: [
          "收到申請後會核對交易、履約狀態、申請理由及適用規則，退款狀態分為已受理、審核中、已拒絕（會說明理由）、已向金流送出、已退款與退款失敗。受理申請或送出金流指令不代表款項已入帳。",
          "依法解除服務契約時，企業經營者原則上應自收到解除通知次日起 15 日內返還已支付對價；商品交易則依取回或收到退回商品等法定起算方式處理。銀行或金流顯示時間可能不同，但不會減少依法應返還的金額或權利。",
          "付款狀態不明、重複收款或退款結果未知時，平台會保留可追蹤紀錄並先核對，不會因單一畫面或逾時就任意重複扣款或退款。",
        ],
      },
      {
        heading: "電子發票與國外交易",
        paragraphs: [
          "CelebrateDeal 的自動電子發票功能尚未開放。付款成功、填寫發票需求或退款申請，都不代表系統已自動開立、作廢或折讓發票。",
          "該筆交易的開立主體會依法開立並提供發票；平台會把結帳時填寫的發票資料交給該開立主體。若未收到發票，或訂單未顯示開立主體，請寄信至客服信箱，我們會協助查明，且不影響開立主體原有的義務。",
          "目前系統不會自動產生國外商用 Invoice。需要公司抬頭、統一編號、國外 Invoice 或其他特殊文件時，請透過客服信箱確認實際商品提供者、開立主體與可提供的文件。",
        ],
      },
    ],
  },
};

export const publicPolicyLinks = [
  { href: "/policies", label: "政策與協助中心" },
  { href: "/policies/terms", label: "使用條款" },
  { href: "/policies/privacy", label: "隱私通知" },
  { href: "/policies/refunds", label: "退款政策" },
  { href: "/support", label: "客服與付款協助" },
  { href: "/merchant-onboarding", label: "商家使用指南" },
] as const;
