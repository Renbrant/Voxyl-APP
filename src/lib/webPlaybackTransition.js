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

export function createWebResumeTransitionProtection({
  isWebPlayback,
  shouldProtectCanonicalResume,
  audioUrl,
  resumeAt,
  transitionGeneration,
}) {
  if (!isWebPlayback || !audioUrl) {
    return { progressRegressionGuard: null, pendingWebSeek: null };
  }

  return {
    progressRegressionGuard: shouldProtectCanonicalResume
      ? {
          audioUrl,
          position_seconds: Math.trunc(resumeAt),
          pendingSeek: true,
          transitionGeneration,
        }
      : null,
    pendingWebSeek: resumeAt > 0
      ? { audioUrl, position_seconds: resumeAt, transitionGeneration }
      : null,
  };
}

function isNearRequestedPosition(audio, requestedPosition, toleranceSeconds) {
  const current = Number(audio?.currentTime);
  return Number.isFinite(current) && Math.abs(current - requestedPosition) <= toleranceSeconds;
}

function hasUsableSeekTarget(audio, requestedPosition) {
  if (!audio) return false;

  const seekable = audio.seekable;
  if (seekable?.length > 0) {
    for (let index = 0; index < seekable.length; index += 1) {
      if (requestedPosition >= seekable.start(index) && requestedPosition <= seekable.end(index)) {
        return true;
      }
    }
    return false;
  }

  const duration = Number(audio.duration);
  return audio.readyState >= 1 || Number.isFinite(duration) || !seekable;
}

function isSeekConfirmed(audio, requestedPosition, toleranceSeconds) {
  if (audio?.seeking === true) return false;
  return isNearRequestedPosition(audio, requestedPosition, toleranceSeconds);
}

function isTransientMediaSeekError(error, audio, requestedPosition) {
  if (hasUsableSeekTarget(audio, requestedPosition)) return false;
  return error?.name === 'InvalidStateError' ||
    error?.name === 'NotSupportedError' ||
    (typeof DOMException !== 'undefined' && error instanceof DOMException);
}

export function confirmWebResumeSeek({
  audio,
  resumeAt,
  isCurrent,
  timeoutMs = 8000,
  toleranceSeconds = 0.75,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
}) {
  const requestedPosition = Number(resumeAt);

  if (!Number.isFinite(requestedPosition) || requestedPosition <= 0) {
    return Promise.resolve(Number(audio?.currentTime) || 0);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let attemptedSeek = false;
    let assignmentAttempt = 0;
    let latestAssignment = 0;
    let assignmentPending = false;
    let previousTargetUsable = false;
    let previousTransientError = false;
    const readinessEventTypes = [
      'loadedmetadata',
      'durationchange',
      'canplay',
      'canplaythrough',
      'progress',
    ];
    const confirmationEventTypes = [
      'seeked',
      'timeupdate',
    ];
    const eventTypes = [...readinessEventTypes, ...confirmationEventTypes];

    const cleanup = () => {
      clearTimeoutFn(timeout);
      for (const type of readinessEventTypes) {
        audio.removeEventListener?.(type, handleReadinessEvent);
      }
      for (const type of confirmationEventTypes) {
        audio.removeEventListener?.(type, handleConfirmationEvent);
      }
    };

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };

    const assertCurrent = () => {
      if (!isCurrent()) {
        finish(reject, new ObsoleteWebPlaybackError());
        return false;
      }
      return true;
    };

    const maybeConfirm = (assignmentToConfirm) => {
      if (!assertCurrent()) return;
      if (
        assignmentToConfirm === latestAssignment &&
        assignmentToConfirm > 0 &&
        isSeekConfirmed(audio, requestedPosition, toleranceSeconds)
      ) {
        finish(resolve, Number(audio.currentTime) || requestedPosition);
      }
    };

    const shouldAssign = (targetUsable) => {
      if (audio?.seeking === true) return false;
      if (!assignmentPending) return true;
      if (previousTransientError) return true;
      if (isNearRequestedPosition(audio, requestedPosition, toleranceSeconds)) return false;
      if (!targetUsable) return false;
      if (!previousTargetUsable && targetUsable) return true;
      return true;
    };

    const trySeek = () => {
      if (!assertCurrent()) return;
      if (settled) return;

      const targetUsable = hasUsableSeekTarget(audio, requestedPosition);
      if (!attemptedSeek || shouldAssign(targetUsable)) {
        attemptedSeek = true;
        const nextAssignment = assignmentAttempt + 1;
        assignmentAttempt = nextAssignment;
        try {
          audio.currentTime = requestedPosition;
          latestAssignment = nextAssignment;
          assignmentPending = true;
          previousTransientError = false;
          previousTargetUsable = targetUsable;
        } catch (error) {
          assignmentAttempt -= 1;
          if (isTransientMediaSeekError(error, audio, requestedPosition)) {
            assignmentPending = false;
            previousTransientError = true;
            previousTargetUsable = targetUsable;
            return;
          }
          finish(reject, error);
        }
      }
    };

    const handleReadinessEvent = () => {
      trySeek();
    };

    const handleConfirmationEvent = () => {
      const assignmentToConfirm = latestAssignment;
      maybeConfirm(assignmentToConfirm);
      if (settled) {
        return;
      }
      trySeek();
    };

    const timeout = setTimeoutFn(() => {
      if (!isCurrent()) {
        finish(reject, new ObsoleteWebPlaybackError());
        return;
      }
      finish(reject, new Error(`Timed out seeking to ${requestedPosition}`));
    }, timeoutMs);

    for (const type of eventTypes) {
      const handler = confirmationEventTypes.includes(type) ? handleConfirmationEvent : handleReadinessEvent;
      audio.addEventListener?.(type, handler);
    }

    trySeek();
  });
}

export async function establishWebPlaybackTransition({
  audio,
  coordinator,
  transition,
  transitionLabel,
  resumeAt = 0,
  retryDelays,
  waitForMediaReady,
  logger = console,
}) {
  if (resumeAt > 0) {
    await confirmWebResumeSeek({
      audio,
      resumeAt,
      isCurrent: () => coordinator.isCurrent(transition),
    });
  }

  coordinator.assertCurrent(transition);
  await requestGuardedWebPlayback({
    audio,
    transitionLabel,
    retryDelays,
    waitForMediaReady,
    isCurrent: () => coordinator.isCurrent(transition),
    logger,
  });
  coordinator.assertCurrent(transition);
  coordinator.markEstablished(transition);
  return Number(audio?.currentTime) || resumeAt || 0;
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
