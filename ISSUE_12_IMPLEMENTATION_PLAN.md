# Issue #12 Implementation Plan: User Search and Public Profile Routes

## ⚠️ PRE-IMPLEMENTATION REVIEW REQUIRED
**Before any code is committed, the implementation must be reviewed and approved.**

---

## Executive Summary

Implement three missing Worker route handlers:
1. `POST /api/functions/searchUsers` - Query users by username with privacy rules
2. `POST /api/functions/getPublicUserProfile` - Get public profile data for a user
3. `POST /api/functions/getUserPlaylists` - Get public playlists for a user

These routes are called by the frontend but currently return 404 errors, breaking:
- Explore → Users tab (user search)
- Public user profile pages (`/user/:userId`)
- Follow request modals

---

## Technical Specifications

### 1. searchUsers Route

**Endpoint**: `POST /api/functions/searchUsers`

**Request Payload**:
```json
{
  "query": "john",  // username search term (can be empty string)
}
```

**Response Format**:
```json
{
  "data": {
    "users": [
      {
        "id": "user_abc123",
        "username": "john_doe",
        "profile_hidden": false
      }
    ]
  }
}
```

**Behavior**:
- Search User table by `username` (case-insensitive prefix match or exact match)
- If `query` is empty, return top 10 most recently created users
- **Privacy Rule**: Skip users where `profile_hidden = true` UNLESS `query` is an exact username match
- Return empty array if no matches
- Handle guest (unauthenticated) requests same as authenticated

**D1 Query Pattern**:
```sql
SELECT id, username, profile_hidden 
FROM User 
WHERE LOWER(username) LIKE LOWER(?1 || '%') 
AND (profile_hidden = false OR LOWER(username) = LOWER(?2))
LIMIT 25
```

---

### 2. getPublicUserProfile Route

**Endpoint**: `POST /api/functions/getPublicUserProfile`

**Request Payload**:
```json
{
  "userId": "user_abc123"
}
```

**Response Format**:
```json
{
  "data": {
    "id": "user_abc123",
    "username": "john_doe",
    "full_name": "John Doe",
    "profile_picture": "https://r2.example.com/profiles/abc123.jpg",
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

**Behavior**:
- Fetch user record from User table by `userId`
- Return 404 if user not found
- Return 404 if `profile_hidden = true` (unless authenticated as that user or admin)
  - For now, always return 404 for hidden profiles (guest/auth doesn't matter for MVP)
- Include `profile_picture` if available (from database or Clerk)
- Do NOT include sensitive fields: `email`, `role`, etc.

**Database Fields**:
- `id` (Clerk user ID)
- `username`
- `full_name` (or similar display name)
- May need to join Clerk data for `profile_picture`

---

### 3. getUserPlaylists Route

**Endpoint**: `POST /api/functions/getUserPlaylists`

**Request Payload**:
```json
{
  "userId": "user_abc123"
}
```

**Response Format**:
```json
{
  "data": {
    "playlists": [
      {
        "id": "playlist_123",
        "name": "My Tech Podcasts",
        "description": "Best tech podcasts",
        "cover_image": "https://...",
        "creator_id": "user_abc123",
        "creator_username": "john_doe",
        "creator_picture": "https://...",
        "visibility": "public",
        "episodes_count": 42
      }
    ]
  }
}
```

**Behavior**:
- Fetch playlists from Playlist table where `creator_id = userId`
- **Privacy Rule**: Only return playlists where `visibility = "public"`
  - Skip `private` playlists (even if user is the creator, for guests)
  - Skip `friends_only` playlists (unless authenticated user is a follower with status="accepted")
- Return empty array if no public playlists
- Sort by creation date, newest first
- Include count of episodes (may need separate query or aggregation)

**D1 Query Pattern**:
```sql
SELECT 
  id, name, description, cover_image, 
  creator_id, creator_username, creator_picture, 
  visibility
