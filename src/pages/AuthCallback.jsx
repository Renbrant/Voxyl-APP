/**
 * src/pages/AuthCallback.jsx
 *
 * This page runs inside the Capacitor Browser after login completes.
 * It extracts the token and redirects to the custom scheme.
 *
 * IMPORTANT: This runs in a Chrome Custom Tab, NOT in the app WebView.
 * window.Capacitor is NOT available here. We cannot rely on Capacitor APIs.
 * We MUST use window.location.href to trigger the custom scheme redirect.
 *
 * Flow:
 * 1. Login succeeds and redirects to /?native_auth_callback=1&access_token=...
 * 2. This page loads and shows visible debug output
 * 3. We extract the token from query params or hash
 * 4. We redirect to: com.renbrant.voxyl://auth/callback?access_token=<TOKEN>
 * 5. Android intent filter catches the custom scheme and fires appUrlOpen
 * 6. nativeAuthCallback.js handles it and stores the token
 */

import React, { useEffect, useState } from 'react'

export default function AuthCallback() {
  const [debugInfo, setDebugInfo] = useState({
    currentUrl: '',
    queryParams: [],
    hashParams: [],
    tokenFound: false,
    redirecting: false,
    error: null
  })

  useEffect(() => {
    const processCallback = async () => {
      try {
        const currentUrl = window.location.href
        const search = new URLSearchParams(window.location.search)
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))

        // Extract token from query or hash
        const token =
          search.get('access_token') ||
          search.get('access_tc') ||
          search.get('token') ||
          hash.get('access_token') ||
          hash.get('access_tc') ||
          hash.get('token')

        const queryParamKeys = Array.from(search.keys())
        const hashParamKeys = Array.from(hash.keys())

        const foundToken = !!token

        setDebugInfo({
          currentUrl,
          queryParams: queryParamKeys,
          hashParams: hashParamKeys,
          tokenFound: foundToken,
          redirecting: foundToken,
          error: foundToken ? null : 'No token found in URL'
        })

        console.log('[AUTH_CALLBACK] Current URL:', currentUrl)
        console.log('[AUTH_CALLBACK] Query params:', queryParamKeys)
        console.log('[AUTH_CALLBACK] Hash params:', hashParamKeys)
        console.log('[AUTH_CALLBACK] Token found:', foundToken ? 'YES' : 'NO')

        if (token) {
          console.log('[AUTH_CALLBACK] Preparing redirect to custom scheme')
          // Wait 500ms so the debug output is visible before the redirect happens
          await new Promise(r => setTimeout(r, 500))

          const customSchemeUrl = 'com.renbrant.voxyl://auth/callback?access_token=' + encodeURIComponent(token)
          console.log('[AUTH_CALLBACK] Redirecting to custom scheme (token not logged)')
          window.location.href = customSchemeUrl
        }
      } catch (e) {
        console.error('[AUTH_CALLBACK] Error:', e)
        setDebugInfo(prev => ({
          ...prev,
          error: e?.message || 'Unknown error'
        }))
      }
    }

    processCallback()
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f0d0b',
        color: '#fff',
        padding: '24px',
        fontFamily: 'monospace',
        gap: '12px',
        fontSize: '14px',
        lineHeight: '1.6'
      }}
    >
      <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#f97316' }}>
        🔐 Native Auth Callback
      </div>

      <div style={{ fontSize: '12px', color: '#888', maxWidth: '360px' }}>
        Voxyl is processing your login. Please wait...
      </div>

      <div
        style={{
          marginTop: '24px',
          padding: '16px',
          background: '#1a1815',
          borderRadius: '6px',
          maxWidth: '360px',
          maxHeight: '300px',
          overflowY: 'auto'
        }}
      >
        <div style={{ color: '#888', marginBottom: '8px' }}>
          <strong>URL:</strong>
          <div style={{ fontSize: '11px', wordBreak: 'break-all', color: '#666' }}>
            {debugInfo.currentUrl.substring(0, 100)}...
          </div>
        </div>

        <div style={{ color: '#888', marginBottom: '8px' }}>
          <strong>Query params:</strong>
          <div style={{ fontSize: '11px', color: '#666' }}>
            {debugInfo.queryParams.length > 0 ? debugInfo.queryParams.join(', ') : '(none)'}
          </div>
        </div>

        <div style={{ color: '#888', marginBottom: '8px' }}>
          <strong>Hash params:</strong>
          <div style={{ fontSize: '11px', color: '#666' }}>
            {debugInfo.hashParams.length > 0 ? debugInfo.hashParams.join(', ') : '(none)'}
          </div>
        </div>

        <div style={{ color: debugInfo.tokenFound ? '#22c55e' : '#ef4444', marginBottom: '8px' }}>
          <strong>Token found:</strong>
          <div style={{ fontSize: '11px' }}>
            {debugInfo.tokenFound ? '✓ YES' : '✗ NO'}
          </div>
        </div>

        <div style={{ color: debugInfo.redirecting ? '#22c55e' : '#888', marginBottom: '8px' }}>
          <strong>Status:</strong>
          <div style={{ fontSize: '11px' }}>
            {debugInfo.redirecting ? '✓ Redirecting to app...' : debugInfo.error ? `✗ ${debugInfo.error}` : 'Processing...'}
          </div>
        </div>
      </div>

      {debugInfo.error && (
        <div style={{ marginTop: '16px', fontSize: '12px', color: '#ef4444' }}>
          <strong>Error:</strong> {debugInfo.error}
        </div>
      )}
    </div>
  )
}
