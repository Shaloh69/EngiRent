"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, Group, NumberInput, SimpleGrid, Text, ThemeIcon, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { AlertCircle, Percent, Save } from "lucide-react";
import api from "@/lib/api";
import { roleColor } from "@/app/theme";

interface Fees {
  platformFeePct: number;
  serviceFee: number;
}

const php = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 }).format(n);

/** What a renter pays for an item priced `perDay`, for `days` days (mirrors server/services/pricing.ts). */
export function previewFor(perDay: number, days: number, f: Fees) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const rent = r2(perDay * days);
  const platform = r2((rent * f.platformFeePct) / 100);
  return { shownPerDay: r2(perDay * (1 + f.platformFeePct / 100)), total: r2(rent + platform + f.serviceFee) };
}

/**
 * Renter fees (user ruling 2026-10-21): the platform % (inside the daily price
 * students see) and the service fee (once per rental; pays the PayMongo payout
 * transfer). GET/PUT /admin/fees. New bookings only.
 */
export default function RenterFeesCard() {
  const [fees, setFees] = useState<Fees | null>(null);
  const [limits, setLimits] = useState({ maxPlatformFeePct: 20, maxServiceFee: 100 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/admin/fees")
      .then((res) => {
        setFees(res.data.data.fees);
        setLimits(res.data.data.limits);
      })
      .catch(() => setError("Could not load the current fees."));
  }, []);

  const save = async () => {
    if (!fees) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.put("/admin/fees", fees);
      setFees(res.data.data.fees);
      notifications.show({ color: "green", title: "Fees saved", message: "They apply to new bookings. Existing bookings keep their price." });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? "Could not save the fees.");
    } finally {
      setSaving(false);
    }
  };

  const one = fees ? previewFor(100, 1, fees) : null;
  const three = fees ? previewFor(100, 3, fees) : null;

  return (
    <Card withBorder radius="md" padding="lg">
      <Group justify="space-between" wrap="wrap" mb="md">
        <Group gap="sm">
          <ThemeIcon size={38} radius="md" variant="light" color={roleColor.brand}>
            <Percent size={19} />
          </ThemeIcon>
          <div>
            <Title order={3} size="h5">
              Renter Fees
            </Title>
            <Text size="xs" c="dimmed">
              Added to what renters pay. The owner always receives their own price. New bookings only.
            </Text>
          </div>
        </Group>
        <Button leftSection={<Save size={16} />} onClick={save} loading={saving} disabled={!fees}>
          Save fees
        </Button>
      </Group>

      {error && (
        <Alert icon={<AlertCircle size={16} />} color={roleColor.critical} variant="light" mb="md">
          {error}
        </Alert>
      )}

      {fees && (
        <>
          <SimpleGrid cols={{ base: 1, sm: 2 }} mb="md">
            <NumberInput
              label="Platform fee (%)"
              description="EngiRent's share, included in the daily price students see."
              value={fees.platformFeePct}
              min={0}
              max={limits.maxPlatformFeePct}
              step={0.5}
              decimalScale={2}
              onChange={(v) => setFees({ ...fees, platformFeePct: Number(v) || 0 })}
            />
            <NumberInput
              label="Service fee (₱, once per rental)"
              description="Pays the PayMongo transfer that sends the owner their money."
              value={fees.serviceFee}
              min={0}
              max={limits.maxServiceFee}
              step={1}
              decimalScale={2}
              prefix="₱"
              onChange={(v) => setFees({ ...fees, serviceFee: Number(v) || 0 })}
            />
          </SimpleGrid>
          {one && three && (
            <Text size="sm" c="dimmed">
              Example, an item priced ₱100/day: students see <b>{php(one.shownPerDay)}/day + {php(fees.serviceFee)} service fee</b>.
              1 day costs <b>{php(one.total)}</b>; 3 days cost <b>{php(three.total)}</b>. The owner receives ₱100 per day.
            </Text>
          )}
        </>
      )}
    </Card>
  );
}
