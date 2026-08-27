export const DISCOVER_TAB_KEYS = Object.freeze(['playlists', 'podcasts']);

export function resolveExploreTab(requestedTab) {
  return DISCOVER_TAB_KEYS.includes(requestedTab) ? requestedTab : 'playlists';
}
