import { useEffect, useState } from 'react';

/**
 * Calculates the time remaining until the next Cloudflare daily quota reset (00:00 UTC).
 *
 * @param {string|Date|null} [serverReset] - Optional server-provided reset timestamp.
 * @param {Date} [now=new Date()] - Reference timestamp (defaults to current time).
 * @returns {{
 *   hours: number,
 *   minutes: number,
 *   seconds: number,
 *   totalSeconds: number,
 *   formatted: string,
 *   targetUtc: string
 * }}
 */
export function calculateTimeUntilReset(serverReset = null, now = new Date()) {
  let target;

  if (serverReset) {
    const parsed = new Date(serverReset);
    if (!isNaN(parsed.getTime()) && parsed > now) {
      target = parsed;
    }
  }

  if (!target) {
    target = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0, 0, 0, 0,
    ));
  }

  const diffMs = Math.max(0, target.getTime() - now.getTime());
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n) => String(n).padStart(2, '0');
  const formatted = `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;

  return {
    hours,
    minutes,
    seconds,
    totalSeconds,
    formatted,
    targetUtc: target.toISOString(),
  };
}

/**
 * Hook to provide a live-updating countdown to the next Cloudflare quota reset.
 * Updates every second.
 *
 * @param {string|null} [serverReset]
 * @returns {{
 *   hours: number,
 *   minutes: number,
 *   seconds: number,
 *   totalSeconds: number,
 *   formatted: string,
 *   targetUtc: string
 * }}
 */
export function useCloudflareResetCountdown(serverReset = null) {
  const [countdown, setCountdown] = useState(() => calculateTimeUntilReset(serverReset));

  useEffect(() => {
    setCountdown(calculateTimeUntilReset(serverReset));

    const interval = setInterval(() => {
      setCountdown(calculateTimeUntilReset(serverReset));
    }, 1000);

    return () => clearInterval(interval);
  }, [serverReset]);

  return countdown;
}
