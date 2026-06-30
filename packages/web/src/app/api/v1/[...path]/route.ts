/**
 * API Proxy Route - Forwards all /api/v1/* requests to the backend API.
 * Uses Node.js http module directly to bypass Next.js body size limits.
 */

import { NextRequest, NextResponse } from 'next/server';
import http from 'http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const API_BASE = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// Headers that should not be forwarded to the backend
const STRIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'transfer-encoding',
  // Strip caching headers to prevent 304 responses (NextResponse doesn't support 304)
  'if-none-match',
  'if-modified-since',
]);

// Headers that should not be forwarded from the backend response
const STRIP_RESPONSE_HEADERS = new Set([
  'transfer-encoding',
  'connection',
  // Strip ETag/Last-Modified to prevent browser sending conditional requests
  'etag',
  'last-modified',
]);

async function proxyRequest(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const targetPath = path.join('/');
  const url = new URL(req.url);
  const targetUrl = new URL(`${API_BASE}/${targetPath}${url.search}`);

  return new Promise<NextResponse>((resolve) => {
    const proxyReq = http.request(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port,
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers: Object.fromEntries(
          [...req.headers.entries()].filter(
            ([k]) => !STRIP_REQUEST_HEADERS.has(k.toLowerCase())
          )
        ),
        timeout: 30000,
      },
      (proxyRes) => {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          const body = Buffer.concat(chunks);
          const headers = new Headers();
          for (const [key, value] of Object.entries(proxyRes.headers)) {
            if (value && !STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
              headers.set(key, Array.isArray(value) ? value[0] : value);
            }
          }
          // Ensure we never return cache headers through the proxy
          headers.set('cache-control', 'no-store');

          // NextResponse only accepts valid status codes (100-599, not 304 for body responses)
          let status = proxyRes.statusCode || 500;
          if (status === 304) {
            // Convert 304 to 200 with the cached body (proxy handles caching, not browser)
            status = 200;
          }

          resolve(new NextResponse(body.length > 0 ? body : null, {
            status,
            headers,
          }));
        });
      }
    );

    proxyReq.on('error', (err) => {
      resolve(NextResponse.json(
        { error: 'API proxy error', message: err.message },
        { status: 502 }
      ));
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      resolve(NextResponse.json({ error: 'API proxy timeout' }, { status: 504 }));
    });

    // Stream the request body directly to the proxy
    if (req.body) {
      const reader = req.body.getReader();
      function pump(): void {
        reader.read().then(({ done, value }) => {
          if (done) {
            proxyReq.end();
            return;
          }
          proxyReq.write(value);
          pump();
        }).catch(() => proxyReq.end());
      }
      pump();
    } else {
      proxyReq.end();
    }
  });
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const DELETE = proxyRequest;
export const PATCH = proxyRequest;
