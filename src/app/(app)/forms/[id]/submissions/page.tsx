import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export default async function FormSubmissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendor();
  const { id } = await params;
  const form = await getDb().registrationForm.findFirst({
    where: { id, vendorId: vendor.id },
    include: { submissions: { orderBy: { createdAt: "desc" }, include: { live: true } } },
  });
  if (!form) notFound();

  return (
    <>
      <PageHeader title={`${form.name} 名單`} description="查看表單與直播頁收集到的 lead 資料。" />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="py-2">姓名</th>
                <th>Email</th>
                <th>手機</th>
                <th>來源</th>
                <th>時間</th>
              </tr>
            </thead>
            <tbody>
              {form.submissions.map((submission) => (
                <tr key={submission.id} className="border-t border-border">
                  <td className="py-3 font-medium text-slate-950">{submission.name}</td>
                  <td>{submission.email}</td>
                  <td>{submission.phone}</td>
                  <td>{submission.live?.title ?? submission.source}</td>
                  <td>{formatDateTime(submission.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
