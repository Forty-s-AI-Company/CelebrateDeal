import { WorkspaceLoadingSkeleton } from "@/components/workspace-loading-skeleton";

export default function AdminLoading() {
  return (
    <WorkspaceLoadingSkeleton
      id="admin-loading"
      title="正在載入平台管理"
      description="正在整理管理資料，請稍候。"
      statusMessage="正在載入平台管理內容，請稍候。"
    />
  );
}
