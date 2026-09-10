"use client";

import { Badge, Tooltip } from "@mantine/core";
import { roleColor } from "@/app/theme";
import type { ConnectionState } from "@/lib/adminSocket";

/**
 * Whether this console is actually receiving live updates — E2.2 / D-4.
 *
 * `ENGIRENT-CLAUDE.md` §1 names a connection-state indicator as one of the
 * justified additions, and E0's register found it was the one genuinely
 * missing item among the template rows.
 *
 * It exists because of a specific failure this system is prone to: a socket
 * pointed at a rotated Cloudflare hostname looks *exactly* like a quiet
 * period with no activity (D-4's real cause, and the same root as D-17 and
 * D-20). An admin watching a queue has no way to tell "nothing has happened"
 * from "nothing can reach me" — so the console has to say which.
 *
 * Each state is a distinct, checkable claim rather than a traffic light:
 * `live` means connected AND the server accepted the room join, which is the
 * only state in which a queue can be trusted to update itself.
 */
const PRESENTATION: Record<
  ConnectionState,
  { label: string; color: string; tooltip: string }
> = {
  live: {
    label: "Live",
    color: roleColor.success,
    tooltip: "Connected and subscribed — queues update themselves.",
  },
  // D-50: both of these were roleColor.warning. They are IN-PROGRESS states,
  // not warnings, and tokens.json already maps that meaning to `review`
  // (PROCESSING, AWAITING_CONFIRMATION and PENDING all resolve to it). E3.1's
  // ruling is explicit that a pending state must never read as
  // warning-yellow: an amber "Connecting…" tells an admin something is WRONG
  // when the system is merely WORKING, which is the one thing this indicator
  // exists to stop it doing. Cyan-teal here means the same thing it means on a
  // PENDING chip anywhere else in the product.
  connected: {
    label: "Connecting…",
    color: roleColor.review,
    tooltip: "Socket is up; waiting for the server to accept the subscription.",
  },
  connecting: {
    label: "Connecting…",
    color: roleColor.review,
    tooltip: "Opening the live connection.",
  },
  offline: {
    label: "Not live",
    color: roleColor.critical,
    tooltip:
      "No live connection. Queues show what was loaded when the page opened — reload to see current data. If this persists, the API tunnel hostname has probably rotated.",
  },
  unauthorized: {
    label: "Not subscribed",
    color: roleColor.critical,
    tooltip:
      "Connected, but the server refused the live subscription — this account is not staff, or its session predates a role change. Sign out and back in.",
  },
};

export function ConnectionIndicator({ state }: { state: ConnectionState }) {
  const { label, color, tooltip } = PRESENTATION[state];
  return (
    <Tooltip label={tooltip} multiline w={260} withArrow>
      <Badge color={color} variant="light" size="sm" radius="sm">
        {label}
      </Badge>
    </Tooltip>
  );
}
