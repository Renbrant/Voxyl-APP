import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

function source(path) {
  return fs.readFileSync(new URL(path, import.meta.url), 'utf8');
}

function section(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);

  assert.ok(start >= 0, `Missing section start: ${startMarker}`);
  assert.ok(end > start, `Missing section end: ${endMarker}`);

  return text.slice(start, end);
}

const workerSource = source('../workers/api/src/index.ts');
const migrationSource = source('../workers/api/migrations/0004_clerk_profile_picture.sql');
const profileSource = source('../src/pages/Profile.jsx');
const userProfileSource = source('../src/pages/UserProfile.jsx');
const peopleSource = source('../src/pages/People.jsx');
const userSearchCardSource = source('../src/components/explore/UserSearchCard.jsx');
const followRequestsSource = source('../src/components/profile/FollowRequestsModal.jsx');
const userAvatarSource = source('../src/components/common/UserAvatar.jsx');

const authContextSource = source('../src/lib/AuthContext.jsx');
const createPlaylistSource = source('../src/components/playlist/CreatePlaylistModal.jsx');

describe('Issue #35 Google/Clerk avatar regressions', () => {
  it('stores the Clerk/provider avatar separately from the custom Voxyl avatar', () => {
    assert.match(
      migrationSource,
      /ALTER TABLE users ADD COLUMN clerk_profile_picture TEXT;/,
    );

    assert.match(workerSource, /profile_picture: string \| null;/);
    assert.match(workerSource, /clerk_profile_picture: string \| null;/);
  });

  it('reads a real Clerk image and ignores a generated Clerk fallback image', () => {
    assert.match(workerSource, /image_url\?: string \| null;/);
    assert.match(workerSource, /has_image\?: boolean;/);

    assert.match(
      workerSource,
      /data\.has_image === false[\s\S]*?null[\s\S]*?data\.image_url\?\.trim\(\) \|\| null/,
    );
  });

  it('performs provider synchronization only during the /me bootstrap path', () => {
    const syncCalls = workerSource.match(/syncClerkProfile:\s*true/g) || [];
    assert.equal(syncCalls.length, 1);

    const meSource = section(
      workerSource,
      'async function meResponse',
      'async function updateMeResponse',
    );

    assert.match(meSource, /syncClerkProfile:\s*true/);


  });

  it('keeps custom > Clerk > fallback precedence in the client user contract', () => {
    const resolver = section(
      workerSource,
      'function resolveProfilePicture',
      'function toClientUser',
    );

    const customIndex = resolver.indexOf('user.profile_picture?.trim()');
    const clerkIndex = resolver.indexOf('user.clerk_profile_picture?.trim()');

    assert.ok(customIndex >= 0);
    assert.ok(clerkIndex > customIndex);

    const clientUser = section(
      workerSource,
      'function toClientUser',
      'async function meResponse',
    );

    assert.match(clientUser, /custom_profile_picture: user\.profile_picture/);
    assert.match(clientUser, /profile_picture: resolvedPicture/);
    assert.match(clientUser, /picture: resolvedPicture/);
  });

  it('returns the same resolved avatar through search, public profile, follows, and blocks', () => {
    assert.match(
      workerSource,
      /NULLIF\(TRIM\(profile_picture\), ''\)[\s\S]*?NULLIF\(TRIM\(clerk_profile_picture\), ''\)[\s\S]*?AS profile_picture/,
    );

    assert.match(
      workerSource,
      /profile_picture: resolveProfilePicture\(user\)/,
    );

    assert.match(
      workerSource,
      /AS follower_profile_picture/,
    );

    assert.match(
      workerSource,
      /AS following_profile_picture/,
    );

    assert.match(
      workerSource,
      /u\.clerk_profile_picture[\s\S]*?AS blocked_profile_picture/,
    );
  });

  it('restores the provider avatar by clearing the custom override', () => {
    const useLoginPhoto = section(
      profileSource,
      'const handleUseLoginPhoto',
      'const handleUploadPhoto',
    );

    assert.match(useLoginPhoto, /user\.clerk_profile_picture/);
    assert.match(useLoginPhoto, /profile_picture:\s*null/);
    assert.match(useLoginPhoto, /setLocalUser\(updatedUser\)/);

    assert.match(
      profileSource,
      /user\.clerk_profile_picture && user\.custom_profile_picture/,
    );
  });

  it('uses one common avatar component with Radix image-failure fallback', () => {
    assert.match(userAvatarSource, /AvatarImage/);
    assert.match(userAvatarSource, /AvatarFallback/);
    assert.match(userAvatarSource, /getUserInitials/);

    for (const displaySource of [
      userSearchCardSource,
      profileSource,
      userProfileSource,
      followRequestsSource,
    ]) {
      assert.match(displaySource, /UserAvatar/);
    }
  });

  it('uses the follow DTO avatar directly instead of an N+1 public-profile request', () => {
    assert.match(
      followRequestsSource,
      /src=\{req\.follower_profile_picture\}/,
    );

    assert.doesNotMatch(
      followRequestsSource,
      /getPublicUserProfile/,
    );
  });

  it('propagates follow DTO avatars through People', () => {
    assert.match(
      peopleSource,
      /const prefix = side === 'follower' \? 'follower' : 'following'/,
    );

    assert.match(
      peopleSource,
      /profile_picture: follow\[/,
    );

    const followingMatches =
      peopleSource.match(/userFromFollow\(follow, 'following'\)/g) || [];

    const followerMatches =
      peopleSource.match(/userFromFollow\(follow, 'follower'\)/g) || [];

    assert.equal(followingMatches.length, 1);
    assert.equal(followerMatches.length, 2);
    assert.match(peopleSource, /user=\{sectionUser\}/);
    assert.match(peopleSource, /user=\{searchedUser\}/);
  });
  it('keeps existing playlist creator avatars synchronized in the Worker', () => {
    assert.match(
      workerSource,
      /function preparePlaylistCreatorPictureSync/,
    );

    assert.match(
      workerSource,
      /SET creator_picture = \?/,
    );

    assert.doesNotMatch(
      profileSource,
      /syncPictureToPlaylists/,
    );
  });

  it('keeps the Clerk image as the provisional auth fallback before D1 bootstrap completes', () => {
    assert.match(
      authContextSource,
      /profile_picture:\s*clerkUser\.imageUrl \|\| null/,
    );
  });

  it('uses the resolved authenticated avatar when creating new playlists', () => {
    assert.match(
      createPlaylistSource,
      /creator_picture:\s*user\.profile_picture \|\| user\.picture \|\| user\.avatar_url \|\| ''/,
    );
  });
});