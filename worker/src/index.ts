/**
 * s3man – Cloudflare Worker Proxy for S3-compatible storage
 *
 * Two access modes:
 *
 * 1. **Inline config** (app-internal: Image/Video/fetch)
 *    AUTH_TOKEN required. S3 config via X-S3-* headers.
 *    URL: /{bucket}/{key}
 *
 * 2. **KV alias** (clean share URLs, no auth needed)
 *    S3 config stored in KV by alias. Registered via management API.
 *    URL: /{alias}/{bucket}/{key}
 *
 * Management API (requires AUTH_TOKEN):
 *   PUT    /api/configs/{alias}  — register S3 config
 *   DELETE /api/configs/{alias}  — remove S3 config
 *
 * Deploy: wrangler deploy
 * Secrets: wrangler secret put AUTH_TOKEN
 * KV: wrangler kv namespace create S3_CONFIGS  (bind id in wrangler.toml)
 */

export interface Env {
  AUTH_TOKEN: string;
  S3_CONFIGS: KVNamespace;
}

// KVNamespace is provided by Cloudflare Workers runtime
declare global {
  interface KVNamespace {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  }
}

interface S3Cfg {
  /** endpoint */
  e: string;
  /** region */
  r: string;
  /** accessKey */
  a: string;
  /** secretKey */
  s: string;
}

interface CachedS3Cfg {
  value: S3Cfg;
  expiresAt: number;
}

interface ResolvedRequest {
  s3Cfg: S3Cfg;
  bucket: string;
  key: string;
  mode: 'inline' | 'alias';
}

interface CfAwareRequestInit extends RequestInit {
  cf?: {
    cacheEverything?: boolean;
    cacheTtlByStatus?: Record<string, number>;
  };
}

const BROWSER_CACHE_TTL_SECONDS = 3600;
const EDGE_CACHE_TTL_SECONDS = 86400;
const NOT_FOUND_CACHE_TTL_SECONDS = 60;
const ALIAS_CACHE_TTL_MS = 10 * 60 * 1000;
const aliasConfigCache = new Map<string, CachedS3Cfg>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // ── CORS preflight ──────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    const url = new URL(request.url);

    // ── Management API: /api/configs/{alias} ────────────────────
    if (url.pathname.startsWith('/api/')) {
      return handleManagementApi(request, url, env);
    }

    // ── Resolve S3 config and path ──────────────────────────────
    const resolved = await resolveRequest(request, url, env);
    if (resolved instanceof Response) return resolved;
    const { s3Cfg, bucket, key, mode } = resolved;

    // ── Build S3 request ────────────────────────────────────────
    const s3Url = `${s3Cfg.e}/${bucket}/${key}`;

    const method = request.method;
    if (!['GET', 'HEAD', 'PUT'].includes(method)) {
      return json({ error: 'Method not allowed' }, 405);
    }

    // Sign the request using AWS Signature V4
    const s3Headers = await signRequest({
      method,
      url: s3Url,
      region: s3Cfg.r,
      accessKey: s3Cfg.a,
      secretKey: s3Cfg.s,
      body: method === 'PUT' ? request.body : null,
      contentType: request.headers.get('Content-Type') || undefined,
      range: request.headers.get('Range') || undefined,
    });

    const s3Request: CfAwareRequestInit = {
      method,
      headers: s3Headers,
    };

    if (method === 'PUT') {
      s3Request.body = request.body;
      // @ts-expect-error - Cloudflare Workers support duplex streaming
      s3Request.duplex = 'half';
    }

    // ── Forward to S3 ───────────────────────────────────────────
    if (method === 'GET' || method === 'HEAD') {
      s3Request.cf = {
        cacheEverything: true,
        cacheTtlByStatus: {
          '200-299': EDGE_CACHE_TTL_SECONDS,
          '404': NOT_FOUND_CACHE_TTL_SECONDS,
          '500-599': 0,
        },
      };
    }

    const s3Response = await fetch(s3Url, s3Request);

    // ── Build response ──────────────────────────────────────────
    const responseHeaders = new Headers(corsHeaders());

    // Pass through relevant headers from S3
    const passHeaders = [
      'content-type',
      'content-length',
      'etag',
      'last-modified',
      'content-range',
      'accept-ranges',
    ];
    for (const h of passHeaders) {
      const val = s3Response.headers.get(h);
      if (val) responseHeaders.set(h, val);
    }

    // Keep browser caching conservative while letting Cloudflare edge cache more aggressively.
    if ((method === 'GET' || method === 'HEAD') && s3Response.ok) {
      responseHeaders.set(
        'Cache-Control',
        `${mode === 'inline' ? 'private' : 'public'}, max-age=${BROWSER_CACHE_TTL_SECONDS}`
      );
      responseHeaders.set(
        'Cloudflare-CDN-Cache-Control',
        `public, s-maxage=${EDGE_CACHE_TTL_SECONDS}`
      );
    }

    // Force download if requested
    if (url.searchParams.has('download')) {
      const fileName = key.split('/').pop() || 'download';
      responseHeaders.set('Content-Disposition', `attachment; filename="${fileName}"`);
    }

    return new Response(s3Response.body, {
      status: s3Response.status,
      statusText: s3Response.statusText,
      headers: responseHeaders,
    });
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────

