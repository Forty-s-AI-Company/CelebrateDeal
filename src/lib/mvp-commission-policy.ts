/**
 * 首發 MVP 不再建立新的推薦／團隊佣金負債。
 *
 * 這個 policy 僅控制新的 accrual；既有佣金的退款、reversal 與 dispute
 * 必須繼續走原本的 immutable ledger 流程。
 */
export type CommissionAccrualKind = "affiliate" | "team_course" | "platform_referral";

export interface MvpCommissionPolicy {
  allowsNewAccrual(kind: CommissionAccrualKind): boolean;
}

/** 正式首發預設：所有新佣金 accrual 一律停用。 */
export const mvpCommissionPolicy: MvpCommissionPolicy = {
  allowsNewAccrual: () => false,
};
