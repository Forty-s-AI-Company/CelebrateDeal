import { SettingsBackLink } from "@/components/settings-back-link";

export default function BillingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SettingsBackLink />
      {children}
    </>
  );
}
