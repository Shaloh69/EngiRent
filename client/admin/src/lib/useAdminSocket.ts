"use client";

import { useEffect, useRef, useState } from "react";
import {
  connectAdminSocket,
  getConnectionState,
  onAdminEvent,
  onConnectionState,
  type ConnectionState,
} from "./adminSocket";

/**
 * Subscribe this component to the admin socket — E2.2 / D-4.
 *
 * Connecting is idempotent, so every page calling this shares one socket
 * rather than opening its own. The socket module owns the connection; this is
 * only the React seam onto it, which is what keeps `ENGIRENT-CLAUDE.md` §7's
 * redo rule true — a page can be deleted and rebuilt without touching any
 * networking code.
 */
export function useAdminSocket(
  onEvent?: (event: string, payload: unknown) => void,
): ConnectionState {
  const [state, setState] = useState<ConnectionState>(getConnectionState);

  // Kept in a ref so a caller passing an inline arrow — which every caller
  // will — does not tear down and re-add the listener on every render.
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    connectAdminSocket();
    const offState = onConnectionState(setState);
    const offEvent = onAdminEvent((event, payload) => {
      handler.current?.(event, payload);
    });
    return () => {
      offState();
      offEvent();
    };
  }, []);

  return state;
}

/**
 * Refetch when any of `events` arrives.
 *
 * The payloads deliberately carry ids and timestamps rather than whole
 * records, so a queue page re-runs its own authenticated fetch instead of
 * patching a row together from socket data. That keeps the server the single
 * source of truth for what a queue contains, and means a missed event costs
 * one stale render rather than a permanently wrong list.
 */
export function useAdminRefetch(
  events: readonly string[],
  refetch: () => void,
): ConnectionState {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  return useAdminSocket((event) => {
    if (events.includes(event)) refetchRef.current();
  });
}
