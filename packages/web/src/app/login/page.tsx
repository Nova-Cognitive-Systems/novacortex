"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Brain, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getApiBaseUrl } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // If a token is already present and valid, go home.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const existing = localStorage.getItem("novacortex_token");
    if (!existing) return;

    const url = `${getApiBaseUrl()}/auth/whoami`;
    fetch(url, { headers: { Authorization: `Bearer ${existing}` } })
      .then((res) => {
        if (res.ok) router.replace("/dashboard");
      })
      .catch(() => {});
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const raw = token.trim();
    if (!raw) {
      setError("Please paste your access token or bootstrap code");
      return;
    }
    setSubmitting(true);
    try {
      let accessToken = raw;

      // Bootstrap code: exchange nc_boot_... for a real access token
      if (raw.startsWith("nc_boot_")) {
        const res = await fetch(`${getApiBaseUrl()}/setup/exchange`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: raw, name: "admin" }),
        });
        const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string; message?: string };
        if (!res.ok || !body.token) {
          setError(body.message ?? body.error ?? "Bootstrap code is invalid or already used");
          setSubmitting(false);
          return;
        }
        accessToken = body.token;
      }

      const verify = await fetch(`${getApiBaseUrl()}/auth/whoami`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!verify.ok) {
        const body = (await verify.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(body.message ?? body.error ?? "Token is invalid or revoked");
        setSubmitting(false);
        return;
      }
      localStorage.setItem("novacortex_token", accessToken);
      router.replace("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Brain className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>NovaCortex</CardTitle>
          <CardDescription>Paste your access token to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token">Access Token</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="token"
                  type="password"
                  placeholder="nc_pat_... or nc_boot_..."
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="pl-9 font-mono"
                  autoFocus
                />
              </div>
            </div>
            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Verifying..." : "Login"}
            </Button>
          </form>
          <p className="mt-4 text-xs text-muted-foreground">
            Paste your <code className="rounded bg-muted px-1">nc_pat_...</code> access token, or
            the <code className="rounded bg-muted px-1">nc_boot_...</code> bootstrap code from the
            API logs — it will be exchanged automatically.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
