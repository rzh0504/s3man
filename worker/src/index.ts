/**
 * s3man – Cloudflare Worker Proxy for S3-compatible storage
 *
 * A generic S3 reverse proxy — S3 credentials are passed per-request
 * from the app, so one Worker serves all providers with no env-var setup.
 *
 * Deploy: wrangler deploy
 *
 * Environment variables (set via wrangler secret):
 *   AUTH_TOKEN — Bearer token required for all requests
 *
 * S3 config is passed via request headers:
 *   X-S3-Endpoint   — e.g. https://s3.us-west-004.backblazeb2.com
 *   X-S3-Region     — e.g. us-west-004
 *   X-S3-Access-Key — S3 access key ID
 *   X-S3-Secret-Key — S3 secret access key
 *
 * Or via a single query param for Image/Video component compatibility:
 *   ?s3cfg=<base64url-encoded JSON of {e,r,a,s}>
 *
 * URL pattern: https://your-worker.domain/{bucket}/{key}
 *
 * Optional query params:
 *   ?download=1  — Force Content-Disposition: attachment
 */

export interface Env {
  AUTH_TOKEN: string;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // ── CORS preflight ──────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    // ── Auth ────────────────────────────────────────────────────
    const url = new URL(request.url);
    const authHeader = request.headers.get('Authorization');
    const tokenParam = url.searchParams.get('token');
    const token = authHeader?.replace('Bearer ', '') || tokenParam;
    if (!token || token !== env.AUTH_TOKEN) {
      return json({ error: 'Unauthorized' }, 401);
    }

    // ── Parse path: /{bucket}/{...key} ──────────────────────────
    const parts = url.pathname.slice(1).split('/');
    if (parts.length < 2 || !parts[0]) {
      return json({ error: 'URL must be /{bucket}/{key}' }, 400);
    }

    const bucket = decodeURIComponent(parts[0]);
    const key = parts.slice(1).map(decodeURIComponent).join('/');
    if (!key) {
      return json({ error: 'Object key is required' }, 400);
    }

    // ── Resolve S3 config (headers or ?s3cfg query param) ───────
    const s3Cfg = resolveS3Config(request, url);
    if (!s3Cfg) {
      return json({ error: 'Missing S3 config. Provide X-S3-* headers or ?s3cfg= param' }, 400);
    }

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
    });

    const s3Request: RequestInit = {
      method,
      headers: s3Headers,
    };

    if (method === 'PUT') {
      s3Request.body = request.body;
      // @ts-expect-error - Cloudflare Workers support duplex streaming
      s3Request.duplex = 'half';
    }

    // ── Forward to S3 ───────────────────────────────────────────
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

    // Cache control for GET requests on static assets
    if (method === 'GET' && s3Response.ok) {
      responseHeaders.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
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

/**
 * Resolve S3 config from request headers or ?s3cfg query param.
 * Headers take priority.
 */
function resolveS3Config(request: Request, url: URL): S3Cfg | null {
  // Try headers first
  const endpoint = request.headers.get('X-S3-Endpoint');
  const region = request.headers.get('X-S3-Region');
  const accessKey = request.headers.get('X-S3-Access-Key');
  const secretKey = request.headers.get('X-S3-Secret-Key');
  if (endpoint && region && accessKey && secretKey) {
    return { e: endpoint, r: region, a: accessKey, s: secretKey };
  }

  // Fallback: ?s3cfg=<base64url JSON>
  const cfgParam = url.searchParams.get('s3cfg');
  if (cfgParam) {
    try {
      const decoded = atob(cfgParam.replace(/-/g, '+').replace(/_/g, '/'));
      const cfg = JSON.parse(decoded) as S3Cfg;
      if (cfg.e && cfg.r && cfg.a && cfg.s) return cfg;
    } catch {
      // invalid base64/json
    }
  }

  return null;
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
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-S3-Endpoint, X-S3-Region, X-S3-Access-Key, X-S3-Secret-Key',
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
}

async function signRequest(params: SignParams): Promise<Record<string, string>> {
  const { method, url, region, accessKey, secretKey, contentType } = params;
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