/** KV key prefix for stored configs */
const KV_PREFIX = 'cfg:';

/**
 * Management API: register / remove S3 configs stored in KV.
 * Always requires AUTH_TOKEN.
 */
async function handleManagementApi(request: Request, url: URL, env: Env): Promise<Response> {
  // Auth check
  const token =
    request.headers.get('Authorization')?.replace('Bearer ', '') ||
    url.searchParams.get('token');
  if (!token || token !== env.AUTH_TOKEN) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // Route: /api/configs/{alias}
  const match = url.pathname.match(/^\/api\/configs\/([^/]+)$/);
  if (!match) return json({ error: 'Not found' }, 404);

  const alias = decodeURIComponent(match[1]);

  if (request.method === 'PUT') {
    const body = (await request.json()) as Record<string, string>;
    if (!body.endpoint || !body.region || !body.accessKey || !body.secretKey) {
      return json({ error: 'Missing fields: endpoint, region, accessKey, secretKey' }, 400);
    }
    const cfg: S3Cfg = {
      e: body.endpoint,
      r: body.region,
      a: body.accessKey,
      s: body.secretKey,
    };
    await env.S3_CONFIGS.put(KV_PREFIX + alias, JSON.stringify(cfg));
    setAliasConfigCache(alias, cfg);
    return json({ ok: true, alias });
  }

  if (request.method === 'DELETE') {
    await env.S3_CONFIGS.delete(KV_PREFIX + alias);
    aliasConfigCache.delete(alias);
    return json({ ok: true, alias });
  }

  return json({ error: 'Method not allowed' }, 405);
}

/**
 * Resolve S3 config and path from the request.
 *
 * 1. If inline config is present (X-S3-* headers):
 *    → AUTH_TOKEN required, path = /{bucket}/{key}
 *
 * 2. Otherwise try first path segment as KV alias:
 *    → No auth required, path = /{alias}/{bucket}/{key}
 */
async function resolveRequest(
  request: Request,
  url: URL,
  env: Env
): Promise<ResolvedRequest | Response> {
  const inlineCfg = resolveInlineS3Config(request);

  if (inlineCfg) {
    // Inline mode: requires AUTH_TOKEN
    const token =
      request.headers.get('Authorization')?.replace('Bearer ', '') ||
      url.searchParams.get('token');
    if (!token || token !== env.AUTH_TOKEN) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const parts = url.pathname.slice(1).split('/');
    if (parts.length < 2 || !parts[0]) {
      return json({ error: 'URL must be /{bucket}/{key}' }, 400);
    }
    const bucket = decodeURIComponent(parts[0]);
    const key = parts.slice(1).map(decodeURIComponent).join('/');
    if (!key) return json({ error: 'Object key is required' }, 400);

    return { s3Cfg: inlineCfg, bucket, key, mode: 'inline' };
  }

  // KV alias mode: /{alias}/{bucket}/{key} — no auth needed
  const parts = url.pathname.slice(1).split('/');
  if (parts.length < 3 || !parts[0]) {
    return json({ error: 'URL must be /{alias}/{bucket}/{key}' }, 400);
  }

  const alias = decodeURIComponent(parts[0]);
  const storedCfg = await getStoredS3Config(env, alias);
  if (storedCfg === null) {
    return json({ error: `Unknown alias: ${alias}` }, 404);
  }
  if (storedCfg === 'corrupted') {
    return json({ error: 'Corrupted config in KV' }, 500);
  }

  const bucket = decodeURIComponent(parts[1]);
  const key = parts.slice(2).map(decodeURIComponent).join('/');
  if (!key) return json({ error: 'Object key is required' }, 400);

  return { s3Cfg: storedCfg, bucket, key, mode: 'alias' };
}

