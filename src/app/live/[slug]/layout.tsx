export default function PublicLiveLayout({
  children,
  checkout,
}: {
  children: React.ReactNode;
  checkout: React.ReactNode;
}) {
  return (
    <>
      {children}
      {checkout}
    </>
  );
}
