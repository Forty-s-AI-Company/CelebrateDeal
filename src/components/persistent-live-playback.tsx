"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LivePageData } from "@/components/live-playback";

const PersistentLivePlayback = dynamic(
  () => import("@/components/live-playback").then(({ LivePlayback }) => LivePlayback),
  { ssr: false },
);

type PlaybackSession = {
  identity: string;
  live: LivePageData;
  allowedCheckoutPaths: ReadonlySet<string>;
};

type PersistentLivePlaybackContextValue = {
  activeIdentity: string | null;
  register: (live: LivePageData) => void;
};

const PersistentLivePlaybackContext = createContext<PersistentLivePlaybackContextValue | null>(null);

export function playbackIdentity(live: Pick<LivePageData, "vendorId" | "id">) {
  return `${live.vendorId}:${live.id}`;
}

function livePath(live: Pick<LivePageData, "slug">) {
  return `/live/${encodeURIComponent(live.slug)}`;
}

function checkoutPath(vendorId: string, productId: string) {
  return `/checkout/${encodeURIComponent(vendorId)}/${encodeURIComponent(productId)}`;
}

export function createPlaybackSession(live: LivePageData): PlaybackSession {
  return {
    identity: playbackIdentity(live),
    live,
    allowedCheckoutPaths: new Set(
      live.products
        .filter((product) => !product.checkoutUrl)
        .map((product) => checkoutPath(live.vendorId, product.id)),
    ),
  };
}

export function sessionMatchesPath(session: PlaybackSession, pathname: string | null) {
  return pathname === livePath(session.live) || Boolean(pathname && session.allowedCheckoutPaths.has(pathname));
}

export function PersistentLivePlaybackProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [session, setSession] = useState<PlaybackSession | null>(null);
  const register = useCallback((live: LivePageData) => {
    setSession((current) => (
      current?.identity === playbackIdentity(live) && current.live === live
        ? current
        : createPlaybackSession(live)
    ));
  }, []);
  const keepsPlayback = Boolean(session && sessionMatchesPath(session, pathname));
  const context = useMemo<PersistentLivePlaybackContextValue>(() => ({
    activeIdentity: keepsPlayback ? session?.identity ?? null : null,
    register,
  }), [keepsPlayback, register, session?.identity]);

  useEffect(() => {
    if (!session || keepsPlayback) return;
    const staleIdentity = session.identity;
    const timer = window.setTimeout(() => {
      setSession((current) => current?.identity === staleIdentity ? null : current);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [keepsPlayback, session]);

  return (
    <PersistentLivePlaybackContext.Provider value={context}>
      {session && keepsPlayback ? <PersistentLivePlayback key={session.identity} live={session.live} /> : null}
      {children}
    </PersistentLivePlaybackContext.Provider>
  );
}

export function PersistentLivePlaybackRegistration({ live }: { live: LivePageData }) {
  const context = useContext(PersistentLivePlaybackContext);
  const identity = playbackIdentity(live);
  const register = context?.register;

  useEffect(() => {
    register?.(live);
  }, [register, live]);

  if (context?.activeIdentity === identity) return null;
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white" data-testid="persistent-live-loading">
      <div role="status" className="max-w-sm rounded-3xl border border-white/15 bg-white/10 p-6 text-center shadow-2xl">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-white/60">{live.brand.name}</p>
        <h1 className="mt-3 text-2xl font-black">{live.title}</h1>
        <p className="mt-3 text-sm text-white/75">正在確認直播資格並載入播放器…</p>
      </div>
    </main>
  );
}
