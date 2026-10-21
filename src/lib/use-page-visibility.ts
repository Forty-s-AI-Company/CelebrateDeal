"use client";

import { useSyncExternalStore } from "react";

/**
 * Page Visibility gate for viewer polling (F-091 / B06-05). Hidden tabs stop
 * their chat and interaction polls; effects keyed on this value restart and
 * fetch immediately when the tab returns to the foreground.
 */
export function isPageVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function subscribe(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

// The server render (and hydration) assumes a visible page.
const serverSnapshot = () => true;

export function usePageVisible() {
  return useSyncExternalStore(subscribe, isPageVisible, serverSnapshot);
}
