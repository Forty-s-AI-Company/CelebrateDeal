"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireVendorManager } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { saveRegistrationForm, type FormBuilderActionState as RegistrationFormSaveState } from "@/lib/registration-form-save";

export type FormBuilderActionState = RegistrationFormSaveState;

export async function upsertFormBuilderAction(
  _previousState: FormBuilderActionState,
  formData: FormData,
): Promise<FormBuilderActionState> {
  try {
    await assertServerActionSecurity(formData);
  } catch {
    return {
      status: "error",
      message: "安全驗證已失效，請重新整理頁面後再送出。",
      fieldErrors: { root: "本頁的安全驗證已過期。" },
    };
  }

  const vendor = await requireVendorManager();
  const result = await saveRegistrationForm(vendor.id, formData);
  if (!result.ok) return result.state;

  // Refresh project task counts only after a successful resource write.
  revalidatePath("/(app)", "layout");
  redirect("/forms");
}
