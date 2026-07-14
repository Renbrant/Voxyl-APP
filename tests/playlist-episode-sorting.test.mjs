import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sortPlaylistEpisodes } from '../src/lib/playlistEpisodeSorting.js';

describe('playlist episode sorting', () => {
  it('sorts valid pubDate episodes across feeds instead of preserving feed insertion groups', () => {
    const episodes = [
      {
        title: 'Feed A older',
        feedUrl: 'https://feeds.example.com/a.xml',
        audioUrl: 'https://cdn.example.com/a-old.mp3',
        pubDate: 'Tue, 14 Jul 2026 10:00:00 GMT',
      },
      {
        title: 'Feed A newest',
        feedUrl: 'https://feeds.example.com/a.xml',
        audioUrl: 'https://cdn.example.com/a-new.mp3',
        pubDate: 'Tue, 14 Jul 2026 13:00:00 GMT',
      },
      {
        title: 'Feed B middle',
        feedUrl: 'https://feeds.example.com/b.xml',
        audioUrl: 'https://cdn.example.com/b-middle.mp3',
        pubDate: 'Tue, 14 Jul 2026 12:00:00 GMT',
      },
    ];

    const sorted = sortPlaylistEpisodes(episodes, { episodes_sort_order: 'newest_first' });

    assert.deepEqual(sorted.map((episode) => episode.title), [
      'Feed A newest',
      'Feed B middle',
      'Feed A older',
    ]);
  });

  it('places missing or invalid dates after valid dates with deterministic invalid ordering', () => {
    const episodes = [
      {
        title: 'Missing date',
        feedUrl: 'https://feeds.example.com/z.xml',
        audioUrl: 'https://cdn.example.com/missing.mp3',
      },
      {
        title: 'Old valid',
        feedUrl: 'https://feeds.example.com/a.xml',
        audioUrl: 'https://cdn.example.com/old.mp3',
        pubDate: 'Tue, 14 Jul 2026 10:00:00 GMT',
      },
      {
        title: 'Invalid date',
        feedUrl: 'https://feeds.example.com/a.xml',
        audioUrl: 'https://cdn.example.com/invalid.mp3',
        pubDate: 'not a date',
      },
      {
        title: 'New valid',
        feedUrl: 'https://feeds.example.com/b.xml',
        audioUrl: 'https://cdn.example.com/new.mp3',
        pubDate: 'Tue, 14 Jul 2026 12:00:00 GMT',
      },
    ];

    const newestFirst = sortPlaylistEpisodes(episodes, { episodes_sort_order: 'newest_first' });
    const oldestFirst = sortPlaylistEpisodes(episodes, { episodes_sort_order: 'oldest_first' });

    assert.deepEqual(newestFirst.map((episode) => episode.title), [
      'New valid',
      'Old valid',
      'Invalid date',
      'Missing date',
    ]);
    assert.deepEqual(oldestFirst.map((episode) => episode.title), [
      'Old valid',
      'New valid',
      'Invalid date',
      'Missing date',
    ]);
  });
});
