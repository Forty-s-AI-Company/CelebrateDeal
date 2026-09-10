"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

export function AppShellNavLink({
  href,
  children,
  mobile = false,
}: {
  href: string;
  children: React.ReactNode;
  mobile?: boolean;
}) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== "/dashboard" && Boolean(pathname?.startsWith(`${href}/`)));

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={clsx(
        "group relative flex min-h-10 items-center gap-3 text-sm font-medium transition-colors duration-150",
        mobile
          ? "shrink-0 rounded-full border px-4 py-2"
          : "rounded-lg px-3 py-2",
        mobile && isActive && "border-blue-200 bg-blue-50 text-blue-700",
        mobile && !isActive && "border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-950",
        !mobile && isActive && "bg-blue-50 text-blue-700 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.08)]",
        !mobile && !isActive && "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
      )}
    >
      {!mobile && isActive ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-blue-600" aria-hidden="true" /> : null}
      {children}
    </Link>
  );
}
