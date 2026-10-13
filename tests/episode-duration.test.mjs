import assert from 'node:assert/strict';
import test from 'node:test';
import { getEpisodeDurationLabel } from '../src/lib/episodeDuration.js';

test('formats RSS seconds, minutes and hours consistently', () => {
  for (const duration of [1800, '1800', '30:00', '00:30:00']) {
    assert.equal(getEpisodeDurationLabel({ duration }), '30:00');
  }
  assert.equal(getEpisodeDurationLabel({ duration: '1:02:03' }), '1:02:03');
});

test('uses measured or cached duration when RSS duration is missing or inaccurate', () => {
  assert.equal(getEpisodeDurationLabel({ duration: '30:00' }, 1900), '31:40');
  assert.equal(getEpisodeDurationLabel({}, 1800), '30:00');
  assert.equal(getEpisodeDurationLabel({ duration_seconds: 1800 }), '30:00');
  assert.equal(getEpisodeDurationLabel({ duration: '30:00' }, Infinity), '30:00');
});

test('shows quoted playable duration with intro, outro, or both cuts', () => {
  assert.equal(getEpisodeDurationLabel({ duration: '30:00', skip_start_seconds: 60 }), '30:00 "29:00"');
  assert.equal(getEpisodeDurationLabel({ duration: '30:00', skip_end_seconds: 240 }), '30:00 "26:00"');
  assert.equal(getEpisodeDurationLabel({ duration: '30:00', skip_start_seconds: '60', skip_end_seconds: 240 }), '30:00 "25:00"');
  assert.equal(getEpisodeDurationLabel({ duration: 10, skip_start_seconds: 30, skip_end_seconds: 30 }), '0:10 "0:00"');
});

test('rejects invalid durations and ignores invalid cuts', () => {
  for (const duration of [undefined, '', 0, -1, Infinity, 'unknown', '1:invalid']) {
    assert.equal(getEpisodeDurationLabel({ duration }), '');
  }
  assert.equal(getEpisodeDurationLabel({ duration: '30:00', skip_start_seconds: -60, skip_end_seconds: Infinity }), '30:00');
});
