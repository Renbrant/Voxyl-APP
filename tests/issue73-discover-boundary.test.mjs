import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { DISCOVER_TAB_KEYS, resolveExploreTab } from '../src/lib/discoverTabs.js';

const exploreSource = fs.readFileSync(new URL('../src/pages/Explore.jsx', import.meta.url), 'utf8');
const peopleSource = fs.readFileSync(new URL('../src/pages/People.jsx', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

describe('Issue #73 Discover content boundary', () => {
  it('limits Discover to playlists and podcasts', () => {
    assert.deepEqual(DISCOVER_TAB_KEYS, ['playlists', 'podcasts']);
    assert.equal(resolveExploreTab(null), 'playlists');
    assert.equal(resolveExploreTab('playlists'), 'playlists');
    assert.equal(resolveExploreTab('podcasts'), 'podcasts');
    assert.equal(resolveExploreTab('users'), 'playlists');
    assert.equal(resolveExploreTab('anything-else'), 'playlists');
  });

  it('routes People through a dedicated page', () => {
    assert.match(appSource, /<Route path="\/people"/);
    assert.doesNotMatch(peopleSource, /lockedTab="users"/);
    assert.doesNotMatch(peopleSource, /routeBase="\/people"/);
    assert.doesNotMatch(peopleSource, /from '@\/pages\/Explore'/);
  });
  it('keeps People ownership completely out of Discover', () => {
    const tabsStart = exploreSource.indexOf('const DISCOVER_TABS = [');
    const tabsEnd = exploreSource.indexOf('const sortOptions', tabsStart);

    assert.notEqual(tabsStart, -1);
    assert.notEqual(tabsEnd, -1);

    const tabsSource = exploreSource.slice(tabsStart, tabsEnd);

    assert.match(tabsSource, /key: 'playlists'/);
    assert.match(tabsSource, /key: 'podcasts'/);
    assert.doesNotMatch(tabsSource, /key: 'users'/);
    assert.doesNotMatch(exploreSource, /lockedTab/);
    assert.doesNotMatch(exploreSource, /routeBase/);
    assert.doesNotMatch(exploreSource, /tab === 'users'/);
    assert.doesNotMatch(exploreSource, /invoke\('searchUsers'/);
    assert.doesNotMatch(exploreSource, /UserSearchCard/);
    assert.match(peopleSource, /voxylApi\.people\.summary\(\)/);
    assert.match(peopleSource, /invoke\('searchUsers'/);
    assert.match(peopleSource, /key: 'suggestions'/);
  });
});
