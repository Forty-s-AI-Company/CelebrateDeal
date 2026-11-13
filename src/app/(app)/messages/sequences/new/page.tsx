import { EmailSequenceForm } from "@/components/email-sequence-form";
import { PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { ID_PATTERN } from "@/lib/email-sequence-rules";
import { requireFeatureOrNotFound } from "@/lib/feature-gates";

export default async function NewEmailSequencePage({
  searchParams,
}: {
  searchParams: Promise<{ liveId?: string | string[] }>;
}) {
  const vendor = await requireVendorManager();
  requireFeatureOrNotFound(vendor, "email_sequences");
  const { liveId } = await searchParams;
  // Only preselects an option; the save re-checks the Live against this vendor.
  const preselected = typeof liveId === "string" && ID_PATTERN.test(liveId) ? liveId : "";
  return (
    <>
      <PageHeader
        title="新增追銷序列"
        description="選一場直播，排好報名者驗證 Email 之後每一封信的寄送時間。建立後是草稿，按「啟用」才會開始寄。"
      />
      <EmailSequenceForm vendorId={vendor.id} initialDraft={{ name: "", liveId: preselected, steps: [] }} />
    </>
  );
}
