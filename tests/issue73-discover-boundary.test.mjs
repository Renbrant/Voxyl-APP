import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { DISCOVER_TAB_KEYS, resolveExploreTab } from '../src/lib/discoverTabs.js';

const exploreSource = fs.readFileSync(new URL('../src/pages/Explore.jsx', import.meta.url), 'utf8');
const peopleSource = fs.readFileSync(new URL('../src/pages/People.jsx', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

describe('Issue #73 Discover content boundary', () => {
  it('limits unlocked Discover to playlists and podcasts', () => {
    assert.deepEqual(DISCOVER_TAB_KEYS, ['playlists', 'podcasts']);
    assert.equal(resolveExploreTab(null, null), 'playlists');
    assert.equal(resolveExploreTab(null, 'playlists'), 'playlists');
    assert.equal(resolveExploreTab(null, 'podcasts'), 'podcasts');
    assert.equal(resolveExploreTab(null, 'users'), 'playlists');
    assert.equal(resolveExploreTab(null, 'anything-else'), 'playlists');
  });

  it('preserves the locked People user mode', () => {
    assert.equal(resolveExploreTab('users', 'podcasts'), 'users');
    assert.match(peopleSource, /lockedTab="users"/);
    assert.match(peopleSource, /routeBase="\/people"/);
    assert.match(appSource, /<Route path="\/people"/);
  });

  it('removes Users from the Discover tab selector without deleting social search', () => {
    const tabsStart = exploreSource.indexOf('const DISCOVER_TABS = [');
    const tabsEnd = exploreSource.indexOf('const sortOptions', tabsStart);

    assert.notEqual(tabsStart, -1);
    assert.notEqual(tabsEnd, -1);

    const tabsSource = exploreSource.slice(tabsStart, tabsEnd);

    assert.match(tabsSource, /key: 'playlists'/);
    assert.match(tabsSource, /key: 'podcasts'/);
    assert.doesNotMatch(tabsSource, /key: 'users'/);
    assert.match(exploreSource, /resolveExploreTab\(lockedTab, params\.get\('tab'\)\)/);
    assert.match(exploreSource, /invoke\('searchUsers'/);
    assert.match(exploreSource, /tab === 'users'/);
  });
});
