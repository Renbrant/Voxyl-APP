import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Inbox, RefreshCcw, Sparkles, UserCheck, Users } from 'lucide-react';
import { voxylApi } from '@/api/voxylApiClient';
import VoxylHeader from '@/components/common/VoxylHeader';
import PodcastSearchBar from '@/components/explore/PodcastSearchBar';
import PeopleUserCard from '@/components/people/PeopleUserCard';
import { useDebounce } from '@/hooks/useDebounce';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const PEOPLE_SECTIONS = Object.freeze([
  {
    key: 'following',
    labelKey: 'peopleFollowing',
    hintKey: 'peopleFollowingHint',
    emptyKey: 'peopleNoFollowing',
    icon: UserCheck,
  },
  {
    key: 'followers',
    labelKey: 'peopleFollowers',
    hintKey: 'peopleFollowersHint',
    emptyKey: 'peopleNoFollowers',
    icon: Users,
  },
  {
    key: 'requests',
    labelKey: 'peopleRequests',
    hintKey: 'peopleRequestsHint',
    emptyKey: 'peopleNoRequests',
    icon: Inbox,
  },
  {
    key: 'suggestions',
    labelKey: 'peopleSuggestions',
    hintKey: 'peopleSuggestionsHint',
    emptyKey: 'peopleNoSuggestions',
    icon: Sparkles,
  },
]);

const PEOPLE_SECTION_KEYS = new Set(PEOPLE_SECTIONS.map((section) => section.key));

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeUser(user) {
  return {
    ...user,
    full_name: user?.full_name || user?.name || '',
  };
}

function userFromFollow(follow, side) {
  const prefix = side === 'follower' ? 'follower' : 'following';

  return {
    id: follow[`${prefix}_id`],
    username: follow[`${prefix}_username`],
    full_name: follow[`${prefix}_name`],
    profile_picture: follow[`${prefix}_profile_picture`],
  };
}

