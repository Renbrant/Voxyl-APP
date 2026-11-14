import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { voxylApi } from '../api/voxylApiClient.js';
import { invalidateCache } from './appCache.js';
import { asArray } from './arrayUtils.js';

// Single source of truth for block state. Every screen that hides content reads the
// hidden-user list from this cache, and every block or unblock refreshes it, so a block
// made on one screen is applied everywhere without a reload.
export const blockQueryKeys = {
  all: ['blocks'],
  hidden: (userId) => ['blocks', 'hidden', userId],
  outbound: (userId) => ['blocks', 'outbound', userId],
};

const NO_IDS = [];

// Content queries whose results depend on who is blocked.
const BLOCK_DEPENDENT_QUERY_KEYS = new Set([
  'home-rankings',
  'all-playlists-feed',
  'explore-playlists',
]);

/** Returns a de-duplicated list of non-empty string ids. */
export function normalizeHiddenIds(raw) {
  const ids = [];
  const seen = new Set();

  for (const value of asArray(raw)) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

/**
 * Playlists carry the creator's canonical user id in `creator_id`, the same id that
 * `/api/blocks/hidden-users` returns. Items without a creator id are never hidden.
 */
export function isCreatorHidden(item, hiddenIds) {
  const creatorId = item?.creator_id;
  if (!creatorId) return false;
  return asArray(hiddenIds).includes(creatorId);
}

export function filterVisibleCreators(items, hiddenIds) {
  const hidden = new Set(asArray(hiddenIds));
  return asArray(items).filter((item) => !item?.creator_id || !hidden.has(item.creator_id));
}

export function isBlockDependentQuery(query) {
  const [root] = query?.queryKey || [];
  if (typeof root !== 'string') return false;
  return BLOCK_DEPENDENT_QUERY_KEYS.has(root) || root.startsWith('people-');
}

export function fetchHiddenUserIds() {
  return voxylApi.blocks.hiddenUserIds().then(normalizeHiddenIds);
}

/**
 * Refresh everything that depends on block state. Call it after a block is created or
 * removed, from any screen.
 */
export function refreshBlockQueries(queryClient, userId) {
  if (userId) {
    invalidateCache(`hidden-users-${userId}`);
  }

  return Promise.all([
    queryClient.invalidateQueries({ queryKey: blockQueryKeys.all }),
    queryClient.invalidateQueries({ predicate: isBlockDependentQuery }),
  ]);
}

/**
 * Ids of users whose content must be hidden from the signed-in user (both directions).
 * `hiddenUsersReady` stays false until the list has loaded, so callers can fail closed
 * instead of briefly showing content that should be hidden.
 */
export function useHiddenUsers(userId) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: blockQueryKeys.hidden(userId),
    enabled: Boolean(userId),
    queryFn: fetchHiddenUserIds,
    refetchOnMount: 'always',
  });

  const setBlockedIds = useCallback((updater) => {
    queryClient.setQueryData(blockQueryKeys.hidden(userId), (previous) => {
      const current = previous || NO_IDS;
      return normalizeHiddenIds(typeof updater === 'function' ? updater(current) : updater);
    });
  }, [queryClient, userId]);

  const { refetch } = query;
  const loadHiddenUsers = useCallback(() => refetch(), [refetch]);

  return {
    blockedIds: query.data || NO_IDS,
    hiddenUsersReady: query.data !== undefined,
    hiddenUsersLoading: query.data === undefined && query.isFetching,
    // Callers show their own localized message when loading finished without data.
    hiddenUsersError: '',
    loadHiddenUsers,
    setBlockedIds,
  };
}

/** The blocks the signed-in user created. Used for the count and the management list. */
export function useOutboundBlocks(userId) {
  return useQuery({
    queryKey: blockQueryKeys.outbound(userId),
    enabled: Boolean(userId),
    queryFn: () => voxylApi.blocks.listOutbound().then(asArray),
    refetchOnMount: 'always',
  });
}
