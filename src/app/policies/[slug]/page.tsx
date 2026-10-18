import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PolicyDocument } from "@/components/public-policy";
import { publicPolicies, resolvePublicPolicy } from "@/lib/public-policy-content";

// 生效狀態依台灣時間的日期在轉譯時判斷，每小時重新產生一次，生效日過後頁面會自動更新。
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
