# Analysis for Issue #63: User Profile and Social Features

Branch: `fix/issue-63-user-profile-social`

## Scope

This is Phase 1 investigation only. No application code was changed in this phase.

The three reported broken areas are:

1. Profile photo upload does not persist.
2. Follower usernames are not displayed reliably.
3. Follow button does not create/cancel follow relationships.

## Problem 1: Profile Photo Upload Does Not Persist

### Frontend Flow Observed

`src/pages/Profile.jsx` calls:

```js
const res = await voxylApi.integrations.Core.UploadFile({ file }).catch(() => null);
if (res?.file_url) {
  await voxylApi.auth.updateMe({ profile_picture: res.file_url });
}
```

`src/api/voxylApiClient.js` maps this to:

```js
return apiFetch("/files/upload", { method: "POST", body: formData });
```

### Worker Findings

Searches for `UploadFile`, `/files/upload`, upload routes, and upload handlers found no Worker route or handler for `POST /api/files/upload` or `/files/upload`.

The Worker does have an R2 binding:

```ts
VOXYL_MEDIA: R2Bucket;
```

and diagnostics code uses `env.VOXYL_MEDIA`, so the storage binding exists conceptually, but there is no upload endpoint wired to it.

### PATCH /api/me Finding

`workers/api/src/index.ts` currently has:

```ts
if (request.method === "GET" && isMeRoute(pathname)) {
  return withCors(await meResponse(request, env), request, env);
}
```

There is no dispatch for:

```ts
PATCH /api/me
PATCH /me
```

`meResponse()` only returns the current user and does not parse update payloads or update `users.profile_picture`.

### Conclusion

Profile upload is broken in two places:

1. `POST /api/files/upload` is missing, so `UploadFile()` returns 404.
2. `PATCH /api/me` is missing, so `voxylApi.auth.updateMe({ profile_picture })` returns 404 even if a URL is available.

## Problem 2: Follower Usernames Not Displaying

### Backend Findings

The schema includes `follows.follower_username` via migration:

```sql
ALTER TABLE follows ADD COLUMN follower_username TEXT;
```

The Worker `D1Follow` type includes:

```ts
follower_username: string | null;
```

The shared `followSelect` includes:

```sql
follower_name, follower_username, following_email
```

So the Follow entity read path can return `follower_username` when the row has it.

### Access Control Finding

`followsResponse()` requires Clerk auth and only allows queries involving the current authenticated user:

```ts
const queryInvolvesCurrentUser =
  (followerId !== null && allowedUserIds.has(followerId)) ||
  (followingId !== null && allowedUserIds.has(followingId));
```

This means a public profile page for another user cannot freely query:

```js
voxylApi.entities.Follow.filter({ following_id: userId, status: 'accepted' })
voxylApi.entities.Follow.filter({ follower_id: userId })
```

unless `userId` is the current authenticated user. On public profiles, those calls often return 403 and the UI catches/logs the error.

### Frontend Findings

`src/components/profile/FollowRequestsModal.jsx` already uses `req.follower_username` for display:

```js
const displayName = req.follower_username ? `@${req.follower_username}` : (req.follower_name || 'Usuário');
```

That should work for pending requests owned by the current user because `following_id = currentUser.id` passes the backend access check.

`src/pages/UserProfile.jsx` has a likely logic bug:

```js
voxylApi.entities.Follow.filter({ follower_id: userId })
  .then(follows => {
    if (follows.length > 0 && follows[0].follower_username) {
      setProfileUser(prev => prev?.username ? prev : {
        ...prev,
        username: follows[0].follower_username || null,
        full_name: follows[0].follower_name || null,
      });
    }
  })
```

For a profile page of `userId`, `follower_id: userId` means rows where the profile user follows someone else. `follower_username` on those rows may indeed describe the profile user, but this query is blocked for most viewers by `followsResponse()` unless the viewer is that same user or an admin.

### Conclusion

`follower_username` is selected by the Worker, but public profile usage is blocked by access control. For public profile display, the more reliable source should be `getPublicUserProfile(userId)` and public playlist metadata, not protected Follow entity queries.

If the product needs visible follower lists on public profiles, a dedicated privacy-safe endpoint is required. If only the follower count is needed, a count-only public endpoint would avoid leaking private follow graph details.

## Problem 3: Follow Button Does Not Work

### Frontend Findings

`src/components/profile/FollowButton.jsx` does not call `voxylApi.entities.Follow.create()`.

It calls function routes:

```js
await voxylApi.functions.invoke('cancelFollowRequest', { targetUserId })
await voxylApi.functions.invoke('requestFollow', { targetUserId })
```

Other call sites use the same function names:

```js
src/lib/AuthContext.jsx
src/pages/PlaylistDetail.jsx
```

### Worker Findings

Searches in `workers/api/src/index.ts` found no route detection functions or handlers for:

```txt
/api/functions/requestFollow
/functions/requestFollow
/api/functions/cancelFollowRequest
/functions/cancelFollowRequest
```

The Worker currently supports:

```ts
GET /api/entities/follow
```

via:

```ts
if (request.method === "GET" && isEntityFollowRoute(pathname)) {
  return withCors(await followsResponse(request, env), request, env);
}
```

There is no dispatch for:

```txt
POST /api/entities/follow
PATCH /api/entities/follow/:id
DELETE /api/entities/follow/:id
```

This also affects `FollowRequestsModal.jsx`, which calls:

