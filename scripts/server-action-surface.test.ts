import fs from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const actionsRoot = path.join(process.cwd(), "src", "app");

/** 收集檔案的「執行期值」匯出名稱（type／interface 不算）。 */
function valueExportNames(filePath: string) {
  const source = ts.createSourceFile(filePath, fs.readFileSync(filePath, "utf8"), ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  for (const statement of source.statements) {
    const isExported = ts.canHaveModifiers(statement)
      && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(statement) && isExported && statement.name) names.push(statement.name.text);
    else if (ts.isClassDeclaration(statement) && isExported && statement.name) names.push(statement.name.text);
    else if (ts.isVariableStatement(statement) && isExported) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      }
    } else if (
      ts.isExportDeclaration(statement)
      && !statement.isTypeOnly
      && statement.exportClause
      && ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (!element.isTypeOnly) names.push(element.name.text);
      }
    }
  }
  return names;
}

function surfaceFiles() {
  const domainDirectory = path.join(actionsRoot, "actions");
  const domainFiles = fs
    .readdirSync(domainDirectory)
    .filter((name) => name.endsWith(".ts") && !/\.test\.ts$/.test(name))
    .map((name) => path.join(domainDirectory, name));
  return [path.join(actionsRoot, "actions.ts"), ...domainFiles];
}

