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
import { isClerkConfigured } from '@/lib/clerkConfig'

function ClerkTestContent() {
  const { user, isLoaded } = useUser()
  const { getToken, isSignedIn } = useAuth()
  const [tokenReceived, setTokenReceived] = useState(null)

  const handleTokenTest = async () => {
    const token = await getToken()
    setTokenReceived(Boolean(token))
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
              <SignOutButton>
                <button className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold">
                  Sign out
                </button>
              </SignOutButton>
            </div>
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
