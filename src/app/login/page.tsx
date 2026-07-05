"use client";

import { useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function nextTarget(): string {
    if (typeof window === "undefined") return "/";
    const n = new URLSearchParams(window.location.search).get("next");
    if (!n || !n.startsWith("/") || n.startsWith("//")) return "/";
    return n;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, next: nextTarget() }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({ next: "/" }));
        window.location.href = typeof data.next === "string" ? data.next : "/";
        return;
      }
      if (res.status === 429) setError("Zu viele Versuche. Bitte später erneut.");
      else setError("Benutzername oder Passwort falsch.");
    } catch {
      setError("Netzwerkfehler. Bitte erneut versuchen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-zinc-900 rounded-2xl border border-zinc-800 p-8 space-y-6">
        <div className="text-center space-y-1">
          <div className="text-2xl">🧠</div>
          <h1 className="text-lg font-semibold text-white">Migräne-Tracker</h1>
          <p className="text-sm text-zinc-400">Bitte anmelden</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="username" className="text-xs text-zinc-400 uppercase tracking-wide">
              Benutzername
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-xs text-zinc-400 uppercase tracking-wide">
              Passwort
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium rounded-lg py-2.5 transition-colors"
          >
            {busy ? "Anmelden…" : "Anmelden"}
          </button>
        </form>
      </div>
    </main>
  );
}
