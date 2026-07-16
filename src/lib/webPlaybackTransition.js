export class ObsoleteWebPlaybackError extends Error {
  constructor(message = 'Obsolete web playback invocation') {
    super(message);
    this.name = 'ObsoleteWebPlaybackError';
    this.code = 'obsolete-web-playback';
  }
}

export function isObsoleteWebPlaybackError(error) {
  return error instanceof ObsoleteWebPlaybackError || error?.code === 'obsolete-web-playback';
}

export function createWebPlaybackTransitionCoordinator() {
  let generation = 0;
  let current = null;

  function isCurrent(transition) {
    return Boolean(
      transition &&
      current &&
      transition.generation === current.generation &&
      transition.audioUrl === current.audioUrl
    );
  }

  function assertCurrent(transition) {
    if (!isCurrent(transition)) {
      throw new ObsoleteWebPlaybackError();
    }
  }

  return {
    begin({ audioUrl, resumeAt, durationSeconds }) {
      current = {
        generation: generation + 1,
        audioUrl,
        resumeAt,
        durationSeconds,
        assignedSrc: null,
        phase: 'switching',
      };
      generation = current.generation;
      return current;
    },

    attachSource(transition, audio) {
      assertCurrent(transition);
      current = {
        ...current,
        assignedSrc: audio?.currentSrc || audio?.src || transition.audioUrl,
      };
      return current;
    },

    getCurrent() {
      return current;
    },

    getPhase(transition = current) {
      if (!transition || !isCurrent(transition)) return null;
      return current.phase;
    },

    isSwitching(transition = current) {
      return this.getPhase(transition) === 'switching';
    },

    isCurrent,
    assertCurrent,

    markEstablished(transition) {
      assertCurrent(transition);
      current = { ...current, phase: 'established' };
      return current;
    },

    cancel(transition = current) {
      if (!transition || isCurrent(transition)) {
        current = null;
      }
    },

    shouldIgnoreEvent(type, audio) {
      return shouldIgnoreWebPlaybackEvent(current, type, audio);
    },
  };
}

export function shouldIgnoreWebPlaybackEvent(transition, type, audio) {
  if (!transition) return false;

  if (transition.phase !== 'switching') return false;

  return [
    'canplay',
    'canplaythrough',
    'durationchange',
    'ended',
    'error',
    'pause',
    'playing',
    'stalled',
    'timeupdate',
    'waiting',
  ].includes(type);
}

export function beginWebEpisodeSourceSwitch({
  coordinator,
  audio,
  audioUrl,
  resumeAt,
  durationSeconds,
  onBeforeSource = null,
  onAfterSource = null,
}) {
  const transition = coordinator.begin({ audioUrl, resumeAt, durationSeconds });
  onBeforeSource?.(transition);
  audio.src = audioUrl;
  coordinator.attachSource(transition, audio);
  onAfterSource?.(transition);
  audio.load?.();
  return transition;
}

export async function requestGuardedWebPlayback({
  audio,
  transitionLabel,
  retryDelays,
  waitForMediaReady,
  isCurrent,
  logger = console,
}) {
  let lastError = null;

  const assertCurrent = () => {
    if (!isCurrent()) {
      throw new ObsoleteWebPlaybackError();
    }
  };

  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    assertCurrent();
    const delay = retryDelays[attempt];
    if (delay > 0) {
      await waitForMediaReady(audio, delay);
      assertCurrent();
    }

    try {
      assertCurrent();
      logger.log?.('[PLAYLIST] play() requested', {
        transition: transitionLabel,
        attempt: attempt + 1,
        src: audio.currentSrc || audio.src,
      });
      await audio.play();
      assertCurrent();
      logger.log?.('[PLAYLIST] play() resolved', {
        transition: transitionLabel,
        attempt: attempt + 1,
      });
      return;
    } catch (error) {
      assertCurrent();
      if (isObsoleteWebPlaybackError(error)) {
        throw error;
      }

      lastError = error;
      logger.error?.('[PLAYLIST] play() rejected', {
        transition: transitionLabel,
        attempt: attempt + 1,
        name: error?.name,
        message: error?.message,
      });

      const networkLoading = typeof HTMLMediaElement !== 'undefined' ? HTMLMediaElement.NETWORK_LOADING : 2;
      const recoverable = error?.name === 'AbortError' ||
        error?.name === 'NotAllowedError' ||
        audio.networkState === networkLoading;
      if (!recoverable) break;
    }
  }

  throw lastError || new Error('Audio playback did not start');
}
