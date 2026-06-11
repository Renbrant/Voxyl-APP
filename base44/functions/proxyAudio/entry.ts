/**
 * proxyAudio — resolves the final redirect URL of an audio file.
 * Many podcast CDNs block CORS on the original feed URL but allow it
 * on the actual CDN URL after redirects. This function follows redirects
 * server-side and returns the resolved URL + CORS headers.
 *
 * Returns: { resolvedUrl: string, proxied: boolean }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  let audioUrl;
  try {
    const body = await req.json();
    audioUrl = body.audioUrl;
  } catch {
    return Response.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (!audioUrl || !audioUrl.startsWith('http')) {
    return Response.json({ error: 'Missing or invalid audioUrl' }, { status: 400 });
  }

  try {
    // Follow redirects and return the final URL
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let finalUrl = audioUrl;
    try {
      // Use a HEAD request to resolve redirects cheaply
      const res = await fetch(audioUrl, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Voxyl/1.0 Podcast Player' },
        redirect: 'follow',
        signal: controller.signal,
      });
      finalUrl = res.url || audioUrl;
    } finally {
      clearTimeout(timeout);
    }

    return Response.json({ resolvedUrl: finalUrl, proxied: finalUrl !== audioUrl });
  } catch (err) {
    // If HEAD fails, return original URL — client will try directly
    return Response.json({ resolvedUrl: audioUrl, proxied: false });
  }
});