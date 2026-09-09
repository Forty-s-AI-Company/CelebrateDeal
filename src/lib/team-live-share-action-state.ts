/** 表單初始狀態屬於純契約，不可作為 Server Action 的 runtime export。 */
export type TeamLiveShareActionState = {
  status: "idle" | "success" | "error";
  message: string;
  shareUrl?: string;
  pageId?: string;
  promoterMembershipId?: string;
};

export const initialTeamLiveShareActionState: TeamLiveShareActionState = {
  status: "idle",
  message: "",
};

