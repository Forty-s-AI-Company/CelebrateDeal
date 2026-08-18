"use client";

import {
  ANNOUNCEMENT_FEED,
  formatAnnouncementDate,
  getLocalDate,
  readSuppression,
  sortAnnouncements,
  writeSuppression,
  type Announcement,
} from "@/lib/announcement-feed";
import { useEffect, useMemo, useRef, useState } from "react";

const SECTION_DEFINITIONS = [
  ["completed", "已完成", "已完成項目"],
  ["incomplete", "未完成", "仍待完成／驗證"],
  ["changes", "變更", "這次公告帶來的變更"],
  ["nextSteps", "下一步", "接下來的工作"],
] as const satisfies readonly [keyof Announcement, string, string][];

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), a[href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])",
    ),
  );
}

function getBrowserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getRestorableActiveElement() {
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLElement
    && activeElement !== document.body
    && activeElement !== document.documentElement
    ? activeElement
    : null;
}

function hasExistingDialog() {
  return Boolean(document.querySelector('[role="dialog"]'));
}

function AnnouncementProgress({ announcement }: { announcement: Announcement }) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-label={`完成進度 ${announcement.progressPercent}%`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={announcement.progressPercent}
      >
        <div
          className="h-full rounded-full bg-blue-600 transition-[width] motion-reduce:transition-none"
          style={{ width: `${announcement.progressPercent}%` }}
        />
      </div>
      <span className="shrink-0 text-sm font-semibold text-slate-700">
        {announcement.progressPercent}%
      </span>
    </div>
  );
}

