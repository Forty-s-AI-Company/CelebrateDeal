import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PolicyDocument } from "@/components/public-policy";
import { publicPolicies, resolvePublicPolicy } from "@/lib/public-policy-content";

// 生效狀態依台灣時間的日期在轉譯時判斷。F-156 起 root layout 讀取每次請求的 CSP nonce，
// 所有頁面都是動態渲染，這裡的 revalidate 與 generateStaticParams 目前沒有作用（每次請求都重新判斷）；
// 保留是為了日後若改用不需 nonce 的靜態政策頁時仍維持每小時更新的契約。
export const revalidate = 3600;

function resolvePolicy(slug: string) {
  return Object.hasOwn(publicPolicies, slug) ? publicPolicies[slug] : undefined;
}

export function generateStaticParams() {
  return Object.keys(publicPolicies).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const policy = resolvePolicy(slug);
  return policy ? { title: `${policy.title} | CelebrateDeal`, description: policy.summary } : {};
}

export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const policy = resolvePolicy(slug);
  if (!policy) notFound();
  return <PolicyDocument policy={resolvePublicPolicy(policy)} />;
}
