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
        mobile && isActive && "border-blue-400/40 bg-blue-500/20 text-white",
        mobile && !isActive && "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white",
        !mobile && isActive && "bg-white/[0.09] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]",
        !mobile && !isActive && "text-slate-400 hover:bg-white/[0.06] hover:text-slate-100",
      )}
    >
      {!mobile && isActive ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-blue-400" aria-hidden="true" /> : null}
      {children}
    </Link>
  );
}
