"use server";

import { requestAuditMeta } from "@/lib/audit";
import { requireVendorManagerContext } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import {
  loadEmailDeliverySearchResult,
  parseEmailDeliverySearchInput,
  requeueEmailDelivery,
  type EmailDeliverySearchResult,
} from "@/lib/email-delivery-operations";

export type EmailDeliveryOperationsActionState = {
  status: "idle" | "success" | "error";
  message: string;
  result: EmailDeliverySearchResult | null;
};

export async function manageEmailDeliveriesAction(
  _previousState: EmailDeliveryOperationsActionState,
  formData: FormData,
): Promise<EmailDeliveryOperationsActionState> {
  try {
    await assertServerActionSecurity(formData);
  } catch {
    return {
      status: "error",
      message: "安全驗證已失效，請重新整理頁面後再操作。",
      result: null,
    };
  }

  const parsed = parseEmailDeliverySearchInput(formData);
  if (!parsed.success) {
    return { status: "error", message: parsed.message, result: null };
  }

  const { auth, vendor } = await requireVendorManagerContext();
  let status: EmailDeliveryOperationsActionState["status"] = "success";
  let message = "寄送紀錄已更新。";

  try {
    if (parsed.retryDeliveryId) {
      const meta = await requestAuditMeta();
      const retry = await requeueEmailDelivery({
        vendorId: vendor.id,
        deliveryId: parsed.retryDeliveryId,
        actorId: auth.member!.id,
        actorLabel: auth.member!.role,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      if (retry.status === "requeued") {
        message = "已重新排入寄送佇列；背景工作會再次確認退訂與來源狀態後才寄送。";
      } else if (retry.status === "stale") {
        message = "來源資料或驗證連結已變更，舊信已安全停止，不會重新寄送。";
      } else if (retry.status === "conflict") {
        status = "error";
        message = "這筆紀錄剛被其他操作更新，請重新整理後確認最新狀態。";
      } else if (retry.status === "ineligible") {
        status = "error";
        message = "這個狀態不能手動重試；已寄送、寄送中、退訂或永久拒絕的信件不會重新排程。";
      } else {
        status = "error";
        message = "找不到這筆寄送紀錄，或目前帳號沒有操作權限。";
      }
    }

    const result = await loadEmailDeliverySearchResult(vendor.id, parsed.data);
    if (!parsed.retryDeliveryId) {
      message = result.totalItems === 0 ? "沒有符合目前條件的寄送紀錄。" : `找到 ${result.totalItems} 筆寄送紀錄。`;
    }
    return { status, message, result };
  } catch {
    return {
      status: "error",
      message: "Email 營運服務暫時無法使用，請稍後重試。",
      result: null,
    };
  }
}
