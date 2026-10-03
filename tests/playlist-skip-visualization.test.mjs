import assert from 'node:assert/strict';
import fs from 'node:fs';
import { beforeEach, describe, it } from 'node:test';
import {
  activateProgressCacheScope,
  getAllFinishedFromCache,
  getAllOutroSkippedFromCache,
  getCachedProgress,
  isFinishedFromCache,
  isOutroSkippedFromCache,
  resetProgressRuntimeState,
  setCachedProgress,
} from '../src/lib/episodeProgressCache.js';

const audioPlayerSource = fs.readFileSync(
  new URL('../src/components/player/AudioPlayer.jsx', import.meta.url),
  'utf8',
);

const playlistDetailSource = fs.readFileSync(
  new URL('../src/pages/PlaylistDetail.jsx', import.meta.url),
  'utf8',
);

const episodeActionButtonSource = fs.readFileSync(
  new URL('../src/components/player/EpisodeActionButton.jsx', import.meta.url),
  'utf8',
);

const playerContextSource = fs.readFileSync(
  new URL('../src/lib/PlayerContext.jsx', import.meta.url),
  'utf8',
);

const i18nSource = fs.readFileSync(
  new URL('../src/lib/i18n.js', import.meta.url),
  'utf8',
);

describe('Playlist Skip Scrubber Representation and Outro Skip Completion', () => {
  beforeEach(() => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (key) => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => { store.set(key, String(value)); },
      removeItem: (key) => { store.delete(key); },
      clear: () => { store.clear(); },
    };
    resetProgressRuntimeState();
    activateProgressCacheScope(null, { migrateLegacy: false });
  });

  describe('episodeProgressCache outro skip support', () => {
    it('persists and retrieves skipped_outro flag when marking progress as finished', () => {
      const audioUrl = 'https://media.example.com/podcast/ep1.mp3';
      const duration = 1800;
      const position = 1740; // skipped last 60s

      setCachedProgress(audioUrl, position, duration, true, { skipped_outro: true });

      const cached = getCachedProgress(audioUrl);
      assert.ok(cached, 'Cache entry should exist');
      assert.equal(cached.finished, true, 'Episode should be marked finished');
      assert.equal(cached.skipped_outro, true, 'Episode should record skipped_outro: true');
      assert.equal(isFinishedFromCache(audioUrl), true);
      assert.equal(isOutroSkippedFromCache(audioUrl), true);

      const allOutro = getAllOutroSkippedFromCache();
      assert.ok(allOutro.has(audioUrl), 'getAllOutroSkippedFromCache should contain audioUrl');

      const allFinished = getAllFinishedFromCache();
      assert.ok(allFinished.has(audioUrl), 'getAllFinishedFromCache should contain audioUrl');
    });

    it('does not mark skipped_outro when not passed in metadata', () => {
      const audioUrl = 'https://media.example.com/podcast/ep2.mp3';
      setCachedProgress(audioUrl, 1800, 1800, true);

      const cached = getCachedProgress(audioUrl);
      assert.equal(cached.finished, true);
      assert.equal(cached.skipped_outro, false);
      assert.equal(isOutroSkippedFromCache(audioUrl), false);

      const allOutro = getAllOutroSkippedFromCache();
      assert.equal(allOutro.has(audioUrl), false);
    });
  });

  describe('AudioPlayer scrubber skip visualization', () => {
    it('calculates intro and outro skip percentages from currentEpisode and duration', () => {
      assert.match(
        audioPlayerSource,
        /skipStart\s*=\s*Math\.max\(0,\s*Number\(currentEpisode\?\.skip_start_seconds\)\s*\|\|\s*0\)/,
      );
      assert.match(
        audioPlayerSource,
        /skipEnd\s*=\s*Math\.max\(0,\s*Number\(currentEpisode\?\.skip_end_seconds\)\s*\|\|\s*0\)/,
      );
      assert.match(audioPlayerSource, /skipStartPct/);
      assert.match(audioPlayerSource, /skipEndPct/);
    });

    it('renders distinct amber skip zones on the interactive scrubber bar', () => {
      assert.match(audioPlayerSource, /skipStartPct > 0/);
      assert.match(audioPlayerSource, /skipEndPct > 0/);
      assert.match(audioPlayerSource, /bg-amber-400 dark:bg-amber-500/);
    });

    it('renders subtle skip indicator badge below the scrubber bar', () => {
      assert.match(audioPlayerSource, /hasSkip/);
      assert.match(audioPlayerSource, /⚡/);
      assert.match(audioPlayerSource, /text-amber-500/);
    });
  });

  describe('PlaylistDetail scrubber and episode row presentation', () => {
    it('renders amber skip zones on the active episode scrubber in PlaylistDetail', () => {
      assert.match(playlistDetailSource, /activeSkipStartPct > 0/);
      assert.match(playlistDetailSource, /activeSkipEndPct > 0/);
      assert.match(playlistDetailSource, /bg-amber-400 dark:bg-amber-500/);
    });

    it('renders subtle outro skipped text in metadata when episode completed with outro skip', () => {
      assert.match(playlistDetailSource, /isOutroSkipped/);
      assert.match(playlistDetailSource, /detailHeardOutroSkipped/);
    });

    it('provides i18n translation keys for outro-skipped heard state and skip badges', () => {
      assert.match(i18nSource, /detailHeardOutroSkipped/);
      assert.match(i18nSource, /ouvido \(final pulado\)/);
      assert.match(i18nSource, /played \(outro skipped\)/);
      assert.match(i18nSource, /playerSkipStartTitle/);
      assert.match(i18nSource, /playerSkipEndTitle/);
      assert.match(i18nSource, /playerSkipBadgeTitle/);
      assert.match(i18nSource, /playerHeardOutroSkipped/);
      assert.match(i18nSource, /detailIntro/);
      assert.match(i18nSource, /detailOutro/);
      assert.match(audioPlayerSource, /t\('detailIntro'\)/);
      assert.match(audioPlayerSource, /t\('detailOutro'\)/);
      assert.match(playlistDetailSource, /t\('detailIntro'\)/);
      assert.match(playlistDetailSource, /t\('detailOutro'\)/);
      assert.match(episodeActionButtonSource, /t\('playerHeardOutroSkipped'\)/);
    });
  });

  describe('EpisodeActionButton subtle indicator', () => {
    it('accepts isOutroSkipped prop and renders subtle amber indicator next to checkmark', () => {
      assert.match(episodeActionButtonSource, /isOutroSkipped/);
      assert.match(episodeActionButtonSource, /CheckCircle2/);
      assert.match(episodeActionButtonSource, /bg-amber-400/);
    });
  });

  describe('PlayerContext advance and completion contract', () => {
    it('immediately saves and marks finished and outro-skipped state on SKIP_END before queue/autoplay checks', () => {
      assert.match(playerContextSource, /isOutroSkip\s*=\s*source === 'SKIP_END' \|\| source === 'NATIVE SKIP_END'/);
      assert.match(playerContextSource, /outroSkippedUrls/);
      assert.match(playerContextSource, /setOutroSkippedUrls/);
      assert.match(
        playerContextSource,
        /setCachedProgress\(\s*endingEpisode\.audioUrl,\s*dur,\s*dur,\s*true,\s*\{\s*skipped_outro:\s*isOutroSkip\s*\}\s*\)/,
      );
      assert.match(
        playerContextSource,
        /saveCurrentProgress\(\s*true,\s*\{\s*forceFinished:\s*true,\s*skippedOutro:\s*isOutroSkip\s*\}\s*\)/,
      );
    });

    it('exposes outroSkippedUrls and setOutroSkippedUrls in PlayerContext provider value', () => {
      assert.match(playerContextSource, /outroSkippedUrls,\s*setOutroSkippedUrls/);
    });
  });
});
