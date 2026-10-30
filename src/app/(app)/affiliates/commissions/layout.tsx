import { SettingsBackLink } from "@/components/settings-back-link";

export default function CommissionsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SettingsBackLink />
      {children}
    </>
  );
}
