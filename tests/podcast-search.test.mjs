import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it, mock } from 'node:test';
import worker, { generatePodcastIndexAuthHeaders } from '../workers/api/src/index.ts';
import { getPodcastSearchErrorMessage } from '../src/lib/podcastSearchErrors.js';

const env = {
  PODCAST_INDEX_API_KEY: 'test-key',
  PODCAST_INDEX_API_SECRET: 'test-secret',
  CLERK_AUTHORIZED_PARTIES: 'https://v.renbrant.com,http://localhost:5173',
};

function jsonRequest(path, body, headers = {}) {
  return new Request(`https://api.voxyl.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function json(response) {
  return response.json();
}

function mockProvider(body, status = 200, onRequest) {
  mock.method(globalThis, 'fetch', async (url, options) => {
    onRequest?.(url, options);
    return Response.json(body, { status });
  });
}

describe('Podcast Index auth', () => {
  it('generates the expected SHA-1 authorization headers', async () => {
    const headers = await generatePodcastIndexAuthHeaders('key', 'secret', 1700000000);

    assert.equal(headers['X-Auth-Date'], '1700000000');
    assert.equal(headers['X-Auth-Key'], 'key');
    assert.equal(headers.Authorization, 'abaf71c02050c31e4d4e6b08c1625173af0445ba');
    assert.match(headers['User-Agent'], /^Voxyl\/3\.0/);
  });
});

describe('podcast search Worker route', () => {
  it('returns 400 when query is missing', async () => {
    const response = await worker.fetch(jsonRequest('/api/functions/searchPodcasts', { query: '   ' }), env);
    const body = await json(response);

    assert.equal(response.status, 400);
    assert.equal(body.code, 'invalid-request');
  });

  it('returns 400 for malformed request bodies', async () => {
    const response = await worker.fetch(jsonRequest('/api/functions/searchPodcasts', '{'), env);
    const body = await json(response);

    assert.equal(response.status, 400);
    assert.equal(body.code, 'invalid-request');
  });

  it('returns 503 when Podcast Index secrets are missing', async () => {
    const response = await worker.fetch(jsonRequest('/api/functions/searchPodcasts', { query: 'Bible' }), {
      CLERK_AUTHORIZED_PARTIES: '',
    });
    const body = await json(response);

    assert.equal(response.status, 503);
    assert.equal(body.code, 'provider-configuration');
  });

  it('normalizes provider success responses on the compatibility route', async () => {
    mockProvider({
      feeds: [{
        id: 123,
        title: 'Bible in a Year',
        author: 'Voxyl Test',
        description: '<p>Daily Bible</p>',
        image: 'https://example.com/image.jpg',
        url: 'https://example.com/feed.xml',
        link: 'https://example.com',
        language: 'en',
        categories: { 55: 'News' },
        episodeCount: 365,
        newestItemPublishTime: 1700000010,
        oldestItemPublishTime: 1600000010,
        lastUpdateTime: 1700000000,
      }],
    });

    const response = await worker.fetch(jsonRequest('/api/functions/searchPodcasts', { query: 'Bible' }), env);
    const body = await json(response);

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.results.length, 1);
    assert.deepEqual(body.results[0], {
      id: '123',
      title: 'Bible in a Year',
      author: 'Voxyl Test',
      description: '<p>Daily Bible</p>',
      image: 'https://example.com/image.jpg',
      feedUrl: 'https://example.com/feed.xml',
      website: 'https://example.com',
      language: 'en',
      categories: { 55: 'News' },
      episodeCount: 365,
      latestPublishTime: 1700000010,
      oldestPublishTime: 1600000010,
      lastUpdateTime: 1700000000,
    });
  });

  it('normalizes id and numeric fields when they arrive as strings', async () => {
    mockProvider({
      feeds: [{
        id: '456',
        title: 'String Numbers',
        url: 'https://example.com/string.xml',
        episodeCount: '12',
        newestItemPublishTime: '1700000100',
        oldestItemPublishTime: '1690000100',
        lastUpdateTime: '1700000099',
      }],
    });

    const response = await worker.fetch(jsonRequest('/api/podcasts/search', { query: 'numbers' }), env);
    const body = await json(response);

    assert.equal(body.results[0].id, '456');
    assert.equal(body.results[0].episodeCount, 12);
    assert.equal(body.results[0].latestPublishTime, 1700000100);
    assert.equal(body.results[0].oldestPublishTime, 1690000100);
    assert.equal(body.results[0].lastUpdateTime, 1700000099);
  });

  it('generates documented provider URL parameters for popularity searches', async () => {
    let providerUrl;
    mockProvider({ feeds: [] }, 200, (url) => { providerUrl = new URL(url); });

    const response = await worker.fetch(jsonRequest('/api/podcasts/search', { query: 'Bible', sortBy: 'popularity' }), env);

    assert.equal(response.status, 200);
    assert.equal(providerUrl.origin, 'https://api.podcastindex.org');
    assert.equal(providerUrl.pathname, '/api/1.0/search/byterm');
    assert.equal(providerUrl.searchParams.get('q'), 'Bible');
    assert.equal(providerUrl.searchParams.get('max'), '100');
    assert.equal(providerUrl.searchParams.has('fulltext'), true);
    assert.equal(providerUrl.searchParams.has('similar'), true);
    assert.equal(providerUrl.searchParams.has('sort'), false);
  });

  it('filters results by requested language', async () => {
    mockProvider({
      feeds: [
        { id: 1, title: 'English Show', url: 'https://example.com/en.xml', language: 'en-US' },
        { id: 2, title: 'Portuguese Show', url: 'https://example.com/pt.xml', language: 'pt-BR' },
      ],
    });

    const response = await worker.fetch(jsonRequest('/api/podcasts/search', { query: 'show', language: 'pt' }), env);
    const body = await json(response);

    assert.deepEqual(body.results.map((podcast) => podcast.title), ['Portuguese Show']);
  });

  it('prioritizes mapped category matches without discarding other results', async () => {
    mockProvider({
      feeds: [
        { id: 1, title: 'General Show', url: 'https://example.com/general.xml', categories: { 55: 'News' } },
        { id: 2, title: 'Tech Show', url: 'https://example.com/tech.xml', categories: { 102: 'Technology' } },
      ],
    });

    const response = await worker.fetch(jsonRequest('/api/podcasts/search', { query: 'show', category: 'technology' }), env);
    const body = await json(response);

    assert.deepEqual(body.results.map((podcast) => podcast.title), ['Tech Show', 'General Show']);
  });

  it('reports unknown categories in meta.ignoredFilters', async () => {
    mockProvider({ feeds: [] });

    const response = await worker.fetch(jsonRequest('/api/podcasts/search', { query: 'show', category: 'mystery' }), env);
    const body = await json(response);

    assert.deepEqual(body.meta.ignoredFilters, ['category']);
  });

  it('sorts frequency by episodes per publishing day', async () => {
    mockProvider({
      feeds: [
        {
          id: 1,
          title: 'Slow Daily',
          url: 'https://example.com/slow.xml',
          episodeCount: 10,
          oldestItemPublishTime: 1700000000,
          newestItemPublishTime: 1700864000,
        },
        {
          id: 2,
          title: 'Fast Daily',
          url: 'https://example.com/fast.xml',
          episodeCount: 6,
          oldestItemPublishTime: 1700000000,
          newestItemPublishTime: 1700172800,
        },
      ],
    });

    const response = await worker.fetch(jsonRequest('/api/podcasts/search', { query: 'daily', sortBy: 'frequency' }), env);
    const body = await json(response);

    assert.deepEqual(body.results.map((podcast) => podcast.title), ['Fast Daily', 'Slow Daily']);
  });

  it('does not send maxDuration from Explore podcast directory search', () => {
    const exploreSource = fs.readFileSync(new URL('../src/pages/Explore.jsx', import.meta.url), 'utf8');
    const searchCall = exploreSource.slice(exploreSource.indexOf("voxylApi.functions.invoke('searchPodcasts'"));

    assert.equal(/maxDuration/.test(searchCall.slice(0, searchCall.indexOf('})') + 2)), false);
  });

  it('returns valid zero results on the REST route', async () => {
    mockProvider({ feeds: [] });

    const response = await worker.fetch(jsonRequest('/api/podcasts/search', { query: 'zzzzzzzzzzvoxylnone' }), env);
    const body = await json(response);

    assert.equal(response.status, 200);
    assert.deepEqual(body.results, []);
  });

  it('maps provider 401 to provider-authentication', async () => {
    mockProvider({ status: 'false' }, 401);

    const response = await worker.fetch(jsonRequest('/api/podcasts/search', { query: 'news' }), env);
    const body = await json(response);

    assert.equal(response.status, 502);
    assert.equal(body.code, 'provider-authentication');
  });

  it('maps provider 429 to provider-rate-limit', async () => {
    mockProvider({ status: 'false' }, 429);

    const response = await worker.fetch(jsonRequest('/api/podcasts/search', { query: 'news' }), env);
    const body = await json(response);

    assert.equal(response.status, 429);
    assert.equal(body.code, 'provider-rate-limit');
  });

  it('maps provider timeout', async () => {
    mock.method(globalThis, 'fetch', async () => {
      throw new DOMException('timeout', 'TimeoutError');
    });

    const response = await worker.fetch(jsonRequest('/api/podcasts/search', { query: 'news' }), env);
    const body = await json(response);

    assert.equal(response.status, 504);
    assert.equal(body.code, 'provider-timeout');
  });

  it('maps malformed provider responses', async () => {
    mockProvider({ items: [] });

    const response = await worker.fetch(jsonRequest('/api/podcasts/search', { query: 'news' }), env);
    const body = await json(response);

    assert.equal(response.status, 502);
    assert.equal(body.code, 'provider-response');
  });

  it('allows guest and authenticated podcast searches without calling /api/me', async () => {
    let calls = 0;
    mockProvider({ feeds: [] }, 200, () => { calls += 1; });

    const guestResponse = await worker.fetch(jsonRequest('/api/podcasts/search', { query: 'technology' }), env);
    const authResponse = await worker.fetch(
      jsonRequest('/api/podcasts/search', { query: 'technology' }, { authorization: 'Bearer fake-token' }),
      env,
    );

    assert.equal(guestResponse.status, 200);
    assert.equal(authResponse.status, 200);
    assert.equal(calls, 2);
  });

  it('handles CORS preflight from the production and local origins', async () => {
    const productionResponse = await worker.fetch(new Request('https://api.voxyl.test/api/podcasts/search', {
      method: 'OPTIONS',
      headers: { origin: 'https://v.renbrant.com' },
    }), env);
    const localResponse = await worker.fetch(new Request('https://api.voxyl.test/api/podcasts/search', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5173' },
    }), env);

    assert.equal(productionResponse.status, 204);
    assert.equal(productionResponse.headers.get('access-control-allow-origin'), 'https://v.renbrant.com');
    assert.equal(localResponse.status, 204);
    assert.equal(localResponse.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  });
});

describe('frontend podcast search messages', () => {
  it('distinguishes backend failures from true zero results', () => {
    assert.match(getPodcastSearchErrorMessage({ status: 503, data: { code: 'provider-configuration' } }), /configurada/);
    assert.match(getPodcastSearchErrorMessage({ status: 504, data: { code: 'provider-timeout' } }), /demorou/);
    assert.match(getPodcastSearchErrorMessage({ status: 429, data: { code: 'provider-rate-limit' } }), /ocupada/);
    assert.equal(getPodcastSearchErrorMessage(null), 'Não foi possível buscar podcasts. Tente novamente.');
  });
});
