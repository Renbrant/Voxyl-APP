import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterEach, describe, it, mock } from 'node:test';
import worker from '../workers/api/src/index.ts';

const baseEnv = {
  CLERK_AUTHORIZED_PARTIES: 'https://v.renbrant.com,http://localhost:5173',
};
const MIB = 1024 * 1024;
const OLD_RSS_FETCH_MAX_BYTES = 2 * MIB;
const RSS_FETCH_MAX_BYTES = 4 * MIB;

class MemoryKv {
  constructor() {
    this.map = new Map();
  }

  async get(key, type) {
    const value = this.map.get(key) || null;
    return type === 'json' && value ? JSON.parse(value) : value;
  }

  async put(key, value) {
    this.map.set(key, value);
  }
}

function env(overrides = {}) {
  return {
    ...baseEnv,
    VOXYL_CACHE: new MemoryKv(),
    ...overrides,
  };
}

function request(path, body, headers = {}) {
  return new Request(`https://api.voxyl.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function rssFeed(items = '') {
  return `<?xml version="1.0"?>
    <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:media="http://search.yahoo.com/mrss/">
      <channel>
        <title>Test Podcast</title>
        <description><![CDATA[<p>Feed <strong>description</strong></p>]]></description>
        <link>https://podcasts.example.com</link>
        <itunes:author>Feed Author</itunes:author>
        <itunes:image href="https://cdn.example.com/feed.jpg" />
        ${items || `
        <item>
          <guid>episode-1</guid>
          <title>Episode One</title>
          <description><![CDATA[<p>Hello <b>world</b></p>]]></description>
          <enclosure url="https://cdn.example.com/episode-1.mp3?x=1&amp;y=2" type="audio/mpeg" length="123" />
          <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
          <itunes:duration>01:02:03</itunes:duration>
          <itunes:image href="https://cdn.example.com/episode-1.jpg" />
        </item>`}
      </channel>
    </rss>`;
}

function rssFeedWithMinimumBytes(minBytes) {
  const base = rssFeed();
  const paddingSize = Math.max(0, minBytes - new TextEncoder().encode(base).byteLength);
  return base.replace('</channel>', `<docs>${'x'.repeat(paddingSize)}</docs></channel>`);
}

function atomFeed() {
  return `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Atom Podcast</title>
      <subtitle><![CDATA[<p>Atom description</p>]]></subtitle>
      <logo>https://cdn.example.com/atom.jpg</logo>
      <link rel="alternate" href="https://podcasts.example.com/atom" />
      <entry>
        <id>tag:example.com,2024:atom-1</id>
        <title>Atom Episode</title>
        <summary><![CDATA[<p>Atom <em>summary</em></p>]]></summary>
        <link rel="alternate" href="https://podcasts.example.com/atom/1" />
        <link rel="enclosure" href="https://cdn.example.com/atom-1.m4a" type="audio/mp4" />
        <published>2024-01-02T00:00:00Z</published>
      </entry>
    </feed>`;
}

function atomFeedWithAuthors() {
  return `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Authored Atom Podcast</title>
      <author><name>Feed Atom Author</name></author>
      <link rel="alternate" href="https://podcasts.example.com/atom" />
      <entry>
        <id>tag:example.com,2024:atom-author-1</id>
        <title>Authored Atom Episode</title>
        <author><name>Episode Atom Author</name></author>
        <link rel="enclosure" href="https://cdn.example.com/atom-author-1.mp3" type="audio/mpeg" />
        <published>2024-01-02T00:00:00Z</published>
      </entry>
    </feed>`;
}

function megaphoneFeed() {
  return rssFeed(`<item>
    <guid isPermaLink="false">megaphone-episode</guid>
    <title>Megaphone Episode</title>
    <description><![CDATA[<p>Megaphone <strong>description</strong></p>]]></description>
    <enclosure url="https://traffic.megaphone.fm/ADSMOVILESPAASL4011217832.mp3?updated=1&amp;source=rss" type="audio/mpeg" length="12345" />
    <pubDate>Tue, 14 Jul 2026 10:00:00 GMT</pubDate>
    <itunes:author>Megaphone Host</itunes:author>
    <itunes:duration>00:10:00</itunes:duration>
    <itunes:image href="https://megaphone.imgix.net/podcasts/show/episode.jpg" />
  </item>`);
}

function omnyFeed() {
  return rssFeed(`<item>
    <guid>bd27a0a8-30b2-4cc8-b2e8-ac5d0168cd32</guid>
    <title>Omny Episode</title>
    <description><![CDATA[Omny description]]></description>
    <enclosure url="https://www.omnycontent.com/d/clips/episode/audio.mp3" type="audio/mpeg" />
    <pubDate>Tue, 14 Jul 2026 11:00:00 GMT</pubDate>
    <itunes:duration>615</itunes:duration>
    <media:thumbnail url="https://www.omnycontent.com/d/programs/image.jpg" />
  </item>`);
}

function spreakerFeed() {
  return rssFeed(`<item>
    <guid>spreaker-episode</guid>
    <title>Spreaker Episode</title>
    <description><![CDATA[<p>Spreaker description</p>]]></description>
    <enclosure url="https://api.spreaker.com/download/episode/5009509/audio.mp3" type="audio/mpeg" />
    <pubDate>Tue, 14 Jul 2026 12:00:00 GMT</pubDate>
    <itunes:image href="https://d1bm3dmew779uf.cloudfront.net/cover.jpg" />
  </item>`);
}

function globoFeed() {
  return rssFeed(`<item>
    <guid>globo-episode</guid>
    <title>Globo Episode</title>
    <description><![CDATA[<p>Globo Radio description</p>]]></description>
    <media:content url="https://audio.globoradio.globo.com/podcast/audio/episode.mp3" type="audio/mpeg" medium="audio" />
    <pubDate>Tue, 14 Jul 2026 13:00:00 GMT</pubDate>
    <itunes:author>Globo Radio</itunes:author>
  </item>`);
}

function manyPlayableItems(count) {
  return Array.from({ length: count }, (_, index) => `<item>
    <guid>episode-${index}</guid>
    <title>Episode ${index}</title>
    <description><![CDATA[<p>Description ${index}</p>]]></description>
    <enclosure url="https://cdn.example.com/${index}.mp3" type="audio/mpeg" />
    <pubDate>Tue, 14 Jul 2026 10:${String(index % 60).padStart(2, '0')}:00 GMT</pubDate>
  </item>`).join('');
}

function mockFetchSequence(responses, onRequest) {
  let index = 0;
  mock.method(globalThis, 'fetch', async (url, options) => {
    onRequest?.(url, options);
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next instanceof Error || next instanceof DOMException) throw next;
    return next;
  });
}

function xmlResponse(xml, init = {}) {
  return new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'application/rss+xml',
      ...init.headers,
    },
    ...init,
  });
}

function textChunkStream(chunks, hooks = {}) {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      hooks.onPull?.(index);

      if (index >= chunks.length) {
        controller.close();
        return;
      }

      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
    cancel(reason) {
      hooks.onCancel?.(reason, index);
    },
  });
}

function playableItem(index) {
  return `<item><title>Episode ${index}</title><enclosure url="https://cdn.example.com/${index}.mp3" type="audio/mpeg" /></item>`;
}

async function body(response) {
  return response.json();
}

afterEach(() => {
  mock.restoreAll();
});

describe('RSS fetch Worker route', () => {
  it('normalizes a valid RSS 2.0 feed', async () => {
    mockFetchSequence([xmlResponse(rssFeed())]);

    const response = await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env());
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Voxyl-Cache'), 'MISS');
    assert.equal(data.title, 'Test Podcast');
    assert.equal(data.description, 'Feed description');
    assert.equal(data.image, 'https://cdn.example.com/feed.jpg');
    assert.equal(data.author, 'Feed Author');
    assert.equal(data.link, 'https://podcasts.example.com/');
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].guid, 'episode-1');
    assert.equal(data.items[0].audioUrl, 'https://cdn.example.com/episode-1.mp3?x=1&y=2');
    assert.equal(data.items[0].feedUrl, 'https://feeds.example.com/show.xml');
  });

  it('preserves mixed-case RSS pubDate values from the streaming parser', async () => {
    mockFetchSequence([xmlResponse(rssFeed(`<item>
      <guid>mixed-case-date</guid>
      <title>Mixed Case Date</title>
      <enclosure url="https://cdn.example.com/mixed-case-date.mp3" type="audio/mpeg" />
      <pubDate>Tue, 14 Jul 2026 12:00:00 GMT</pubDate>
    </item>`))]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/mixed-case-date.xml' }), env()));

    assert.equal(data.items[0].pubDate, 'Tue, 14 Jul 2026 12:00:00 GMT');
  });

  it('normalizes a valid Atom feed', async () => {
    mockFetchSequence([xmlResponse(atomFeed())]);

    const response = await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/atom.xml' }), env());
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.title, 'Atom Podcast');
    assert.equal(data.items[0].title, 'Atom Episode');
    assert.equal(data.items[0].audioUrl, 'https://cdn.example.com/atom-1.m4a');
    assert.equal(data.items[0].link, 'https://podcasts.example.com/atom/1');
  });

  it('preserves iTunes metadata and duration', async () => {
    mockFetchSequence([xmlResponse(rssFeed())]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env()));

    assert.equal(data.author, 'Feed Author');
    assert.equal(data.items[0].duration, '01:02:03');
    assert.equal(data.items[0].author, 'Feed Author');
  });

  it('uses episode images before feed images', async () => {
    const item = `<item>
      <title>With image</title>
      <enclosure url="https://cdn.example.com/a.mp3" type="audio/mpeg" />
      <media:thumbnail url="https://cdn.example.com/thumb.jpg" />
    </item>`;
    mockFetchSequence([xmlResponse(rssFeed(item))]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env()));

    assert.equal(data.image, 'https://cdn.example.com/feed.jpg');
    assert.equal(data.items[0].image, 'https://cdn.example.com/thumb.jpg');
  });

  it('strips HTML in descriptions', async () => {
    mockFetchSequence([xmlResponse(rssFeed())]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env()));

    assert.equal(data.items[0].description, 'Hello world');
  });

  it('extracts audio enclosures and media:content audio URLs', async () => {
    const item = `<item>
      <title>Media Episode</title>
      <media:content url="https://cdn.example.com/media.mp3" type="audio/mpeg" />
    </item>`;
    mockFetchSequence([xmlResponse(rssFeed(item))]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env()));

    assert.equal(data.items[0].audioUrl, 'https://cdn.example.com/media.mp3');
  });

  it('filters entries without audio', async () => {
    const item = `<item><title>No audio</title><link>https://podcasts.example.com/page</link></item>`;
    mockFetchSequence([xmlResponse(rssFeed(item))]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env()));

    assert.deepEqual(data.items, []);
  });

  it('honors count after normalization', async () => {
    const items = Array.from({ length: 3 }, (_, index) => `<item><title>${index}</title><enclosure url="https://cdn.example.com/${index}.mp3" type="audio/mpeg" /></item>`).join('');
    mockFetchSequence([xmlResponse(rssFeed(items))]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml', count: 2 }), env()));

    assert.equal(data.items.length, 2);
  });

  it('parses RSS across arbitrary chunk and tag boundaries', async () => {
    mockFetchSequence([new Response(textChunkStream([
      '<?xml version="1.0"?><rss><channel><tit',
      'le>Chunked Podcast</title><item><title>Chunk',
      'ed Episode</title><enclosure url="https://cdn.example.com/chunked.mp3" type="audio/mpeg" /></item></channel></rss>',
    ]), { status: 200 })]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/chunked.xml', count: 1 }), env()));

    assert.equal(data.title, 'Chunked Podcast');
    assert.equal(data.items[0].title, 'Chunked Episode');
    assert.equal(data.items[0].audioUrl, 'https://cdn.example.com/chunked.mp3');
  });

  it('parses split CDATA and split XML entities', async () => {
    mockFetchSequence([new Response(textChunkStream([
      '<?xml version="1.0"?><rss><channel><title>Entity Podcast</title><item><title>A &a',
      'mp; B</title><description><![CDATA[<p>Hello ',
      '<strong>CDATA</strong></p>]]></description><enclosure url="https://cdn.example.com/entity.mp3" type="audio/mpeg" /></item></channel></rss>',
    ]), { status: 200 })]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/entity.xml', count: 1 }), env()));

    assert.equal(data.items[0].title, 'A & B');
    assert.equal(data.items[0].description, 'Hello CDATA');
  });

  it('skips non-playable entries and keeps parsing until the requested playable count', async () => {
    const items = [
      '<item><title>No audio</title><link>https://podcasts.example.com/no-audio</link></item>',
      playableItem(1),
      playableItem(2),
    ].join('');
    mockFetchSequence([xmlResponse(rssFeed(items))]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/skip.xml', count: 2 }), env()));

    assert.deepEqual(data.items.map((item) => item.title), ['Episode 1', 'Episode 2']);
  });

  it('cancels the upstream reader after the requested playable count is collected', async () => {
    let canceled = false;
    mockFetchSequence([new Response(textChunkStream([
      `<?xml version="1.0"?><rss><channel><title>Cancel Podcast</title>${playableItem(1)}`,
      `${playableItem(2)}</channel></rss>`,
    ], {
      onCancel: () => { canceled = true; },
    }), { status: 200 })]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/cancel.xml', count: 1 }), env()));

    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].title, 'Episode 1');
    assert.equal(canceled, true);
  });

  it('limits normalized RSS results to the requested count before cache serialization', async () => {
    mockFetchSequence([xmlResponse(rssFeed(manyPlayableItems(250)))]);
    const testEnv = env();

    const response = await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/many.xml', count: 3 }), testEnv);
    const data = await body(response);
    const cacheEntries = [...testEnv.VOXYL_CACHE.map.values()].map((value) => JSON.parse(value));

    assert.equal(response.status, 200);
    assert.equal(data.items.length, 3);
    assert.equal(cacheEntries.length, 1);
    assert.equal(cacheEntries[0].data.items.length, 3);
  });

  it('uses separate cache entries for different requested counts', async () => {
    let calls = 0;
    const testEnv = env();
    mockFetchSequence([
      xmlResponse(rssFeed(manyPlayableItems(10))),
      xmlResponse(rssFeed(manyPlayableItems(10))),
    ], () => { calls += 1; });

    const small = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/counts.xml', count: 2 }), testEnv));
    const larger = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/counts.xml', count: 5 }), testEnv));

    assert.equal(calls, 2);
    assert.equal(small.items.length, 2);
    assert.equal(larger.items.length, 5);
    assert.equal(testEnv.VOXYL_CACHE.map.size, 2);
  });

  it('supports the /api/functions/fetchRSSFeed compatibility route', async () => {
    mockFetchSequence([xmlResponse(rssFeed())]);

    const response = await worker.fetch(request('/api/functions/fetchRSSFeed', { url: 'https://feeds.example.com/show.xml' }), env());

    assert.equal(response.status, 200);
  });

  it('supports the /functions/fetchRSSFeed alias route', async () => {
    mockFetchSequence([xmlResponse(rssFeed())]);

    const response = await worker.fetch(request('/functions/fetchRSSFeed', { url: 'https://feeds.example.com/show.xml' }), env());

    assert.equal(response.status, 200);
  });

  it('allows guest requests without Authorization', async () => {
    let authorization;
    mockFetchSequence([xmlResponse(rssFeed())], (url, options) => { authorization = options.headers.Authorization || options.headers.authorization; });

    const response = await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env());

    assert.equal(response.status, 200);
    assert.equal(authorization, undefined);
  });

  it('returns 400 when URL is missing', async () => {
    const response = await worker.fetch(request('/api/rss/fetch', { count: 1 }), env());
    const data = await body(response);

    assert.equal(response.status, 400);
    assert.equal(data.code, 'missing-feed-url');
  });

  it('returns 400 for malformed JSON', async () => {
    const response = await worker.fetch(request('/api/rss/fetch', '{'), env());
    const data = await body(response);

    assert.equal(response.status, 400);
    assert.equal(data.code, 'invalid-request');
  });

  it('rejects unsupported protocols', async () => {
    const response = await worker.fetch(request('/api/rss/fetch', { url: 'ftp://feeds.example.com/show.xml' }), env());
    const data = await body(response);

    assert.equal(response.status, 400);
    assert.equal(data.code, 'invalid-feed-url');
  });

  it('rejects localhost hosts', async () => {
    const response = await worker.fetch(request('/api/rss/fetch', { url: 'http://localhost/feed.xml' }), env());
    const data = await body(response);

    assert.equal(response.status, 403);
    assert.equal(data.code, 'unsafe-feed-url');
  });

  it('rejects private IPv4 literals', async () => {
    const response = await worker.fetch(request('/api/rss/fetch', { url: 'http://192.168.1.10/feed.xml' }), env());
    const data = await body(response);

    assert.equal(response.status, 403);
    assert.equal(data.code, 'unsafe-feed-url');
  });

  it('rejects private and link-local IPv6 literals', async () => {
    const privateResponse = await worker.fetch(request('/api/rss/fetch', { url: 'http://[::1]/feed.xml' }), env());
    const linkLocalResponse = await worker.fetch(request('/api/rss/fetch', { url: 'http://[fe80::1]/feed.xml' }), env());

    assert.equal(privateResponse.status, 403);
    assert.equal(linkLocalResponse.status, 403);
  });

  it('rejects blocked IPv6 CIDR ranges', async () => {
    const urls = [
      'http://[fe80::1]/feed.xml',
      'http://[fe90::1]/feed.xml',
      'http://[fea0::1]/feed.xml',
      'http://[febf::1]/feed.xml',
      'http://[fc00::1]/feed.xml',
      'http://[fd00::1]/feed.xml',
      'http://[ff02::1]/feed.xml',
      'http://[64:ff9b::c0a8:101]/feed.xml',
    ];

    for (const url of urls) {
      const response = await worker.fetch(request('/api/rss/fetch', { url }), env());
      const data = await body(response);

      assert.equal(response.status, 403, url);
      assert.equal(data.code, 'unsafe-feed-url', url);
    }
  });

  it('does not reject a clearly public IPv6 literal during URL validation', async () => {
    mockFetchSequence([xmlResponse(rssFeed())]);

    const response = await worker.fetch(request('/api/rss/fetch', { url: 'https://[2606:4700:4700::1111]/feed.xml' }), env());

    assert.equal(response.status, 200);
  });

  it('rejects unsafe redirect destinations', async () => {
    mockFetchSequence([new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/feed.xml' } })]);

    const response = await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env());
    const data = await body(response);

    assert.equal(response.status, 403);
    assert.equal(data.code, 'unsafe-feed-url');
  });

  it('preserves requested feedUrl across redirects while resolving relative media from the final URL', async () => {
    const requestedFeedUrl = 'https://feeds.example.com/show';
    const redirectedFeedUrl = 'https://cdn.example.com/podcasts/show/feed.xml';
    const item = `<item>
      <guid>redirected-episode</guid>
      <title>Redirected Episode</title>
      <enclosure url="episodes/one.mp3" type="audio/mpeg" />
    </item>`;
    mockFetchSequence([
      new Response(null, { status: 302, headers: { location: redirectedFeedUrl } }),
      xmlResponse(rssFeed(item)),
    ]);

    const response = await worker.fetch(request('/api/rss/fetch', { url: requestedFeedUrl }), env());
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.feedUrl, requestedFeedUrl);
    assert.equal(data.items[0].feedUrl, requestedFeedUrl);
    assert.equal(data.items[0].audioUrl, 'https://cdn.example.com/podcasts/show/episodes/one.mp3');
    assert.equal(data.items.every((episode) => episode.feedUrl === requestedFeedUrl), true);
  });

  it('enforces the redirect limit', async () => {
    mockFetchSequence(Array.from({ length: 6 }, (_, index) => new Response(null, {
      status: 302,
      headers: { location: `https://feeds.example.com/${index}.xml` },
    })));

    const response = await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env());
    const data = await body(response);

    assert.equal(response.status, 502);
    assert.equal(data.code, 'upstream-unavailable');
  });

  it('uses one global timeout signal across redirects', async () => {
    const signals = [];
    mockFetchSequence([
      new Response(null, { status: 302, headers: { location: 'https://feeds.example.com/final.xml' } }),
      xmlResponse(rssFeed()),
    ], (url, options) => { signals.push(options.signal); });

    const response = await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env());

    assert.equal(response.status, 200);
    assert.equal(signals.length, 2);
    assert.equal(signals[0], signals[1]);
  });

  it('maps upstream timeout to 504', async () => {
    mockFetchSequence([new DOMException('timeout', 'TimeoutError')]);

    const response = await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env());
    const data = await body(response);

    assert.equal(response.status, 504);
    assert.equal(data.code, 'upstream-timeout');
  });

  it('maps timeout while reading the response body to 504', async () => {
    const stream = new ReadableStream({
      pull() {
        throw new DOMException('timeout', 'AbortError');
      },
    });
    mockFetchSequence([new Response(stream, { status: 200 })]);

    const response = await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env());
    const data = await body(response);

    assert.equal(response.status, 504);
    assert.equal(data.code, 'upstream-timeout');
  });

  it('maps non-timeout body stream failures to upstream-unavailable', async () => {
    const stream = new ReadableStream({
      pull() {
        throw new TypeError('connection reset');
      },
    });
    mockFetchSequence([new Response(stream, { status: 200 })]);

    const response = await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env());
    const data = await body(response);

    assert.equal(response.status, 502);
    assert.equal(data.code, 'upstream-unavailable');
  });

  it('accepts valid feeds above the old 2 MiB limit but below 4 MiB', async () => {
    mockFetchSequence([xmlResponse(rssFeedWithMinimumBytes(OLD_RSS_FETCH_MAX_BYTES + 128 * 1024))]);

    const response = await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/large.xml' }), env());
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.title, 'Test Podcast');
    assert.equal(data.items.length, 1);
  });

  it('allows success with Content-Length above 4 MiB when requested episodes are found early', async () => {
    mockFetchSequence([new Response(rssFeed(), {
      status: 200,
      headers: {
        'content-length': String(RSS_FETCH_MAX_BYTES + 1),
        'content-type': 'application/rss+xml',
      },
    })]);

    const response = await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env());
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.items.length, 1);
  });

  it('maps streamed responses over the processed-byte limit to 413 before a usable result', async () => {
    const hugeIncompleteFeed = textChunkStream([
      '<?xml version="1.0"?><rss><channel><title>Huge Podcast</title><docs>',
      'x'.repeat(RSS_FETCH_MAX_BYTES + 1),
      '</docs></channel></rss>',
    ]);
    mockFetchSequence([new Response(hugeIncompleteFeed, { status: 200 })]);

    const response = await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/streamed-large.xml' }), env());
    const data = await body(response);

    assert.equal(response.status, 413);
    assert.equal(data.code, 'feed-too-large');
  });

  it('succeeds for feeds over 4 MiB when requested episodes arrive before the byte limit', async () => {
    let canceled = false;
    mockFetchSequence([new Response(textChunkStream([
      `<?xml version="1.0"?><rss><channel><title>Huge Early Podcast</title>${playableItem(1)}`,
      'x'.repeat(RSS_FETCH_MAX_BYTES + 1),
      '</channel></rss>',
    ], {
      onCancel: () => { canceled = true; },
    }), {
      status: 200,
      headers: { 'content-length': String(RSS_FETCH_MAX_BYTES + 2048) },
    })]);

    const response = await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/huge-early.xml', count: 1 }), env());
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.items.length, 1);
    assert.equal(canceled, true);
  });

  it('maps upstream non-success responses clearly', async () => {
    mockFetchSequence([Response.json({ nope: true }, { status: 500 })]);

    const response = await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env());
    const data = await body(response);

    assert.equal(response.status, 502);
    assert.equal(data.code, 'upstream-unavailable');
  });

  it('maps malformed XML to 422', async () => {
    mockFetchSequence([xmlResponse('<rss><channel><title>broken</title>')]);

    const response = await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env());
    const data = await body(response);

    assert.equal(response.status, 422);
    assert.equal(data.code, 'invalid-feed-xml');
  });

  it('skips image enclosures and uses a later audio enclosure', async () => {
    const item = `<item>
      <title>Mixed enclosures</title>
      <enclosure url="https://cdn.example.com/cover.jpg" type="image/jpeg" />
      <enclosure url="https://cdn.example.com/audio.mp3" type="audio/mpeg" />
    </item>`;
    mockFetchSequence([xmlResponse(rssFeed(item))]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env()));

    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].audioUrl, 'https://cdn.example.com/audio.mp3');
  });

  it('filters feeds containing only an image enclosure', async () => {
    const item = `<item>
      <title>Image only</title>
      <enclosure url="https://cdn.example.com/cover.jpg" type="image/jpeg" />
    </item>`;
    mockFetchSequence([xmlResponse(rssFeed(item))]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env()));

    assert.deepEqual(data.items, []);
  });

  it('accepts audio enclosure URLs without a MIME type', async () => {
    const item = `<item>
      <title>No MIME</title>
      <enclosure url="https://cdn.example.com/audio.flac" />
    </item>`;
    mockFetchSequence([xmlResponse(rssFeed(item))]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env()));

    assert.equal(data.items[0].audioUrl, 'https://cdn.example.com/audio.flac');
  });

  it('accepts generic binary enclosures with audio extensions', async () => {
    const item = `<item>
      <title>Generic binary</title>
      <enclosure url="https://cdn.example.com/audio.mp3" type="application/octet-stream" />
    </item>`;
    mockFetchSequence([xmlResponse(rssFeed(item))]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env()));

    assert.equal(data.items[0].audioUrl, 'https://cdn.example.com/audio.mp3');
  });

  it('does not use audio media:content as episode artwork', async () => {
    const item = `<item>
      <title>Audio media only</title>
      <media:content url="https://cdn.example.com/episode.mp3" type="audio/mpeg" />
    </item>`;
    mockFetchSequence([xmlResponse(rssFeed(item))]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), env()));

    assert.equal(data.items[0].audioUrl, 'https://cdn.example.com/episode.mp3');
    assert.equal(data.items[0].image, 'https://cdn.example.com/feed.jpg');
  });

  it('normalizes standard Atom author name structures', async () => {
    mockFetchSequence([xmlResponse(atomFeedWithAuthors())]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/atom.xml' }), env()));

    assert.equal(data.author, 'Feed Atom Author');
    assert.equal(data.items[0].author, 'Episode Atom Author');
  });

  it('normalizes Megaphone-like feeds', async () => {
    mockFetchSequence([xmlResponse(megaphoneFeed())]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.megaphone.fm/ADSMOVILESPAASL4011217832' }), env()));

    assert.equal(data.items[0].title, 'Megaphone Episode');
    assert.equal(data.items[0].audioUrl, 'https://traffic.megaphone.fm/ADSMOVILESPAASL4011217832.mp3?updated=1&source=rss');
    assert.equal(data.items[0].description, 'Megaphone description');
    assert.equal(data.items[0].author, 'Megaphone Host');
    assert.equal(data.items[0].duration, '00:10:00');
    assert.equal(data.items[0].feedUrl, 'https://feeds.megaphone.fm/ADSMOVILESPAASL4011217832');
  });

  it('normalizes Omny-like feeds', async () => {
    mockFetchSequence([xmlResponse(omnyFeed())]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://www.omnycontent.com/d/playlist/show/podcast.rss' }), env()));

    assert.equal(data.items[0].title, 'Omny Episode');
    assert.equal(data.items[0].audioUrl, 'https://www.omnycontent.com/d/clips/episode/audio.mp3');
    assert.equal(data.items[0].image, 'https://www.omnycontent.com/d/programs/image.jpg');
    assert.equal(data.items[0].duration, '615');
  });

  it('normalizes Spreaker-like feeds', async () => {
    mockFetchSequence([xmlResponse(spreakerFeed())]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://www.spreaker.com/show/5009509/episodes/feed' }), env()));

    assert.equal(data.items[0].title, 'Spreaker Episode');
    assert.equal(data.items[0].audioUrl, 'https://api.spreaker.com/download/episode/5009509/audio.mp3');
    assert.equal(data.items[0].image, 'https://d1bm3dmew779uf.cloudfront.net/cover.jpg');
  });

  it('normalizes Globo-like feeds', async () => {
    mockFetchSequence([xmlResponse(globoFeed())]);

    const data = await body(await worker.fetch(request('/api/rss/fetch', { url: 'https://audio.globoradio.globo.com/podcast/feed/529/cbn-primeiras-noticias' }), env()));

    assert.equal(data.items[0].title, 'Globo Episode');
    assert.equal(data.items[0].audioUrl, 'https://audio.globoradio.globo.com/podcast/audio/episode.mp3');
    assert.equal(data.items[0].author, 'Globo Radio');
  });

  it('uses fresh KV cache hits without a second origin fetch', async () => {
    let calls = 0;
    const testEnv = env();
    mockFetchSequence([xmlResponse(rssFeed())], () => { calls += 1; });

    await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), testEnv);
    const response = await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), testEnv);

    assert.equal(response.headers.get('X-Voxyl-Cache'), 'HIT');
    assert.equal(calls, 1);
  });

  it('returns stale cache when origin fetching fails', async () => {
    const testEnv = env();
    mockFetchSequence([xmlResponse(rssFeed())]);
    await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), testEnv);

    for (const [key, value] of testEnv.VOXYL_CACHE.map.entries()) {
      const entry = JSON.parse(value);
      entry.cachedAt = Date.now() - 60 * 60 * 1000;
      testEnv.VOXYL_CACHE.map.set(key, JSON.stringify(entry));
    }

    mock.restoreAll();
    mockFetchSequence([new Error('network')]);

    const response = await worker.fetch(request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }), testEnv);
    const data = await body(response);

    assert.equal(response.headers.get('X-Voxyl-Cache'), 'STALE');
    assert.equal(data.title, 'Test Podcast');
  });

  it('preserves CORS headers for allowed origins', async () => {
    mockFetchSequence([xmlResponse(rssFeed())]);

    const response = await worker.fetch(
      request('/api/rss/fetch', { url: 'https://feeds.example.com/show.xml' }, { origin: 'https://v.renbrant.com' }),
      env(),
    );

    assert.equal(response.headers.get('access-control-allow-origin'), 'https://v.renbrant.com');
  });

  it('keeps every normalized episode tied to its feedUrl', async () => {
    const source = fs.readFileSync(new URL('../workers/api/src/index.ts', import.meta.url), 'utf8');

    assert.match(source, /feedUrl:\s*feed\.feedUrl/);
  });

  it('keeps RSS parsing bounded by the requested count', async () => {
    const source = fs.readFileSync(new URL('../workers/api/src/index.ts', import.meta.url), 'utf8');

    assert.match(source, /function parseNormalizedFeedStream\(/);
    assert.match(source, /if \(items\.length >= count\) {\s*completedEarly = true;\s*throw new RssFeedComplete\(\);/);
    assert.match(source, /await reader\.cancel\(\)/);
    assert.match(source, /parseNormalizedFeedStream\(response, payload\.url, finalUrl, payload\.count\)/);
  });
});