// R-04 拆分 actions.ts 前後，可被呼叫的 server action 名稱集合必須完全相同。
// 刪除 wrapper 只能改變「名稱由哪個檔案提供」，不能讓名稱消失或憑空新增。
// 有意新增或移除 action 時，同步更新這份清單。
const EXPECTED_SURFACE: readonly string[] = [
  "acceptBetaAgreementAction",
  "acceptVendorMemberInvitationAction",
  "switchFromBetaAgreementGateAction",
  "activateEmailSequenceAction",
  "addBuyerSupportReplyAction",
  "addCustomerTagAction",
  "addSupportCaseCustomerReplyAction",
  "addSupportCaseNoteAction",
  "addTeamMemberAction",
  "applyLandingPageTemplateAction",
  "approveAffiliatePayeeProfileAction",
  "approveSettlementAdjustmentAction",
  "archiveVideoAction",
  "assignSupportCaseAction",
  "cancelConsultationBookingAction",
  "changeVendorMemberRoleAction",
  "claimTeamTemplateAction",
  "completePersonalizedOnboardingAction",
  "confirmMfaEnrollmentAction",
  "confirmPasswordResetAction",
  "controlOnboardingGuideAction",
  "createAffiliateRemunerationQuoteAction",
  "createAutomationRecipeAction",
  "createAutomationRuleAction",
  "createAutomationRuleStepAction",
  "createBuyerSupportCaseAction",
  "createConsultationBookingAction",
  "createConsultationEventAction",
  "createFunnelAutomationRuleAction",
  "createLandingPageFromTemplateAction",
  "createMerchantInvitationAction",
  "createMessageTemplateQuickAction",
  "createPayoutBatchAction",
  "createPlatformReferralPayoutBatchAction",
  "createProductQuickAction",
  "createRegistrationFormQuickAction",
  "createSalesProjectAction",
  "createSalesTeamAction",
  "createSupportCaseAction",
  "createTeamLiveShareAction",
  "createUrlVideoQuickAction",
  "createVendorMemberAction",
  "deactivateTeamMembershipAction",
  "deactivateVendorMemberAction",
  "deleteAutomationRuleAction",
  "deleteAutomationRuleStepAction",
  "deleteCourseChapterAction",
  "deleteEmailSequenceAction",
  "deleteInteractionRoleAction",
  "deleteInteractionScriptAction",
  "deleteLandingPageTemplateAction",
  "disableTeamLiveShareAction",
  "dismissRecoveryCodesAction",
  "drawLiveInteractionWinnerAction",
  "dryRunAutomationRuleAction",
  "duplicateInteractionScriptAction",
  "endLiveInteractionAction",
  "enterStudentPortalFromCheckoutAction",
  "generateSettlementAction",
  "getConsultationSlots",
  "getLivePollStudioSnapshotAction",
  "grantCommerceEntitlementAction",
  "grantCustomerVoucherAction",
  "importSystemRolesAction",
  "initialTeamLiveShareActionState",
  "instantiateStepTemplateAction",
  "landingPageAction",
  "listFunnelAutomationRulesAction",
  "listLiveInteractionScriptsAction",
  "lockSettlementAction",
  "loginAction",
  "logoutAction",
  "logoutStudentPortalAction",
  "lookupAccountForMfaRemovalAction",
  "manageEmailDeliveriesAction",
  "manageTeamFunnelTemplateAction",
  "markPayoutBatchExportedAction",
  "moderateCourseCommunityAction",
  "moderateLiveQuestionAction",
  "moveCourseChapterAction",
  "moveCourseLessonAction",
  "pauseEmailSequenceAction",
  "payInvoiceAction",
  "persistTaskPanelCollapsedAction",
  "publishSalesProjectAction",
  "readFunnelOperations",
  "readLandingPageTemplateDocumentAction",
  "readLandingPageTemplateTargetAction",
  "readPlatformTemplateDocumentAction",
  "readStepTemplatePreviewAction",
  "recordAffiliatePayoutOutcomeAction",
  "recordCoursePayoutOutcomeAction",
  "recordPlatformReferralPayoutOutcomeAction",
  "refundPaymentTransactionAction",
  "regenerateRecoveryCodesAction",
  "registerAction",
  "rejectSettlementAdjustmentAction",
  "releaseAccountSecurityHoldAction",
  "releaseHeldEntitlementsAction",
  "removeAccountMfaAction",
  "removeCustomerTagAction",
  "renameCourseChapterAction",
  "renameLandingPageTemplateAction",
  "requestAccountEmailChangeAction",
  "requestMagicLinkAction",
  "requestPasswordResetAction",
  "requestSupportRefundHandoffAction",
  "resendMerchantEmailVerificationAction",
  "resendVendorMemberInvitationAction",
  "reserveConsultationBooking",
  "restoreVideoAction",
  "resumeVendorAction",
  "retryWebhookEventAction",
  "reviewSupportRefundHandoffAction",
  "revokeAllSessionsAction",
  "revokeMerchantInvitationAction",
  "revokeOtherSessionsAction",
  "revokePaymentMethodReferenceAction",
  "revokeVendorMemberInvitationAction",
  "saveBrandSettingsAction",
  "saveBrandSettingsActionState",
  "saveConsultantNoteAction",
  "saveCourseLessonAction",
  "saveEmailSequenceAction",
  "saveInteractionScript",
  "saveLandingPageTemplateAction",
  "saveLineOfficialAccountAction",
  "saveMerchantAffiliatePayoutPolicyAction",
  "saveMerchantAffiliatePolicyAction",
  "saveMobileConsultationAction",
  "saveOnboardingAnswerAction",
  "savePartnerPageAction",
  "saveTrackingCredentialAction",
  "saveTrackingSettingsAction",
  "searchCustomersAction",
  "searchFormSubmissionsAction",
  "selectSalesProjectAction",
  "sendPasswordResetSmokeAction",
  "setAffiliatePortalAccessAction",
  "setFunnelAutomationRuleEnabledAction",
  "setPartnerPagePublishAction",
  "setStudentPortalLocaleAction",
  "setTeamMembershipAffiliateAction",
  "setTeamUplineAction",
  "signAffiliateRemunerationQuoteAction",
  "skipPersonalizedOnboardingAction",
  "startLiveInteractionAction",
  "startMfaEnrollmentAction",
  "startPaymentMethodSetupAction",
  "startPaymentMethodSetupStateAction",
  "submitAffiliatePayeeProfileAction",
  "suspendVendorAction",
  "switchFromSuspendedVendorAction",
  "testLineOfficialAccountAction",
  "toggleAutomationRuleAction",
  "toggleConsultationEventAction",
  "transferTeamMemberAction",
  "transitionServiceFulfillmentAction",
  "transitionShippingFulfillmentAction",
  "transitionSupportCaseAction",
  "unbindInteractionScriptFromLiveAction",
  "unblockBlacklistAction",
  "updateAutomationRuleStepAction",
  "updateConsultationBookingStatusAction",
  "updateConsultationEventAction",
  "updateCustomerStatusAction",
  "updateEvergreenWebinarSettingsAction",
  "updateFunnelAutomationRuleAction",
  "updateFunnelOperations",
  "updatePasswordAction",
  "updatePayoutItemStatusAction",
  "updateRichMenuDraftAction",
  "updateSettlementAdjustmentAction",
  "updateVendorBetaFeatureGrantsAction",
  "upsertAffiliateAction",
  "upsertBlacklistAction",
  "upsertFormAction",
  "upsertFormBuilderAction",
  "upsertInteractionRoleAction",
  "upsertInteractionRoleActionState",
  "upsertInteractionScriptAction",
  "upsertLiveAction",
  "upsertProductAction",
  "upsertTemplateAction",
  "upsertVideoAction",
  "verifyLuckyDrawWinnerClaimAction",
  "verifyMfaAction",
  "voidAffiliateCommissionAction",
];

describe("server action 名稱集合", () => {
  it("@/app/actions 與 src/app/actions/* 的匯出名稱聯集維持不變", () => {
    const union = new Set(surfaceFiles().flatMap(valueExportNames));
    expect([...union].sort()).toEqual([...EXPECTED_SURFACE].sort());
  });
});
