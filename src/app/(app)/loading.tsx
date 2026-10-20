import { WorkspaceLoadingSkeleton } from "@/components/workspace-loading-skeleton";

export default function ProtectedAppLoading() {
  return (
    <WorkspaceLoadingSkeleton
      id="protected-app-loading"
      title="正在載入工作區"
      description="正在整理頁面資料，請稍候。"
      statusMessage="正在載入工作區內容，請稍候。"
    />
  );
}
