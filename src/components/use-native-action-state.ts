"use client";

import { useState, type FormEvent } from "react";

export type NativeActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const FALLBACK_ERROR_MESSAGE = "操作未完成，請稍後再試一次。";

export function selectNativeTransport<T>(endpoint: string | undefined, nativeValue: T, fallbackValue: T): T {
  return endpoint ? nativeValue : fallbackValue;
}

function isActionState(value: unknown): value is NativeActionState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.status === "idle" || candidate.status === "success" || candidate.status === "error") &&
    typeof candidate.message === "string"
  );
}

function fallbackError<State extends NativeActionState>(initialState: State): State {
  return { ...initialState, status: "error", message: FALLBACK_ERROR_MESSAGE };
}

/**
 * Sends a form to a same-origin route while keeping the Server Action form
 * action as the no-JavaScript fallback. The response is deliberately reduced
 * to the public action-state shape so provider or network errors never reach
 * the rendered UI or browser logs.
 */
export function useNativeActionState<State extends NativeActionState>(initialState: State, endpoint?: string) {
  const [state, setState] = useState<State>(initialState);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!endpoint || pending) return null;

    setPending(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: new FormData(event.currentTarget),
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload: unknown = await response.json().catch(() => null);
      const nextState = isActionState(payload) ? payload as State : fallbackError(initialState);
      setState(nextState);
      return nextState;
    } catch {
      const nextState = fallbackError(initialState);
      setState(nextState);
      return nextState;
    } finally {
      setPending(false);
    }
  }

  return { state, pending, submit };
}
