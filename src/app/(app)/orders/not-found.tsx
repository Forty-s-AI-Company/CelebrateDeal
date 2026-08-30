import Link from "next/link";
import { Card } from "@/components/ui";

export default function OrderNotFound() {
  return (
    <Card className="mx-auto max-w-xl text-center">
      <h1 className="text-xl font-bold text-slate-950">找不到這筆訂單</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        這筆訂單不存在，或不屬於目前登入的商家。系統不會顯示其他商家的訂單資料。
      </p>
      <Link
        href="/orders"
        className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
      >
        返回訂單列表
      </Link>
    </Card>
  );
}
