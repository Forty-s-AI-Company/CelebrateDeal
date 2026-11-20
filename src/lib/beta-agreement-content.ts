import { publicSupportContact } from "@/lib/public-policy-content";

/**
 * CelebrateDeal 封測合作協議（O-11 方案 B，owner 2026-11-20 決定）。
 *
 * 條文依 `docs/goal-beta-prep-2026Q4/beta-merchant-agreement.md`，不含其中的
 * 「使用說明」區塊；owner 已決定第 1 條第 1 項的期間、第 8 條第 2 項的上限，
 * 第 11 條第 3 項改為網頁內勾選同意（clickwrap）。
 *
 * 版本號是伺服器的唯一事實：彈窗、公開頁 `/policies/beta-agreement` 與
 * `UserPolicyConsent.agreementVersion` 都讀這裡。條文有任何實質變動時必須
 * 換新版本號，所有商家下一次進後台都要重新同意。版本字串要符合資料庫
 * CHECK `^[0-9A-Za-z._-]{1,32}$`。
 */
export const BETA_AGREEMENT_VERSION = "beta-2026.11.20";
/** `UserPolicyConsent.context` of an acceptance (CHECK UserPolicyConsent_context_check). */
export const BETA_AGREEMENT_CONTEXT = "beta_agreement";

export type BetaAgreementSection = {
  number: number;
  heading: string;
  items: readonly string[];
};

export type BetaAgreementParty = {
  /** 商家名稱與帳號 Email 一律由伺服器帶入；公開頁沒有特定商家時為 null。 */
  vendorName: string | null;
  accountEmail: string | null;
};

