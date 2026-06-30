/**
 * Next.js Health Check API Route
 * GET /api/health - Returns health status for container orchestration
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  checks: {
    api: {
      status: 'ok' | 'error';
      latency_ms?: number;
      error?: string;
    };
  };
}

export async function GET(): Promise<NextResponse<HealthResponse>> {
  const startTime = Date.now();

  // Check API backend
  const apiCheck = await checkApiBackend();

  const health: HealthResponse = {
    status: apiCheck.status === 'ok' ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    checks: {
      api: apiCheck,
    },
  };

  const statusCode = health.status === 'healthy' ? 200 : 503;

  return NextResponse.json(health, { status: statusCode });
}

async function checkApiBackend(): Promise<{
  status: 'ok' | 'error';
  latency_ms?: number;
  error?: string;
}> {
  const start = Date.now();

  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const internalApiUrl = process.env.API_INTERNAL_URL || apiUrl.replace('https://', 'http://').replace('api.', 'api:3001/');

    // Use internal URL for container-to-container communication
    const response = await fetch(`${internalApiUrl}/health`, {
      signal: AbortSignal.timeout(5000),
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return {
        status: 'error',
        latency_ms: Date.now() - start,
        error: `API returned ${response.status}`,
      };
    }

    return {
      status: 'ok',
      latency_ms: Date.now() - start,
    };
  } catch (error) {
    return {
      status: 'error',
      latency_ms: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
