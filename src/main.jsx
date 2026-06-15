import React from 'react'
import ReactDOM from 'react-dom/client'
import '@/index.css'
// ONLY import the lightweight storage helper here — it has NO base44/SDK imports.
// Everything else (App, AuthContext, base44Client) is dynamically imported AFTER hydration.
import { hydrateLocalStorageFromPreferences } from '@/lib/nativeTokenStorage'

// Native auth callback detector.
// Runs synchronously BEFORE any async work so no routing or auth logic interferes.
// Base44 redirects to /?native_auth_callback=1&access_token=... after Google login.
function runNativeAuthCallbackCheck() {
  const search = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))

  if (search.get('native_auth_callback') !== '1') return false

  const log = (...args) => console.log('[AUTH]', ...args)

  log('AuthCallback detected — URL:', window.location.href)
  log('Query params:', Object.fromEntries(search.entries()))

  const token =
    search.get('access_token') ||
    search.get('access_tc') ||
    search.get('token') ||
    hash.get('access_token') ||
    hash.get('access_tc') ||
    hash.get('token')

  log('Token found:', token ? 'YES' : 'NO')

  if (token) {
    const customSchemeUrl = 'com.renbrant.voxyl://auth/callback?access_token=' + encodeURIComponent(token)
    log('Redirecting to custom scheme')
    window.location.href = customSchemeUrl
    return true
  }

  log('No token found — rendering debug screen')
  document.getElementById('root').innerHTML =
    '<div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0f0d0b;color:#fff;padding:24px;font-family:monospace;gap:12px;text-align:center;">' +
    '<div style="font-size:18px;font-weight:bold;color:#f97316;">Native Login Callback Reached</div>' +
    '<div style="color:#ef4444;">No token found</div>' +
    '<div style="font-size:11px;color:#888;word-break:break-all;max-width:360px;">URL: ' + window.location.href + '</div>' +
    '<div style="font-size:11px;color:#888;word-break:break-all;max-width:360px;">Query: ' + (window.location.search || '(none)') + '</div>' +
    '<div style="font-size:11px;color:#888;word-break:break-all;max-width:360px;">Hash: ' + (window.location.hash || '(none)') + '</div>' +
    '</div>'
  return true
}

async function bootstrap() {
  console.log('[AUTH] bootstrap start')

  // 1. Handle native OAuth callback redirect — no hydration needed here
  const nativeCallbackHandled = runNativeAuthCallbackCheck()
  if (nativeCallbackHandled) return

  // 2. Apply saved theme before render to avoid flash
  const savedTheme = localStorage.getItem('theme') || 'dark'
  const root = document.documentElement
  const nativePlatform = window.Capacitor?.getPlatform?.()

  if (nativePlatform === 'android') root.classList.add('native-android')

  if (savedTheme === 'auto') {
    root.classList.add(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  } else {
    root.classList.add(savedTheme === 'light' ? 'light' : 'dark')
  }

  // 3. Hydrate localStorage from Capacitor Preferences BEFORE importing anything
  //    that touches base44Client / app-params. This is the critical step that ensures
  //    the SDK sees the token at module initialization time on cold start.
  if (nativePlatform === 'android' || nativePlatform === 'ios') {
    await hydrateLocalStorageFromPreferences()
  }

  // 4. NOW dynamically import App and auth callback — base44Client/app-params
  //    will initialize with the token already in localStorage.
  console.log('[AUTH] importing App after token hydration')
  const [{ default: App }, { initializeNativeAuthCallback }] = await Promise.all([
    import('@/App.jsx'),
    import('@/lib/nativeAuthCallback'),
  ])

  // 5. Register native auth callback listener (appUrlOpen, launch URL check)
  initializeNativeAuthCallback().catch(error => {
    console.error('Failed to initialize native auth callback:', error)
  })

  // 6. Mount React
  ReactDOM.createRoot(document.getElementById('root')).render(
    <App />
  )
}

bootstrap().catch(error => {
  console.error('[AUTH] bootstrap failed:', error)
  // Fallback: attempt to mount app anyway so the user isn't stuck on a blank screen
  import('@/App.jsx').then(({ default: App }) => {
    ReactDOM.createRoot(document.getElementById('root')).render(<App />)
  })
})
