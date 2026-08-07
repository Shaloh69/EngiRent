"use client";

import { Badge } from "@mantine/core";
import { roleColor } from "@/app/theme";

// Every status string the console renders maps to a semantic role here, so
// status colors stay consistent across pages and survive a palette change.
// Anything unmapped falls back to gray rather than silently picking
// Mantine's default primary, which would read as a brand-colored status.
const STATUS_ROLE: Record<string, string> = {
  // Rentals
  PENDING: roleColor.warning,
  AWAITING_DEPOSIT: roleColor.warning,
  DEPOSITED: roleColor.accent,
  ACTIVE: roleColor.success,
  VERIFICATION: roleColor.cta,
  COMPLETED: roleColor.brand,
  CANCELLED: roleColor.critical,
  DISPUTED: roleColor.critical,
  OVERDUE: roleColor.critical,
  // Transactions
  PROCESSING: roleColor.warning,
  FAILED: roleColor.critical,
  REFUNDED: roleColor.accent,
  // Verifications
  APPROVED: roleColor.success,
  RETRY: roleColor.warning,
  REJECTED: roleColor.critical,
  // Generic
  ONLINE: roleColor.success,
  OFFLINE: roleColor.critical,
  ACTIVE_USER: roleColor.success,
};

export function StatusBadge({
  status,
  variant = "light",
}: {
  status: string;
  variant?: string;
}) {
  const label = status.replace(/_/g, " ");
  return (
    <Badge color={STATUS_ROLE[status] ?? "gray"} variant={variant} tt="capitalize">
      {label.toLowerCase()}
    </Badge>
  );
}
