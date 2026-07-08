import { verifyToken } from "@clerk/backend";

const healthResponse = {
  ok: true,
  service: "voxyl-api",
  version: "migration-shell",
};

const notFoundResponse = {
  ok: false,
  error: "Not found",
};

const unauthorizedResponse = {
  ok: false,
  error: "Unauthorized",
};

const unauthenticatedResponse = {
  ok: false,
  authenticated: false,
  error: "Unauthorized",
};

interface Env {
  DB: D1Database;
  VOXYL_CACHE: KVNamespace;
  VOXYL_MEDIA: R2Bucket;
  DIAGNOSTICS_TOKEN: string;
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY: string;
  CLERK_AUTHORIZED_PARTIES: string;
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function getDiagnosticsToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");

  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return request.headers.get("x-diagnostics-token");
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}

function isDiagnosticsAuthorized(request: Request, env: Env): boolean {
  const providedToken = getDiagnosticsToken(request);

  if (!providedToken || !env.DIAGNOSTICS_TOKEN) {
    return false;
  }

  return constantTimeEqual(providedToken, env.DIAGNOSTICS_TOKEN);
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}

function getAuthorizedParties(env: Env): string[] {
  return env.CLERK_AUTHORIZED_PARTIES.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("origin");

  if (!origin || !getAuthorizedParties(env).includes(origin)) {
    return {};
  }

  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type",
    "vary": "Origin",
  };
}

function isAuthDiagnosticsRoute(pathname: string): boolean {
  return pathname === "/auth/diagnostics" || pathname === "/api/auth/diagnostics";
}

function isMeRoute(pathname: string): boolean {
  return pathname === "/me" || pathname === "/api/me";
}

function isPlaylistsRoute(pathname: string): boolean {
  return pathname === "/playlists" || pathname === "/api/playlists";
}

function getPlaylistId(pathname: string): string | null {
  const prefixes = ["/playlists/", "/api/playlists/"];

  for (const prefix of prefixes) {
    if (!pathname.startsWith(prefix)) {
      continue;
    }

    const encodedId = pathname.slice(prefix.length);

    if (!encodedId || encodedId.includes("/")) {
      return null;
    }

    try {
      return decodeURIComponent(encodedId);
    } catch {
      return null;
    }
  }

  return null;
}

function isPlaylistRoute(pathname: string): boolean {
  return isPlaylistsRoute(pathname) || getPlaylistId(pathname) !== null;
}

async function checkDb(env: Env): Promise<true | string> {
  try {
    const result = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return result?.ok === 1 ? true : "D1 check failed";
  } catch {
    return "D1 check failed";
  }
}

async function checkKv(env: Env): Promise<true | string> {
  const key = `diagnostics/${crypto.randomUUID()}`;
  const value = "ok";

  try {
    await env.VOXYL_CACHE.put(key, value, { expirationTtl: 60 });
    const cachedValue = await env.VOXYL_CACHE.get(key);
    await env.VOXYL_CACHE.delete(key);

    return cachedValue === value ? true : "KV check failed";
  } catch {
    return "KV check failed";
  }
}

async function checkR2(env: Env): Promise<true | string> {
  const key = `diagnostics/${crypto.randomUUID()}.txt`;

  try {
    await env.VOXYL_MEDIA.put(key, "ok");
    const object = await env.VOXYL_MEDIA.head(key);
    await env.VOXYL_MEDIA.delete(key);

    return object ? true : "R2 check failed";
  } catch {
    return "R2 check failed";
  }
}

async function diagnosticsResponse(env: Env): Promise<Response> {
  const checks = {
    db: await checkDb(env),
    kv: await checkKv(env),
    r2: await checkR2(env),
  };
  const ok = checks.db === true && checks.kv === true && checks.r2 === true;

  return jsonResponse({
    ok,
    service: healthResponse.service,
    version: healthResponse.version,
    checks,
  });
}

async function checkClerk(env: Env): Promise<true | string> {
  try {
    const response = await fetch("https://api.clerk.com/v1/users?limit=1", {
      headers: {
        authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
        accept: "application/json",
      },
    });

    return response.ok ? true : "Clerk check failed";
  } catch {
    return "Clerk check failed";
  }
}

