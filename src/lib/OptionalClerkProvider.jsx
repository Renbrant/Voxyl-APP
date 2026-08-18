import { ClerkProvider } from '@clerk/clerk-react'
import { CLERK_PUBLISHABLE_KEY, isClerkConfigured } from '@/lib/clerkConfig'
import { isAndroidNative } from '@/lib/nativeClerk'

export default function OptionalClerkProvider({ children }) {
  if (isAndroidNative()) {
    return children
  }

  if (!isClerkConfigured) {
    return children
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      {children}
    </ClerkProvider>
  )
}
