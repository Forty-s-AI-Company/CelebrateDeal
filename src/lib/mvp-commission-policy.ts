/**
 * 佣金 accrual 的伺服器端功能閘門。
 *
 * 第二階段已開放商家聯盟、課程團隊分潤與平台推薦；退款、reversal 與
 * dispute 仍一律走各自的 immutable ledger 流程。
 */
export type CommissionAccrualKind = "affiliate" | "team_course" | "platform_referral";

export interface MvpCommissionPolicy {
  allowsNewAccrual(kind: CommissionAccrualKind): boolean;
}

/** 第二階段預設：已支援的佣金領域全部允許建立新 accrual。 */
export const mvpCommissionPolicy: MvpCommissionPolicy = {
  allowsNewAccrual: () => true,
};