async function clerkDiagnosticsResponse(env: Env): Promise<Response> {
  const clerk = await checkClerk(env);
  const ok = clerk === true;

  return jsonResponse(
    {
      ok,
      service: healthResponse.service,
      version: healthResponse.version,
      checks: {
        clerk,
      },
    },
    ok ? 200 : 502,
  );
}

function getStringClaim(claims: Record<string, unknown>, names: string[]): string | null {
  for (const name of names) {
    const value = claims[name];

    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return null;
}

async function authDiagnosticsResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const claims = await getVerifiedClerkClaims(request, env);

  if (!claims) {
    return jsonResponse(unauthenticatedResponse, 401, corsHeaders);
  }

  return jsonResponse(
    {
      ok: true,
      authenticated: true,
      userId: claims.userId,
      sessionId: claims.sessionId,
      email: claims.email,
    },
    200,
    corsHeaders,
  );
}

function authDiagnosticsOptionsResponse(request: Request, env: Env): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request, env),
  });
}

type ClerkClaims = {
  userId: string;
  sessionId: string | null;
  email: string | null;
  name: string | null;
};

async function getVerifiedClerkClaims(request: Request, env: Env): Promise<ClerkClaims | null> {
  const token = getBearerToken(request);

  if (!token) {
    return null;
  }

  try {
    const verifiedToken = await verifyToken(token, {
      jwtKey: env.CLERK_JWT_KEY,
      secretKey: env.CLERK_SECRET_KEY,
      authorizedParties: getAuthorizedParties(env),
    });
    const claims = verifiedToken as Record<string, unknown>;
    const userId = getStringClaim(claims, ["sub"]);

    if (!userId) {
      return null;
    }

    return {
      userId,
      sessionId: getStringClaim(claims, ["sid", "session_id"]),
      email: getStringClaim(claims, ["email", "primary_email", "primary_email_address"]),
      name: getStringClaim(claims, ["name", "full_name"]),
    };
  } catch {
    return null;
  }
}

type D1User = {
  id: string;
  clerk_user_id: string | null;
  legacy_base44_user_id: string | null;
  email: string | null;
  name: string | null;
  username: string | null;
  role: string;
  profile_picture: string | null;
  profile_hidden: number;
  created_at: string;
  updated_at: string;
};

async function getUserByClerkUserId(env: Env, clerkUserId: string): Promise<D1User | null> {
  return env.DB.prepare(
    `SELECT id, clerk_user_id, legacy_base44_user_id, email, name, username, role,
      profile_picture, profile_hidden, created_at, updated_at
     FROM users
     WHERE clerk_user_id = ?`,
  )
    .bind(clerkUserId)
    .first<D1User>();
}

