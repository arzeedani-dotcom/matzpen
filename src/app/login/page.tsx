"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { instance } from "@/config/instance";
import { api } from "@/lib/client/api";
import { formatLongHebrew, todayIn } from "@/lib/dates";
import { CompassMark } from "@/components/shell/compass-mark";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", json: { password } });
      const next = params.get("next");
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "הכניסה נכשלה");
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-ink px-4 text-ink-text">
      <div className="w-full max-w-sm">
        <CompassMark className="mx-auto size-16" spin />
        <h1 className="mt-5 text-center text-4xl font-bold tracking-tight">{instance.productName}</h1>
        <p className="mt-2 text-center text-ink-muted">{formatLongHebrew(todayIn(instance.timeZone))}</p>

        <form onSubmit={submit} className="mt-10 space-y-3">
          <label htmlFor="password" className="block text-sm text-ink-muted">
            סיסמה
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 w-full rounded-[var(--radius-card)] border border-white/15 bg-white/5 px-4 text-lg text-ink-text outline-none placeholder:text-ink-muted focus:border-brass"
            aria-invalid={!!error}
            aria-describedby={error ? "login-error" : undefined}
          />
          {error && (
            <p id="login-error" role="alert" className="text-sm text-[#fca5a5]">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !password}
            className="h-12 w-full rounded-[var(--radius-card)] bg-brass text-base font-semibold text-[#1b1306] transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "נכנס…" : "כניסה"}
          </button>
        </form>
      </div>
    </main>
  );
}
