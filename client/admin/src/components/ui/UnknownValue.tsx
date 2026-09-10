import { Text } from "@mantine/core";
import type { ReactNode } from "react";

/**
 * D-38's primitive: **unknown is not zero.**
 *
 * The console used to initialise every counter to `0` and leave it there when
 * the fetch failed, so a dead API rendered *"Unable to load dashboard data."*
 * directly above **TOTAL USERS 0 · TOTAL ITEMS 0 · REVENUE ₱0**. Two
 * contradictory claims at once, and the numbers were the more believable of
 * the two — a quiet pilot really might have low counts, so an admin had no way
 * to tell a dead API from a slow week.
 *
 * This is deliberately ONE primitive rather than sixteen page-level patches:
 * 16 page components call `setError` in a catch, and the defaulted-state shape
 * runs through all of them. The list pages have the same bug in words rather
 * than digits — "No rentals found" is not "there are none", it is "we could
 * not ask".
 *
 * Use `null` for *not known* and a number for *known, possibly zero*. A real
 * zero still renders as `0`, because "no pending verifications" is a true and
 * useful statement; only the absence of an answer becomes an em-dash.
 */

/** Rendered when a value is genuinely unknown. */
export function Unknown({ label = "Not available" }: { label?: string }) {
  return (
    <Text
      component="span"
      c="dimmed"
      aria-label={label}
      // An em-dash reads as "no answer" to a sighted user; the aria-label is
      // what a screen reader gets, because "—" announces as nothing useful.
      title={label}
    >
      —
    </Text>
  );
}

/**
 * Renders `value` through `format`, or an em-dash when it is null/undefined.
 *
 * `format` exists so a currency or percentage keeps its formatting on the
 * known path without every caller re-implementing the null check and getting
 * it subtly different.
 */
export function StatValue<T>({
  value,
  format,
  label,
}: {
  value: T | null | undefined;
  format?: (v: T) => ReactNode;
  label?: string;
}) {
  if (value === null || value === undefined) return <Unknown label={label} />;
  return <>{format ? format(value) : String(value)}</>;
}

/**
 * For list/table bodies. Distinguishes the three states a table can be in,
 * which the console previously collapsed into two.
 *
 * `unknown` is the one that was missing: rows are not empty, they are
 * *unavailable*, and saying "No X found" in that case is a false claim.
 */
export function tableStateMessage(opts: {
  loading: boolean;
  failed: boolean;
  count: number;
  noun: string;
}): string | null {
  const { loading, failed, count, noun } = opts;
  if (loading) return `Loading ${noun}…`;
  if (failed) return `Could not load ${noun}. This is not the same as there being none.`;
  if (count === 0) return `No ${noun} found.`;
  return null;
}
