"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireVendorManagerContext } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";

const BookingId = z.string().min(1).max(191);
const QuickTag = z.enum(["預算足夠", "需再跟進"]);

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** 手機工作台的快速寫入：先由預約反查 tenant-bound identity，再一次完成 CRM 更新。 */
export async function saveMobileConsultationAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const bookingId = BookingId.parse(text(formData, "bookingId"));
  const note = z.string().max(4_000).parse(text(formData, "note"));
  const tagInput = text(formData, "tag");
  const tag = tagInput ? QuickTag.parse(tagInput) : null;
  const closedWon = text(formData, "closedWon") === "true";
  if (!note && !tag && !closedWon) throw new Error("請至少選擇一項快速操作");

  const database = getDb();
  const booking = await database.consultationBooking.findFirst({
    where: { id: bookingId, vendorId: vendor.id },
    select: { customerKeyHash: true },
  });
  if (!booking?.customerKeyHash) throw new Error("此預約尚未建立可用的客戶識別");

  await database.$transaction(async (transaction) => {
    const record = await transaction.customerCrmRecord.upsert({
      where: { vendorId_customerKeyHash: { vendorId: vendor.id, customerKeyHash: booking.customerKeyHash! } },
      create: { vendorId: vendor.id, customerKeyHash: booking.customerKeyHash!, consultationStatus: closedWon ? "closed_won" : "following_up" },
      update: closedWon ? { consultationStatus: "closed_won" } : {},
    });
    if (note) {
      await transaction.consultantNote.create({
        data: { vendorId: vendor.id, customerRecordId: record.id, body: note, actorId: auth.member!.id, actorLabel: auth.member!.role },
      });
    }
    if (tag) {
      await transaction.customerTagAssignment.upsert({
        where: { vendorId_customerKeyHash_tag: { vendorId: vendor.id, customerKeyHash: booking.customerKeyHash!, tag } },
        create: { vendorId: vendor.id, customerKeyHash: booking.customerKeyHash!, tag },
        update: {},
      });
    }
  });
  revalidatePath("/consultations/mobile");
  revalidatePath("/customers");
}
