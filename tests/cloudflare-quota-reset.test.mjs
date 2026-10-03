import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { calculateTimeUntilReset } from '../src/lib/cloudflareQuota.js';

const adminSource = fs.readFileSync(
  new URL('../src/pages/Admin.jsx', import.meta.url),
  'utf8',
);

describe('Cloudflare Quota Reset Countdown', () => {
  it('calculates remaining time until next midnight UTC accurately', () => {
    const referenceNow = new Date('2026-10-03T20:15:30.000Z');
    const result = calculateTimeUntilReset(null, referenceNow);

    assert.equal(result.hours, 3);
    assert.equal(result.minutes, 44);
    assert.equal(result.seconds, 30);
    assert.equal(result.totalSeconds, 3 * 3600 + 44 * 60 + 30);
    assert.equal(result.formatted, '03h 44m 30s');
    assert.equal(result.targetUtc, '2026-10-04T00:00:00.000Z');
  });

  it('formats single-digit hours, minutes, and seconds with zero padding', () => {
    const referenceNow = new Date('2026-10-03T23:55:08.000Z');
    const result = calculateTimeUntilReset(null, referenceNow);

    assert.equal(result.hours, 0);
    assert.equal(result.minutes, 4);
    assert.equal(result.seconds, 52);
    assert.equal(result.formatted, '00h 04m 52s');
  });

  it('handles month boundary transitions correctly', () => {
    const referenceNow = new Date('2026-10-31T22:30:00.000Z');
    const result = calculateTimeUntilReset(null, referenceNow);

    assert.equal(result.hours, 1);
    assert.equal(result.minutes, 30);
    assert.equal(result.seconds, 0);
    assert.equal(result.formatted, '01h 30m 00s');
    assert.equal(result.targetUtc, '2026-11-01T00:00:00.000Z');
  });

  it('handles year boundary transitions correctly', () => {
    const referenceNow = new Date('2026-12-31T23:45:00.000Z');
    const result = calculateTimeUntilReset(null, referenceNow);

    assert.equal(result.hours, 0);
    assert.equal(result.minutes, 15);
    assert.equal(result.seconds, 0);
    assert.equal(result.formatted, '00h 15m 00s');
    assert.equal(result.targetUtc, '2027-01-01T00:00:00.000Z');
  });

  it('respects a valid server-provided reset timestamp if in the future', () => {
    const referenceNow = new Date('2026-10-03T12:00:00.000Z');
    const serverReset = '2026-10-03T18:00:00.000Z';
    const result = calculateTimeUntilReset(serverReset, referenceNow);

    assert.equal(result.hours, 6);
    assert.equal(result.minutes, 0);
    assert.equal(result.seconds, 0);
    assert.equal(result.formatted, '06h 00m 00s');
    assert.equal(result.targetUtc, '2026-10-03T18:00:00.000Z');
  });

  it('falls back to next midnight UTC if server reset timestamp is past or invalid', () => {
    const referenceNow = new Date('2026-10-03T21:00:00.000Z');
    const pastReset = '2026-10-03T10:00:00.000Z';
    const resultPast = calculateTimeUntilReset(pastReset, referenceNow);
    assert.equal(resultPast.targetUtc, '2026-10-04T00:00:00.000Z');

    const resultInvalid = calculateTimeUntilReset('not-a-date', referenceNow);
    assert.equal(resultInvalid.targetUtc, '2026-10-04T00:00:00.000Z');
  });
});

describe('Admin Panel Cloudflare Reset Timer UI Contract', () => {
  it('imports and uses useCloudflareResetCountdown hook', () => {
    assert.match(
      adminSource,
      /import\s*\{\s*useCloudflareResetCountdown\s*\}\s*from\s*['"]@\/lib\/cloudflareQuota['"]/,
    );
    assert.match(
      adminSource,
      /const\s+resetCountdown\s*=\s*useCloudflareResetCountdown\(/,
    );
  });

  it('renders the reset countdown badge and informative cycle bar', () => {
    assert.match(adminSource, /Reset em:/);
    assert.match(adminSource, /00:00 UTC/);
    assert.match(adminSource, /Ciclo Diário Cloudflare/);
  });
});
