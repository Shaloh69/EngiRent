"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Card, CardBody, CardHeader } from "@heroui/react";
import { Lock, ShieldCheck } from "lucide-react";
import api, { isDemoMode } from "@/lib/api";

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
    <div className="min-h-screen px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 lg:flex-row lg:items-stretch">
        <section className="app-surface flex-1 rounded-3xl border border-[var(--color-border)] p-7 sm:p-10">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] app-muted">
            EngiRent Hub
          </p>
          <h1 className="text-3xl font-extrabold text-[var(--color-ink)] sm:text-5xl">
            Admin Command Center
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-relaxed app-muted sm:text-base">
            Monitor kiosk health, rental lifecycle, verification outcomes, and
            transaction integrity from one secure console.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <div className="app-soft rounded-2xl border border-[var(--color-border)] p-4">
              <p className="text-sm font-semibold text-[var(--color-ink)]">
                Live Monitoring
              </p>
              <p className="mt-1 text-xs app-muted">
                Track lockers, rentals, and payout states in real-time.
              </p>
            </div>
            <div className="app-soft rounded-2xl border border-[var(--color-border)] p-4">
              <p className="text-sm font-semibold text-[var(--color-ink)]">
                Audit Visibility
              </p>
              <p className="mt-1 text-xs app-muted">
                Every action is logged for dispute handling and compliance.
              </p>
            </div>
          </div>
        </section>

        <Card className="app-surface w-full rounded-3xl border border-[var(--color-border)] lg:max-w-md">
          <CardHeader className="flex flex-col items-center gap-2 px-8 pb-0 pt-8 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-primary)] text-white">
              <ShieldCheck size={24} />
            </div>
            <h2 className="text-2xl font-extrabold">Secure Admin Login</h2>
            <p className="text-sm app-muted">
              {isDemoMode
                ? "Dev demo mode is active. Any email/password can log in."
                : "Use your authorized EngiRent account."}
            </p>
          </CardHeader>
          <CardBody className="px-8 pb-8 pt-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <Input
                type="email"
                label="Email"
                placeholder="admin@uclm.edu.ph"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                variant="bordered"
              />
              <Input
                type="password"
                label="Password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                variant="bordered"
                startContent={<Lock size={16} className="text-default-400" />}
              />
              {error && (
                <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                color="primary"
                className="h-11 w-full font-semibold"
                isLoading={loading}
              >
                Access Dashboard
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
