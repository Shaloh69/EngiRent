"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Center,
  Group,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { motion } from "framer-motion";
import { AlertCircle, Eye, Lock, ShieldCheck } from "lucide-react";
import api, { isDemoMode } from "@/lib/api";
import { roleColor } from "../theme";

export default function LoginPage() {
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
    } catch (err: any) {
      setError(err.response?.data?.error || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Center mih="100vh" px="md" py="xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        style={{ width: "100%", maxWidth: 980 }}
      >
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
          <Card withBorder radius="lg" padding="xl">
            <Stack gap="sm">
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: 2 }}>
                EngiRent Hub
              </Text>
              <Title order={1} size="h1">
                Admin Command Center
              </Title>
              <Text size="sm" c="dimmed" maw={460}>
                Monitor kiosk health, rental lifecycle, verification outcomes, and
                transaction integrity from one secure console.
              </Text>

              <SimpleGrid cols={{ base: 1, sm: 2 }} mt="md">
                {[
                  {
                    title: "Live Monitoring",
                    body: "Track lockers, rentals, and payout states in real-time.",
                    icon: Eye,
                    color: roleColor.brand,
                  },
                  {
                    title: "Audit Visibility",
                    body: "Every action is logged for dispute handling and compliance.",
                    icon: ShieldCheck,
                    color: roleColor.accent,
                  },
                ].map((f) => (
                  <Card key={f.title} withBorder radius="md" padding="md" bg="var(--color-surface-soft)">
                    <ThemeIcon size={32} radius="md" variant="light" color={f.color} mb="xs">
                      <f.icon size={16} />
                    </ThemeIcon>
                    <Text size="sm" fw={700}>
                      {f.title}
                    </Text>
                    <Text size="xs" c="dimmed" mt={2}>
                      {f.body}
                    </Text>
                  </Card>
                ))}
              </SimpleGrid>
            </Stack>
          </Card>

          <Card withBorder radius="lg" padding="xl">
            <Stack align="center" gap={6} mb="lg">
              <ThemeIcon size={52} radius="md" variant="filled" color={roleColor.brand}>
                <ShieldCheck size={26} />
              </ThemeIcon>
              <Title order={2} size="h3">
                Secure Admin Login
              </Title>
              <Text size="sm" c="dimmed">
                {isDemoMode
                  ? "Dev demo mode is active. Any email/password can log in."
                  : "Use your authorized EngiRent account."}
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
                  leftSection={<Lock size={16} />}
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

                <Button type="submit" size="md" fullWidth loading={loading} mt="xs">
                  Access Dashboard
                </Button>
              </Stack>
            </form>
          </Card>
        </SimpleGrid>
      </motion.div>
    </Center>
  );
}
