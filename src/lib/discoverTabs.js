export const DISCOVER_TAB_KEYS = Object.freeze(['playlists', 'podcasts']);

export function resolveExploreTab(lockedTab, requestedTab) {
  if (lockedTab) return lockedTab;
  return DISCOVER_TAB_KEYS.includes(requestedTab) ? requestedTab : 'playlists';
}
