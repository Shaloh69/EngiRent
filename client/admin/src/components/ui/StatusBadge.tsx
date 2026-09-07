"use client";

import { Badge, useMantineColorScheme } from "@mantine/core";
import { statusChipStyle, statusRole } from "@/app/theme";

/**
 * One status chip, one meaning — and as of E3.1 the meaning is not decided
 * here. The status→role table lives in design/tokens/tokens.json and is
 * generated into every surface, so a rental that reads "pending" in this
 * console is the same colour in the Flutter app and on the kiosk.
 *
 * What changed for a reader of this file:
 *   - The local STATUS_ROLE map is gone. It disagreed with the app's, which is
 *     the drift the token source exists to remove.
 *   - PENDING / AWAITING_DEPOSIT / PROCESSING were warning-yellow and are now
 *     the cyan-teal `review` family. "PENDING is never red or warning-yellow"
 *     (E3.1) — a queue waiting on a human is not a fault.
 *   - VERIFICATION was coral, which is the CTA colour. A status should never
 *     borrow the colour that means "press this".
 *   - COMPLETED was brand blue and is now success, matching the other surfaces.
 *
 * WHY THIS SETS COLOURS EXPLICITLY instead of using Mantine's `variant="light"`
 * — measured, not assumed. Mantine's soft variant paints the colour's shade 6
 * as text over a 10% wash of itself. On this palette that gave:
 *
 *     success  2.45:1     warning  2.27:1     accent  2.34:1
 *     review   3.59:1     critical 3.72:1
 *
 * i.e. 25 of 28 chips on the reference screen under the 4.5:1 text floor. That
 * was true before E3.1 too — it is a pre-existing defect, not a regression —
 * but the token source carries fill/ink pairs computed to clear 4.5:1, so the
 * fix is to use them rather than to let a library derive the pair.
 *
 * An unrecognised status gets the muted pair: it must not assert a meaning the
 * system does not have, and it must not fall through to Mantine's primary,
 * which would render an unknown state in brand colour as if it were real.
 */
export function StatusBadge({ status }: { status: string }) {
  const { colorScheme } = useMantineColorScheme();
  // `colorScheme` can be "auto"; the chip table only has real resolutions.
  const scheme = colorScheme === "dark" ? "dark" : "light";
  const { fill, ink, border } = statusChipStyle(status, scheme);
  const label = status.replace(/_/g, " ").toLowerCase();

  return (
    <Badge
      variant="filled"
      tt="capitalize"
      styles={{
        root: {
          backgroundColor: fill,
          color: ink,
          border: `1px solid ${border}`,
        },
      }}
    >
      {label}
    </Badge>
  );
}

/** Exported so a page can check whether a status is one the design system
 *  actually knows about, rather than discovering it rendered as muted. */
export function isKnownStatus(status: string): boolean {
  return status.toUpperCase() in statusRole;
}
