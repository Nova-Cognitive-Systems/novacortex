"use client";

import { useEffect, useState, useCallback } from "react";
import { Activity, Database, Server, Cpu } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getApiBaseUrl } from "@/lib/api";

interface ServiceStatus {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  status: "online" | "offline" | "checking";
  latency: number | null;
  lastCheck: Date | null;
}

async function pingService(
  url: string,
  timeout = 5000
): Promise<{ ok: boolean; latency: number }> {
  const start = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);
    const latency = Math.round(performance.now() - start);
    return { ok: response.ok, latency };
  } catch {
    clearTimeout(timeoutId);
    const latency = Math.round(performance.now() - start);
    return { ok: false, latency };
  }
}

export function ServiceMonitor() {
  const [services, setServices] = useState<ServiceStatus[]>([
    { name: "API Backend", icon: Server, status: "checking", latency: null, lastCheck: null },
    { name: "Qdrant", icon: Cpu, status: "checking", latency: null, lastCheck: null },
    { name: "SurrealDB", icon: Database, status: "checking", latency: null, lastCheck: null },
  ]);

  const checkServices = useCallback(async () => {
    const apiUrl = getApiBaseUrl();

    // Single health check — derive all service statuses from one call
    const apiResult = await pingService(`${apiUrl}/health`);
    let qdrantOk = false;
    let dbOk = false;

    if (apiResult.ok) {
      try {
        const res = await fetch(`${apiUrl}/health`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          // API health endpoint validates all backend connections
          dbOk = data.status === "healthy";
          qdrantOk = data.status === "healthy";
        }
      } catch {
        // API responded but health parse failed
      }
    }

    const now = new Date();
    setServices([
      {
        name: "API Backend",
        icon: Server,
        status: apiResult.ok ? "online" : "offline",
        latency: apiResult.latency,
        lastCheck: now,
      },
      {
        name: "Qdrant",
        icon: Cpu,
        status: qdrantOk ? "online" : "offline",
        latency: apiResult.ok ? apiResult.latency : null,
        lastCheck: now,
      },
      {
        name: "SurrealDB",
        icon: Database,
        status: dbOk ? "online" : "offline",
        latency: apiResult.ok ? apiResult.latency : null,
        lastCheck: now,
      },
    ]);
  }, []);

  useEffect(() => {
    checkServices();
    const interval = setInterval(checkServices, 30000);
    return () => clearInterval(interval);
  }, [checkServices]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-[#ff5600]" />
          Service Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {services.map((service) => (
          <div
            key={service.name}
            className="flex items-center justify-between py-2 px-3 rounded-lg bg-secondary/30"
          >
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "h-2 w-2 rounded-full",
                  service.status === "online" && "bg-green-500",
                  service.status === "offline" && "bg-red-500",
                  service.status === "checking" && "bg-yellow-500 animate-pulse"
                )}
              />
              <service.icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{service.name}</span>
            </div>
            <div className="flex items-center gap-3">
              {service.latency !== null && (
                <span
                  className={cn(
                    "text-xs font-mono",
                    service.latency < 100 && "text-green-500",
                    service.latency >= 100 && service.latency < 500 && "text-yellow-500",
                    service.latency >= 500 && "text-red-500"
                  )}
                >
                  {service.latency}ms
                </span>
              )}
              {service.status === "checking" && (
                <span className="text-xs text-muted-foreground">Checking...</span>
              )}
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground text-center pt-2">
          Auto-refresh every 30s
        </p>
      </CardContent>
    </Card>
  );
}
