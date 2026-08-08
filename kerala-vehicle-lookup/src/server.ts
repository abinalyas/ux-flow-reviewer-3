import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { InvalidRegistrationNumberError } from './regno';
import { createProvider, ProviderError } from './providers';
import { LookupService } from './service';

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const RATE_LIMIT_MAX = Number.parseInt(process.env.RATE_LIMIT_MAX ?? '30', 10);
const RATE_LIMIT_WINDOW_MS = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10);
const PUBLIC_DIR = join(__dirname, '..', '..', 'public');

const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

/**
 * Registration numbers are personal data under the DPDP Act, so the access log
 * gets a salted hash rather than the plate itself. You keep the ability to spot
 * abuse patterns without building a searchable log of who looked up what.
 */
function auditToken(registrationNumber: string): string {
  const salt = process.env.AUDIT_SALT ?? 'dev-salt-change-me';
  return createHash('sha256').update(`${salt}:${registrationNumber}`).digest('hex').slice(0, 12);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(payload);
}

function statusForProviderError(error: ProviderError): number {
  switch (error.code) {
    case 'NOT_FOUND':
      return 404;
    case 'UNAUTHORIZED':
      return 502;
    case 'RATE_LIMITED':
      return 429;
    case 'TIMEOUT':
      return 504;
    case 'NOT_CONFIGURED':
    case 'UNSUPPORTED':
      return 501;
    default:
      return 502;
  }
}

async function main(): Promise<void> {
  const provider = createProvider();
  const service = new LookupService(provider);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res, service, provider.name).catch((error) => {
      console.error('[server] unhandled', error);
      if (!res.headersSent) sendJson(res, 500, { error: 'INTERNAL_ERROR' });
    });
  });

  server.listen(PORT, () => {
    console.log(`kerala-vehicle-lookup listening on http://localhost:${PORT}`);
    console.log(`  provider: ${provider.name}`);
    console.log(`  privacy:  ${process.env.PRIVACY_MODE === 'full' ? 'full' : 'masked'}`);
    if (provider.name === 'mock') {
      console.log('  NOTE: mock provider — all results are synthetic, not real vehicle data.');
    }
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  service: LookupService,
  providerName: string,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/healthz') {
    sendJson(res, 200, { ok: true, provider: providerName });
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    try {
      const html = await readFile(join(PUBLIC_DIR, 'index.html'), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      sendJson(res, 404, { error: 'UI_NOT_FOUND', hint: 'public/index.html is missing' });
    }
    return;
  }

  const match = /^\/api\/v1\/vehicles\/([^/]+)$/.exec(url.pathname);
  if (!match) {
    sendJson(res, 404, { error: 'NOT_FOUND' });
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const ip = req.socket.remoteAddress ?? 'unknown';
  if (rateLimited(ip)) {
    sendJson(res, 429, { error: 'RATE_LIMITED', retryAfterMs: RATE_LIMIT_WINDOW_MS });
    return;
  }

  const raw = decodeURIComponent(match[1]!);

  try {
    const result = await service.lookup(raw);
    console.log(
      `[lookup] plate=${auditToken(result.registrationNumber)} provider=${result.meta.provider} ` +
        `cached=${result.meta.cached} pending=${result.summary.pendingCount}`,
    );
    sendJson(res, 200, result);
  } catch (error) {
    if (error instanceof InvalidRegistrationNumberError) {
      sendJson(res, 400, { error: error.code, message: error.message });
      return;
    }
    if (error instanceof ProviderError) {
      console.error(`[lookup] provider error ${error.code}: ${error.message}`);
      sendJson(res, statusForProviderError(error), { error: error.code, message: error.message });
      return;
    }
    throw error;
  }
}

void main();