function AnnouncementSections({ announcement }: { announcement: Announcement }) {
  return (
    <table className="w-full border-separate border-spacing-0 text-left text-sm">
      <thead className="hidden bg-slate-100 text-xs uppercase tracking-wide text-slate-600 md:table-header-group">
        <tr>
          <th className="w-44 border-b border-slate-200 px-4 py-3 font-semibold" scope="col">區段</th>
          <th className="border-b border-slate-200 px-4 py-3 font-semibold" scope="col">內容</th>
        </tr>
      </thead>
      <tbody className="block md:table-row-group">
        {SECTION_DEFINITIONS.map(([key, label, description]) => (
          <tr
            className="mb-3 block overflow-hidden rounded-xl border border-slate-200 bg-white last:mb-0 md:mb-0 md:table-row md:rounded-none md:border-0"
            data-testid={`announcement-section-${key}`}
            key={key}
          >
            <th
              className="block border-b border-slate-200 bg-slate-50 px-4 py-3 align-top font-semibold text-slate-900 md:table-cell md:border-b md:px-4 md:py-4"
              scope="row"
            >
              <span className="block">{label}</span>
              <span className="mt-1 block text-xs font-normal text-slate-500">{description}</span>
            </th>
            <td className="block px-4 py-3 align-top text-slate-700 md:table-cell md:border-b md:border-slate-200 md:px-4 md:py-4">
              <ul className="space-y-2">
                {announcement[key].map((item) => <li key={item}>{item}</li>)}
              </ul>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AnnouncementCenter({ feed = ANNOUNCEMENT_FEED }: { feed?: readonly Announcement[] } = {}) {
  const announcements = useMemo(() => sortAnnouncements(feed), [feed]);
  const latestAnnouncement = announcements[0];
  const latestVersion = latestAnnouncement?.version;
  const [isOpen, setIsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(latestAnnouncement?.id ?? null);
  const [suppressOnClose, setSuppressOnClose] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const autoOpenEvaluatedVersionsRef = useRef(new Set<string>());
  const focusRestoreTimerRef = useRef<number | null>(null);

  const cancelPendingFocusRestore = () => {
    if (focusRestoreTimerRef.current === null) return;
    window.clearTimeout(focusRestoreTimerRef.current);
    focusRestoreTimerRef.current = null;
  };

  const openCenter = () => {
    if (hasExistingDialog()) return;
    cancelPendingFocusRestore();
    lastFocusedRef.current = getRestorableActiveElement();
    setSuppressOnClose(false);
    setSelectedId(latestAnnouncement?.id ?? null);
    setIsOpen(true);
  };

  const closeCenter = () => {
    if (suppressOnClose && latestAnnouncement) {
      writeSuppression(
        getBrowserStorage(),
        latestAnnouncement.version,
        getLocalDate(),
      );
    }
    setIsOpen(false);
  };

  useEffect(() => {
    const evaluatedVersions = autoOpenEvaluatedVersionsRef.current;
    if (!latestVersion || evaluatedVersions.has(latestVersion)) return;
    evaluatedVersions.add(latestVersion);
    const localDate = getLocalDate();
    if (!readSuppression(getBrowserStorage(), latestVersion, localDate)) return;
    if (hasExistingDialog()) return;

    lastFocusedRef.current = getRestorableActiveElement();
    let timerFired = false;
    const openTimer = window.setTimeout(() => {
      timerFired = true;
      if (hasExistingDialog()) return;
      setIsOpen(true);
    }, 0);
    return () => {
      window.clearTimeout(openTimer);
      if (!timerFired) evaluatedVersions.delete(latestVersion);
    };
  }, [latestVersion]);

  useEffect(() => {
    if (!isOpen || !dialogRef.current) return;

    const previousOverflow = document.body.style.overflow;
    const launcher = launcherRef.current;
    const focusRestoreTimer = focusRestoreTimerRef;
    document.body.style.overflow = "hidden";
    cancelPendingFocusRestore();
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      const previousFocus = lastFocusedRef.current;
      focusRestoreTimer.current = window.setTimeout(() => {
        focusRestoreTimer.current = null;
        const focusTarget = previousFocus?.isConnected ? previousFocus : launcher;
        if (focusTarget?.isConnected) focusTarget.focus();
      }, 0);
    };
  }, [isOpen]);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCenter();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;

    const focusableElements = getFocusableElements(dialogRef.current);
    if (focusableElements.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (!firstElement || !lastElement) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  const selectedAnnouncement = announcements.find(({ id }) => id === selectedId) ?? latestAnnouncement;

  return (
    <>
      <button
        aria-label="開啟最新消息"
        className="fixed bottom-4 right-4 z-[90] inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-4 text-sm font-semibold text-white shadow-lg transition hover:bg-slate-700 focus-visible:outline-4 focus-visible:outline-blue-500 motion-reduce:transition-none"
        data-testid="announcement-center-launcher"
        onClick={openCenter}
        ref={launcherRef}
        type="button"
      >
        最新消息
      </button>

      {isOpen && selectedAnnouncement ? (
        <div
          className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/60 p-4 sm:p-6"
          data-testid="announcement-center-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCenter();
          }}
        >
          <div
            aria-describedby="announcement-center-description"
            aria-labelledby="announcement-center-title"
            aria-modal="true"
            className="mx-auto my-2 flex max-h-[calc(100dvh-1rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none sm:my-6 sm:max-h-[calc(100dvh-3rem)]"
            onKeyDown={handleDialogKeyDown}
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-7">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">CelebrateDeal</p>
                <h2 className="mt-1 text-xl font-bold text-slate-950 sm:text-2xl" id="announcement-center-title">
                  進站最新消息
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600" id="announcement-center-description">
                  這裡整理目前 Goal 的實際進度，未驗證的工作會明確保留在待完成區。
                </p>
              </div>
              <button
                aria-label="關閉最新消息"
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-2xl leading-none text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 motion-reduce:transition-none"
                data-testid="announcement-center-close"
                onClick={closeCenter}
                ref={closeButtonRef}
                type="button"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <div className="grid min-h-0 overflow-y-auto md:grid-cols-[minmax(13rem,0.8fr)_minmax(0,1.8fr)]" data-testid="announcement-center-content">
              <nav aria-label="公告列表" className="border-b border-slate-200 bg-slate-50 p-4 md:border-b-0 md:border-r md:p-5">
                <h3 className="sr-only">公告列表</h3>
                <ul className="space-y-3">
                  {announcements.map((announcement) => (
                    <li key={announcement.id}>
                      <button
                        aria-current={announcement.id === selectedAnnouncement.id ? "true" : undefined}
                        className={`min-h-11 w-full rounded-xl border p-4 text-left transition motion-reduce:transition-none ${announcement.id === selectedAnnouncement.id ? "border-blue-600 bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:border-blue-300"}`}
                        onClick={() => setSelectedId(announcement.id)}
                        type="button"
                      >
                        <span className="block text-xs font-medium text-slate-600">
                          {formatAnnouncementDate(announcement.publishedAt)}
                        </span>
                        <span className="mt-1 block font-semibold text-slate-950">{announcement.title}</span>
                        <span className="mt-1 block text-sm leading-5 text-slate-600">{announcement.summary}</span>
                        <span className="mt-2 block text-xs font-semibold text-blue-700">進度 {announcement.progressPercent}%</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>

              <article className="min-w-0 p-5 sm:p-7">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-500">{formatAnnouncementDate(selectedAnnouncement.publishedAt)}</p>
                    <h3 className="mt-1 text-2xl font-bold text-slate-950">{selectedAnnouncement.title}</h3>
                    <p className="mt-2 text-base leading-7 text-slate-700">{selectedAnnouncement.summary}</p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-bold text-blue-800">v{selectedAnnouncement.version}</span>
                </div>

                <AnnouncementProgress announcement={selectedAnnouncement} />
                <div className="mt-6">
                  <AnnouncementSections announcement={selectedAnnouncement} />
                </div>
              </article>
            </div>

            <div className="flex flex-col gap-4 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-slate-700">
                <input
                  checked={suppressOnClose}
                  className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500"
                  data-testid="announcement-center-suppress"
                  onChange={(event) => setSuppressOnClose(event.target.checked)}
                  type="checkbox"
                />
                今日不再提醒
              </label>
              <p className="text-xs leading-5 text-slate-500">關閉後才會保存今日抑制設定；手動點擊「最新消息」仍可查看。</p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
