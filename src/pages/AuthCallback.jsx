import { useEffect } from 'react';

const log = (...args) => console.log('[AUTH]', ...args);

/**
 * /auth/callback — Base44-domain bridge page
 *
 * Base44 redirects here after login because voxyl-app.base44.app is an allowed domain.
 * This page always redirects to the native custom scheme when:
 *   - a token is present, AND
 *   - the URL contains native=1 (set by authRedirect.js for native login)
 *
 * This avoids any dependency on window.Capacitor, which is unavailable inside
 * Capacitor Browser / Chrome Custom Tabs.
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

    const isNativeCallback = search.get('native') === '1';

    log('All query params:', Object.fromEntries(search.entries()));
    log('Token found:', token ? 'YES' : 'NO');
    log('isNativeCallback (native=1):', isNativeCallback);

    if (!token) {
      log('No token — redirecting to /');
      window.location.replace('/');
      return;
    }

    if (isNativeCallback) {
      // Always redirect to custom scheme for native flow.
      // Android intent filter catches this and fires appUrlOpen in the APK.
      // window.Capacitor is NOT used here — it is unavailable in Chrome Custom Tab.
      const customSchemeUrl = `com.renbrant.voxyl://auth/callback?access_token=${encodeURIComponent(token)}`;
      log('Redirecting to custom scheme:', customSchemeUrl);
      window.location.href = customSchemeUrl;
    } else {
      // Web flow: store token and reload
      log('Web flow: storing token and reloading');
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