FROM Playlist 
WHERE creator_id = ?1 AND visibility = 'public'
ORDER BY created_at DESC
LIMIT 50
```

---

## Implementation Strategy

### File Structure
- Modify: `workers/api/src/index.ts`
- Add route detection functions:
  - `isSearchUsersRoute(pathname)`
  - `isGetPublicUserProfileRoute(pathname)`
  - `isGetUserPlaylistsRoute(pathname)`
- Add handler functions:
  - `handleSearchUsers(request, db, env)`
  - `handleGetPublicUserProfile(request, db, env)`
  - `handleGetUserPlaylists(request, db, env)`

### Code Organization
1. Add three `isXxxRoute()` functions in the routing section (~line 340-460)
2. Add three route checks in the main handler dispatch logic
3. Add three handler functions in a new "User Discovery Functions" section
4. Reuse existing error handling and response format patterns

### Error Handling
- Invalid `userId` parameter → 400 Bad Request
- Missing required parameter → 400 Bad Request
- User not found → 200 with empty data (not 404, per Base44 legacy pattern)
- Database errors → 500 with generic error message
- Privacy violations (hidden profile) → 404 Not Found

### Response Envelope Pattern
All responses must use the existing envelope:
```json
{
  "data": { /* actual response */ }
}
```
Use `withDataEnvelope()` helper if available, or wrap manually.

---

## Acceptance Criteria (Pre-Commit Review)

### Before Merging:
- [ ] All three routes are implemented and respond to test requests
- [ ] Route detection functions are added and tested
- [ ] Privacy rules are enforced:
  - [ ] Hidden profiles do not appear in search results
  - [ ] Hidden profiles return 404 when requested directly
  - [ ] Private playlists are not exposed
  - [ ] Friends-only playlists respect follower status
- [ ] Response format matches the specification above
- [ ] Error handling returns appropriate status codes
- [ ] No Base44 runtime dependencies introduced
- [ ] No unguarded database queries (use parameterized queries)
- [ ] Code follows existing Worker patterns in index.ts
- [ ] TypeScript compiles without errors
- [ ] Manual browser tests pass:
  - [ ] Search for users in Explore → Users tab
  - [ ] View public profile at `/user/:userId`
  - [ ] View playlists on public profile
  - [ ] Search for hidden profile (should not appear)
  - [ ] Try to access hidden profile directly (should 404)

### Testing Checklist:
```bash
# API-level tests (use curl or Postman)
curl -X POST https://voxyl.example.com/api/functions/searchUsers \
  -H "Content-Type: application/json" \
  -d '{"query": "john"}'

curl -X POST https://voxyl.example.com/api/functions/getPublicUserProfile \
  -H "Content-Type: application/json" \
  -d '{"userId": "user_abc123"}'

curl -X POST https://voxyl.example.com/api/functions/getUserPlaylists \
  -H "Content-Type: application/json" \
  -d '{"userId": "user_abc123"}'
```

---

## Known Constraints

1. **No Base44 Runtime**: Do not import or use Base44 packages
2. **D1 as Source of Truth**: All data comes from D1, no external APIs for user data
3. **Clerk Integration**: User IDs are Clerk IDs; no legacy Base44 IDs
4. **Privacy First**: Hidden profiles and private playlists must never leak
5. **Existing Patterns**: Follow error handling and response formats already in index.ts

---

## Related Issues

- **Issue #48** (Blocked users): Depends on `searchUsers` to work
- **Issue #56** (Username validation): Related User table queries, different scope
- **Issue #35** (Profile photo): May benefit from profile picture handling

---

## REVIEW PROTOCOL

⚠️ **This implementation MUST be reviewed before merging:**

1. Code review in VS Code (static analysis)
2. Manual API testing with curl/Postman
3. Browser testing in development environment
4. Approval comment in this issue before merge

**DO NOT** commit directly without explicit approval.

---

**Branch**: `issue-12-user-search-public-profile`  
**Status**: 🔄 AWAITING IMPLEMENTATION AND REVIEW