```js
voxylApi.entities.Follow.update(follow.id, { status: 'accepted' });
voxylApi.entities.Follow.delete(follow.id);
```

Those currently map to generic entity paths that the Worker does not route for follows.

### Conclusion

Follow actions are broken because the frontend uses missing function endpoints, and the generic Follow entity write/update/delete endpoints are also missing.

## Recommended Phase 2 Fix Plan

### 1. Implement File Upload

Add route detection:

```ts
function isFileUploadRoute(pathname: string): boolean {
  return pathname === "/api/files/upload" || pathname === "/files/upload";
}
```

Add `POST` dispatch before the 404 fallback.

Handler behavior:

1. Require Clerk auth.
2. Parse `multipart/form-data`.
3. Read `file` from `FormData`.
4. Validate file type and size.
5. Store in `env.VOXYL_MEDIA`.
6. Return:

```json
{ "file_url": "..." }
```

Open question: confirm the public URL base for `VOXYL_MEDIA`. If no public R2/custom domain is configured, the Worker may need a companion read route or a known media base env var.

### 2. Implement PATCH /api/me

Add route dispatch:

```ts
if (request.method === "PATCH" && isMeRoute(pathname)) {
  return withCors(await updateMeResponse(request, env), request, env);
}
```

Handler behavior:

1. Require Clerk auth.
2. Resolve D1 user with `resolveD1UserFromClerkClaims`.
3. Accept safe profile fields only:
   - `profile_picture`
   - `profile_hidden`
   - possibly `username` if `syncUsername` remains unimplemented.
4. Use parameterized `UPDATE users SET ... WHERE id = ?`.
5. Return updated user using `toClientUser(user)`.

### 3. Implement Follow Creation and Function Aliases

Preferred compatibility path: implement the function routes used by the existing UI:

```txt
POST /api/functions/requestFollow
POST /functions/requestFollow
POST /api/functions/cancelFollowRequest
POST /functions/cancelFollowRequest
```

`requestFollow` behavior:

1. Require auth.
2. Parse `{ targetUserId }`.
3. Reject self-follow.
4. Verify target user exists and is not hidden/blocked as appropriate.
5. Insert or upsert into `follows`.
6. Populate denormalized fields:
   - `follower_clerk_user_id`
   - `follower_legacy_base44_user_id`
   - `follower_email`
   - `follower_name`
   - `follower_username`
   - `following_clerk_user_id`
   - `following_legacy_base44_user_id`
   - `following_email`
7. Use `status = 'pending'` by default.
8. Return the follow record.

`cancelFollowRequest` behavior:

1. Require auth.
2. Parse `{ targetUserId }`.
3. Delete rows where authenticated user is follower and target is following.
4. Return `{ ok: true, deleted: true }`.

### 4. Implement Follow Entity Writes Used By Existing UI

Add support for:

```txt
PATCH /api/entities/follow/:id
DELETE /api/entities/follow/:id
```

Acceptance/rejection in `FollowRequestsModal.jsx` depends on these paths.

`PATCH` should only allow the followed user to accept/reject their own incoming request, or admin. For acceptance:

```json
{ "status": "accepted" }
```

`DELETE` should allow either follower or following user to delete/cancel/reject the relationship.

### 5. Revisit Public Profile Follower Display

Do not loosen `GET /api/entities/follow` broadly because it can leak social graph data.

Safer options:

1. Use `getPublicUserProfile(userId)` as the source for the displayed profile username/photo.
2. Add a dedicated public follower count endpoint that returns only aggregate count.
3. If a public follower list is desired, add a dedicated endpoint that returns only public, non-hidden user profile snippets.

## Manual Test Commands

After Phase 2 fixes:

```bash
curl -X POST http://localhost:8787/api/files/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@/path/to/photo.jpg"
```

```bash
curl -X PATCH http://localhost:8787/api/me \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"profile_picture":"https://example.com/photo.jpg"}'
```

```bash
curl -X POST http://localhost:8787/api/functions/requestFollow \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"targetUserId":"target_user_id"}'
```

```bash
curl -X POST http://localhost:8787/api/functions/cancelFollowRequest \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"targetUserId":"target_user_id"}'
```

```bash
curl -X POST http://localhost:8787/api/entities/follow \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"following_id":"target_user_id"}'
```

## Summary of Findings

| Area | Status | Likely Fix Needed |
| --- | --- | --- |
| `POST /api/files/upload` | Missing | Add authenticated R2 upload handler |
| `PATCH /api/me` | Missing | Add update handler for `profile_picture` and `profile_hidden` |
| Follow GET returns `follower_username` | Present | Backend select includes it |
| Public profile follower queries | Restricted | Use public profile endpoint or add safe public count/list endpoint |
| `requestFollow` function | Missing | Add function route used by UI |
| `cancelFollowRequest` function | Missing | Add function route used by UI |
| `POST /api/entities/follow` | Missing | Add or keep function route as primary compatibility path |
| `PATCH/DELETE /api/entities/follow/:id` | Missing | Needed for accepting/rejecting follow requests |

## Blockers / Open Questions

1. What public URL should be returned for R2 uploads? The Worker has `VOXYL_MEDIA`, but no obvious media public base URL env var was found in `index.ts`.
2. Should follow requests always be `pending`, or should public profiles auto-accept? Current UI labels imply pending request flow.
3. Should public profiles show follower names/lists, or only follower counts? A public list needs privacy design.
