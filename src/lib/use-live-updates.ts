"use client";

import { useEffect, useRef } from "react";

import {
  subscribeLiveUpdates,
  type LiveUpdatesPayload,
  type LiveUpdatesStatus,
} from "@/lib/live-updates-client";
import { usePageVisible } from "@/lib/use-page-visibility";

/**
 * Subscribes a viewer component to the shared `/api/live-updates` poll
 * (F-091 (2)). A hidden tab unsubscribes, which stops the poll when nobody
 * else is listening; returning to the foreground subscribes again and
 * fetches at once, as the per-component gates did in #461.
 */
export function useLiveUpdates(options: {
  vendorId: string;
  liveId: string;
  enabled: boolean;
  chat?: boolean;
  interactions?: boolean;
  onUpdate: (payload: LiveUpdatesPayload) => void;
  onStatus?: (status: LiveUpdatesStatus) => void;
}) {
  const { vendorId, liveId, enabled, chat = false, interactions = false } = options;
  const pageVisible = usePageVisible();
  const handlers = useRef({ onUpdate: options.onUpdate, onStatus: options.onStatus });
  useEffect(() => {
    handlers.current = { onUpdate: options.onUpdate, onStatus: options.onStatus };
  });

  useEffect(() => {
    if (!enabled || !pageVisible || (!chat && !interactions)) return;
    return subscribeLiveUpdates({ vendorId, liveId }, {
      include: { chat, interactions },
      onUpdate: (payload) => handlers.current.onUpdate(payload),
      onStatus: (status) => handlers.current.onStatus?.(status),
    });
  }, [chat, enabled, interactions, liveId, pageVisible, vendorId]);
}