export default function People() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const requestedSection = params.get('section');
  const selectedSection = PEOPLE_SECTION_KEYS.has(requestedSection)
    ? requestedSection
    : null;

  const [user, setUser] = useState(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [followOverrides, setFollowOverrides] = useState({});

  const debouncedUserSearch = useDebounce(userSearch, 400);
  const searchMode = debouncedUserSearch.trim().length > 0;
  const socialDetailsActive = Boolean(user && (selectedSection || searchMode));

  useEffect(() => {
    let active = true;

    voxylApi.auth.me()
      .then((currentUser) => {
        if (!active) return;
        setUser(currentUser);
        setAuthResolved(true);
      })
      .catch((error) => {
        if (!active) return;
        if (error?.status && error.status !== 401) {
          console.error('[People] Failed to resolve current user', { error });
        }
        setUser(null);
        setAuthResolved(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const summaryQuery = useQuery({
    queryKey: ['people-summary', user?.id],
    enabled: Boolean(user),
    queryFn: () => voxylApi.people.summary(),
  });

  const hiddenQuery = useQuery({
    queryKey: ['people-hidden-users', user?.id],
    enabled: socialDetailsActive,
    queryFn: () => voxylApi.blocks.hiddenUserIds(),
  });

  const outgoingQuery = useQuery({
    queryKey: ['people-outgoing-follows', user?.id],
    enabled: socialDetailsActive,
    queryFn: () => voxylApi.entities.Follow.filter({ follower_id: user.id }),
  });

  const incomingAcceptedQuery = useQuery({
    queryKey: ['people-incoming-accepted', user?.id],
    enabled: socialDetailsActive,
    queryFn: () => voxylApi.entities.Follow.filter({ following_id: user.id, status: 'accepted' }),
  });

  const incomingPendingQuery = useQuery({
    queryKey: ['people-incoming-pending', user?.id],
    enabled: socialDetailsActive,
    queryFn: () => voxylApi.entities.Follow.filter({ following_id: user.id, status: 'pending' }),
  });

  const suggestionsQuery = useQuery({
    queryKey: ['people-suggestions-preview', user?.id],
    enabled: Boolean(user && selectedSection === 'suggestions'),
    queryFn: () => voxylApi.functions.invoke('searchUsers', { query: '' }).then((response) => response.data?.users || []),
  });

  const searchQuery = useQuery({
    queryKey: ['people-user-search', debouncedUserSearch],
    enabled: searchMode,
    queryFn: () => voxylApi.functions.invoke('searchUsers', { query: debouncedUserSearch }).then((response) => response.data?.users || []),
  });

  const hiddenIds = useMemo(
    () => new Set(asArray(hiddenQuery.data)),
    [hiddenQuery.data],
  );

  const followStatuses = useMemo(() => {
    const statuses = {};

    for (const follow of asArray(outgoingQuery.data)) {
      statuses[follow.following_id] = follow.status;
    }

    return {
      ...statuses,
      ...followOverrides,
    };
  }, [outgoingQuery.data, followOverrides]);

  const incomingAcceptedIds = useMemo(
    () => new Set(asArray(incomingAcceptedQuery.data).map((follow) => follow.follower_id)),
    [incomingAcceptedQuery.data],
  );

  const incomingPendingIds = useMemo(
    () => new Set(asArray(incomingPendingQuery.data).map((follow) => follow.follower_id)),
    [incomingPendingQuery.data],
  );

  const searchRows = useMemo(
    () => asArray(searchQuery.data)
      .map(normalizeUser)
      .filter((candidate) => candidate.id !== user?.id && !hiddenIds.has(candidate.id)),
    [searchQuery.data, hiddenIds, user?.id],
  );

  const sectionRows = useMemo(() => {
    if (!selectedSection) return [];

    if (selectedSection === 'following') {
      return asArray(outgoingQuery.data)
        .filter((follow) => followStatuses[follow.following_id] === 'accepted')
        .map((follow) => userFromFollow(follow, 'following'))
        .filter((candidate) => !hiddenIds.has(candidate.id));
    }

    if (selectedSection === 'followers') {
      return asArray(incomingAcceptedQuery.data)
        .map((follow) => userFromFollow(follow, 'follower'))
        .filter((candidate) => !hiddenIds.has(candidate.id));
    }

    if (selectedSection === 'requests') {
      return asArray(incomingPendingQuery.data)
        .map((follow) => userFromFollow(follow, 'follower'))
        .filter((candidate) => !hiddenIds.has(candidate.id));
    }

    return asArray(suggestionsQuery.data)
      .map(normalizeUser)
      .filter((candidate) => (
        candidate.id !== user?.id &&
        !hiddenIds.has(candidate.id) &&
        !followStatuses[candidate.id] &&
        !incomingPendingIds.has(candidate.id)
      ));
  }, [
    selectedSection,
    outgoingQuery.data,
    incomingAcceptedQuery.data,
    incomingPendingQuery.data,
    suggestionsQuery.data,
    followStatuses,
    incomingPendingIds,
    hiddenIds,
    user?.id,
  ]);

  const commonSocialQueries = [
    hiddenQuery,
    outgoingQuery,
    incomingAcceptedQuery,
    incomingPendingQuery,
  ];

  const commonSocialLoading = Boolean(
    user &&
    socialDetailsActive &&
    commonSocialQueries.some((query) => query.isLoading),
  );

  const commonSocialError = Boolean(
    user &&
    socialDetailsActive &&
    commonSocialQueries.some((query) => query.isError),
  );

  const sectionLoading = commonSocialLoading ||
    Boolean(selectedSection === 'suggestions' && suggestionsQuery.isLoading);

  const sectionError = commonSocialError ||
    Boolean(selectedSection === 'suggestions' && suggestionsQuery.isError);

  const searchLoading = searchQuery.isLoading || Boolean(user && commonSocialLoading);
  const searchError = searchQuery.isError || Boolean(user && commonSocialError);

  const summaryCounts = summaryQuery.data?.counts || null;
  const sectionConfig = PEOPLE_SECTIONS.find((section) => section.key === selectedSection) || null;

  const handleStatusChange = (targetUserId, status) => {
    setFollowOverrides((previous) => ({
      ...previous,
      [targetUserId]: status,
    }));
  };

  const retrySocial = () => {
    hiddenQuery.refetch();
    outgoingQuery.refetch();
    incomingAcceptedQuery.refetch();
    incomingPendingQuery.refetch();

    if (selectedSection === 'suggestions') {
      suggestionsQuery.refetch();
    }
  };

  const handleSignIn = async () => {
    setLoginError('');

    try {
      await voxylApi.auth.redirectToLogin();
    } catch (error) {
      console.error('[People] Failed to start sign-in', { error });
      setLoginError(t('peopleSignInError'));
    }
  };

  const signInCard = (
    <div className="rounded-3xl border border-border bg-card p-6 text-center">
      <Users size={28} className="mx-auto mb-3 text-primary" />
      <h2 className="font-semibold text-foreground">{t('peopleSignInTitle')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('peopleSignInHint')}</p>
      {loginError && (
        <p className="mt-3 text-xs text-destructive">{loginError}</p>
      )}
      <button
        type="button"
        onClick={handleSignIn}
        className="mt-4 rounded-full gradient-primary px-5 py-2 text-sm font-semibold text-white"
      >
        {t('peopleSignInAction')}
      </button>
    </div>
  );

  return (
    <div className="bg-background pb-24">
      <VoxylHeader
        title={t('navPeople')}
        subtitle={t('peopleSubtitle')}
        right={null}
      />

      <main className="mx-auto w-full max-w-5xl px-4">
        <div className="mb-4">
          <PodcastSearchBar
            value={userSearch}
            onChange={setUserSearch}
            loading={searchQuery.isFetching}
            placeholder={t('peopleSearchPlaceholder')}
          />
        </div>

        <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
          {PEOPLE_SECTIONS.map((section) => {
            const SectionIcon = section.icon;
            const active = selectedSection === section.key && !searchMode;

            return (
              <button
                key={section.key}
                type="button"
                aria-pressed={active}
                onClick={() => navigate(`/people?section=${section.key}`)}
                className={cn(
                  'flex flex-shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-all',
                  active
                    ? 'gradient-primary border-transparent text-white'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                <SectionIcon size={14} />
                {t(section.labelKey)}
              </button>
            );
          })}
        </div>

        {searchMode ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-foreground">
              {t('peopleSearchResults')}
            </h2>

            {searchLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, index) => (
                  <div key={index} className="h-16 animate-pulse rounded-2xl bg-secondary" />
                ))}
              </div>
            ) : searchError ? (
              <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
                <p>{t('peopleSectionError')}</p>
                <button
                  type="button"
                  onClick={() => {
                    searchQuery.refetch();
                    if (user) retrySocial();
                  }}
                  className="mt-3 inline-flex items-center gap-2 rounded-full gradient-primary px-4 py-2 text-xs font-semibold text-white"
                >
                  <RefreshCcw size={13} />
                  {t('retry')}
                </button>
              </div>
            ) : searchRows.length === 0 ? (
              <div className="py-14 text-center text-sm text-muted-foreground">
                {t('noResults')}
              </div>
            ) : (
              <div className="space-y-2">
                {searchRows.map((searchedUser, index) => (
                  <PeopleUserCard
                    key={searchedUser.id}
                    user={searchedUser}
                    index={index}
                    currentUser={user}
                    followStatus={followStatuses[searchedUser.id] || null}
                    theyFollowMe={incomingAcceptedIds.has(searchedUser.id)}
                    onStatusChange={(status) => handleStatusChange(searchedUser.id, status)}
                  />
                ))}
              </div>
            )}
          </section>
        ) : selectedSection ? (
          <section>
            <button
              type="button"
              onClick={() => navigate('/people')}
              className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft size={14} />
              {t('peopleBackDashboard')}
            </button>

            <div className="mb-4">
              <h2 className="text-lg font-semibold text-foreground">
                {t(sectionConfig.labelKey)}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t(sectionConfig.hintKey)}
              </p>
              {selectedSection === 'suggestions' && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('peopleSuggestionsSubset')}
                </p>
              )}
            </div>

            {!authResolved ? (
              <div className="h-24 animate-pulse rounded-3xl bg-secondary" />
            ) : !user ? (
              signInCard
            ) : sectionLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, index) => (
                  <div key={index} className="h-16 animate-pulse rounded-2xl bg-secondary" />
                ))}
              </div>
            ) : sectionError ? (
              <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
                <p>{t('peopleSectionError')}</p>
                <button
                  type="button"
                  onClick={retrySocial}
                  className="mt-3 inline-flex items-center gap-2 rounded-full gradient-primary px-4 py-2 text-xs font-semibold text-white"
                >
                  <RefreshCcw size={13} />
                  {t('retry')}
                </button>
              </div>
            ) : (
              <>
                {selectedSection === 'requests' && sectionRows.length > 0 && (
                  <div className="mb-3 flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground">
                    <Inbox size={14} />
                    <span>{t('peopleRequestsAttention')}</span>
                  </div>
                )}

                {sectionRows.length === 0 ? (
                  <div className="py-14 text-center text-sm text-muted-foreground">
                    {t(sectionConfig.emptyKey)}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sectionRows.map((sectionUser, index) => (
                      <PeopleUserCard
                        key={sectionUser.id}
                        user={sectionUser}
                        index={index}
                        currentUser={user}
                        followStatus={followStatuses[sectionUser.id] || null}
                        theyFollowMe={incomingAcceptedIds.has(sectionUser.id)}
                        onStatusChange={(status) => handleStatusChange(sectionUser.id, status)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        ) : (
          <section>
            {!authResolved ? (
              <div className="grid grid-cols-2 gap-3">
                {[...Array(4)].map((_, index) => (
                  <div key={index} className="h-36 animate-pulse rounded-3xl bg-secondary" />
                ))}
              </div>
            ) : !user ? (
              signInCard
            ) : summaryQuery.isLoading ? (
              <div className="grid grid-cols-2 gap-3">
                {[...Array(4)].map((_, index) => (
                  <div key={index} className="h-36 animate-pulse rounded-3xl bg-secondary" />
                ))}
              </div>
            ) : summaryQuery.isError || !summaryCounts ? (
              <div className="rounded-3xl border border-border bg-card p-5 text-center">
                <p className="text-sm text-muted-foreground">{t('peopleSummaryError')}</p>
                <button
                  type="button"
                  onClick={() => summaryQuery.refetch()}
                  className="mt-3 inline-flex items-center gap-2 rounded-full gradient-primary px-4 py-2 text-xs font-semibold text-white"
                >
                  <RefreshCcw size={13} />
                  {t('retry')}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {PEOPLE_SECTIONS.map((section) => {
                  const SectionIcon = section.icon;
                  const count = summaryCounts[section.key];

                  return (
                    <button
                      key={section.key}
                      type="button"
                      onClick={() => navigate(`/people?section=${section.key}`)}
                      className="group flex min-h-36 flex-col rounded-3xl border border-border bg-card p-4 text-left transition-all hover:border-primary/30"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-secondary">
                          <SectionIcon size={18} className="text-primary" />
                        </div>
                        <ChevronRight size={18} className="text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </div>

                      <div className="mt-auto">
                        <div className="text-2xl font-bold text-foreground">{count}</div>
                        <div className="mt-1 text-sm font-semibold text-foreground">
                          {t(section.labelKey)}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {t(section.hintKey)}
                        </div>

                        {section.key === 'requests' && count > 0 && (
                          <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-primary">
                            <Inbox size={12} />
                            <span>{t('peopleRequestsAttention')}</span>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
