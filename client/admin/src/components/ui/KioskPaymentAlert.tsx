"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { Banknote } from "lucide-react";
import api from "@/lib/api";
import { useAdminRefetch } from "@/lib/useAdminSocket";
import { DisputeListRow, pesoFmt } from "@/lib/disputes";

/**
 * Ruling 6 (2026-10-11): when PayMongo is unavailable the manual fallback needs
 * a person, NOW — a student is standing at the kiosk with the door locked until
 * someone confirms. So this sits in the shell, on every page, and is loud.
 *
 * Polled as well as pushed: the admin socket does not always reach the browser
 * through the Cloudflare tunnel (D-86), and a missed push here means a student
 * waiting ten minutes for nothing.
 */
export function KioskPaymentAlert() {
  const [waiting, setWaiting] = useState<DisputeListRow[]>([]);
  const [, setTick] = useState(0);

  const load = async () => {
    try {
      const res = await api.get("/admin/disputes");
      const rows: DisputeListRow[] = res.data.data?.disputes ?? [];
      setWaiting(rows.filter((r) => (r.visitExpiresAt && r.visitExpiresAt > Date.now()) || r.pendingTransaction));
    } catch {
      /* the page itself shows connection problems */
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      setTick((n) => n + 1);
      void load();
    }, 15_000);
    return () => clearInterval(t);
  }, []);

  useAdminRefetch(["admin:kiosk_payment_waiting", "admin:dispute_opened"], () => void load());

  if (waiting.length === 0) return null;
  return (
    <Stack gap="xs" mb="md">
      {waiting.map((w) => {
        const atKiosk = Boolean(w.visitExpiresAt && w.visitExpiresAt > Date.now());
        const manual = w.pendingTransaction?.paymentMethod?.startsWith("Manual");
        const left = atKiosk ? Math.max(0, Math.round(((w.visitExpiresAt as number) - Date.now()) / 1000)) : 0;
        return (
          <Alert
            key={w.id}
            color={atKiosk && manual ? "red" : "orange"}
            variant={atKiosk ? "filled" : "light"}
            icon={<Banknote size={18} />}
            title={
              atKiosk
                ? `Kiosk payment waiting: ${w.referenceNo} (${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left)`
                : `Payment to confirm: ${w.referenceNo}`
            }
          >
            <Group justify="space-between">
              <Text size="sm">
                {w.renter.firstName} {w.renter.lastName} ·{" "}
                {w.pendingTransaction
                  ? `${pesoFmt.format(w.pendingTransaction.amount)} via ${w.pendingTransaction.paymentMethod}${
                      manual ? ": PayMongo is unavailable, a person must confirm" : ": waiting for PayMongo"
                    }`
                  : `${pesoFmt.format(w.owed)} owed, not paid yet`}
              </Text>
              <Button component={Link} href={`/disputes/${w.id}`} size="xs" variant={atKiosk ? "white" : "light"} color={atKiosk ? "dark" : "orange"}>
                Open the case
              </Button>
            </Group>
          </Alert>
        );
      })}
    </Stack>
  );
}
