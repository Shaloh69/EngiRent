"use client";

/**
 * E3 design reference — admin surface.
 *
 * The phase's definition of done requires "a reference screen per surface that
 * renders every token and every status state". This is that screen for the
 * admin console, and it exists for two practical reasons beyond the checklist:
 *
 *  1. It is the only place the whole system is visible at once, so a token
 *     change can be looked at rather than reasoned about. This project's rule
 *     is that a green test is not a fix.
 *  2. It renders WITHOUT AdminLayout, therefore without the auth gate — so the
 *     palette can be verified on screen without an admin login, which is a
 *     credential the repo deliberately does not hold.
 *
 * Deliberately not linked from the console's navigation: it is a development
 * instrument, not a page for staff.
 */

import {
  Badge,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Button,
  useMantineColorScheme,
  Box,
} from "@mantine/core";
import { semantic, statusRole } from "../theme";
import { StatusBadge } from "@/components/ui/StatusBadge";

const ROLE_ORDER = [
  "brand",
  "onBrand",
  "success",
  "warning",
  "critical",
  "review",
  "accent",
  "cta",
  "brandInk",
  "successInk",
  "warningInk",
  "criticalInk",
  "reviewInk",
  "accentInk",
  "ctaInk",
  "appBg",
  "surface",
  "surfaceAlt",
  "border",
  "borderStrong",
  "textPrimary",
  "textSecondary",
  "textDisabled",
] as const;

// WCAG 2.1 relative luminance — duplicated from design/tokens/lib.mjs on
// purpose. That file is a build-time Node module; importing it into a client
// bundle to render a swatch label would drag the token toolchain into the
// shipped app for no benefit.
function luminance(hex: string) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const s = parseInt(h.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

export default function DesignReferencePage() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";
  const set = isDark ? semantic.dark : semantic.light;

  const statuses = Object.keys(statusRole);
  const byRole = (role: string) => statuses.filter((s) => statusRole[s as keyof typeof statusRole] === role);

  return (
    <Box p="xl" style={{ background: "var(--color-bg)", minHeight: "100vh" }}>
      <Stack gap="xl">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: 2 }}>
              E3 design foundation
            </Text>
            <Title order={1} size="h2">
              Token reference — admin
            </Title>
            <Text c="dimmed" size="sm" mt={4}>
              Generated from design/tokens/tokens.json. Rendering{" "}
              <strong>{isDark ? "dark" : "light"}</strong> resolution.
            </Text>
          </div>
          <Button variant="light" onClick={() => setColorScheme(isDark ? "light" : "dark")}>
            Switch to {isDark ? "light" : "dark"}
          </Button>
        </Group>

        {/* ── Semantic roles ─────────────────────────────────────────────── */}
        <Card withBorder radius="md" padding="lg">
          <Text fw={700} mb="md">
            Semantic roles ({ROLE_ORDER.length}) — with contrast against this
            theme&apos;s page ground
          </Text>
          <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }}>
            {ROLE_ORDER.map((role) => {
              const hex = (set as Record<string, string>)[role];
              if (!hex) return null;
              const ratio = contrast(hex, set.appBg);
              return (
                <Group key={role} gap="xs" wrap="nowrap">
                  <Box
                    style={{
                      width: 40,
                      height: 40,
                      flexShrink: 0,
                      background: hex,
                      border: "1px solid var(--color-border)",
                      borderRadius: 4,
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <Text size="xs" fw={600} truncate>
                      {role}
                    </Text>
                    <Text size="xs" c="dimmed" className="mono-num">
                      {hex.toUpperCase()}
                    </Text>
                    <Text size="xs" c="dimmed" className="mono-num">
                      {ratio.toFixed(2)}:1
                    </Text>
                  </div>
                </Group>
              );
            })}
          </SimpleGrid>
        </Card>

        {/* ── Status states ──────────────────────────────────────────────── */}
        <Card withBorder radius="md" padding="lg">
          <Text fw={700}>Status states ({statuses.length})</Text>
          <Text size="sm" c="dimmed" mb="md">
            One meaning across all four surfaces. The pending family is cyan-teal
            &mdash; never warning-yellow, never red.
          </Text>
          <Stack gap="md">
            {["success", "review", "warning", "critical", "accent", "textSecondary"].map((role) => (
              <div key={role}>
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6} style={{ letterSpacing: 1 }}>
                  {role}
                </Text>
                <Group gap="xs">
                  {byRole(role).map((s) => (
                    <StatusBadge key={s} status={s} />
                  ))}
                </Group>
              </div>
            ))}
            <div>
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6} style={{ letterSpacing: 1 }}>
                unmapped (must not assert a meaning)
              </Text>
              <Group gap="xs">
                <StatusBadge status="SOME_FUTURE_STATE" />
              </Group>
            </div>
          </Stack>
        </Card>

        {/* ── Radius + elevation ─────────────────────────────────────────── */}
        <Card withBorder radius="md" padding="lg">
          <Text fw={700} mb="md">
            Radius scale &mdash; 6px hard cap, &ldquo;machined edges, not lozenges&rdquo;
          </Text>
          <Group gap="lg">
            {(["xs", "sm", "md"] as const).map((r) => (
              <Stack key={r} gap={4} align="center">
                <Card withBorder radius={r} padding="lg" style={{ width: 90 }}>
                  <Text size="xs" ta="center">
                    {r}
                  </Text>
                </Card>
              </Stack>
            ))}
          </Group>
        </Card>

        {/* ── Buttons / interaction ──────────────────────────────────────── */}
        <Card withBorder radius="md" padding="lg">
          <Text fw={700} mb="md">
            Components on the generated theme
          </Text>
          <Group>
            <Button>Primary</Button>
            <Button variant="light">Light</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="subtle">Subtle</Button>
            <Button disabled>Disabled</Button>
          </Group>

          <Text fw={700} mt="xl">
            Why StatusBadge does not use Mantine&apos;s soft variant
          </Text>
          <Text size="sm" c="dimmed" mb="md">
            Left: a raw <code>variant=&quot;light&quot;</code> badge, which paints
            shade&nbsp;6 over a 10% wash of itself &mdash; 3.59:1 in light mode.
            Right: the same status through <code>StatusBadge</code>, using the
            token source&apos;s computed fill/ink pair &mdash; 5.25:1. Kept side
            by side deliberately: this is the single measurement that justifies
            the component overriding its library.
          </Text>
          <Group>
            <Badge color="review" variant="light">
              raw soft variant
            </Badge>
            <StatusBadge status="PENDING" />
          </Group>
        </Card>
      </Stack>
    </Box>
  );
}
