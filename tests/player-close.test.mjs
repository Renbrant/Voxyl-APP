import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

const audioPlayerSource = fs.readFileSync(
  new URL('../src/components/player/AudioPlayer.jsx', import.meta.url),
  'utf8',
);

const playerContextSource = fs.readFileSync(
  new URL('../src/lib/PlayerContext.jsx', import.meta.url),
  'utf8',
);

describe('Audio Player Close Option', () => {
  describe('AudioPlayer UI controls', () => {
    it('imports X icon from lucide-react', () => {
      assert.match(audioPlayerSource, /import\s*\{[^}]*\bX\b[^}]*\}\s*from\s*['"]lucide-react['"]/);
    });

    it('extracts closePlayer from usePlayer hook', () => {
      assert.match(audioPlayerSource, /const\s*\{[^}]*\bclosePlayer\b[^}]*\}\s*=\s*usePlayer\(\)/);
    });

    it('renders close button in full player view next to minimize button', () => {
      assert.match(audioPlayerSource, /<button[^>]*onClick=\{[^}]*closePlayer\(\)[^}]*\}[^>]*(title="Fechar"|title=\{t\('playerClose'\)\})[^>]*>/);
      assert.match(audioPlayerSource, /<X\s+size=\{16\}\s*\/>/);
    });

    it('renders close button in minimized player bar next to expand button', () => {
      assert.match(audioPlayerSource, /<button[^>]*onClick=\{[^}]*closePlayer\(\)[^}]*\}[^>]*(aria-label="Fechar player"|aria-label=\{t\('playerCloseAria'\)\})[^>]*>/);
    });
  });

  describe('PlayerContext closePlayer implementation', () => {
    it('defines closePlayer with progress save, stop playback, and state cleanup', () => {
      assert.match(playerContextSource, /const closePlayer = useCallback\(\(\) => \{/);
      assert.match(playerContextSource, /saveCurrentProgress\(true\);/);
      assert.match(playerContextSource, /setCurrentEpisode\(null\);/);
      assert.match(playerContextSource, /setIsPlaying\(false\);/);
      assert.match(playerContextSource, /setPlayerMinimized\(false\);/);
    });

    it('exposes closePlayer in PlayerContext.Provider value', () => {
      assert.match(playerContextSource, /closePlayer,\s*\}\}>/);
    });
  });
});
