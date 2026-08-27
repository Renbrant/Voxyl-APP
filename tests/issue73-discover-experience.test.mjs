import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

const exploreSource = fs.readFileSync(new URL('../src/pages/Explore.jsx', import.meta.url), 'utf8');
const peopleSource = fs.readFileSync(new URL('../src/pages/People.jsx', import.meta.url), 'utf8');
const i18nSource = fs.readFileSync(new URL('../src/lib/i18n.js', import.meta.url), 'utf8');

describe('Issue #73 Discover experience redesign', () => {
  it('presents Discover as a content-search destination', () => {
    assert.match(exploreSource, /t\('navDiscover'\)/);
    assert.match(exploreSource, /t\('discoverSearchSubtitle'\)/);
    assert.match(exploreSource, /grid grid-cols-2 gap-1\.5/);
    assert.match(exploreSource, /t\('discoverPlaylistsHeading'\)/);
    assert.match(exploreSource, /t\('discoverPodcastsHeading'\)/);
  });

  it('keeps playlist empty states intentional', () => {
    assert.match(exploreSource, /discoverNoPlaylistResults/);
    assert.match(exploreSource, /discoverNoPlaylistsAvailable/);
    assert.match(exploreSource, /discoverTryAnotherSearch/);
  });

  it('provides an explicit podcast retry path', () => {
    assert.match(exploreSource, /podcastSearchNonce/);
    assert.match(exploreSource, /setPodcastSearchNonce\(value => value \+ 1\)/);
    assert.match(exploreSource, /podcastCategory, podcastSearchNonce/);
  });

  it('keeps the new Discover copy localized', () => {
    assert.match(i18nSource, /discoverSearchSubtitle:/);
    assert.match(i18nSource, /discoverPlaylistsHint:/);
    assert.match(i18nSource, /discoverPodcastsHint:/);
    assert.match(i18nSource, /discoverNoPlaylistResults:/);
  });

  it('keeps People available through its dedicated page', () => {
    assert.match(peopleSource, /voxylApi\.people\.summary\(\)/);
    assert.match(peopleSource, /invoke\('searchUsers'/);
    assert.doesNotMatch(peopleSource, /from '@\/pages\/Explore'/);
  });
});