export function invoiceStatusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    issued: "待付款",
    paid: "已付款",
    partially_refunded: "部分退款",
    refunded: "已退款",
    overdue: "已逾期",
    void: "已作廢",
  };
  return labels[status] ?? "待確認";
}

export function invoiceStatusTone(status: string) {
  if (status === "paid") return "green" as const;
  if (status === "partially_refunded") return "orange" as const;
  if (status === "refunded") return "red" as const;
  if (status === "issued") return "blue" as const;
  if (status === "overdue") return "orange" as const;
  return "gray" as const;
}
