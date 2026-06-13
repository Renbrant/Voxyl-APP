import { createContext, useState, useContext, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { appParams, base44ConfigError } from '@/lib/app-params';
import { createAxiosClient } from '@base44/sdk/dist/utils/axios-client';
import { redirectToLogin } from '@/lib/authRedirect';
import { clearStoredNativeToken, getStoredNativeToken, isNativePlatform, restoreNativeAuthSession } from '@/lib/nativeAuthSession';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings, setAppPublicSettings] = useState(null); // Contains only { id, public_settings }

  useEffect(() => {
    checkAppState();
  }, []);

  const checkAppState = async () => {
    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);

      if (base44ConfigError) {
        setAuthError({
          type: 'configuration_error',
          message: base44ConfigError
        });
        setIsLoadingPublicSettings(false);
        setIsLoadingAuth(false);
        return;
      }

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
      
      // First, check app public settings (with token if available)
      // This will tell us if auth is required, user not registered, etc.
      const appClient = createAxiosClient({
        baseURL: `${appParams.serverUrl}/api/apps/public`,
        headers: {
          'X-App-Id': appParams.appId
        },
        token: appParams.token, // Include token if available
        interceptResponses: true
      });
      
      try {
        const publicSettings = await appClient.get(`/prod/public-settings/by-id/${appParams.appId}`);
        setAppPublicSettings(publicSettings);
        
        // If we got the app public settings successfully, check if user is authenticated
        if (appParams.token) {
          await checkUserAuth();
        } else {
          setIsLoadingAuth(false);
          setIsAuthenticated(false);
          setAuthChecked(true);
        }
        setIsLoadingPublicSettings(false);
      } catch (appError) {
        console.error('App state check failed:', appError);
        
        // Handle app-level errors
        if (appError.status === 403 && appError.data?.extra_data?.reason) {
          const reason = appError.data.extra_data.reason;
          if (reason === 'auth_required') {
            setAuthError({
              type: 'auth_required',
              message: 'Authentication required'
            });
          } else if (reason === 'user_not_registered') {
            setAuthError({
              type: 'user_not_registered',
              message: 'User not registered for this app'
            });
          } else {
            setAuthError({
              type: reason,
              message: appError.message
            });
          }
        } else {
          setAuthError({
            type: 'unknown',
            message: appError.message || 'Failed to load app'
          });
        }
        setIsLoadingPublicSettings(false);
        setIsLoadingAuth(false);
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
    await base44.functions.invoke('requestFollow', { targetUserId: referrerId }).catch(() => {});

    // Update referral record if exists
    const referrals = await base44.entities.Referral.filter({ inviter_id: referrerId, invitee_email: currentUser.email }).catch(() => []);
    if (referrals[0]) {
      await base44.entities.Referral.update(referrals[0].id, { status: 'joined' }).catch(() => {});
    }

    // Clean ref param from URL without reload
    params.delete('ref');
    const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    window.history.replaceState({}, '', newUrl);
  };

  const checkUserAuth = async () => {
    try {
      // Now check if the user is authenticated
      setIsLoadingAuth(true);
      const currentUser = await base44.auth.me();
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
      base44.auth.logout(window.location.href);
    } else {
      base44.auth.logout();
    }
  };

  const navigateToLogin = () => {
    redirectToLogin(window.location.href).catch(error => {
      console.error('Login redirect failed:', error);
    });
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated, 
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
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

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};