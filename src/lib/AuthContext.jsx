import { createContext, useState, useContext, useCallback, useEffect } from 'react';
import { useAuth as useClerkAuth, useUser as useClerkUser } from '@clerk/clerk-react';
import { voxylApi, setAuthTokenGetter } from '@/api/voxylApiClient';
import { redirectToLogin } from '@/lib/authRedirect';
import { isClerkConfigured } from '@/lib/clerkConfig';
import { clearStoredNativeToken, getStoredNativeToken, isNativePlatform, restoreNativeAuthSession } from '@/lib/nativeAuthSession';
import {
  getNativeClerkToken,
  isAndroidNative,
  signInWithNativeClerk,
  signOutNativeClerk,
  waitForNativeClerkReady,
} from '@/lib/nativeClerk';
import { toast } from '@/components/ui/use-toast';

const AuthContext = createContext();

const LOGIN_UNAVAILABLE_MESSAGE = 'Sign-in is temporarily unavailable. Please try again shortly.';

function notifyLoginRedirectFailed(error) {
  console.error('Login redirect failed:', error);
  toast({
    title: 'Unable to start sign-in',
    description: LOGIN_UNAVAILABLE_MESSAGE,
    variant: 'destructive',
  });
}

function devAuthLog(message, details = {}) {
  if (!import.meta.env.DEV) return;
  console.debug(`[VOXYL AUTH] ${message}`, details);
}

const FallbackAuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings, setAppPublicSettings] = useState({ public_settings: {} });

  useEffect(() => {
    checkAppState();
  }, []);

  const checkAppState = async () => {
    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);

      // On native platforms, attempt to restore session from stored token BEFORE
      // hitting the server. This ensures cold-start logins survive app restarts.
      if (isNativePlatform()) {
        const hasToken = !!(await getStoredNativeToken());
        console.log('[AUTH] startup token exists:', hasToken);
        if (hasToken) {
          const restoredUser = await restoreNativeAuthSession();
          if (restoredUser) {
            setUser(restoredUser);
            setIsAuthenticated(true);
            setIsLoadingAuth(false);
            setIsLoadingPublicSettings(false);
            setAuthChecked(true);
            // processReferral is defined later in the component but is in the same
            // closure scope — safe to call here after all hooks are initialized.
            setTimeout(() => processReferral(restoredUser).catch(() => {}), 0);
            return;
          }
          // Token was invalid (401/403) — clearStoredNativeToken already called inside restoreNativeAuthSession.
          // Fall through to normal auth check.
        }
      }
      
      setAppPublicSettings({ public_settings: {} });
      setIsLoadingPublicSettings(false);

      if (await voxylApi.auth.isAuthenticated()) {
        await checkUserAuth();
      } else {
        setIsLoadingAuth(false);
        setIsAuthenticated(false);
        setAuthChecked(true);
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      setAuthError({
        type: 'unknown',
        message: error.message || 'An unexpected error occurred'
      });
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
    }
  };

  const processReferral = async (currentUser) => {
    const params = new URLSearchParams(window.location.search);
    const referrerId = params.get('ref');
    if (!referrerId || referrerId === currentUser.id) return;

    // Store so it's not processed twice across re-renders
    const storageKey = `voxyl_ref_processed_${currentUser.id}`;
    if (localStorage.getItem(storageKey)) return;
    localStorage.setItem(storageKey, '1');

    // Auto-follow the referrer via secure server function
    await voxylApi.functions.invoke('requestFollow', { targetUserId: referrerId }).catch(() => {});

    // Update referral record if exists
    const referrals = await voxylApi.entities.Referral.filter({ inviter_id: referrerId, invitee_email: currentUser.email }).catch(() => []);
    if (referrals[0]) {
      await voxylApi.entities.Referral.update(referrals[0].id, { status: 'joined' }).catch(() => {});
    }

    // Clean ref param from URL without reload
    params.delete('ref');
    const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    window.history.replaceState({}, '', newUrl);
  };

  const checkUserAuth = async () => {
    try {
      setIsLoadingAuth(true);
      const currentUser = await voxylApi.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      // Process referral link if present
      processReferral(currentUser).catch(() => {});
    } catch (error) {
      console.error('User auth check failed:', error);
      setIsLoadingAuth(false);
      setIsAuthenticated(false);
      setAuthChecked(true);
      
      const status = error?.status || error?.response?.status;
      if (status === 401 || status === 403) {
        // Definitively invalid token — clear it so we don't retry forever.
        if (isNativePlatform()) {
          console.log('[AUTH] stored token invalid, clearing session');
          await clearStoredNativeToken();
        }
        setAuthError({
          type: 'auth_required',
          message: 'Authentication required'
        });
      }
      // On network/server errors, do NOT set auth_required — keep the user's
      // session intact so a temporary connectivity issue doesn't force re-login.
    }
  };

  const logout = async (shouldRedirect = true) => {
    console.log('[AUTH] logout requested, clearing stored token');
    setUser(null);
    setIsAuthenticated(false);
    // Clear the persisted native token so the next cold start doesn't restore it.
    if (isNativePlatform()) {
      await clearStoredNativeToken();
    }
    if (shouldRedirect) {
      voxylApi.auth.logout(window.location.href);
    } else {
      voxylApi.auth.logout();
    }
  };

  const navigateToLogin = async () => {
    setAuthError(null);
    try {
      return (await redirectToLogin(window.location.href)) ?? true;
    } catch (error) {
      notifyLoginRedirectFailed(error);
      setAuthError({
        type: 'login_unavailable',
        code: error?.code || 'LOGIN_REDIRECT_FAILED',
        message: LOGIN_UNAVAILABLE_MESSAGE,
      });
      return false;
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      apiUser: user,
      clerkUser: null,
      clerkLoaded: true,
      clerkSignedIn: isAuthenticated,
      isAuthenticated, 
      isLoadingAuth,
      authLoading: isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      accountSyncError: null,
      appPublicSettings,
      authChecked,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState
    }}>
      {children}
    </AuthContext.Provider>
  );
};

const NativeClerkAuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [nativeLoaded, setNativeLoaded] = useState(false);
  const [nativeSignedIn, setNativeSignedIn] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings] = useState({ public_settings: {} });

  const processReferral = useCallback(async (currentUser) => {
    const params = new URLSearchParams(window.location.search);
    const referrerId = params.get('ref');

    if (!referrerId || referrerId === currentUser.id) {
      return;
    }

    const storageKey = `voxyl_ref_processed_${currentUser.id}`;

    if (localStorage.getItem(storageKey)) {
      return;
    }

    localStorage.setItem(storageKey, '1');

    await voxylApi.functions
      .invoke('requestFollow', { targetUserId: referrerId })
      .catch(() => {});

    const referrals = await voxylApi.entities.Referral
      .filter({
        inviter_id: referrerId,
        invitee_email: currentUser.email,
      })
      .catch(() => []);

    if (referrals[0]) {
      await voxylApi.entities.Referral
        .update(referrals[0].id, { status: 'joined' })
        .catch(() => {});
    }

    params.delete('ref');

    const newUrl =
      `${window.location.pathname}` +
      `${params.toString() ? '?' + params.toString() : ''}`;

    window.history.replaceState({}, '', newUrl);
  }, []);

  const checkUserAuth = useCallback(async () => {
    let clerkInitialized = false;
    let clerkSignedIn = false;

    try {
      setIsLoadingAuth(true);
      setAuthError(null);

      const state = await waitForNativeClerkReady();

      clerkInitialized = Boolean(state.initialized);
      clerkSignedIn = Boolean(state.signedIn);

      setNativeLoaded(clerkInitialized);
      setNativeSignedIn(clerkSignedIn);

      devAuthLog('native clerk state', {
        initialized: clerkInitialized,
        signedIn: clerkSignedIn,
        sessionId: state.sessionId || null,
      });

      if (!clerkInitialized) {
        setUser(null);
        setIsLoadingAuth(false);
        setAuthChecked(true);
        sessionStorage.setItem('voxyl_authed', 'false');

        setAuthError({
          type: 'clerk_initialization_failed',
          code: 'CLERK_NOT_READY',
          message: 'Clerk Android did not finish initializing.',
        });

        return null;
      }

      if (!clerkSignedIn) {
        setUser(null);
        setIsLoadingAuth(false);
        setAuthChecked(true);
        sessionStorage.setItem('voxyl_authed', 'false');
        return null;
      }

      /*
       * Ensure every Worker request obtains its JWT from Clerk Android.
       * No native JWT is persisted in localStorage or Preferences.
       */
      setAuthTokenGetter(getNativeClerkToken);

      const currentUser = await voxylApi.auth.me();

      setUser(currentUser);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      sessionStorage.setItem('voxyl_authed', 'true');

      processReferral(currentUser).catch(() => {});

      return currentUser;
    } catch (error) {
      console.error('Native Clerk auth check failed:', error);

      setUser(null);
      setNativeLoaded(clerkInitialized);
      setNativeSignedIn(clerkSignedIn);
      setIsLoadingAuth(false);
      setAuthChecked(true);

      sessionStorage.setItem(
        'voxyl_authed',
        clerkSignedIn ? 'true' : 'false'
      );

      const status = error?.status || error?.response?.status;

      setAuthError({
        type: clerkSignedIn
          ? 'account_sync_failed'
          : 'native_auth_failed',
        status,
        code: error?.code || null,
        message: clerkSignedIn
          ? (
              status === 401 || status === 403
                ? 'Your Clerk session is active, but Voxyl could not verify it with the API.'
                : (
                    error?.message ||
                    'Your Clerk session is active, but Voxyl could not load your account profile.'
                  )
            )
          : (
              error?.message ||
              'Unable to restore the native Clerk session.'
            ),
      });

      return null;
    }
  }, [processReferral]);

  useEffect(() => {
    /*
     * Keep the API client permanently wired to Clerk Android while this
     * provider is mounted. getNativeClerkToken() returns null while signed out.
     */
    setAuthTokenGetter(getNativeClerkToken);

    checkUserAuth();

    return () => {
      setAuthTokenGetter(null);
    };
  }, [checkUserAuth]);

  const checkAppState = useCallback(async () => {
    return checkUserAuth();
  }, [checkUserAuth]);

  const navigateToLogin = async () => {
    setAuthError(null);

    try {
      const result = await signInWithNativeClerk();

      if (!result?.signedIn) {
        throw Object.assign(
          new Error('Clerk Android did not activate a session.'),
          { code: 'CLERK_SESSION_NOT_ACTIVE' }
        );
      }

      setNativeLoaded(true);
      setNativeSignedIn(true);
      sessionStorage.setItem('voxyl_authed', 'true');

      await checkUserAuth();

      return true;
    } catch (error) {
      notifyLoginRedirectFailed(error);

      setAuthError({
        type: 'login_unavailable',
        code: error?.code || 'NATIVE_CLERK_SIGN_IN_FAILED',
        message: LOGIN_UNAVAILABLE_MESSAGE,
      });

      return false;
    }
  };

  const logout = async () => {
    setAuthError(null);

    try {
      const result = await signOutNativeClerk();

      setUser(null);
      setNativeLoaded(true);
      setNativeSignedIn(Boolean(result?.signedIn));
      setAuthChecked(true);

      sessionStorage.setItem(
        'voxyl_authed',
        result?.signedIn ? 'true' : 'false'
      );

      if (result?.warning) {
        console.warn(
          '[VOXYL AUTH] Native Clerk sign-out warning:',
          result.warning
        );
      }

      return result;
    } catch (error) {
      console.error('Native Clerk sign-out failed:', error);

      setAuthError({
        type: 'logout_failed',
        code: error?.code || 'NATIVE_CLERK_SIGN_OUT_FAILED',
        message: error?.message || 'Unable to sign out.',
      });

      return null;
    }
  };

  const clerkLoaded = nativeLoaded;
  const clerkSignedIn = nativeSignedIn;
  const isAuthenticated = nativeSignedIn;

  return (
    <AuthContext.Provider value={{
      user,
      apiUser: user,
      clerkUser: null,
      clerkLoaded,
      clerkSignedIn,
      isAuthenticated,
      isLoadingAuth,
      authLoading: isLoadingAuth,
      isLoadingPublicSettings: false,
      authError,
      accountSyncError:
        authError?.type === 'account_sync_failed'
          ? authError
          : null,
      appPublicSettings,
      authChecked,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
const ClerkAuthProvider = ({ children }) => {
  const { isLoaded, isSignedIn, getToken, signOut } = useClerkAuth();
  const { user: clerkUser } = useClerkUser();
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings] = useState({ public_settings: {} });

  const clerkLoaded = Boolean(isLoaded);
  const clerkSignedIn = Boolean(isSignedIn);
  const isAuthenticated = clerkSignedIn;

  const buildClerkFallbackUser = useCallback(() => {
    if (!clerkUser) return null;
    const email = clerkUser.primaryEmailAddress?.emailAddress || clerkUser.emailAddresses?.[0]?.emailAddress || null;
    return {
      id: clerkUser.id,
      clerk_user_id: clerkUser.id,
      email,
      full_name: clerkUser.fullName || [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || email,
      name: clerkUser.fullName || email,
      username: null,
      profile_picture: clerkUser.imageUrl || null,
      picture: clerkUser.imageUrl || null,
      avatar_url: clerkUser.imageUrl || null,
      profile_hidden: 0,
      account_sync_pending: true,
    };
  }, [clerkUser]);

  useEffect(() => {
    if (!clerkLoaded || !clerkSignedIn) {
      setAuthTokenGetter(null);
      return;
    }

    setAuthTokenGetter(async () => getToken());
    return () => setAuthTokenGetter(null);
  }, [clerkLoaded, clerkSignedIn, getToken]);

  const processReferral = useCallback(async (currentUser) => {
    const params = new URLSearchParams(window.location.search);
    const referrerId = params.get('ref');
    if (!referrerId || referrerId === currentUser.id) return;

    const storageKey = `voxyl_ref_processed_${currentUser.id}`;
    if (localStorage.getItem(storageKey)) return;
    localStorage.setItem(storageKey, '1');

    await voxylApi.functions.invoke('requestFollow', { targetUserId: referrerId }).catch(() => {});

    const referrals = await voxylApi.entities.Referral.filter({ inviter_id: referrerId, invitee_email: currentUser.email }).catch(() => []);
    if (referrals[0]) {
      await voxylApi.entities.Referral.update(referrals[0].id, { status: 'joined' }).catch(() => {});
    }

    params.delete('ref');
    const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    window.history.replaceState({}, '', newUrl);
  }, []);

  const checkUserAuth = useCallback(async () => {
    if (!clerkLoaded) {
      setIsLoadingAuth(true);
      return null;
    }

    devAuthLog("clerk state", {
      clerkLoaded,
      clerkSignedIn,
      clerkUserId: clerkUser?.id || null,
    });

    if (!clerkSignedIn) {
      setUser(null);
      setAuthError(null);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      sessionStorage.setItem('voxyl_authed', 'false');
      return null;
    }

    try {
      setIsLoadingAuth(true);
      setAuthError(null);
      sessionStorage.setItem('voxyl_authed', 'true');
      const token = await getToken().catch(() => null);
      devAuthLog("clerk token readiness", {
        clerkUserId: clerkUser?.id || null,
        hasToken: Boolean(token),
      });
      const currentUser = await voxylApi.auth.me();
      setUser(currentUser);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      sessionStorage.setItem('voxyl_authed', 'true');
      processReferral(currentUser).catch(() => {});
      return currentUser;
    } catch (error) {
      console.error('User auth check failed:', error);
      const fallbackUser = buildClerkFallbackUser();
      setUser(fallbackUser);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      sessionStorage.setItem('voxyl_authed', 'true');

      const status = error?.status || error?.response?.status;
      setAuthError({
        type: 'account_sync_failed',
        status,
        message: status === 401 || status === 403
          ? 'Your Clerk session is active, but Voxyl could not verify it with the API.'
          : (error.message || 'Your Clerk session is active, but Voxyl could not load your account profile.'),
      });
      return null;
    }
  }, [buildClerkFallbackUser, clerkLoaded, clerkSignedIn, clerkUser, getToken, processReferral]);

  useEffect(() => {
    checkUserAuth();
  }, [checkUserAuth]);

  useEffect(() => {
    devAuthLog("final state", {
      clerkLoaded,
      clerkSignedIn,
      clerkUserId: clerkUser?.id || null,
      hasApiUser: Boolean(user && !user.account_sync_pending),
      isAuthenticated,
      isLoadingAuth,
      authErrorType: authError?.type || null,
      authErrorStatus: authError?.status || null,
    });
  }, [authError, clerkLoaded, clerkSignedIn, clerkUser, isAuthenticated, isLoadingAuth, user]);

  const checkAppState = useCallback(async () => {
    return checkUserAuth();
  }, [checkUserAuth]);

  const logout = async (shouldRedirect = true) => {
    setUser(null);
    setAuthError(null);
    setAuthChecked(true);
    sessionStorage.setItem('voxyl_authed', 'false');
    await signOut?.({ redirectUrl: shouldRedirect ? window.location.href : undefined });
  };

  const navigateToLogin = async () => {
    setAuthError(null);
    try {
      return (await redirectToLogin(window.location.href)) ?? true;
    } catch (error) {
      notifyLoginRedirectFailed(error);
      setAuthError({
        type: 'login_unavailable',
        code: error?.code || 'LOGIN_REDIRECT_FAILED',
        message: LOGIN_UNAVAILABLE_MESSAGE,
      });
      return false;
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      apiUser: user?.account_sync_pending ? null : user,
      clerkUser,
      clerkLoaded,
      clerkSignedIn,
      isAuthenticated,
      isLoadingAuth,
      authLoading: isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      accountSyncError: authError?.type === 'account_sync_failed' ? authError : null,
      appPublicSettings,
      authChecked,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const AuthProvider = ({ children }) => {
  if (isAndroidNative()) {
    return (
      <NativeClerkAuthProvider>
        {children}
      </NativeClerkAuthProvider>
    );
  }

  if (!isClerkConfigured) {
    return <FallbackAuthProvider>{children}</FallbackAuthProvider>;
  }

  return <ClerkAuthProvider>{children}</ClerkAuthProvider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
