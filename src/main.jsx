import React from 'react'
import ReactDOM from 'react-dom/client'
import '@/index.css'
import { clearLegacyAuthCredentials, stripLegacyAuthUrl } from '@/lib/legacyAuthCleanup'

async function bootstrap() {
  console.log('[AUTH] bootstrap start')
  // Old callbacks are no longer accepted. Discard their credentials before
  // importing the app or starting Clerk; do not log the incoming URL.
  stripLegacyAuthUrl()
  await clearLegacyAuthCredentials()

  // Apply saved theme before render to avoid flash.
  const savedTheme = localStorage.getItem('theme') || 'dark'
  const root = document.documentElement
  const nativePlatform = window.Capacitor?.getPlatform?.()

  if (nativePlatform === 'android') root.classList.add('native-android')

  if (savedTheme === 'auto') {
    root.classList.add(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  } else {
    root.classList.add(savedTheme === 'light' ? 'light' : 'dark')
  }

  // Mount with the supported Clerk browser or Android native SDK session.
  const [{ default: App }, { default: OptionalClerkProvider }] = await Promise.all([
    import('@/App.jsx'),
    import('@/lib/OptionalClerkProvider.jsx'),
  ])
  ReactDOM.createRoot(document.getElementById('root')).render(
    <OptionalClerkProvider>
      <App />
    </OptionalClerkProvider>
  )
}

bootstrap().catch(error => {
  console.error('[AUTH] bootstrap failed:', error)
  // Fallback: attempt to mount app anyway so the user isn't stuck on a blank screen
  import('@/App.jsx').then(({ default: App }) => {
    ReactDOM.createRoot(document.getElementById('root')).render(<App />)
  })
})
