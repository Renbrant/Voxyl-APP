import { useEffect } from 'react';

const log = (...args) => console.log('[AUTH]', ...args);

/**
 * /auth/callback — Base44-domain bridge page
 *
 * Base44 redirects here after login (from_url=https://voxyl-app.base44.app/auth/callback).
 * This page extracts the token from query params or hash, then immediately
 * redirects to the custom scheme so Android appUrlOpen fires:
 *   com.renbrant.voxyl://auth/callback?access_token=...
 *
 * On web (non-native), it stores the token and reloads the app normally.
 */
export default function AuthCallback() {
  useEffect(() => {
    log('AuthCallback mounted — extracting token');

    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));

    const token =
      search.get('access_token') ||
      search.get('access_tc') ||
      search.get('token') ||
      hash.get('access_token') ||
      hash.get('access_tc') ||
      hash.get('token');

    log('All query params:', Object.fromEntries(search.entries()));
    log('All hash params:', Object.fromEntries(hash.entries()));
    log('Token found:', token ? 'YES' : 'NO');

    if (!token) {
      log('No token — redirecting to / without login');
      window.location.replace('/');
      return;
    }

    const isNative = !!(window.Capacitor?.isNativePlatform?.());
    log('isNative:', isNative);

    if (isNative) {
      // Redirect to custom scheme — Android intent filter catches this and fires appUrlOpen
      const customSchemeUrl = `com.renbrant.voxyl://auth/callback?access_token=${encodeURIComponent(token)}`;
      log('Redirecting to custom scheme:', customSchemeUrl);
      window.location.href = customSchemeUrl;
    } else {
      // Web fallback: store token and reload
      log('Web: storing token and reloading');
      localStorage.setItem('base44_access_token', token);
      localStorage.setItem('token', token);
      window.location.replace('/');
    }
  }, []);

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-2xl overflow-hidden">
          <img
            src="https://media.base44.com/images/public/69e2ae13aa773b21002b1fe4/26d262763_voxyllogo.png"
            alt="Voxyl"
            className="w-full h-full object-contain"
          />
        </div>
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );
}