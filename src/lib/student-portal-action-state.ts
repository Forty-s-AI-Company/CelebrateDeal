/** 表單初始狀態屬於純契約，不可作為 Server Action 的 runtime export。 */
export type StudentPortalActionState = {
  status: "idle" | "sent" | "invalid" | "rate_limited";
  message: string;
  mockLink?: string;
};

export const STUDENT_PORTAL_INITIAL_STATE: StudentPortalActionState = { status: "idle", message: "" };

