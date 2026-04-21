"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (token) {
      router.push("/dashboard");
    } else {
      router.push("/login");
    }
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="app-surface rounded-2xl border border-[var(--color-border)] px-6 py-5 text-sm font-semibold app-muted">
        Preparing admin console...
      </div>
    </div>
  );
}
