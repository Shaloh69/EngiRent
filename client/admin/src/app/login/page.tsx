"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, Divider, Group, PasswordInput, Stack, Text, TextInput, ThemeIcon, Title, useComputedColorScheme } from "@mantine/core";
import { motion } from "framer-motion";
import { AlertCircle, Lock, ShieldCheck, Activity, ScanLine } from "lucide-react";
import api, { isDemoMode } from "@/lib/api";
import { roleColor } from "../theme";
import { AuroraBackground } from "@/components/ui/AuroraBackground";
import { ColorSchemeToggle } from "@/components/ui/ColorSchemeToggle";

// Mandate §1.5 — auth screens carry the full-bleed animated background.
// Mandate §1.1 — deliberately NOT a centred hero card: the layout is an
// asymmetric split with the brand panel bled into the aurora on the left and
// the form as a hard-edged panel on the right.
export default function LoginPage() {
  const scheme = useComputedColorScheme("light");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (isDemoMode) {
      if (!email.trim() || !password) {
        setError("Email and password are required");
        setLoading(false);
        return;
      }
      localStorage.setItem("admin_token", "demo-admin-token");
      router.push("/dashboard");
      setLoading(false);
      return;
    }

    try {
      const response = await api.post("/auth/login", { email, password });
      const { accessToken } = response.data.data.tokens;
      localStorage.setItem("admin_token", accessToken);
      router.push("/dashboard");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? "Login failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box style={{ position: "relative", minHeight: "100vh", overflow: "hidden" }}>
      {/* Scheme-aware stops. The light-mode brand (#0B5FA5) sits at roughly
          2.4:1 on the dark ground — as an aurora it reads as a dark smudge
          rather than colour, so dark mode takes the lifted hues that the rest
          of the dark theme already uses. */}
      <AuroraBackground
        colorStops={
          scheme === "dark"
            ? ["#4DA3E8", "#F5B85C", "#FF8A95"]
            : ["#0B5FA5", "#E9A13B", "#EF6E7B"]
        }
        amplitude={1.1}
        blend={0.55}
        speed={0.5}
      />

      {/* Contrast scrim — mandate §1.5: the background must never cost
          legibility. Caught in verification: in light mode the aurora's bright
          centre washed out the body copy over it to roughly 1.5:1. This lays a
          scheme-aware wash between the animation and the text — darkened in
          light mode (the type over it is dark ink), deepened in dark mode —
          and it is why the copy stays readable wherever the aurora drifts. */}
      <Box className="login-scrim" aria-hidden />

      <Box style={{ position: "absolute", top: 16, right: 16, zIndex: 3 }}>
        <ColorSchemeToggle />
      </Box>

      <Box
        style={{
          position: "relative",
          zIndex: 2,
          minHeight: "100vh",
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) minmax(0,420px)",
          alignItems: "stretch",
          gap: 0,
        }}
        className="login-grid"
      >
        {/* Brand panel — sits directly on the aurora, no card. */}
        <Box
          p={48}
          style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}
          visibleFrom="md"
        >
          <Group gap={10}>
            <ThemeIcon size={34} radius="sm" variant="filled" color={roleColor.brand}>
              <ShieldCheck size={18} />
            </ThemeIcon>
            <Text
              size="xs"
              fw={700}
              tt="uppercase"
              style={{ letterSpacing: 3, fontFamily: "var(--font-mono)" }}
            >
              EngiRent&nbsp;/&nbsp;Control
            </Text>
          </Group>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <Title order={1} style={{ fontSize: 54, lineHeight: 1.02, letterSpacing: "-0.03em" }}>
              Admin
              <br />
              Command
              <br />
              <span style={{ color: "var(--color-primary)" }}>Center</span>
            </Title>
            <Text size="sm" c="dimmed" maw={420} mt="lg">
              Kiosk health, rental lifecycle, verification outcomes and transaction
              integrity — one console, full audit trail.
            </Text>
          </motion.div>

          {/* Mandate §1.2 — operational counters set in IBM Plex Mono. */}
          <Group gap={40}>
            {[
              { icon: Activity, label: "Lockers", value: "04" },
              { icon: ScanLine, label: "Kiosks", value: "01" },
              { icon: ShieldCheck, label: "Uptime", value: "99.9%" },
            ].map((s) => (
              <Stack key={s.label} gap={2}>
                <Group gap={6}>
                  <s.icon size={13} style={{ color: "var(--color-muted)" }} />
                  <Text size="10px" tt="uppercase" c="dimmed" style={{ letterSpacing: 1.5 }}>
                    {s.label}
                  </Text>
                </Group>
                <Text className="mono-num" fw={600} size="xl">
                  {s.value}
                </Text>
              </Stack>
            ))}
          </Group>
        </Box>

        {/* Form panel — hard-edged, borders not shadows (mandate §1.4). */}
        <Box
          p={{ base: 24, md: 40 }}
          style={{
            background: "var(--color-surface)",
            borderLeft: "1px solid var(--color-border)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <motion.div
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <Stack gap={4} mb="xl">
              <Text
                size="10px"
                fw={700}
                tt="uppercase"
                c={roleColor.brand}
                style={{ letterSpacing: 2.5, fontFamily: "var(--font-mono)" }}
              >
                Restricted Access
              </Text>
              <Title order={2} size="h3">
                Sign in
              </Title>
              <Text size="sm" c="dimmed">
                {isDemoMode
                  ? "Dev demo mode is active — any credentials will pass."
                  : "Authorized EngiRent staff accounts only."}
              </Text>
            </Stack>

            <form onSubmit={handleLogin}>
              <Stack gap="md">
                <TextInput
                  label="Email"
                  placeholder="admin@uclm.edu.ph"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                  required
                  size="md"
                />
                <PasswordInput
                  label="Password"
                  placeholder="Enter your password"
                  leftSection={<Lock size={15} />}
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  required
                  size="md"
                />

                {error && (
                  <Alert
                    icon={<AlertCircle size={16} />}
                    color={roleColor.critical}
                    variant="light"
                  >
                    {error}
                  </Alert>
                )}

                <Button type="submit" size="md" fullWidth loading={loading} mt={4}>
                  Access Dashboard
                </Button>
              </Stack>
            </form>

            <Divider my="xl" />
            <Text size="xs" c="dimmed">
              Every sign-in is recorded against the audit log, including failed
              attempts and originating address.
            </Text>
          </motion.div>
        </Box>
      </Box>

      <style>{`
        .login-scrim {
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
        }
        [data-mantine-color-scheme="light"] .login-scrim {
          background:
            linear-gradient(100deg,
              rgba(253,251,247,.90) 0%,
              rgba(253,251,247,.72) 34%,
              rgba(253,251,247,.55) 62%,
              rgba(253,251,247,.40) 100%);
        }
        [data-mantine-color-scheme="dark"] .login-scrim {
          background:
            linear-gradient(100deg,
              rgba(7,19,16,.72) 0%,
              rgba(7,19,16,.52) 40%,
              rgba(7,19,16,.34) 100%);
        }
        @media (max-width: 62em) {
          .login-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </Box>
  );
}
