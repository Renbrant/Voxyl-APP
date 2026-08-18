import { Capacitor, registerPlugin } from '@capacitor/core';

const ClerkNative = registerPlugin('ClerkNative');

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function isAndroidNative() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function getNativeClerkState() {
  if (!isAndroidNative()) {
    return {
      initialized: false,
      signedIn: false,
      sessionId: null,
    };
  }

  const state = await ClerkNative.getState();

  return {
    initialized: Boolean(state?.initialized),
    signedIn: Boolean(state?.signedIn),
    sessionId: state?.sessionId || null,
  };
}

export async function waitForNativeClerkReady({
  timeoutMs = 10000,
  pollMs = 100,
} = {}) {
  if (!isAndroidNative()) {
    return {
      initialized: false,
      signedIn: false,
      sessionId: null,
    };
  }

  const deadline = Date.now() + timeoutMs;
  let state = await getNativeClerkState();

  while (!state.initialized && Date.now() < deadline) {
    await sleep(pollMs);
    state = await getNativeClerkState();
  }

  return state;
}

export async function signInWithNativeClerk() {
  if (!isAndroidNative()) {
    throw new Error('Native Clerk sign-in is only available on Android.');
  }

  const result = await ClerkNative.signIn();

  return {
    signedIn: Boolean(result?.signedIn),
    sessionId: result?.sessionId || null,
  };
}

export async function getNativeClerkToken() {
  if (!isAndroidNative()) {
    return null;
  }

  const result = await ClerkNative.getToken();

  if (!result?.signedIn) {
    return null;
  }

  return typeof result?.token === 'string' && result.token
    ? result.token
    : null;
}

export async function signOutNativeClerk() {
  if (!isAndroidNative()) {
    return {
      signedIn: false,
      serverSignOutSucceeded: true,
    };
  }

  const result = await ClerkNative.signOut();

  return {
    signedIn: Boolean(result?.signedIn),
    serverSignOutSucceeded:
      result?.serverSignOutSucceeded !== false,
    warning: result?.warning || null,
  };
}
