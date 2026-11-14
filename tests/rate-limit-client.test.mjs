import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getPlaylistCreationErrorKey } from '../src/lib/playlistCreation.js';
import { queryClientInstance } from '../src/lib/query-client.js';

describe('rate limit messages', () => {
  it('shows the rate limit message when playlist creation is limited', () => {
    assert.equal(getPlaylistCreationErrorKey({ status: 429 }), 'rateLimitGeneric');
    assert.equal(getPlaylistCreationErrorKey({ code: 'rate-limited', status: 429 }), 'rateLimitGeneric');
  });

  it('keeps existing playlist creation messages unchanged', () => {
    assert.equal(getPlaylistCreationErrorKey({ code: 'playlist-limit' }), 'playlistCreateLimit');
    assert.equal(getPlaylistCreationErrorKey({ status: 400 }), 'playlistCreateInvalid');
  });
});

describe('query retries', () => {
  const retry = queryClientInstance.getDefaultOptions().queries.retry;

  it('does not retry a rate-limited query, so the block is not extended', () => {
    assert.equal(retry(0, { status: 429 }), false);
    assert.equal(retry(0, { code: 'rate-limited' }), false);
  });

  it('keeps a single retry for other failures', () => {
    assert.equal(retry(0, new Error('network')), true);
    assert.equal(retry(1, new Error('network')), false);
  });
});
