import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── SSRF guard ────────────────────────────────────────────────────────────────

const BLOCKED_CIDRS_V4 = [
  [0x7f000000, 0xff000000],   // 127.0.0.0/8  — loopback
  [0x0a000000, 0xff000000],   // 10.0.0.0/8   — private
  [0xac100000, 0xfff00000],   // 172.16.0.0/12 — private
  [0xc0a80000, 0xffff0000],   // 192.168.0.0/16 — private
  [0xa9fe0000, 0xffff0000],   // 169.254.0.0/16 — link-local / metadata
  [0xe0000000, 0xf0000000],   // 224.0.0.0/4  — multicast
  [0x00000000, 0xffffffff],   // 0.0.0.0/32
];

function ipv4ToInt(addr) {
  const parts = addr.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return null;
  return (parts[0] << 24 | parts[1] << 16 | parts[2] << 8 | parts[3]) >>> 0;
}

function isBlockedIPv4(addr) {
  const n = ipv4ToInt(addr);
  if (n === null) return true; // unparseable → block
  return BLOCKED_CIDRS_V4.some(([net, mask]) => (n & mask) >>> 0 === net);
}

function isBlockedIPv6(addr) {
  const lower = addr.toLowerCase().replace(/^\[|\]$/g, '');
  // loopback ::1
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
  // fc00::/7 — unique local
  const firstWord = parseInt(lower.split(':')[0] || '0', 16);
  if ((firstWord & 0xfe00) === 0xfc00) return true;
  // fe80::/10 — link-local
  if ((firstWord & 0xffc0) === 0xfe80) return true;
  return false;
}

async function validateUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false };
  }

  // Only http and https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false };

  const hostname = parsed.hostname.toLowerCase();

  // Block plain "localhost"
  if (hostname === 'localhost') return { ok: false };

  // If it's already a bare IPv4, validate directly without DNS
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (isBlockedIPv4(hostname)) return { ok: false };
    return { ok: true, url: parsed };
  }

  // IPv6 literal
  if (hostname.startsWith('[') || /^[0-9a-f:]+$/i.test(hostname)) {
    if (isBlockedIPv6(hostname)) return { ok: false };
    return { ok: true, url: parsed };
  }

  // DNS resolve and check every returned address
  try {
    const records = await Deno.resolveDns(hostname, 'A').catch(() => []);
    const records6 = await Deno.resolveDns(hostname, 'AAAA').catch(() => []);
    const all = [...records, ...records6];
    if (all.length === 0) return { ok: false }; // unresolvable
    for (const ip of records)  if (isBlockedIPv4(ip)) return { ok: false };
    for (const ip of records6) if (isBlockedIPv6(ip)) return { ok: false };
  } catch {
    return { ok: false };
  }

  return { ok: true, url: parsed };
}

