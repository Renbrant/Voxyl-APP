export const PODCAST_PLAY_RECORD_AFTER_SECONDS = 10;
export const PODCAST_PLAY_RECORD_AFTER_MS = PODCAST_PLAY_RECORD_AFTER_SECONDS * 1000;
export const PODCAST_PLAY_MAX_ATTEMPTS = 3;
export const PODCAST_PLAY_RETRY_DELAYS_MS = [2000, 10000];

export function playbackNowMs() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

export function createPlaybackEventId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export function normalizePlaybackSource(source) {
  if (!source || typeof source !== 'object' || typeof source.type !== 'string') return null;
  return {
    type: source.type,
    id: source.id ?? null,
  };
}

export function createPodcastPlaySession(episode, source = null, eventId = createPlaybackEventId()) {
  return episode?.audioUrl
    ? {
        eventId,
        audioUrl: episode.audioUrl,
        source: normalizePlaybackSource(source),
        playedMs: 0,
        tickStartedAt: null,
        attempts: 0,
        retryTimer: null,
        inFlight: false,
        completed: false,
      }
    : null;
}

export function accumulatePodcastPlayTime(session, now = playbackNowMs()) {
  if (!session || session.tickStartedAt === null) return session;
  session.playedMs += Math.max(0, now - session.tickStartedAt);
  session.tickStartedAt = now;
  return session;
}

export function markPodcastSessionPlaying(session, now = playbackNowMs()) {
  if (!session || session.completed || session.tickStartedAt !== null) return session;
  session.tickStartedAt = now;
  return session;
}

export function pausePodcastSession(session, now = playbackNowMs()) {
  if (!session) return session;
  accumulatePodcastPlayTime(session, now);
  session.tickStartedAt = null;
  return session;
}

export function isPodcastSessionReadyToRecord(session, now = playbackNowMs()) {
  if (!session || session.completed) return false;
  const elapsedMs = session.tickStartedAt === null
    ? session.playedMs
    : session.playedMs + Math.max(0, now - session.tickStartedAt);
  return elapsedMs >= PODCAST_PLAY_RECORD_AFTER_MS;
}

export function buildPodcastPlayPayload(session, episode) {
  if (!session || !episode?.audioUrl) return null;

  const payload = {
    event_id: session.eventId,
    feed_url: episode.feedUrl || episode.id || '',
    podcast_title: episode.feedTitle || '',
    podcast_image: episode.image || '',
    audio_url: episode.audioUrl,
    episode_title: episode.title || '',
  };

  if (session.source?.type === 'playlist' && session.source.id) {
    payload.playlist_id = session.source.id;
  }

  return payload;
}

export function shouldRetryPodcastPlay(error, attemptNumber) {
  if (attemptNumber >= PODCAST_PLAY_MAX_ATTEMPTS) return false;

  const status = Number(error?.status || error?.data?.status || 0);
  if (!status) return true;
  if (status === 401) return attemptNumber < 2;
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

export function getPodcastPlayRetryDelay(attemptNumber) {
  return PODCAST_PLAY_RETRY_DELAYS_MS[Math.max(0, attemptNumber - 1)] ?? PODCAST_PLAY_RETRY_DELAYS_MS.at(-1);
}

export function clearPodcastPlayRetryTimer(session, clearTimer = clearTimeout) {
  if (session?.retryTimer) {
    clearTimer(session.retryTimer);
    session.retryTimer = null;
  }
}

export function createPodcastPlayRecorder({
  invoke,
  getCurrentSession,
  getCurrentEpisode,
  onSuccess = (_result, _session) => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const attempt = (expectedEventId = null) => {
    const session = getCurrentSession();
    const episode = getCurrentEpisode();

    if (!episode?.audioUrl) return Promise.resolve(false);
    if (!session || session.audioUrl !== episode.audioUrl || session.completed || session.inFlight || session.retryTimer) {
      return Promise.resolve(false);
    }
    if (expectedEventId && session.eventId !== expectedEventId) return Promise.resolve(false);
    if (!isPodcastSessionReadyToRecord(session)) return Promise.resolve(false);

    const payload = buildPodcastPlayPayload(session, episode);
    if (!payload) return Promise.resolve(false);

    session.inFlight = true;
    session.attempts += 1;

    return Promise.resolve()
      .then(() => invoke(payload))
      .then((result) => {
        session.inFlight = false;
        session.completed = true;
        clearPodcastPlayRetryTimer(session, clearTimer);
        onSuccess(result, session);
        return true;
      })
      .catch((error) => {
        session.inFlight = false;

        if (getCurrentSession() !== session) {
          return false;
        }

        if (shouldRetryPodcastPlay(error, session.attempts)) {
          const delay = getPodcastPlayRetryDelay(session.attempts);
          session.retryTimer = setTimer(() => {
            session.retryTimer = null;
            return attempt(session.eventId);
          }, delay);
          return false;
        }

        session.completed = true;
        return false;
      });
  };

  return {
    attempt,
    cancel(session = getCurrentSession()) {
      clearPodcastPlayRetryTimer(session, clearTimer);
    },
  };
}
