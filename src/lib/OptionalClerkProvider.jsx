import { ClerkProvider } from '@clerk/clerk-react'
import { CLERK_PUBLISHABLE_KEY, isClerkConfigured } from '@/lib/clerkConfig'

export default function OptionalClerkProvider({ children }) {
  if (!isClerkConfigured) {
    return children
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      {children}
    </ClerkProvider>
  )
}
