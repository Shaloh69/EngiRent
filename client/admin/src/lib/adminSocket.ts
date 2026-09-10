"use client";

import { io, Socket } from "socket.io-client";

/**
 * The admin console's socket.io client — E2.2 / D-4.
 *
 * Until now the console had **no socket client at all**. E0's audit found it
 * consumed kiosk telemetry only through raw SSE `fetch` on two hardware pages,
 * which is why its queues — disputes, verifications, feedback — never
 * live-updated by any means. That, not unconsumed events on the phone, is the
 * real content of D-4 on this surface: the Flutter app already subscribes to
 * all 13 events aimed at it.
 *
 * One connection for the whole console, deliberately outside the component
 * tree (`ENGIRENT-CLAUDE.md` §7: data fetching lives outside the component
 * tree so a screen can be thrown away and rebuilt without touching network
 * code). Pages subscribe through `useAdminSocket`.
 */

export type ConnectionState =
  | "connecting"
  | "live" // connected AND joined the admin room
  | "connected" // connected but the room join has not come back yet
  | "offline"
  | "unauthorized"; // connected, but the server refused the room join

type Listener = (event: string, payload: unknown) => void;

const SOCKET_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1"
).replace(/\/api\/v1\/?$/, "");

/**
 * Events the server sends to the admin room.
 *
 * D-37 (ruled option (b), executed 2026-09-10): the four `admin:kiosk_*`
 * events are GONE from this list and from the server. The console had two
 * independent live channels carrying the same kiosk telemetry -- this socket
 * and the raw SSE stream at /admin/kiosks/events -- and neither knew about the
 * other. SSE won because health/page.tsx and kiosk/page.tsx already read it and
 * nothing read the socket copies: they were declared here and consumed by no
 * component, which is why the duplication was invisible.
 *
 * The socket's real job is the QUEUE events below. Do not add kiosk telemetry
 * back here; it belongs on the SSE stream.
 */
export const ADMIN_EVENTS = [
  "admin:verification_submitted",
  "admin:feedback_new",
  "admin:dispute_opened",
] as const;

let socket: Socket | null = null;
let state: ConnectionState = "offline";
const listeners = new Set<Listener>();
const stateListeners = new Set<(s: ConnectionState) => void>();

function setState(next: ConnectionState) {
  if (state === next) return;
  state = next;
  stateListeners.forEach((fn) => fn(next));
}

export function getConnectionState(): ConnectionState {
  return state;
}

export function onConnectionState(fn: (s: ConnectionState) => void): () => void {
  stateListeners.add(fn);
  fn(state);
  return () => stateListeners.delete(fn);
}

export function onAdminEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Connect once and join the admin room.
 *
 * The token is sent in the handshake `auth` payload, which is what the
 * server's `io.use()` middleware reads to set `kind: "user"` and the role.
 * The room join is server-gated on that role — this client asking to join
 * proves nothing, which is the point.
 */
export function connectAdminSocket(): void {
  if (typeof window === "undefined") return;
  const token = localStorage.getItem("admin_token");
  if (!token) return;
  if (socket?.connected) return;

  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
  }

  setState("connecting");
  socket = io(SOCKET_URL, {
    transports: ["websocket"],
    auth: { token },
    reconnection: true,
    reconnectionDelay: 3000,
  });

  socket.on("connect", () => {
    setState("connected");
    socket?.emit("admin:join");
  });

  // Sent by the server only after the role check passes. Without it, a
  // silent authorization failure is indistinguishable from a quiet period
  // with no kiosk activity — which is the failure mode this whole indicator
  // exists to make visible.
  socket.on("admin:joined", () => setState("live"));

  // The server says so explicitly rather than refusing in silence, so this
  // state is reachable and honest. It means the socket is up and the
  // subscription is not — a signed-in REVIEWER-less account, or a stale
  // token whose role changed since it was issued.
  socket.on("admin:join_refused", () => setState("unauthorized"));

  socket.on("disconnect", () => setState("offline"));
  socket.on("connect_error", () => setState("offline"));

  for (const event of ADMIN_EVENTS) {
    socket.on(event, (payload: unknown) => {
      listeners.forEach((fn) => fn(event, payload));
    });
  }
}

export function disconnectAdminSocket(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  setState("offline");
}
