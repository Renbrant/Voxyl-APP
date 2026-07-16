import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import {
  buildPodcastPlayPayload,
  clearPodcastPlayRetryTimer,
  createPodcastPlayRecorder,
  createPodcastPlaySession,
  isPodcastSessionReadyToRecord,
  markPodcastSessionPlaying,
  pausePodcastSession,
} from '../src/lib/podcastPlaybackSession.js';

const episode = {
  id: 'https://feeds.example.com/show.xml',
  feedUrl: 'https://feeds.example.com/show.xml',
  feedTitle: 'Example Show',
  image: 'https://img.example.com/show.jpg',
  audioUrl: 'https://audio.example.com/episode.mp3',
  title: 'Episode 1',
};

function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimer(fn, delay) {
      const timer = { fn, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      timer.cleared = true;
    },
  };
}

function readySession(source, eventId = 'event-1') {
  const session = createPodcastPlaySession(episode, source, eventId);
  markPodcastSessionPlaying(session, 0);
  pausePodcastSession(session, 10_000);
  return session;
}

function recorderHarness({ session, responses }) {
  let currentSession = session;
  const payloads = [];
  const timers = fakeTimers();
  const recorder = createPodcastPlayRecorder({
    getCurrentSession: () => currentSession,
    getCurrentEpisode: () => episode,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    invoke: async (payload) => {
      payloads.push(payload);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response ?? { data: { recorded: true } };
    },
  });

  return {
    payloads,
    recorder,
    timers,
    replaceSession(nextSession) {
      const oldSession = currentSession;
      currentSession = nextSession;
      clearPodcastPlayRetryTimer(oldSession, timers.clearTimer);
    },
  };
}

describe('podcast playback session bookkeeping', () => {
  it('snapshots playlist source and does not leak it into later podcast or download sessions', () => {
    const playlistSession = createPodcastPlaySession(episode, { type: 'playlist', id: 'playlist-1' }, 'playlist-event');
    const podcastSession = createPodcastPlaySession(episode, { type: 'podcast', id: episode.feedUrl }, 'podcast-event');
    const downloadSession = createPodcastPlaySession(episode, { type: 'download', id: null }, 'download-event');
    const missingSourceSession = createPodcastPlaySession(episode, null, 'direct-event');

    assert.equal(buildPodcastPlayPayload(playlistSession, episode).playlist_id, 'playlist-1');
    assert.equal('playlist_id' in buildPodcastPlayPayload(podcastSession, episode), false);
    assert.equal('playlist_id' in buildPodcastPlayPayload(downloadSession, episode), false);
    assert.equal('playlist_id' in buildPodcastPlayPayload(missingSourceSession, episode), false);
  });

  it('counts actual playback across pause and resume without losing partial intervals', () => {
    const session = createPodcastPlaySession(episode, null, 'event-1');

    markPodcastSessionPlaying(session, 0);
    pausePodcastSession(session, 9000);
    assert.equal(isPodcastSessionReadyToRecord(session, 9000), false);

    markPodcastSessionPlaying(session, 20_000);
    assert.equal(isPodcastSessionReadyToRecord(session, 20_999), false);
    assert.equal(isPodcastSessionReadyToRecord(session, 21_000), true);
  });

  it('does not count time spent waiting or stalled after playback is paused for buffering', () => {
    const session = createPodcastPlaySession(episode, null, 'event-1');

    markPodcastSessionPlaying(session, 0);
    pausePodcastSession(session, 5000);
    assert.equal(isPodcastSessionReadyToRecord(session, 15_000), false);

    markPodcastSessionPlaying(session, 20_000);
    assert.equal(isPodcastSessionReadyToRecord(session, 24_999), false);
    assert.equal(isPodcastSessionReadyToRecord(session, 25_000), true);
  });
});

describe('podcast playback analytics retry behavior', () => {
  it('retries a network failure and then succeeds with the same event id', async () => {
    const session = readySession({ type: 'playlist', id: 'playlist-1' }, 'stable-event');
    const harness = recorderHarness({
      session,
      responses: [new Error('network failed'), { data: { recorded: true } }],
    });

    await harness.recorder.attempt();
    assert.equal(harness.timers.timers.length, 1);
    assert.equal(harness.timers.timers[0].delay, 2000);

    await harness.timers.timers[0].fn();

    assert.deepEqual(harness.payloads.map((payload) => payload.event_id), ['stable-event', 'stable-event']);
    assert.equal(session.completed, true);
  });

  it('retries HTTP 500 and then succeeds', async () => {
    const error = new Error('server failed');
    error.status = 500;
    const session = readySession(null, 'server-event');
    const harness = recorderHarness({
      session,
      responses: [error, { data: { recorded: true } }],
    });

    await harness.recorder.attempt();
    await harness.timers.timers[0].fn();

    assert.equal(harness.payloads.length, 2);
    assert.equal(harness.payloads[0].event_id, 'server-event');
    assert.equal(harness.payloads[1].event_id, 'server-event');
    assert.equal(session.completed, true);
  });

  it('does not retry HTTP 400 validation errors', async () => {
    const error = new Error('bad payload');
    error.status = 400;
    const session = readySession(null, 'bad-event');
    const harness = recorderHarness({ session, responses: [error] });

    await harness.recorder.attempt();

    assert.equal(harness.payloads.length, 1);
    assert.equal(harness.timers.timers.length, 0);
    assert.equal(session.completed, true);
  });

  it('retries 401 only once and uses the same event id', async () => {
    const first = new Error('expired token');
    first.status = 401;
    const second = new Error('still unauthorized');
    second.status = 401;
    const session = readySession(null, 'auth-event');
    const harness = recorderHarness({ session, responses: [first, second] });

    await harness.recorder.attempt();
    await harness.timers.timers[0].fn();

    assert.deepEqual(harness.payloads.map((payload) => payload.event_id), ['auth-event', 'auth-event']);
    assert.equal(harness.timers.timers.length, 1);
    assert.equal(session.completed, true);
  });

  it('cancels a scheduled retry when the session is replaced', async () => {
    const error = new Error('network failed');
    const session = readySession({ type: 'playlist', id: 'playlist-1' }, 'old-event');
    const nextSession = readySession({ type: 'podcast', id: episode.feedUrl }, 'new-event');
    const harness = recorderHarness({ session, responses: [error, { data: { recorded: true } }] });

    await harness.recorder.attempt();
    assert.equal(harness.timers.timers.length, 1);

    harness.replaceSession(nextSession);
    assert.equal(harness.timers.timers[0].cleared, true);

    await harness.timers.timers[0].fn();

    assert.deepEqual(harness.payloads.map((payload) => payload.event_id), ['old-event']);
  });
});