async function createUserFromClerkClaims(env: Env, claims: ClerkClaims): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (id, clerk_user_id, email, name)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(clerk_user_id) DO NOTHING`,
  )
    .bind(claims.userId, claims.userId, claims.email, claims.name)
    .run();
}

async function meResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const claims = await getVerifiedClerkClaims(request, env);

  if (!claims) {
    return jsonResponse(unauthenticatedResponse, 401, corsHeaders);
  }

  let user = await getUserByClerkUserId(env, claims.userId);

  if (!user) {
    await createUserFromClerkClaims(env, claims);
    user = await getUserByClerkUserId(env, claims.userId);
  }

  if (!user) {
    return jsonResponse({ ok: false, error: "User bootstrap failed" }, 500, corsHeaders);
  }

  return jsonResponse({ ok: true, user }, 200, corsHeaders);
}

type D1Playlist = {
  id: string;
  legacy_base44_playlist_id: string | null;
  creator_id: string;
  creator_clerk_user_id: string | null;
  creator_legacy_base44_user_id: string | null;
  title: string;
  description: string | null;
  cover_image: string | null;
  visibility: string;
  rss_feeds: string | null;
  likes_count: number;
  plays_count: number;
  creator_username: string | null;
  creator_picture: string | null;
  creator_hidden: number;
  created_at: string;
  updated_at: string;
};

type PublicPlaylist = Omit<D1Playlist, "rss_feeds"> & {
  name: string;
  rss_feeds: unknown[];
};

const playlistSelect = `SELECT id, legacy_base44_playlist_id, creator_id, creator_clerk_user_id,
  creator_legacy_base44_user_id, title, description, cover_image, visibility, rss_feeds,
  likes_count, plays_count, creator_username, creator_picture, creator_hidden, created_at,
  updated_at
 FROM playlists`;

function parseRssFeeds(value: string | null): unknown[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toPublicPlaylist(playlist: D1Playlist): PublicPlaylist {
  return {
    id: playlist.id,
    legacy_base44_playlist_id: playlist.legacy_base44_playlist_id,
    creator_id: playlist.creator_id,
    creator_clerk_user_id: playlist.creator_clerk_user_id,
    creator_legacy_base44_user_id: playlist.creator_legacy_base44_user_id,
    title: playlist.title,
    name: playlist.title,
    description: playlist.description,
    cover_image: playlist.cover_image,
    visibility: playlist.visibility,
    rss_feeds: parseRssFeeds(playlist.rss_feeds),
    likes_count: playlist.likes_count ?? 0,
    plays_count: playlist.plays_count ?? 0,
    creator_username: playlist.creator_username,
    creator_picture: playlist.creator_picture,
    creator_hidden: playlist.creator_hidden ?? 0,
    created_at: playlist.created_at,
    updated_at: playlist.updated_at,
  };
}

async function playlistsResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const { results } = await env.DB.prepare(
    `${playlistSelect}
     WHERE visibility = 'public'
     ORDER BY created_at DESC
     LIMIT 50`,
  ).all<D1Playlist>();

  return jsonResponse(
    {
      ok: true,
      playlists: results.map(toPublicPlaylist),
    },
    200,
    corsHeaders,
  );
}

async function playlistResponse(request: Request, env: Env, playlistId: string): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const playlist = await env.DB.prepare(
    `${playlistSelect}
     WHERE id = ? AND visibility = 'public'
     LIMIT 1`,
  )
    .bind(playlistId)
    .first<D1Playlist>();

  if (!playlist) {
    return jsonResponse(notFoundResponse, 404, corsHeaders);
  }

  return jsonResponse(
    {
      ok: true,
      playlist: toPublicPlaylist(playlist),
    },
    200,
    corsHeaders,
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === "OPTIONS" && (isAuthDiagnosticsRoute(pathname) || isMeRoute(pathname) || isPlaylistRoute(pathname))) {
      return authDiagnosticsOptionsResponse(request, env);
    }

    if (request.method === "GET" && (pathname === "/health" || pathname === "/api/health")) {
      return jsonResponse(healthResponse);
    }

    if (request.method === "GET" && (pathname === "/diagnostics" || pathname === "/api/diagnostics")) {
      if (!isDiagnosticsAuthorized(request, env)) {
        return jsonResponse(unauthorizedResponse, 401);
      }

      return diagnosticsResponse(env);
    }

    if (request.method === "GET" && (pathname === "/clerk/diagnostics" || pathname === "/api/clerk/diagnostics")) {
      if (!isDiagnosticsAuthorized(request, env)) {
        return jsonResponse(unauthorizedResponse, 401);
      }

      return clerkDiagnosticsResponse(env);
    }

    if (request.method === "GET" && isAuthDiagnosticsRoute(pathname)) {
      return authDiagnosticsResponse(request, env);
    }

    if (request.method === "GET" && isMeRoute(pathname)) {
      return meResponse(request, env);
    }

    if (request.method === "GET" && isPlaylistsRoute(pathname)) {
      return playlistsResponse(request, env);
    }

    const playlistId = getPlaylistId(pathname);

    if (request.method === "GET" && playlistId) {
      return playlistResponse(request, env, playlistId);
    }

    return jsonResponse(notFoundResponse, 404);
  },
};
