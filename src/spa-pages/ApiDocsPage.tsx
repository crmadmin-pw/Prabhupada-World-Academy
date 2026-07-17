/**
 * /api-docs — Swagger UI for the FOLK Sadhana Tracker API
 *
 * Dynamically loads Swagger UI from CDN and renders the OpenAPI spec
 * fetched from /api/openApiSpec.
 */
import { useEffect, useRef, useState } from 'react';
import { openApiSpec } from 'zite-endpoints-sdk';

declare global {
  interface Window {
    SwaggerUIBundle: (config: Record<string, unknown>) => unknown;
  }
}

export default function ApiDocsPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // 1. Load Swagger UI CSS
        if (!document.getElementById('swagger-ui-css')) {
          const link = document.createElement('link');
          link.id = 'swagger-ui-css';
          link.rel = 'stylesheet';
          link.href = 'https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css';
          document.head.appendChild(link);
        }

        // 2. Load Swagger UI JS (if not already loaded)
        if (!window.SwaggerUIBundle) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load Swagger UI bundle'));
            document.head.appendChild(script);
          });
        }

        if (cancelled) return;

        // 3. Fetch the OpenAPI spec from our endpoint
        const result = await openApiSpec({});
        if (cancelled) return;

        // 4. Inject base URL into the spec
        const specWithBase = {
          ...result.spec,
          servers: [{ url: window.location.origin, description: 'This app' }],
        };

        // 5. Render Swagger UI
        if (containerRef.current && window.SwaggerUIBundle) {
          window.SwaggerUIBundle({
            spec: specWithBase,
            domNode: containerRef.current,
            presets: [
              (window.SwaggerUIBundle as any).presets.apis,
              (window.SwaggerUIBundle as any).SwaggerUIStandalonePreset,
            ],
            layout: 'BaseLayout',
            deepLinking: true,
            showExtensions: true,
            showCommonExtensions: true,
            defaultModelsExpandDepth: 2,
            defaultModelExpandDepth: 2,
          });
        }

        setLoading(false);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load API docs');
          setLoading(false);
        }
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-6 py-4 shadow-md">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 bg-primary-foreground/20 rounded-lg flex items-center justify-center text-lg font-bold">
            🕉
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">FOLK Sadhana Tracker — API Docs</h1>
            <p className="text-xs opacity-80 mt-0.5">OpenAPI 3.0 · REST · Live endpoint</p>
          </div>
          <div className="ml-auto flex gap-2 text-xs opacity-70">
            <span className="bg-primary-foreground/10 border border-primary-foreground/20 rounded px-2 py-1">
              v1.0.0
            </span>
          </div>
        </div>
      </div>

      {/* Info bar */}
      <div className="bg-muted border-b border-border px-6 py-2">
        <div className="max-w-7xl mx-auto flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span>
            📌 <strong className="text-foreground">Base URL:</strong>{' '}
            <code className="font-mono bg-card border border-border rounded px-1 py-0.5">
              {typeof window !== 'undefined' ? window.location.origin : ''}
            </code>
          </span>
          <span>
            📋 <strong className="text-foreground">Spec endpoint:</strong>{' '}
            <code className="font-mono bg-card border border-border rounded px-1 py-0.5">
              /api/openApiSpec
            </code>
          </span>
          <span>
            🔌 <strong className="text-foreground">Data endpoint:</strong>{' '}
            <code className="font-mono bg-card border border-border rounded px-1 py-0.5">
              /api/sadhanaStatus
            </code>
          </span>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-32">
          <div className="text-center space-y-4">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-muted-foreground text-sm">Loading Swagger UI…</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="max-w-2xl mx-auto mt-12 p-6 bg-destructive/10 border border-destructive/30 rounded-xl text-center">
          <p className="text-destructive font-semibold">Failed to load API docs</p>
          <p className="text-sm text-muted-foreground mt-2">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {/* Swagger UI mount point */}
      <div
        ref={containerRef}
        className={loading || error ? 'hidden' : ''}
        style={{ maxWidth: '100%' }}
      />

      {/* Override some Swagger UI styles to match theme */}
      <style>{`
        .swagger-ui .topbar { display: none !important; }
        .swagger-ui .info { margin: 24px 0 !important; }
        .swagger-ui { font-family: inherit !important; }
        .swagger-ui .scheme-container { background: transparent !important; box-shadow: none !important; }
      `}</style>
    </div>
  );
}
