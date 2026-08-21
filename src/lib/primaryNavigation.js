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
