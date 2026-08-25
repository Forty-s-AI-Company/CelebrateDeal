"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createPlatformPlanCheckout,
  platformPlanCheckoutPath,
} from "@/lib/platform-plan-checkout";

export async function selectBillingPlanAction(formData: FormData) {
  const result = await createPlatformPlanCheckout(formData);
  const path = platformPlanCheckoutPath(result);

  if (result.kind === "checkout") {
    revalidatePath("/billing/plans");
    revalidatePath("/billing/usage");
    revalidatePath("/dashboard");
  }

  redirect(path);
}
