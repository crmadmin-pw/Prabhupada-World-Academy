/**
 * Per-request Content-Security-Policy.
 * Script tags get a nonce. Style attributes and the meeting modal's inline
 * style block stay on 'unsafe-inline' — a nonce in style-src would make
 * browsers ignore that keyword and break those styles.
 */
export function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  const scriptSrc = [
    "script-src 'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    'https://unpkg.com',
    isDev ? "'unsafe-eval'" : '',
  ].filter(Boolean).join(' ');

  const connectSrc = [
    "connect-src 'self'",
    'https://*.googleapis.com',
    'https://*.firebaseapp.com',
    'https://*.firebasestorage.app',
    'https://firebasestorage.googleapis.com',
    'https://storage.googleapis.com',
    'https://accounts.google.com',
    'wss://*.googleapis.com',
    'wss://*.firebaseio.com',
    isDev ? 'ws: http://127.0.0.1:* http://localhost:*' : '',
  ].filter(Boolean).join(' ');

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://unpkg.com",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data: https://images.fillout.com https://*.firebasestorage.app https://firebasestorage.googleapis.com https://storage.googleapis.com https://*.googleusercontent.com",
    "font-src 'self' data: https://unpkg.com",
    connectSrc,
    "frame-src 'self' https://*.firebaseapp.com https://*.web.app https://accounts.google.com https://apis.google.com",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    isDev ? '' : 'upgrade-insecure-requests',
  ].filter(Boolean).join('; ');
}
