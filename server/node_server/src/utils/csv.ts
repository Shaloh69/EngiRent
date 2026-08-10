import { Response } from "express";

/** Quotes a CSV field only when it actually needs it (contains a comma,
 * quote, or newline) — matches how the existing report CSV in
 * adminController.ts already quotes titles, kept consistent here. */
function csvField(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Checklist Stage 9 admin gap — "no CSV for a thesis defence or an audit."
 * Generic enough for any list endpoint: pass the column headers, and a
 * mapper from one row to an array of cell values in the same order.
 */
export function sendCsv<T>(
  res: Response,
  filenamePrefix: string,
  columns: string[],
  rows: T[],
  toRow: (row: T) => unknown[],
): void {
  const lines = [
    columns.map(csvField).join(","),
    ...rows.map((r) => toRow(r).map(csvField).join(",")),
  ];
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  res.send(lines.join("\n"));
}
