/**
 * proxyAudio — resolves the final redirect URL of a podcast audio file.
 * Includes full SSRF protection: protocol allowlist, private IP blocking,
 * DNS resolution checks, and per-hop re-validation.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── SSRF guard ────────────────────────────────────────────────────────────────

const BLOCKED_CIDRS_V4 = [
  [0x7f000000, 0xff000000],   // 127.0.0.0/8
  [0x0a000000, 0xff000000],   // 10.0.0.0/8
  [0xac100000, 0xfff00000],   // 172.16.0.0/12
  [0xc0a80000, 0xffff0000],   // 192.168.0.0/16
  [0xa9fe0000, 0xffff0000],   // 169.254.0.0/16
  [0xe0000000, 0xf0000000],   // 224.0.0.0/4  multicast
  [0x00000000, 0xffffffff],   // 0.0.0.0/32
];

function ipv4ToInt(addr) {
  const parts = addr.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return null;
  return (parts[0] << 24 | parts[1] << 16 | parts[2] << 8 | parts[3]) >>> 0;
}

function isBlockedIPv4(addr) {
  const n = ipv4ToInt(addr);
  if (n === null) return true;
  return BLOCKED_CIDRS_V4.some(([net, mask]) => (n & mask) >>> 0 === net);
}

function isBlockedIPv6(addr) {
  const lower = addr.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
  const firstWord = parseInt(lower.split(':')[0] || '0', 16);
  if ((firstWord & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((firstWord & 0xffc0) === 0xfe80) return true; // fe80::/10
  return false;
}

async function validateUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false };

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost') return { ok: false };

  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (isBlockedIPv4(hostname)) return { ok: false };
    return { ok: true, url: parsed };
  }

  if (hostname.startsWith('[') || /^[0-9a-f:]+$/i.test(hostname)) {
    if (isBlockedIPv6(hostname)) return { ok: false };
    return { ok: true, url: parsed };
  }

  try {
    const records  = await Deno.resolveDns(hostname, 'A').catch(() => []);
    const records6 = await Deno.resolveDns(hostname, 'AAAA').catch(() => []);
    const all = [...records, ...records6];
    if (all.length === 0) return { ok: false };
    for (const ip of records)  if (isBlockedIPv4(ip)) return { ok: false };
    for (const ip of records6) if (isBlockedIPv6(ip)) return { ok: false };
  } catch {
    return { ok: false };
  }

  return { ok: true, url: parsed };
}

// Follow redirects manually, re-validating every hop
async function resolveAudioUrl(startUrl, maxRedirects = 5) {
  let currentUrl = startUrl;

  for (let i = 0; i <= maxRedirects; i++) {
    const guard = await validateUrl(currentUrl);
    if (!guard.ok) throw new Error('SSRF_BLOCKED');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let res;
    try {
      res = await fetch(currentUrl, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Voxyl/1.0 Podcast Player' },
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const status = res.status;
    if (status >= 300 && status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error('Redirect with no Location');
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    // Final URL reached
    return currentUrl;
  }

  throw new Error('Too many redirects');
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Authentication required
  const me = await base44.auth.me().catch(() => null);
  if (!me) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let audioUrl;
  try {
    const body = await req.json();
    audioUrl = body.audioUrl;
  } catch {
    return Response.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (!audioUrl || typeof audioUrl !== 'string') {
    return Response.json({ error: 'Missing audioUrl' }, { status: 400 });
  }

  // Upfront SSRF validation before any network call
  const guard = await validateUrl(audioUrl);
  if (!guard.ok) return Response.json({ error: 'Invalid or disallowed URL' }, { status: 400 });

  try {
    const finalUrl = await resolveAudioUrl(audioUrl);
    return Response.json({ resolvedUrl: finalUrl, proxied: finalUrl !== audioUrl });
  } catch (err) {
    if (err.message === 'SSRF_BLOCKED') {
      return Response.json({ error: 'Invalid or disallowed URL' }, { status: 400 });
    }
    // If resolution fails, return original URL so the client can try directly
    return Response.json({ resolvedUrl: audioUrl, proxied: false });
  }
});