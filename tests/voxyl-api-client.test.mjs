import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterEach, describe, it, mock } from 'node:test';

async function loadClient() {
  const source = fs
    .readFileSync(new URL('../src/api/voxylApiClient.js', import.meta.url), 'utf8')
    .replaceAll('import.meta.env', '({ VITE_VOXYL_API_URL: "https://api.voxyl.test/api", DEV: false })');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Date.now()}-${Math.random()}`;
  return import(moduleUrl);
}

afterEach(() => {
  mock.restoreAll();
  delete globalThis.window;
});

describe('voxyl API entity client', () => {
  it('fetches known public playlists through the public playlist item endpoint', async () => {
    const { voxylApi, setAuthTokenGetter } = await loadClient();
    setAuthTokenGetter(() => null);

    const knownPlaylists = [
      ['69e30f712334311e3e807257', 'F1 News'],
      ['69e41c3e4da96ab814342bd6', 'Tech & AI Today'],
      ['69e2b5f5a2b7b0a66c197980', 'Fast News Portugues'],
    ];
    const requests = [];
    mock.method(globalThis, 'fetch', async (url) => {
      const requestUrl = new URL(url);
      requests.push(requestUrl);
      const id = requestUrl.pathname.split('/').pop();
      const playlist = knownPlaylists.find(([playlistId]) => playlistId === id);
      return Response.json({
        ok: true,
        playlist: { id: playlist[0], name: playlist[1] },
      });
    });

    const playlists = await Promise.all(
      knownPlaylists.map(([id]) => voxylApi.entities.Playlist.get(id)),
    );

    assert.deepEqual(
      requests.map((requestUrl) => requestUrl.pathname),
      knownPlaylists.map(([id]) => `/api/playlists/${id}`),
    );
    assert.deepEqual(requests.map((requestUrl) => requestUrl.search), ['', '', '']);
    assert.deepEqual(
      playlists.map((playlist) => [playlist.id, playlist.name]),
      knownPlaylists,
    );
  });

  it('encodes playlist ids and normalizes supported item envelopes', async () => {
    const { voxylApi, setAuthTokenGetter } = await loadClient();
    setAuthTokenGetter(() => null);

    const responses = [
      { playlist: { id: 'playlist-envelope' } },
      { item: { id: 'item-envelope' } },
      { data: { id: 'data-envelope' } },
      { id: 'direct-response' },
    ];
    const paths = [];
    mock.method(globalThis, 'fetch', async (url) => {
      const requestUrl = new URL(url);
      paths.push(requestUrl.pathname);
      return Response.json(responses.shift());
    });

    const playlistEnvelope = await voxylApi.entities.Playlist.get('id with spaces/slash');
    const itemEnvelope = await voxylApi.entities.Playlist.get('item');
    const dataEnvelope = await voxylApi.entities.Playlist.get('data');
    const directResponse = await voxylApi.entities.Playlist.get('direct');

    assert.equal(paths[0], '/api/playlists/id%20with%20spaces%2Fslash');
    assert.deepEqual([playlistEnvelope, itemEnvelope, dataEnvelope, directResponse], [
      { id: 'playlist-envelope' },
      { id: 'item-envelope' },
      { id: 'data-envelope' },
      { id: 'direct-response' },
    ]);
  });

  it('rejects missing playlists from the item endpoint instead of returning a public list', async () => {
    const { voxylApi, setAuthTokenGetter } = await loadClient();
    setAuthTokenGetter(() => null);

    let requestUrl;
    mock.method(globalThis, 'fetch', async (url) => {
      requestUrl = new URL(url);
      return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
    });

    await assert.rejects(
      () => voxylApi.entities.Playlist.get('missing-playlist'),
      (error) => error.status === 404 && error.message === 'Not found',
    );
    assert.equal(requestUrl.pathname, '/api/playlists/missing-playlist');
  });

  it('keeps non-playlist entity get requests on the entity item route', async () => {
    const { voxylApi, setAuthTokenGetter } = await loadClient();
    setAuthTokenGetter(() => null);

    let requestUrl;
    mock.method(globalThis, 'fetch', async (url) => {
      requestUrl = new URL(url);
      return Response.json({ item: { id: 'like-1' } });
    });

    const like = await voxylApi.entities.PlaylistLike.get('like-1');

    assert.equal(requestUrl.pathname, '/api/entities/playlist-like/like-1');
    assert.deepEqual(like, { id: 'like-1' });
  });
});

describe('voxyl API auth redirect', () => {
  it('starts Clerk sign-in when redirectToSignIn is available', async () => {
    const { voxylApi } = await loadClient();
    const redirectToSignIn = mock.fn(async (options) => ({ started: true, options }));
    globalThis.window = {
      Clerk: { redirectToSignIn },
      location: { href: 'https://voxyl.test/current' },
    };

    const result = await voxylApi.auth.redirectToLogin('https://voxyl.test/from');

    assert.deepEqual(result, {
      started: true,
      options: { redirectUrl: 'https://voxyl.test/from' },
    });
    assert.equal(redirectToSignIn.mock.callCount(), 1);
  });

  it('throws a descriptive error when Clerk is unavailable', async () => {
    const { voxylApi } = await loadClient();
    globalThis.window = {
      location: { href: 'https://voxyl.test/current' },
    };

    await assert.rejects(
      async () => voxylApi.auth.redirectToLogin('https://voxyl.test/from'),
      (error) => {
        assert.equal(error.code, 'CLERK_NOT_CONFIGURED');
        assert.equal(error.status, 0);
        assert.match(error.message, /not configured/i);
        return true;
      },
    );
  });

  it('rejects instead of resolving when Clerk sign-in is not ready', async () => {
    const { voxylApi } = await loadClient();
    globalThis.window = {
      Clerk: { loaded: false },
      location: { href: 'https://voxyl.test/current' },
    };

    let resolved = false;
    await assert.rejects(
      voxylApi.auth.redirectToLogin('https://voxyl.test/from').then(() => {
        resolved = true;
      }),
      (error) => error.code === 'CLERK_NOT_READY',
    );

    assert.equal(resolved, false);
  });
});