describe('podcast playback idempotency migration', () => {
  it('executes the real migration SQL and enforces idempotent trigger behavior', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE playlists (
        id TEXT PRIMARY KEY,
        plays_count INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE podcast_plays (
        id TEXT PRIMARY KEY,
        legacy_base44_podcast_play_id TEXT UNIQUE,
        user_id TEXT,
        clerk_user_id TEXT,
        legacy_base44_user_id TEXT,
        playlist_id TEXT,
        feed_url TEXT,
        podcast_title TEXT,
        episode_title TEXT,
        audio_url TEXT,
        played_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        podcast_image TEXT,
        base44_created_date TEXT,
        base44_updated_date TEXT,
        imported_at TEXT
      );
      INSERT INTO playlists (id, plays_count) VALUES ('playlist-1', 7);
      INSERT INTO podcast_plays (id, playlist_id, feed_url, audio_url, imported_at)
        VALUES ('legacy-1', 'playlist-1', 'https://feeds.example.com/show.xml', 'https://audio.example.com/old.mp3', CURRENT_TIMESTAMP);
    `);

    const migration = fs.readFileSync(new URL('../workers/api/migrations/0003_podcast_play_idempotency.sql', import.meta.url), 'utf8');
    db.exec(migration);

    const columns = db.prepare("PRAGMA table_info('podcast_plays')").all();
    assert.equal(columns.some((column) => column.name === 'client_event_id'), true);

    db.exec(`
      INSERT INTO podcast_plays (id, playlist_id, feed_url, audio_url)
        VALUES ('legacy-null-1', NULL, 'https://feeds.example.com/show.xml', 'https://audio.example.com/null-1.mp3');
      INSERT INTO podcast_plays (id, playlist_id, feed_url, audio_url)
        VALUES ('legacy-null-2', NULL, 'https://feeds.example.com/show.xml', 'https://audio.example.com/null-2.mp3');
      INSERT INTO podcast_plays (id, playlist_id, feed_url, audio_url)
        VALUES ('legacy-null-playlist', 'playlist-1', 'https://feeds.example.com/show.xml', 'https://audio.example.com/null-playlist.mp3');
    `);

    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM podcast_plays WHERE id = 'legacy-null-playlist'").get().count, 1);
    assert.equal(db.prepare("SELECT plays_count FROM playlists WHERE id = 'playlist-1'").get().plays_count, 7);

    db.prepare(`
      INSERT OR IGNORE INTO podcast_plays (id, client_event_id, playlist_id, feed_url, audio_url)
      VALUES (?, ?, ?, ?, ?)
    `).run('play-1', 'event-1', 'playlist-1', 'https://feeds.example.com/show.xml', 'https://audio.example.com/new.mp3');

    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM podcast_plays WHERE client_event_id = 'event-1'").get().count, 1);
    assert.equal(db.prepare("SELECT plays_count FROM playlists WHERE id = 'playlist-1'").get().plays_count, 8);

    db.prepare(`
      INSERT OR IGNORE INTO podcast_plays (id, client_event_id, playlist_id, feed_url, audio_url)
      VALUES (?, ?, ?, ?, ?)
    `).run('play-duplicate', 'event-1', 'playlist-1', 'https://feeds.example.com/show.xml', 'https://audio.example.com/new.mp3');

    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM podcast_plays WHERE client_event_id = 'event-1'").get().count, 1);
    assert.equal(db.prepare("SELECT plays_count FROM playlists WHERE id = 'playlist-1'").get().plays_count, 8);

    db.prepare(`
      INSERT OR IGNORE INTO podcast_plays (id, client_event_id, playlist_id, feed_url, audio_url)
      VALUES (?, ?, ?, ?, ?)
    `).run('play-no-playlist', 'event-2', null, 'https://feeds.example.com/show.xml', 'https://audio.example.com/loose.mp3');

    assert.equal(db.prepare("SELECT plays_count FROM playlists WHERE id = 'playlist-1'").get().plays_count, 8);
  });
});
