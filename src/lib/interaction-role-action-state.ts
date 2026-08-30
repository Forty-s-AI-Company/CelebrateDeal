import type { InteractionRoleAvatarMode } from "@/lib/interaction-role";

export type InteractionRoleFormValues = {
  id: string;
  name: string;
  avatarUrl: string;
  avatarAssetId: string;
  avatarMode: InteractionRoleAvatarMode | "";
  avatarUploadPhase: string;
  label: string;
  roleType: string;
  tone: string;
  isActive: boolean;
  isScheduled: boolean;
};

export type InteractionRoleActionState = {
  status: "idle" | "error";
  message: string;
  values: InteractionRoleFormValues;
};

export const initialInteractionRoleActionState: InteractionRoleActionState = {
  status: "idle",
  message: "",
  values: {
    id: "",
    name: "",
    avatarUrl: "",
    avatarAssetId: "",
    avatarMode: "",
    avatarUploadPhase: "",
    label: "",
    roleType: "official",
    tone: "",
    isActive: true,
    isScheduled: false,
  },
};
