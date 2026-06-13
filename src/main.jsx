import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { initializeNativeAuthCallback } from '@/lib/nativeAuthCallback'
import { hydrateLocalStorageFromPreferences } from '@/lib/nativeAuthSession'

// Native auth callback detector.
// Runs BEFORE React mounts so no routing or auth logic interferes.
// Base44 redirects to /?native_auth_callback=1&access_token=... after Google login.
// The root URL always exists on the published app (no 404), unlike a dedicated route.
// We extract the token and redirect to the custom scheme that Android catches via appUrlOpen.
function runNativeAuthCallbackCheck() {
  const search = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))

  if (search.get('native_auth_callback') !== '1') return false

  const log = function() {
    console.log('[AUTH]', ...arguments)
  }

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
    log('Redirecting to custom scheme:', customSchemeUrl)
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
  // 1. Handle native OAuth callback redirect (synchronous — no async needed)
  const nativeCallbackHandled = runNativeAuthCallbackCheck()
  if (nativeCallbackHandled) return

  // 2. Apply saved theme before render to avoid flash
  const savedTheme = localStorage.getItem('theme') || 'dark'
  const root = document.documentElement
  const nativePlatform = window.Capacitor?.getPlatform?.()

  if (nativePlatform === 'android') {
    root.classList.add('native-android')
  }

  if (savedTheme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.add(prefersDark ? 'dark' : 'light')
  } else {
    root.classList.add(savedTheme === 'light' ? 'light' : 'dark')
  }

  // 3. On native platforms, hydrate localStorage from Capacitor Preferences BEFORE
  //    React mounts. This ensures app-params.js and base44Client.js read the token
  //    correctly at module initialization time on a cold start.
  if (nativePlatform === 'android' || nativePlatform === 'ios') {
    await hydrateLocalStorageFromPreferences()
  }

  // 4. Register native auth callback listener (appUrlOpen, launch URL check)
  initializeNativeAuthCallback().catch(error => {
    console.error('Failed to initialize native auth callback:', error)
  })

  // 5. Mount React
  ReactDOM.createRoot(document.getElementById('root')).render(
    <App />
  )
}

bootstrap().catch(error => {
  console.error('Bootstrap failed:', error)
  // Fallback: mount app anyway so the user isn't stuck on a blank screen
  ReactDOM.createRoot(document.getElementById('root')).render(
    <App />
  )
})