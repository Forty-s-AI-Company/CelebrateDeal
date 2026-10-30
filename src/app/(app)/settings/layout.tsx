import { SettingsBackLink } from "@/components/settings-back-link";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SettingsBackLink />
      {children}
    </>
  );
}
