import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignOutButton,
  UserButton,
  useAuth,
  useUser,
} from '@clerk/clerk-react'
import { useState } from 'react'
import { API_BASE_URL } from '@/api/voxylApiClient'
import { isClerkConfigured } from '@/lib/clerkConfig'

function ClerkTestContent() {
  const { user, isLoaded } = useUser()
  const { getToken, isSignedIn } = useAuth()
  const [tokenReceived, setTokenReceived] = useState(null)
  const [workerDiagnostics, setWorkerDiagnostics] = useState(null)
  const [isTestingWorkerDiagnostics, setIsTestingWorkerDiagnostics] = useState(false)

  const handleTokenTest = async () => {
    const token = await getToken()
    setTokenReceived(Boolean(token))
  }

  const handleWorkerDiagnosticsTest = async () => {
    setIsTestingWorkerDiagnostics(true)
    setWorkerDiagnostics(null)

    try {
      const token = await getToken()

      if (!token) {
        setWorkerDiagnostics({
          status: null,
          ok: false,
          authenticated: false,
          userId: null,
          sessionId: null,
          email: null,
          error: 'No Clerk token received.',
        })
        return
      }

      const response = await fetch(`${API_BASE_URL.replace(/\/+$/, '')}/api/auth/diagnostics`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const contentType = response.headers.get('content-type') || ''
      const data = contentType.includes('application/json') ? await response.json() : {}

      setWorkerDiagnostics({
        status: response.status,
        ok: Boolean(data.ok),
        authenticated: Boolean(data.authenticated),
        userId: data.userId || null,
        sessionId: data.sessionId || null,
        email: data.email || null,
        error: data.error || null,
      })
    } catch (error) {
      setWorkerDiagnostics({
        status: null,
        ok: false,
        authenticated: false,
        userId: null,
        sessionId: null,
        email: null,
        error: error instanceof Error ? error.message : 'Worker auth diagnostics request failed.',
      })
    } finally {
      setIsTestingWorkerDiagnostics(false)
    }
  }

  return (
    <div className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 rounded-2xl border border-border bg-card p-6">
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-4 text-sm font-medium text-orange-200">
          Temporary migration test page. Base44 remains the active auth provider.
        </div>

        <SignedOut>
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold">Clerk Test</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              This is an isolated migration test for Clerk. It does not replace Base44 auth or change the current app flow.
            </p>
            <SignInButton mode="modal">
              <button className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
                Sign in with Clerk
              </button>
            </SignInButton>
          </div>
        </SignedOut>

        <SignedIn>
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <h1 className="text-2xl font-semibold">Clerk Test</h1>
              <UserButton />
            </div>

            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">User ID</dt>
                <dd className="break-all font-mono">{user?.id || 'Unavailable'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Primary email</dt>
                <dd>{user?.primaryEmailAddress?.emailAddress || 'Unavailable'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Session status</dt>
                <dd>{isLoaded && isSignedIn ? 'Signed in' : 'Loading'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Token received</dt>
                <dd>{tokenReceived === null ? 'Not tested' : String(tokenReceived)}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleTokenTest}
                className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
              >
                Test Clerk token
              </button>
              <button
                type="button"
                onClick={handleWorkerDiagnosticsTest}
                disabled={isTestingWorkerDiagnostics}
                className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isTestingWorkerDiagnostics ? 'Testing Worker auth diagnostics...' : 'Test Worker auth diagnostics'}
              </button>
              <SignOutButton>
                <button className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold">
                  Sign out
                </button>
              </SignOutButton>
            </div>

            {workerDiagnostics && (
              <div className="rounded-xl border border-border bg-background/60 p-4">
                <h2 className="mb-3 text-sm font-semibold">Worker auth diagnostics result</h2>
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">HTTP status</dt>
                    <dd>{workerDiagnostics.status ?? 'Unavailable'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">ok</dt>
                    <dd>{String(workerDiagnostics.ok)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">authenticated</dt>
                    <dd>{String(workerDiagnostics.authenticated)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">userId</dt>
                    <dd className="break-all font-mono">{workerDiagnostics.userId || 'null'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">sessionId</dt>
                    <dd className="break-all font-mono">{workerDiagnostics.sessionId || 'null'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">email</dt>
                    <dd>{workerDiagnostics.email || 'null'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">error</dt>
                    <dd>{workerDiagnostics.error || 'null'}</dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
        </SignedIn>
      </div>
    </div>
  )
}

export default function ClerkTest() {
  if (!isClerkConfigured) {
    return (
      <div className="min-h-screen bg-background px-6 py-10 text-foreground">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 rounded-2xl border border-border bg-card p-6">
          <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-4 text-sm font-medium text-orange-200">
            Temporary migration test page. Base44 remains the active auth provider.
          </div>
          <h1 className="text-2xl font-semibold">Clerk Test</h1>
          <p className="text-sm text-muted-foreground">
            Clerk is not configured. Add VITE_CLERK_PUBLISHABLE_KEY to test this page.
          </p>
        </div>
      </div>
    )
  }

  return <ClerkTestContent />
}
