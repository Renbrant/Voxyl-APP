import { ClerkProvider } from '@clerk/clerk-react'
import { CLERK_PUBLISHABLE_KEY, isClerkConfigured } from '@/lib/clerkConfig'

export default function OptionalClerkProvider({ children }) {
  if (!isClerkConfigured) {
    return children
  }

  // ClerkProvider is currently passive; Base44 remains the active auth provider during migration.
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      {children}
    </ClerkProvider>
  )
}
