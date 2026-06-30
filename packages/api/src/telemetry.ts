/**
 * Opt-in OpenTelemetry. Activates ONLY when OTEL_EXPORTER_OTLP_ENDPOINT is set,
 * so default self-host deployments are unaffected. Import this module FIRST in the
 * entrypoint (before express/http) so auto-instrumentation can patch them.
 *
 * Enable, e.g.:
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 \
 *   OTEL_SERVICE_NAME=novacortex-api docker compose ... up
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | undefined;

if (process.env['OTEL_EXPORTER_OTLP_ENDPOINT']) {
  try {
    sdk = new NodeSDK({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: process.env['OTEL_SERVICE_NAME'] || 'novacortex-api',
        [ATTR_SERVICE_VERSION]: process.env['npm_package_version'] || '1.1.0',
      }),
      traceExporter: new OTLPTraceExporter(),
      instrumentations: [
        getNodeAutoInstrumentations({
          // fs instrumentation is noisy and low-value here.
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });
    sdk.start();
    // eslint-disable-next-line no-console
    console.log(`[telemetry] OpenTelemetry enabled -> ${process.env['OTEL_EXPORTER_OTLP_ENDPOINT']}`);
  } catch (e) {
    // Never let telemetry break the API.
    // eslint-disable-next-line no-console
    console.error('[telemetry] failed to start OpenTelemetry:', e);
    sdk = undefined;
  }
}

/**
 * Flush + stop the OpenTelemetry SDK. Awaited from the single graceful-shutdown
 * path in index.ts (NOT via its own signal handler) so the final span batch is
 * flushed exactly once before process.exit — no race with the rest of shutdown.
 * No-op when telemetry is disabled. Bounded so a hung collector can't block exit.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  try {
    await Promise.race([
      sdk.shutdown(),
      new Promise<void>((resolve) => setTimeout(resolve, 4000)),
    ]);
  } catch {
    // never let telemetry break shutdown
  }
}