export const betaAgreement = {
  slug: "beta-agreement",
  title: "CelebrateDeal 封測合作協議",
  summary: "參加 CelebrateDeal 封閉測試的商家與平台之間的合作條件，商家在後台勾選同意後生效。",
  version: BETA_AGREEMENT_VERSION,
  /** 甲方：O-9 定案前使用現行營運名稱與客服信箱。 */
  operator: {
    name: publicSupportContact.displayName,
    email: publicSupportContact.email,
  },
  preamble: "甲方邀請乙方參加 CelebrateDeal 平台（以下稱「本平台」）的封閉測試（以下稱「封測」），雙方同意下列條款。",
  sections: [
    {
      number: 1,
      heading: "封測期間與範圍",
      items: [
        "封測期間自乙方同意本協議之日起，至本平台正式上線為止；甲方得以 Email 通知提前結束或調整。",
        "封測提供的功能以甲方開通的為準。部分模組（例如課程、帳單、諮詢預約、瀏覽器直播、彈幕）由甲方逐商家開啟，甲方得隨時調整。",
        "本平台在封測期間仍在開發中，功能、介面與資料格式可能變更、暫停或移除，甲方不保證服務不中斷或沒有錯誤。",
      ],
    },
    {
      number: 2,
      heading: "費用",
      items: [
        "封測期間甲方不向乙方收取平台月費。",
        "乙方自行申請的第三方服務費用，例如 LINE 官方帳號訊息費、乙方自己的金流或物流費用，由乙方自行負擔。本平台的 LINE 推播使用乙方自己的官方帳號，甲方不代付訊息費用。",
        "直播與回放的播放分鐘數有方案額度，超過額度時播放會暫停。甲方會在封測開始前為乙方設定足夠的額度，並在需要調整時通知乙方。",
      ],
    },
    {
      number: 3,
      heading: "付款與交易",
      items: [
        "封測期間，本平台內建結帳只使用 PayUni 測試環境（Sandbox），不會產生真實扣款，只供演練流程。",
        "乙方向真實消費者收款，仍以乙方原有方式進行，與甲方無關。",
        "封測期間本平台產生的訂單、佣金與報表都是測試資料，不作為任何一方請款、分潤或報稅的依據。",
      ],
    },
    {
      number: 4,
      heading: "乙方的責任",
      items: [
        "乙方應確保在本平台上架的商品、課程、直播與頁面內容合法、不侵害他人權利，並自負商品或服務的履約、退換貨與消費者服務責任。",
        "乙方應自行保管登入資訊與雙重驗證裝置；以乙方帳號進行的操作，視為乙方所為。",
        "乙方不得利用本平台從事詐騙、釣魚、散布惡意程式或其他違法行為。甲方發現時，得立即停用相關頁面或帳號。",
      ],
    },
    {
      number: 5,
      heading: "互動腳本與「虛擬使用者」",
      items: [
        "本平台的直播與回放可以顯示乙方預先設定的互動腳本，例如預設留言、購買提示、倒數。有互動腳本時，觀眾頁會標示「部分互動為商家預先設定的腳本，不代表即時真人留言、真實購買或觀看人數」。",
        "乙方不得移除或遮蔽前項標示，也不得把腳本內容設定為冒充真實消費者的評價、虛構銷量、虛構限量或其他可能構成不實廣告、違反公平交易法的內容。",
        "腳本內容由乙方設定並自負法律責任。因乙方違反本條，使甲方受第三人請求或受主管機關處分時，乙方應負責處理，並賠償甲方因此受到的損害。",
      ],
    },
    {
      number: 6,
      heading: "消費者權益（七日解除權）",
      items: [
        "乙方透過本平台對消費者銷售時，應依消費者保護法提供七日解除權及必要的告知。本平台退款政策與結帳流程預設保留解除權。",
        "乙方如主張特定商品或服務屬於可以排除解除權的情形，應自行確認符合法令，並在消費者購買前醒目告知、取得同意。甲方不負責判斷乙方的商品是否可以排除。",
      ],
    },
    {
      number: 7,
      heading: "個人資料",
      items: [
        "乙方透過本平台蒐集的報名者、觀眾與買家個人資料，由乙方作為蒐集者，負個人資料保護法上的告知與合法利用責任；甲方在提供服務的必要範圍內代為處理。",
        "本平台使用的受託處理者與資料處理地區，以本平台隱私通知（/policies/privacy）所列為準，目前包括雲端資料庫與主機（Supabase、Vercel）、影音（Cloudflare）、Email（Resend）、LINE、金流（PayUni）、產品分析（PostHog）與錯誤監控（Sentry）。",
        "封測結束或乙方退出時，乙方得要求匯出或刪除其資料。依法應保存的交易、安全或爭議紀錄，甲方在法定期間屆滿後刪除。",
      ],
    },
    {
      number: 8,
      heading: "責任限制",
      items: [
        "本平台在封測期間以「現況」提供。因系統錯誤、資料遺失或服務中斷造成乙方損失時，除甲方有故意或重大過失外，甲方不負賠償責任。",
        "甲方依本協議對乙方負擔的賠償總額，以新台幣 3,000 元為上限。",
        "乙方應自行備份重要內容，例如商品文案、圖片、名單匯出。",
      ],
    },
    {
      number: 9,
      heading: "保密與回饋",
      items: [
        "雙方對因封測知悉的對方非公開資訊（包括未公開功能、商業資料、報價）負保密義務，封測結束後一年內仍然有效。",
        "乙方提供的意見、錯誤回報與建議，甲方得無償用於改善本平台，不必另外取得同意或支付對價。",
      ],
    },
    {
      number: 10,
      heading: "終止",
      items: [
        "任一方得以 Email 通知對方，隨時終止封測。",
        "乙方違反第 4 條或第 5 條時，甲方得立即停用乙方帳號或相關頁面。",
        "終止後，第 5 條第 3 項、第 7 條、第 8 條、第 9 條仍繼續有效。",
      ],
    },
    {
      number: 11,
      heading: "其他",
      items: [
        "本協議以中華民國法律為準據法。如有爭議，雙方同意以臺灣臺北地方法院為第一審管轄法院。",
        "本協議沒有規定的事項，依本平台公告的使用條款、隱私通知與退款政策辦理；如有衝突，以本協議為準。",
        "本協議以乙方在本平台勾選同意的方式簽署，本平台記錄同意的帳號、商家、協議版本與時間。",
      ],
    },
  ] satisfies readonly BetaAgreementSection[],
} as const;
