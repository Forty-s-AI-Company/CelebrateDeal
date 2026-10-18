import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PolicyDocument } from "@/components/public-policy";
import { publicPolicies } from "@/lib/public-policy-content";

// Only the registered policy pages exist; reject unknown routes before streaming.
export const dynamicParams = false;

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
  return <PolicyDocument policy={policy} />;
}
