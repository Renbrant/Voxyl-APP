// Future Clerk config for the Cloudflare + Clerk migration.
// This is intentionally not wired into the app yet.

export const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "";

export const isClerkConfigured = CLERK_PUBLISHABLE_KEY !== "";

export const clerkConfigError = isClerkConfigured ? null : "VITE_CLERK_PUBLISHABLE_KEY is missing.";