// Manual redirect follower — re-validates every hop
async function safeFetch(startUrl, options = {}, maxRedirects = 5) {
  const { timeoutMs = 15000, method = 'GET', headers = {} } = options;
  let currentUrl = startUrl;

  for (let i = 0; i <= maxRedirects; i++) {
    const guard = await validateUrl(currentUrl);
    if (!guard.ok) throw new Error('SSRF_BLOCKED');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(currentUrl, {
        method,
        headers: { 'User-Agent': 'Voxyl/1.0 RSS Reader', ...headers },
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const status = res.status;
    if (status >= 300 && status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error('Redirect with no Location header');
      // Resolve relative redirects
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return { res, finalUrl: currentUrl };
  }

  throw new Error('Too many redirects');
}

// ── RSS parsing ───────────────────────────────────────────────────────────────

function getTagValue(xml, tag) {
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'),
  ];
  for (const re of patterns) {
    const m = xml.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

function parseItems(xml) {
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  const items = [];
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const title = getTagValue(item, 'title') || '';
    const pubDate = getTagValue(item, 'pubDate') || '';
    const duration = getTagValue(item, 'itunes:duration') || getTagValue(item, 'duration') || null;
    const enclosureMatch = item.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*>/i);
    const audioUrl = enclosureMatch ? enclosureMatch[1] : null;
    if (!audioUrl) continue;
    const itunesImgMatch = item.match(/<itunes:image[^>]*href=["']([^"']+)["'][^>]*>/i);
    const mediaThumbnailMatch = item.match(/<media:thumbnail[^>]*url=["']([^"']+)["'][^>]*>/i);
    const image = itunesImgMatch?.[1] || mediaThumbnailMatch?.[1] || null;
    const descRaw = getTagValue(item, 'description') || getTagValue(item, 'itunes:summary') || '';
    const description = descRaw.replace(/<[^>]*>/g, '').slice(0, 200).trim();
    items.push({ title, audioUrl, pubDate, duration, image, description });
  }
  return items;
}

function parseFeedMeta(xml) {
  const channelMatch = xml.match(/<channel[\s>]([\s\S]*?)<\/channel>/i);
  if (!channelMatch) return { title: '', image: '', author: '', description: '' };
  const channel = channelMatch[1];
  const title = getTagValue(channel, 'title') || '';
  const itunesImgMatch = channel.match(/<itunes:image[^>]*href=["']([^"']+)["'][^>]*>/i);
  const imgTagMatch = channel.match(/<image[\s>][\s\S]*?<url>([\s\S]*?)<\/url>/i);
  const image = itunesImgMatch?.[1] || imgTagMatch?.[1]?.trim() || '';
  const author = getTagValue(channel, 'itunes:author') || getTagValue(channel, 'managingEditor') || '';
  const descRaw = getTagValue(channel, 'description') || getTagValue(channel, 'itunes:summary') || '';
  const description = descRaw.replace(/<[^>]*>/g, '').slice(0, 300).trim();
  return { title, image, author, description };
}

// ── Handler ───────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_RSS_BYTES = 5 * 1024 * 1024; // 5 MB

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Authentication required
  const me = await base44.auth.me().catch(() => null);
  if (!me) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let url, count;
  try {
    const body = await req.json();
    url = body.url;
    count = body.count || 30;
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!url || typeof url !== 'string') return Response.json({ error: 'Missing url' }, { status: 400 });

  // SSRF: validate URL before touching cache or network
  const guard = await validateUrl(url);
  if (!guard.ok) return Response.json({ error: 'Invalid or disallowed URL' }, { status: 400 });

  // Load any existing cache entry
  let cachedEntry = null;
  try {
    const cached = await base44.asServiceRole.entities.RSSCache.filter({ feed_url: url });
    if (cached.length > 0) cachedEntry = cached[0];
  } catch {}

  // Serve from cache if fresh enough
  if (cachedEntry) {
    const age = Date.now() - new Date(cachedEntry.cached_at).getTime();
    if (age < CACHE_TTL_MS) {
      const data = JSON.parse(cachedEntry.data);
      return Response.json({ ...data, items: data.items.slice(0, count) });
    }
  }

  // Fetch fresh with SSRF-safe follower
  try {
    const { res, finalUrl } = await safeFetch(url, { timeoutMs: 15000 });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Enforce max response size
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RSS_BYTES) throw new Error('Feed too large');
      chunks.push(value);
    }
    const xml = new TextDecoder().decode(
      chunks.reduce((acc, c) => { const merged = new Uint8Array(acc.length + c.length); merged.set(acc); merged.set(c, acc.length); return merged; }, new Uint8Array(0))
    );

    const meta = parseFeedMeta(xml);
    const allItems = parseItems(xml);
    const items = allItems.slice(0, 100).map(item => ({
      ...item,
      image: item.image || meta.image,
      feedTitle: meta.title,
      feedUrl: finalUrl,
    }));

    const payload = { title: meta.title, image: meta.image, author: meta.author, description: meta.description, items };

    // Save/update cache
    const cachePayload = { ...payload, items: items.slice(0, 30) };
    const now = new Date().toISOString();
    try {
      if (cachedEntry) {
        base44.asServiceRole.entities.RSSCache.update(cachedEntry.id, { data: JSON.stringify(cachePayload), cached_at: now }).catch(() => {});
      } else {
        base44.asServiceRole.entities.RSSCache.create({ feed_url: url, data: JSON.stringify(cachePayload), cached_at: now }).catch(() => {});
      }
    } catch {}

    return Response.json({ ...payload, items: items.slice(0, count) });

  } catch (error) {
    // Never leak internal details
    if (error.message === 'SSRF_BLOCKED') {
      return Response.json({ error: 'Invalid or disallowed URL' }, { status: 400 });
    }
    // Return stale cache rather than an error so the app never shows empty
    if (cachedEntry) {
      const data = JSON.parse(cachedEntry.data);
      return Response.json({ ...data, items: data.items.slice(0, count), stale: true });
    }
    return Response.json({ error: 'Failed to fetch feed' }, { status: 502 });
  }
});