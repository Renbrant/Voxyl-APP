import { formatDuration, parseDurationToSeconds } from './rssUtils.js';

const positiveSeconds = value => {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
};

export function getEpisodeDurationLabel(episode, knownDuration = 0) {
  const total = positiveSeconds(knownDuration)
    || positiveSeconds(episode?.duration_seconds)
    || positiveSeconds(parseDurationToSeconds(episode?.duration));
  if (!total) return '';

  const intro = positiveSeconds(episode?.skip_start_seconds);
  const outro = positiveSeconds(episode?.skip_end_seconds);
  const original = formatDuration(Math.floor(total)) || '0:00';
  if (!intro && !outro) return original;

  const playable = Math.max(0, Math.floor(total - intro - outro));
  return `${original} "${formatDuration(playable) || '0:00'}"`;
}