/**
 * Try to get S3 config from request headers.
 * Returns null if not present.
 */
function resolveInlineS3Config(request: Request): S3Cfg | null {
  // Try headers first
  const endpoint = request.headers.get('X-S3-Endpoint');
  const region = request.headers.get('X-S3-Region');
  const accessKey = request.headers.get('X-S3-Access-Key');
  const secretKey = request.headers.get('X-S3-Secret-Key');
  if (endpoint && region && accessKey && secretKey) {
    return { e: endpoint, r: region, a: accessKey, s: secretKey };
  }

  return null;
}

async function getStoredS3Config(env: Env, alias: string): Promise<S3Cfg | 'corrupted' | null> {
  const cached = aliasConfigCache.get(alias);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  if (cached) {
    aliasConfigCache.delete(alias);
  }

  const stored = await env.S3_CONFIGS.get(KV_PREFIX + alias);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as S3Cfg;
    if (!parsed.e || !parsed.r || !parsed.a || !parsed.s) {
      return 'corrupted';
    }
    setAliasConfigCache(alias, parsed);
    return parsed;
  } catch {
    return 'corrupted';
  }
}

function setAliasConfigCache(alias: string, cfg: S3Cfg): void {
  aliasConfigCache.set(alias, {
    value: cfg,
    expiresAt: Date.now() + ALIAS_CACHE_TTL_MS,
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range, X-S3-Endpoint, X-S3-Region, X-S3-Access-Key, X-S3-Secret-Key',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified',
    'Access-Control-Max-Age': '86400',
  };
}

// ── AWS Signature V4 ────────────────────────────────────────────────────

interface SignParams {
  method: string;
  url: string;
  region: string;
  accessKey: string;
  secretKey: string;
  body: ReadableStream | null;
  contentType?: string;
  range?: string;
}

async function signRequest(params: SignParams): Promise<Record<string, string>> {
  const { method, url, region, accessKey, secretKey, contentType, range } = params;
  const parsedUrl = new URL(url);

  const service = 's3';
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, '').slice(0, 8);
  const amzDate = dateStamp + 'T' + now.toISOString().replace(/[-:]/g, '').slice(9, 15) + 'Z';

  const credential = `${dateStamp}/${region}/${service}/aws4_request`;

  // For streaming uploads, use UNSIGNED-PAYLOAD
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const headers: Record<string, string> = {
    host: parsedUrl.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) {
    headers['content-type'] = contentType;
  }
  if (range) {
    headers.range = range;
  }

  // Canonical headers (sorted)
  const signedHeaderKeys = Object.keys(headers).sort();
  const signedHeaders = signedHeaderKeys.join(';');
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join('');

  // Canonical request
  const canonicalRequest = [
    method,
    parsedUrl.pathname,
    parsedUrl.search.slice(1), // query string without '?'
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // String to sign
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credential,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  // Signing key
  const kDate = await hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');

  // Signature
  const signature = await hmacHex(kSigning, stringToSign);

  headers['Authorization'] =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credential}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return headers;
}

async function hmac(
  key: string | ArrayBuffer,
  message: string
): Promise<ArrayBuffer> {
  const keyData = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

async function hmacHex(
  key: string | ArrayBuffer,
  message: string
): Promise<string> {
  const sig = await hmac(key, message);
  return bufToHex(sig);
}

async function sha256Hex(message: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return bufToHex(hash);
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
