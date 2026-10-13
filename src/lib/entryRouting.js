// The native shell starts at /, while browsers use / as the public landing page.
// Preserve navigation parameters when opening native Home.
export function getNativeEntryRedirect({ pathname, search = '', hash = '' }, isNativePlatform) {
  if (!isNativePlatform || pathname !== '/') return null;
  return `/app${search}${hash}`;
}
