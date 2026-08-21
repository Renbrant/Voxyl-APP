export const PRIMARY_NAVIGATION = Object.freeze([
  Object.freeze({
    id: 'home',
    path: '/',
    labelKey: 'navHome',
    icon: 'home',
  }),
  Object.freeze({
    id: 'discover',
    path: '/discover',
    labelKey: 'navDiscover',
    icon: 'discover',
  }),
  Object.freeze({
    id: 'people',
    path: '/people',
    labelKey: 'navPeople',
    icon: 'people',
  }),
  Object.freeze({
    id: 'library',
    path: '/library',
    labelKey: 'navLibrary',
    icon: 'library',
  }),
  Object.freeze({
    id: 'profile',
    path: '/profile',
    labelKey: 'navProfile',
    icon: 'profile',
  }),
]);

export const PRIMARY_NAVIGATION_IDS = Object.freeze(
  PRIMARY_NAVIGATION.map(item => item.id),
);

export const PRIMARY_NAVIGATION_PATHS = Object.freeze(
  PRIMARY_NAVIGATION.map(item => item.path),
);

const LEGACY_RUNTIME = Object.freeze({
  home: Object.freeze({
    path: '/',
    labelKey: 'navFeed',
  }),
  discover: Object.freeze({
    path: '/explore',
    labelKey: 'navExplore',
  }),
  library: Object.freeze({
    path: '/playlists',
    labelKey: 'navPlaylists',
  }),
  profile: Object.freeze({
    path: '/profile',
    labelKey: 'navProfile',
  }),
});

const LEGACY_RUNTIME_IDS = Object.freeze([
  'home',
  'discover',
  'library',
  'profile',
]);

export const LEGACY_PRIMARY_NAVIGATION = Object.freeze(
  LEGACY_RUNTIME_IDS.map(id => {
    const canonical = PRIMARY_NAVIGATION.find(item => item.id === id);
    const legacy = LEGACY_RUNTIME[id];

    if (!canonical || !legacy) {
      throw new Error(`Missing primary navigation compatibility item: ${id}`);
    }

    return Object.freeze({
      ...canonical,
      path: legacy.path,
      labelKey: legacy.labelKey,
    });
  }),
);

export const ACTIVE_PRIMARY_NAVIGATION = Object.freeze(
  PRIMARY_NAVIGATION.filter(item => item.id !== 'people'),
);

export const LEGACY_PRIMARY_ROUTE_REDIRECTS = Object.freeze({
  '/explore': '/discover',
  '/playlists': '/library',
});
