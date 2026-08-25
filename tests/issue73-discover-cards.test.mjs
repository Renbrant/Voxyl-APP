import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

const exploreSource = fs.readFileSync(new URL('../src/pages/Explore.jsx', import.meta.url), 'utf8');
const playlistCardSource = fs.readFileSync(new URL('../src/components/playlist/PlaylistCard.jsx', import.meta.url), 'utf8');
const podcastCardSource = fs.readFileSync(new URL('../src/components/explore/PodcastResultCard.jsx', import.meta.url), 'utf8');

describe('Issue #73 Discover card redesign', () => {
  it('uses responsive visual playlist cards in Discover', () => {
    assert.match(exploreSource, /grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3/);
    assert.match(exploreSource, /playlist=\{pl\} discovery liked=/);
    assert.doesNotMatch(exploreSource, /playlist=\{pl\} compact liked=/);
  });

  it('keeps the PlaylistCard simplification scoped to Discover', () => {
    assert.match(playlistCardSource, /discovery = false/);
    assert.match(playlistCardSource, /!discovery && \(/);
    assert.match(playlistCardSource, /<Heart size=\{13\}/);
    assert.match(playlistCardSource, /<Link to=\{`\/playlist\/\$\{playlist\.id\}`\}/);

    const discoveryMenuStart = playlistCardSource.lastIndexOf('{discovery && (');
    assert.notEqual(discoveryMenuStart, -1);

    const discoveryMenuSource = playlistCardSource.slice(discoveryMenuStart);
    assert.match(discoveryMenuSource, /isOwner \? \(/);
    assert.match(discoveryMenuSource, /setEditingPlaylist\(true\)/);
    assert.match(discoveryMenuSource, /<ReportBlockMenu/);
    assert.match(discoveryMenuSource, /contentType="playlist"/);
    assert.match(discoveryMenuSource, /onBlocked=\{onBlocked\}/);
  });

  it('uses responsive podcast results without changing detail and add actions', () => {
    assert.match(exploreSource, /grid grid-cols-1 xl:grid-cols-2 gap-3/);
    assert.match(podcastCardSource, /to=\{`\/podcast\/\$\{encodeURIComponent\(podcast\.feedUrl\)\}`\}/);
    assert.match(podcastCardSource, /onClick=\{\(\) => onAdd\(podcast\)\}/);
    assert.match(podcastCardSource, /onClick=\{\(\) => onLike\?\.\(podcast\)\}/);
  });

  it('replaces expandable podcast descriptions with a concise preview', () => {
    assert.match(podcastCardSource, /const descriptionText =/);
    assert.match(podcastCardSource, /line-clamp-2/);
    assert.equal((podcastCardSource.match(/WebkitLineClamp: 2/g) || []).length, 2);
    assert.equal((podcastCardSource.match(/WebkitBoxOrient: 'vertical'/g) || []).length, 2);
    assert.equal((podcastCardSource.match(/display: '-webkit-box'/g) || []).length, 2);
    assert.doesNotMatch(podcastCardSource, /setExpanded/);
    assert.doesNotMatch(podcastCardSource, /ChevronDown|ChevronUp/);
    assert.doesNotMatch(podcastCardSource, /dangerouslySetInnerHTML/);
  });
});