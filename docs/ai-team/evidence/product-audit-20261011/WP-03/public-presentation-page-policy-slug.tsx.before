import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PolicyDocument } from "@/components/public-policy";
import { policyDrafts } from "@/lib/public-policy-content";

export function generateStaticParams() {
  return Object.keys(policyDrafts).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const draft = policyDrafts[slug];
  return draft ? { title: `${draft.title} | CelebrateDeal`, description: draft.summary } : {};
}

export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const draft = policyDrafts[slug];
  if (!draft) notFound();
  return <PolicyDocument draft={draft} />;
}
