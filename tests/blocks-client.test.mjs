import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { QueryClient } from '@tanstack/react-query';

import {
  blockQueryKeys,
  filterVisibleCreators,
  isBlockDependentQuery,
  isCreatorHidden,
  normalizeHiddenIds,
  refreshBlockQueries,
} from '../src/lib/blocks.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function seededClient() {
  const client = new QueryClient();
  client.setQueryData(blockQueryKeys.hidden('me'), ['a']);
  client.setQueryData(blockQueryKeys.outbound('me'), [{ id: 'b1' }]);
  client.setQueryData(['home-rankings', 7], { playlists: [] });
  client.setQueryData(['all-playlists-feed'], []);
  client.setQueryData(['explore-playlists', 'q'], []);
  client.setQueryData(['people-summary', 'me'], {});
  client.setQueryData(['people-incoming-accepted', 'me'], []);
  client.setQueryData(['my-playlists', 'me'], []);
  client.setQueryData(['user-podcast-plays', 'me'], []);
  return client;
}

const invalidated = (client, key) => client.getQueryState(key)?.isInvalidated === true;

describe('hidden user ids', () => {
  it('normalizes, trims and de-duplicates ids and drops invalid values', () => {
    assert.deepEqual(normalizeHiddenIds(['a', ' a ', 'b', '', null, 7, undefined, 'b']), ['a', 'b']);
    assert.deepEqual(normalizeHiddenIds(undefined), []);
    assert.deepEqual(normalizeHiddenIds('not-a-list'), []);
  });

  it('matches content to hidden users by the canonical creator_id only', () => {
    const hidden = ['user-1'];
    assert.equal(isCreatorHidden({ creator_id: 'user-1' }, hidden), true);
    assert.equal(isCreatorHidden({ creator_id: 'user-2' }, hidden), false);
    // Usernames and display names must never be treated as identities.
    assert.equal(isCreatorHidden({ creator_id: 'user-2', creator_username: 'user-1', creator_name: 'user-1' }, hidden), false);
    assert.equal(isCreatorHidden({}, hidden), false);
    assert.equal(isCreatorHidden({ creator_id: 'user-1' }, undefined), false);
  });

  it('filters every collection shape the screens pass in', () => {
    const playlists = [{ id: 'p1', creator_id: 'user-1' }, { id: 'p2', creator_id: 'user-2' }, { id: 'p3' }];
    assert.deepEqual(filterVisibleCreators(playlists, ['user-1']).map((p) => p.id), ['p2', 'p3']);
    assert.deepEqual(filterVisibleCreators(undefined, ['user-1']), []);
    assert.deepEqual(filterVisibleCreators(playlists, []).map((p) => p.id), ['p1', 'p2', 'p3']);
  });
});

describe('refreshBlockQueries', () => {
  it('refreshes hidden users, the blocked count and every block-dependent view', async () => {
    const client = seededClient();
    await refreshBlockQueries(client, 'me');

    assert.equal(invalidated(client, blockQueryKeys.hidden('me')), true);
    assert.equal(invalidated(client, blockQueryKeys.outbound('me')), true);
    assert.equal(invalidated(client, ['home-rankings', 7]), true);
    assert.equal(invalidated(client, ['all-playlists-feed']), true);
    assert.equal(invalidated(client, ['explore-playlists', 'q']), true);
    assert.equal(invalidated(client, ['people-summary', 'me']), true);
    assert.equal(invalidated(client, ['people-incoming-accepted', 'me']), true);
  });

  it('leaves unrelated queries alone', async () => {
    const client = seededClient();
    await refreshBlockQueries(client, 'me');

    assert.equal(invalidated(client, ['my-playlists', 'me']), false);
    assert.equal(invalidated(client, ['user-podcast-plays', 'me']), false);
  });

  it('classifies block-dependent queries', () => {
    assert.equal(isBlockDependentQuery({ queryKey: ['people-hidden-users', 'x'] }), true);
    assert.equal(isBlockDependentQuery({ queryKey: ['home-rankings', 1] }), true);
    assert.equal(isBlockDependentQuery({ queryKey: ['my-playlists', 'x'] }), false);
    assert.equal(isBlockDependentQuery({ queryKey: [{ not: 'a string' }] }), false);
    assert.equal(isBlockDependentQuery(undefined), false);
  });

  it('keeps hidden-user and blocked-count queries separate per user', () => {
    assert.notDeepEqual(blockQueryKeys.hidden('a'), blockQueryKeys.hidden('b'));
    assert.notDeepEqual(blockQueryKeys.hidden('a'), blockQueryKeys.outbound('a'));
  });
});

describe('screens use the shared block state', () => {
  it('Home and Discover read hidden users from the shared hook, not local state', () => {
    for (const path of ['src/pages/Feed.jsx', 'src/pages/Explore.jsx']) {
      const source = read(path);
      assert.match(source, /useHiddenUsers\(user\?\.id\)/, `${path} must use useHiddenUsers`);
      assert.doesNotMatch(source, /useState\(\[\]\);?\s*\n[^\n]*blockedIds/, `${path} must not keep a local blockedIds list`);
      assert.doesNotMatch(source, /const \[blockedIds, setBlockedIds\]/, `${path} must not own blockedIds`);
      assert.doesNotMatch(source, /hidden-users-/, `${path} must not use its own hidden-users cache`);
    }
  });

  it('Home filters ranked playlists and Discover filters playlists with the canonical helper', () => {
    assert.match(read('src/pages/Feed.jsx'), /filterVisibleCreators\(homeRankings\?\.playlists, blockedIds\)/);
    assert.match(read('src/pages/Explore.jsx'), /isCreatorHidden\(p, blockedIds\)/);
  });

  it('People shares the hidden-user cache entry with Home and Discover', () => {
    const source = read('src/pages/People.jsx');
    assert.match(source, /queryKey: blockQueryKeys\.hidden\(user\?\.id\)/);
    assert.doesNotMatch(source, /people-hidden-users/);
  });

  it('Settings loads the blocked count on open and does not depend on the modal', () => {
    const settings = read('src/pages/Settings.jsx');
    assert.match(settings, /useOutboundBlocks\(user\?\.id\)/);
    assert.doesNotMatch(settings, /setBlockedCount|\[blockedCount, /);
    assert.doesNotMatch(settings, /onCountChange/);
  });

  it('the Blocked Users modal reads and refreshes the same queries as Settings', () => {
    const modal = read('src/components/profile/BlockedUsersModal.jsx');
    assert.match(modal, /useOutboundBlocks\(user\.id\)/);
    assert.match(modal, /refreshBlockQueries\(queryClient, user\.id\)/);
    assert.doesNotMatch(modal, /listOutbound/);
  });

  it('every place that creates or removes a block refreshes block-dependent views', () => {
    for (const path of [
      'src/components/moderation/ReportBlockMenu.jsx',
      'src/pages/UserProfile.jsx',
      'src/components/profile/FollowRequestsModal.jsx',
    ]) {
      assert.match(read(path), /refreshBlockQueries\(queryClient,/, `${path} must refresh after blocking`);
    }
  });
});
