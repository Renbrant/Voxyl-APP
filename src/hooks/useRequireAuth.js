import { useAuth } from '@/lib/AuthContext';

/**
 * Returns a wrapper that checks if the user is authenticated before running an action.
 * If not authenticated, redirects to login (using external browser on Android WebView).
 */
export function useRequireAuth() {
  const { isAuthenticated, clerkLoaded, isLoadingAuth, navigateToLogin } = useAuth();

  const requireAuth = (action) => {
    return async (...args) => {
      if (!clerkLoaded || isLoadingAuth || !isAuthenticated) {
        navigateToLogin();
        return;
      }
      return action(...args);
    };
  };

  return { requireAuth, redirectToLogin: navigateToLogin };
}
