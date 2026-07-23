import { verifyToken } from "@clerk/backend";
import sax from "sax";

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
  CLERK_ISSUER?: string;
  PODCAST_INDEX_API_KEY?: string;
  PODCAST_INDEX_API_SECRET?: string;
}

const PODCAST_INDEX_BASE_URL = "https://api.podcastindex.org/api/1.0";
const PODCAST_INDEX_USER_AGENT = "Voxyl/3.0 (+https://v.renbrant.com)";
const PODCAST_SEARCH_TIMEOUT_MS = 8000;
const PODCAST_SEARCH_MAX_QUERY_LENGTH = 120;
const PODCAST_SEARCH_MAX_RESULTS = 50;
const PODCAST_SEARCH_PROVIDER_MAX_RESULTS = 100;
const RSS_FETCH_TIMEOUT_MS = 9000;
const RSS_FETCH_MAX_BYTES = 4 * 1024 * 1024;
const RSS_FETCH_MAX_REDIRECTS = 5;
const RSS_FETCH_FRESH_TTL_MS = 15 * 60 * 1000;
const RSS_FETCH_KV_TTL_SECONDS = 24 * 60 * 60;
const RSS_FETCH_MAX_DESCRIPTION_LENGTH = 2000;
const RSS_FETCH_USER_AGENT = "Voxyl/3.0 RSS Fetcher (+https://v.renbrant.com)";
const RSS_FETCH_ACCEPT = "application/rss+xml, application/atom+xml, application/rdf+xml, application/xml, text/xml, */*;q=0.1";

const podcastLanguageAliases: Record<string, string[]> = {
  pt: ["pt", "portuguese", "portugues", "português"],
  en: ["en", "english"],
  es: ["es", "spanish", "espanol", "español"],
  fr: ["fr", "french", "français", "francais"],
  de: ["de", "german", "deutsch"],
  it: ["it", "italian", "italiano"],
  ja: ["ja", "japanese", "日本語"],
};

const podcastCategoryMap: Record<string, string> = {
  technology: "102",
  business: "9",
  education: "11",
  entertainment: "12",
  sports: "77",
  health: "14",
  news: "55",
  science: "67",
  "true crime": "103",
  comedy: "10",
  politics: "59",
  tecnologia: "102",
  "negócios": "9",
  "educação": "11",
  entretenimento: "12",
  esportes: "77",
  "saúde": "14",
  "notícias": "55",
  "ciência": "67",
  "comédia": "10",
  "política": "59",
};

const allowedPodcastSorts = new Set(["", "relevance", "popularity", "episodes", "recent", "frequency"]);

type PodcastSearchRequest = {
  query: string;
  maxDuration: number;
  language: string;
  sortBy: string;
  category: string;
};

type PodcastSearchErrorCode =
  | "invalid-request"
  | "provider-configuration"
  | "provider-authentication"
  | "provider-rate-limit"
  | "provider-timeout"
  | "provider-unavailable"
  | "provider-response"
  | "internal-error";

type PodcastSearchResult = {
  id: string;
  title: string;
  author: string;
  description: string;
  image: string;
  feedUrl: string;
  website: string;
  language: string;
  categories: Record<string, string>;
  episodeCount: number;
  latestPublishTime: number | null;
  oldestPublishTime: number | null;
  lastUpdateTime: number | null;
};

class PodcastSearchError extends Error {
  readonly status: number;
  readonly code: PodcastSearchErrorCode;

  constructor(status: number, code: PodcastSearchErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type RssFetchErrorCode =
  | "invalid-request"
  | "missing-feed-url"
  | "invalid-feed-url"
  | "unsafe-feed-url"
  | "feed-too-large"
  | "invalid-feed-xml"
  | "upstream-timeout"
  | "upstream-unavailable";

class RssFetchError extends Error {
  readonly status: number;
  readonly code: RssFetchErrorCode;

  constructor(status: number, code: RssFetchErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type PodcastPlayErrorCode =
  | "invalid-request"
  | "unauthorized"
  | "forbidden"
  | "invalid-playlist"
  | "identity-conflict"
  | "internal-error";

class PodcastPlayError extends Error {
  readonly status: number;
  readonly code: PodcastPlayErrorCode;

  constructor(status: number, code: PodcastPlayErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type RssFetchRequest = {
  url: string;
  count: number;
};

type NormalizedFeed = {
  title: string;
  description: string;
  image: string;
  author: string;
  feedUrl: string;
  link: string;
  items: NormalizedEpisode[];
};

type NormalizedEpisode = {
  id: string;
  guid: string;
  title: string;
  description: string;
  audioUrl: string;
  link: string;
  pubDate: string;
  duration: string;
  image: string;
  author: string;
  feedTitle: string;
  feedUrl: string;
};

type RssCacheEntry = {
  cachedAt: number;
  data: NormalizedFeed;
};

type RssCacheStatus = "HIT" | "MISS" | "STALE";

type XmlRecord = Record<string, unknown>;

type CapturedXmlNode = {
  name: string;
  attributes: Record<string, string>;
  children: XmlRecord;
  text: string[];
};

type FeedKind = "rss" | "rdf" | "atom" | null;

class RssFeedComplete extends Error {
  constructor() {
    super("RSS feed parsing completed early");
  }
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
  return (env.CLERK_AUTHORIZED_PARTIES || "").split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin: string | null, env: Env): origin is string {
  if (!origin) {
    return false;
  }

  if (getAuthorizedParties(env).includes(origin)) {
    return true;
  }

  try {
    const { hostname, protocol } = new URL(origin);
    return protocol === "https:" && hostname.endsWith(".voxyl-app.pages.dev");
  } catch {
    return false;
  }
}

function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("origin");

  if (!isAllowedOrigin(origin, env)) {
    return {};
  }

  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
    "access-control-allow-headers": "Authorization, Content-Type",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  const corsHeaders = getCorsHeaders(request, env);

  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function optionsResponse(request: Request, env: Env): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request, env),
  });
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

function isEntityPlaylistRoute(pathname: string): boolean {
  return pathname === "/entities/playlist" || pathname === "/api/entities/playlist";
}

function isEntityFollowRoute(pathname: string): boolean {
  return pathname === "/entities/follow" || pathname === "/api/entities/follow";
}

function isBlocksRoute(pathname: string): boolean {
  return pathname === "/api/blocks";
}

function isHiddenBlockUsersRoute(pathname: string): boolean {
  return pathname === "/api/blocks/hidden-users";
}

function getBlockStatusTargetId(pathname: string): string | null {
  const prefix = "/api/blocks/status/";

  if (!pathname.startsWith(prefix)) {
    return null;
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

function getBlockId(pathname: string): string | null {
  const prefix = "/api/blocks/";

  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const encodedId = pathname.slice(prefix.length);

  if (!encodedId || encodedId.includes("/") || encodedId === "hidden-users" || encodedId === "status") {
    return null;
  }

  try {
    return decodeURIComponent(encodedId);
  } catch {
    return null;
  }
}

function isTopPodcastsRoute(pathname: string): boolean {
  return pathname === "/functions/getTopPodcastsByPlayback" || pathname === "/api/functions/getTopPodcastsByPlayback";
}

function isTopPlaylistsDiscoveryRoute(pathname: string): boolean {
  return pathname === "/api/discovery/top-playlists" || pathname === "/discovery/top-playlists";
}

function isTopPlaylistsLegacyRoute(pathname: string): boolean {
  return pathname === "/api/functions/getTopPlaylistsByPlayback" ||
    pathname === "/functions/getTopPlaylistsByPlayback";
}

function isSearchUsersRoute(pathname: string): boolean {
  return pathname === "/api/functions/searchUsers" || pathname === "/functions/searchUsers";
}

function isGetPublicUserProfileRoute(pathname: string): boolean {
  return pathname === "/api/functions/getPublicUserProfile" || pathname === "/functions/getPublicUserProfile";
}

function isGetUserPlaylistsRoute(pathname: string): boolean {
  return pathname === "/api/functions/getUserPlaylists" || pathname === "/functions/getUserPlaylists";
}

function isFileUploadRoute(pathname: string): boolean {
  return pathname === "/api/files/upload" || pathname === "/files/upload";
}

function isPodcastSearchRoute(pathname: string): boolean {
  return pathname === "/api/functions/searchPodcasts" || pathname === "/api/podcasts/search";
}

function isRssFetchRoute(pathname: string): boolean {
  return pathname === "/api/functions/fetchRSSFeed" || pathname === "/functions/fetchRSSFeed" || pathname === "/api/rss/fetch";
}

function isPodcastPlayRoute(pathname: string): boolean {
  return pathname === "/api/plays" ||
    pathname === "/plays" ||
    pathname === "/api/functions/recordPodcastPlay" ||
    pathname === "/functions/recordPodcastPlay";
}

function isPodcastPlayHistoryRoute(pathname: string): boolean {
  return pathname === "/api/plays" ||
    pathname === "/plays" ||
    pathname === "/api/entities/podcast-play" ||
    pathname === "/entities/podcast-play";
}

function isPlaylistLikeRoute(pathname: string): boolean {
  return pathname === "/api/entities/playlist-like" || pathname === "/entities/playlist-like";
}

function isTogglePlaylistLikeRoute(pathname: string): boolean {
  return pathname === "/api/functions/togglePlaylistLike" || pathname === "/functions/togglePlaylistLike";
}

function isRequestFollowRoute(pathname: string): boolean {
  return pathname === "/api/functions/requestFollow" || pathname === "/functions/requestFollow";
}

function isCancelFollowRequestRoute(pathname: string): boolean {
  return pathname === "/api/functions/cancelFollowRequest" || pathname === "/functions/cancelFollowRequest";
}

function isPodcastLikeRoute(pathname: string): boolean {
  return pathname === "/api/entities/podcast-like" || pathname === "/entities/podcast-like";
}

function isEpisodeProgressRoute(pathname: string): boolean {
  return pathname === "/api/entities/episode-progress" || pathname === "/entities/episode-progress";
}

function getPodcastLikeId(pathname: string): string | null {
  const prefixes = ["/api/entities/podcast-like/", "/entities/podcast-like/"];

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

function getEpisodeProgressId(pathname: string): string | null {
  const prefixes = ["/api/entities/episode-progress/", "/entities/episode-progress/"];

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

function getPlaylistId(pathname: string): string | null {
  const prefixes = ["/playlists/", "/api/playlists/", "/entities/playlist/", "/api/entities/playlist/"];

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

function healthCheckResponse(request: Request): Response {
  if (request.method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
  }

  return jsonResponse(healthResponse);
}

async function sha1Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function rssFetchErrorResponse(error: RssFetchError, request: Request, env: Env): Response {
  return jsonResponse(
    {
      ok: false,
      code: error.code,
      error: error.message,
    },
    error.status,
    getCorsHeaders(request, env),
  );
}

function podcastPlayErrorResponse(error: PodcastPlayError, request: Request, env: Env): Response {
  return jsonResponse(
    {
      ok: false,
      code: error.code,
      error: error.message,
    },
    error.status,
    getCorsHeaders(request, env),
  );
}

function parseOptionalCount(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return 30;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new RssFetchError(400, "invalid-request", "count must be a number between 1 and 100");
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}

async function parseRssFetchRequest(request: Request): Promise<RssFetchRequest> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new RssFetchError(400, "invalid-request", "Request body must be valid JSON");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RssFetchError(400, "invalid-request", "Request body must be a JSON object");
  }

  const payload = body as Record<string, unknown>;

  if (typeof payload.url !== "string" || !payload.url.trim()) {
    throw new RssFetchError(400, "missing-feed-url", "url is required");
  }

  return {
    url: validatePublicFeedUrl(payload.url),
    count: parseOptionalCount(payload.count),
  };
}

function isPrivateIpv4(parts: number[]): boolean {
  const [first, second] = parts;

  return first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && parts[2] === 0) ||
    (first === 192 && second === 0 && parts[2] === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && parts[2] === 100) ||
    (first === 203 && second === 0 && parts[2] === 113) ||
    parts.join(".") === "169.254.169.254" ||
    parts.join(".") === "255.255.255.255";
}

function parseIpv4Literal(hostname: string): number[] | null {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);

  if (!match) {
    return null;
  }

  const parts = match.slice(1).map(Number);
  return parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

function parseIpv6Literal(hostname: string): bigint | null {
  let address = hostname.toLowerCase();

  if (address.startsWith("[") && address.endsWith("]")) {
    address = address.slice(1, -1);
  }

  const zoneIndex = address.indexOf("%");

  if (zoneIndex >= 0) {
    address = address.slice(0, zoneIndex);
  }

  if (!address.includes(":")) {
    return null;
  }

  const ipv4Match = address.match(/(.+:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  let tail: number[] = [];

  if (ipv4Match) {
    const ipv4 = parseIpv4Literal(ipv4Match[2]);

    if (!ipv4) {
      return null;
    }

    address = `${ipv4Match[1]}${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
    tail = ipv4;
  }

  const pieces = address.split("::");

  if (pieces.length > 2) {
    return null;
  }

  const left = pieces[0] ? pieces[0].split(":").filter(Boolean) : [];
  const right = pieces[1] ? pieces[1].split(":").filter(Boolean) : [];
  const missing = 8 - left.length - right.length;

  if (missing < 0 || (pieces.length === 1 && missing !== 0)) {
    return null;
  }

  const groups = [...left, ...Array(missing).fill("0"), ...right];

  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return null;
  }

  const value = groups.reduce((acc, group) => (acc << 16n) + BigInt(parseInt(group, 16)), 0n);
  const ipv4MappedPrefix = 0xffffn << 32n;

  if (tail.length && (value >> 32n) === ipv4MappedPrefix) {
    return value;
  }

  return value;
}

function ipv6PrefixFromString(prefix: string): bigint {
  const parsed = parseIpv6Literal(prefix);

  if (parsed === null) {
    throw new Error(`Invalid IPv6 prefix: ${prefix}`);
  }

  return parsed;
}

function ipv6MatchesPrefix(value: bigint, prefix: bigint, prefixLength: number): boolean {
  if (prefixLength === 0) {
    return true;
  }

  const shift = BigInt(128 - prefixLength);
  return (value >> shift) === (prefix >> shift);
}

const blockedIpv6Prefixes: Array<[bigint, number]> = [
  [ipv6PrefixFromString("::"), 128],
  [ipv6PrefixFromString("::1"), 128],
  [ipv6PrefixFromString("fc00::"), 7],
  [ipv6PrefixFromString("fe80::"), 10],
  [ipv6PrefixFromString("ff00::"), 8],
  [ipv6PrefixFromString("64:ff9b::"), 96],
  [ipv6PrefixFromString("::ffff:0.0.0.0"), 96],
];

function isUnsafeIpv6(value: bigint): boolean {
  return blockedIpv6Prefixes.some(([prefix, length]) => ipv6MatchesPrefix(value, prefix, length));
}

function validatePublicFeedUrl(rawUrl: string): string {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new RssFetchError(400, "invalid-feed-url", "Feed URL must be a valid HTTP or HTTPS URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new RssFetchError(400, "invalid-feed-url", "Feed URL must use HTTP or HTTPS");
  }

  if (parsed.username || parsed.password) {
    throw new RssFetchError(403, "unsafe-feed-url", "Feed URL must not include credentials");
  }

  if (parsed.port && !((parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443"))) {
    throw new RssFetchError(403, "unsafe-feed-url", "Feed URL uses an unsupported port");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");

  if (!hostname ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".home") ||
      hostname.endsWith(".lan")) {
    throw new RssFetchError(403, "unsafe-feed-url", "Feed URL host is not allowed");
  }

  const ipv4 = parseIpv4Literal(hostname);

  if (ipv4 && isPrivateIpv4(ipv4)) {
    throw new RssFetchError(403, "unsafe-feed-url", "Feed URL host is not public");
  }

  const ipv6Hostname = hostname.replace(/^\[/, "").replace(/\]$/, "");
  const ipv6 = parseIpv6Literal(hostname);

  if (ipv6 !== null && isUnsafeIpv6(ipv6)) {
    throw new RssFetchError(403, "unsafe-feed-url", "Feed URL host is not public");
  }

  if (ipv6Hostname.includes(":") && ipv6 === null) {
    throw new RssFetchError(403, "unsafe-feed-url", "Feed URL host is not allowed");
  }

  // Cloudflare Workers fetch does not expose DNS result pinning to user code. Hostname
  // allowlisting here is lexical; post-deployment tests must verify platform behavior
  // for hostnames that resolve to non-public addresses.
  parsed.hash = "";
  return parsed.toString();
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (isRecord(value)) {
    const text = value["#text"] ?? value["#cdata"];
    return textValue(text);
  }

  return "";
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = textValue(Array.isArray(value) ? value[0] : value).trim();

    if (text) {
      return text;
    }
  }

  return "";
}

function attr(value: unknown, name: string): string {
  return isRecord(value) ? firstText(value[`@_${name}`]) : "";
}

function xmlName(name: string): string {
  return name.trim().toLowerCase();
}

function xmlAttr(attributes: Record<string, string>, name: string): string {
  return attributes[name] || attributes[name.toLowerCase()] || "";
}

function normalizeSaxAttributes(attributes: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [name, value] of Object.entries(attributes)) {
    normalized[`@_${xmlName(name)}`] = String(value ?? "");
  }

  return normalized;
}

function appendXmlValue(target: XmlRecord, name: string, value: unknown): void {
  const existing = target[name];

  if (existing === undefined) {
    target[name] = value;
    return;
  }

  if (Array.isArray(existing)) {
    existing.push(value);
    return;
  }

  target[name] = [existing, value];
}

function capturedNodeToRecord(node: CapturedXmlNode): XmlRecord | string {
  const record: XmlRecord = { ...node.children };
  const text = node.text.join("").trim();
  const attributes = normalizeSaxAttributes(node.attributes);

  if (text) {
    record["#text"] = text;
  }

  if (Object.keys(attributes).length > 0) {
    Object.assign(record, attributes);
  }

  if (Object.keys(record).length === 1 && record["#text"] !== undefined) {
    return text;
  }

  return record;
}

function startCapturedNode(name: string, attributes: Record<string, unknown>): CapturedXmlNode {
  return {
    name,
    attributes: Object.fromEntries(Object.entries(attributes).map(([key, value]) => [xmlName(key), String(value ?? "")])),
    children: {},
    text: [],
  };
}

function addCapturedText(captureStack: CapturedXmlNode[], value: string): void {
  if (captureStack.length === 0 || !value) {
    return;
  }

  captureStack[captureStack.length - 1].text.push(value);
}

function htmlToText(value: unknown): string {
  const text = firstText(value)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text.length > RSS_FETCH_MAX_DESCRIPTION_LENGTH ? `${text.slice(0, RSS_FETCH_MAX_DESCRIPTION_LENGTH).trim()}...` : text;
}

function absolutePublicUrl(value: unknown, baseUrl: string): string {
  const text = firstText(value);

  if (!text) {
    return "";
  }

  try {
    return validatePublicFeedUrl(new URL(text, baseUrl).toString());
  } catch {
    return "";
  }
}

function firstImage(...values: unknown[]): string {
  for (const value of values) {
    for (const item of asArray(value)) {
      const direct = firstText(item);
      const href = attr(item, "href") || attr(item, "url");
      const url = direct || href;

      if (url) {
        return url;
      }
    }
  }

  return "";
}

const audioExtensionPattern = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:[?#]|$)/i;
const genericBinaryMimeTypes = new Set(["", "application/octet-stream", "binary/octet-stream"]);

function hasAudioExtension(url: string): boolean {
  return audioExtensionPattern.test(url);
}

function isPlayableAudioUrl(url: string, type: string): boolean {
  const normalizedType = type.toLowerCase();

  if (normalizedType.startsWith("audio/")) {
    return true;
  }

  return genericBinaryMimeTypes.has(normalizedType) && hasAudioExtension(url);
}

function mediaContentImageUrl(value: unknown): string {
  for (const item of asArray(value)) {
    const url = attr(item, "url");
    const type = attr(item, "type").toLowerCase();
    const medium = attr(item, "medium").toLowerCase();

    if (url && (type.startsWith("image/") || medium === "image")) {
      return url;
    }
  }

  return "";
}

function episodeImageUrl(source: Record<string, unknown>): string {
  return firstImage(source["itunes:image"], source["media:thumbnail"]) || mediaContentImageUrl(source["media:content"]);
}

function atomAuthorText(value: unknown): string {
  for (const author of asArray(value)) {
    const name = isRecord(author) ? firstText(author.name) : firstText(author);

    if (name) {
      return name;
    }
  }

  return "";
}

function getRssAudioUrl(item: Record<string, unknown>, baseUrl: string): string {
  for (const enclosure of asArray(item.enclosure)) {
    const url = attr(enclosure, "url");
    const type = attr(enclosure, "type");

    if (url && isPlayableAudioUrl(url, type)) {
      return absolutePublicUrl(url, baseUrl);
    }
  }

  for (const media of asArray(item["media:content"])) {
    const url = attr(media, "url");
    const type = attr(media, "type").toLowerCase();
    const medium = attr(media, "medium").toLowerCase();

    if (url && (type.startsWith("audio/") || medium === "audio" || isPlayableAudioUrl(url, type))) {
      return absolutePublicUrl(url, baseUrl);
    }
  }

  return "";
}

function getAtomAudioUrl(entry: Record<string, unknown>, baseUrl: string): string {
  for (const link of asArray(entry.link)) {
    const rel = attr(link, "rel") || "alternate";
    const href = attr(link, "href");
    const type = attr(link, "type").toLowerCase();

    if (href && rel === "enclosure" && isPlayableAudioUrl(href, type)) {
      return absolutePublicUrl(href, baseUrl);
    }
  }

  return "";
}

function getAtomAlternateLink(entry: Record<string, unknown>, baseUrl: string): string {
  for (const link of asArray(entry.link)) {
    const rel = attr(link, "rel") || "alternate";
    const href = attr(link, "href");

    if (href && rel === "alternate") {
      return absolutePublicUrl(href, baseUrl);
    }
  }

  return "";
}

function stableEpisodeId(...parts: string[]): string {
  const source = parts.find((part) => part.trim()) || crypto.randomUUID();
  let hash = 5381;

  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) + hash + source.charCodeAt(index)) >>> 0;
  }

  return `ep_${hash.toString(36)}_${source.length.toString(36)}`;
}

function normalizeRssItem(item: Record<string, unknown>, feed: Omit<NormalizedFeed, "items">, resolutionBaseUrl: string): NormalizedEpisode | null {
  const audioUrl = getRssAudioUrl(item, resolutionBaseUrl);

  if (!audioUrl) {
    return null;
  }

  const guid = firstText(item.guid);
  const link = absolutePublicUrl(item.link, resolutionBaseUrl);
  const image = absolutePublicUrl(episodeImageUrl(item), resolutionBaseUrl) || feed.image;

  return {
    id: stableEpisodeId(guid, audioUrl, link, firstText(item.title)),
    guid,
    title: firstText(item.title) || "Untitled episode",
    description: htmlToText(item["content:encoded"] ?? item.description ?? item.summary),
    audioUrl,
    link,
    pubDate: firstText(item.pubdate, item.pubDate, item["dc:date"]),
    duration: firstText(item["itunes:duration"], item.duration),
    image,
    author: firstText(item["itunes:author"], item.author, item["dc:creator"], feed.author),
    feedTitle: feed.title,
    feedUrl: feed.feedUrl,
  };
}

function normalizeAtomItem(entry: Record<string, unknown>, feed: Omit<NormalizedFeed, "items">, resolutionBaseUrl: string): NormalizedEpisode | null {
  const audioUrl = getAtomAudioUrl(entry, resolutionBaseUrl);

  if (!audioUrl) {
    return null;
  }

  const guid = firstText(entry.id);
  const link = getAtomAlternateLink(entry, resolutionBaseUrl);
  const image = absolutePublicUrl(episodeImageUrl(entry), resolutionBaseUrl) || feed.image;

  return {
    id: stableEpisodeId(guid, audioUrl, link, firstText(entry.title)),
    guid,
    title: firstText(entry.title) || "Untitled episode",
    description: htmlToText(entry.content ?? entry.summary),
    audioUrl,
    link,
    pubDate: firstText(entry.published, entry.updated),
    duration: firstText(entry["itunes:duration"]),
    image,
    author: atomAuthorText(entry.author) || feed.author,
    feedTitle: feed.title,
    feedUrl: feed.feedUrl,
  };
}

function isRssItemStart(name: string, tagStack: string[], feedKind: FeedKind): boolean {
  const parent = tagStack[tagStack.length - 1];

  return name === "item" && (
    (feedKind === "rss" && parent === "channel") ||
    (feedKind === "rdf" && parent === "rdf:rdf")
  );
}

function isAtomEntryStart(name: string, tagStack: string[], feedKind: FeedKind): boolean {
  return name === "entry" && feedKind === "atom" && tagStack[tagStack.length - 1] === "feed";
}

function isRssFeedMetadataStart(name: string, tagStack: string[], feedKind: FeedKind): boolean {
  return (feedKind === "rss" || feedKind === "rdf") &&
    tagStack[tagStack.length - 1] === "channel" &&
    name !== "item";
}

function isAtomFeedMetadataStart(name: string, tagStack: string[], feedKind: FeedKind): boolean {
  return feedKind === "atom" &&
    tagStack[tagStack.length - 1] === "feed" &&
    name !== "entry";
}

function buildStreamingFeedBase(
  feedKind: FeedKind,
  feedFields: XmlRecord,
  requestedFeedUrl: string,
  resolutionBaseUrl: string,
): Omit<NormalizedFeed, "items"> {
  if (feedKind === "atom") {
    const feedImage = absolutePublicUrl(firstImage(feedFields["itunes:image"], feedFields.logo, feedFields.icon), resolutionBaseUrl);

    return {
      title: firstText(feedFields.title),
      description: htmlToText(feedFields.subtitle),
      image: feedImage,
      author: atomAuthorText(feedFields.author),
      feedUrl: requestedFeedUrl,
      link: getAtomAlternateLink(feedFields, resolutionBaseUrl),
    };
  }

  const feedImage = absolutePublicUrl(firstImage(feedFields["itunes:image"], isRecord(feedFields.image) ? feedFields.image.url : undefined), resolutionBaseUrl);

  return {
    title: firstText(feedFields.title),
    description: htmlToText(feedFields.description),
    image: feedImage,
    author: firstText(feedFields["itunes:author"], feedFields["dc:creator"], feedFields.managingeditor),
    feedUrl: requestedFeedUrl,
    link: absolutePublicUrl(feedFields.link, resolutionBaseUrl),
  };
}

async function parseNormalizedFeedStream(
  response: Response,
  requestedFeedUrl: string,
  resolutionBaseUrl: string,
  count: number,
): Promise<NormalizedFeed> {
  if (!response.body) {
    throw new RssFetchError(422, "invalid-feed-xml", "Feed XML is invalid or unsupported");
  }

  const parser = sax.parser(true, {
    lowercase: true,
    normalize: false,
    position: false,
    strictEntities: false,
    trim: false,
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const tagStack: string[] = [];
  const captureStack: CapturedXmlNode[] = [];
  const feedFields: XmlRecord = {};
  const items: NormalizedEpisode[] = [];
  let feedKind: FeedKind = null;
  let processedBytes = 0;
  let parseError: Error | null = null;
  let completedEarly = false;

  const finishFeed = (): NormalizedFeed => {
    const feed = buildStreamingFeedBase(feedKind, feedFields, requestedFeedUrl, resolutionBaseUrl);

    if (!feed.title && items.length === 0) {
      throw new RssFetchError(422, "invalid-feed-xml", "Feed XML is invalid or unsupported");
    }

    return { ...feed, items };
  };

  parser.onerror = (error: Error) => {
    parseError = error;
    throw error;
  };

  parser.onopentag = (node: { name: string; attributes: Record<string, unknown> }) => {
    const name = xmlName(node.name);

    if (tagStack.length === 0) {
      if (name === "rss") {
        feedKind = "rss";
      } else if (name === "rdf:rdf") {
        feedKind = "rdf";
      } else if (name === "feed") {
        feedKind = "atom";
      }
    }

    const startsEpisode = captureStack.length === 0 && (
      isRssItemStart(name, tagStack, feedKind) ||
      isAtomEntryStart(name, tagStack, feedKind)
    );
    const startsMetadata = captureStack.length === 0 && (
      isRssFeedMetadataStart(name, tagStack, feedKind) ||
      isAtomFeedMetadataStart(name, tagStack, feedKind)
    );

    if (startsEpisode || startsMetadata || captureStack.length > 0) {
      captureStack.push(startCapturedNode(name, node.attributes));
    }

    tagStack.push(name);
  };

  parser.ontext = (text: string) => {
    addCapturedText(captureStack, text);
  };

  parser.oncdata = (text: string) => {
    addCapturedText(captureStack, text);
  };

  parser.onclosetag = (rawName: string) => {
    const name = xmlName(rawName);
    const node = captureStack[captureStack.length - 1];

    if (node?.name === name) {
      captureStack.pop();
      const value = capturedNodeToRecord(node);

      if (captureStack.length > 0) {
        appendXmlValue(captureStack[captureStack.length - 1].children, node.name, value);
      } else if (node.name === "item") {
        const item = normalizeRssItem(value as XmlRecord, buildStreamingFeedBase(feedKind, feedFields, requestedFeedUrl, resolutionBaseUrl), resolutionBaseUrl);

        if (item) {
          items.push(item);
        }
      } else if (node.name === "entry") {
        const item = normalizeAtomItem(value as XmlRecord, buildStreamingFeedBase(feedKind, feedFields, requestedFeedUrl, resolutionBaseUrl), resolutionBaseUrl);

        if (item) {
          items.push(item);
        }
      } else {
        appendXmlValue(feedFields, node.name, value);
      }

      if (items.length >= count) {
        completedEarly = true;
        throw new RssFeedComplete();
      }
    }

    tagStack.pop();
  };

  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;

      try {
        result = await reader.read();
      } catch (error) {
        if (isTimeoutError(error)) {
          throw new RssFetchError(504, "upstream-timeout", "Feed origin timed out");
        }

        throw new RssFetchError(502, "upstream-unavailable", "Feed origin is unavailable");
      }

      if (result.done) {
        break;
      }

      if (!result.value?.byteLength) {
        continue;
      }

      const remainingBytes = RSS_FETCH_MAX_BYTES - processedBytes;
      const bytesToProcess = Math.min(result.value.byteLength, remainingBytes);

      if (bytesToProcess > 0) {
        processedBytes += bytesToProcess;

        try {
          parser.write(decoder.decode(result.value.subarray(0, bytesToProcess), { stream: true }));
        } catch (error) {
          if (error instanceof RssFeedComplete) {
            await reader.cancel();
            return finishFeed();
          }

          if (error instanceof Error && error === parseError) {
            throw new RssFetchError(422, "invalid-feed-xml", "Feed XML is invalid or unsupported");
          }

          throw error;
        }
      }

      if (bytesToProcess < result.value.byteLength || processedBytes >= RSS_FETCH_MAX_BYTES) {
        throw new RssFetchError(413, "feed-too-large", "Feed response is too large before enough playable episodes were found");
      }
    }

    try {
      parser.write(decoder.decode());
      parser.close();
    } catch (error) {
      if (error instanceof RssFeedComplete) {
        return finishFeed();
      }

      throw new RssFetchError(422, "invalid-feed-xml", "Feed XML is invalid or unsupported");
    }

    if (completedEarly) {
      return finishFeed();
    }

    return finishFeed();
  } finally {
    reader.releaseLock();
  }
}

function cloneFeedWithCount(feed: NormalizedFeed, count: number): NormalizedFeed {
  return {
    ...feed,
    items: feed.items.slice(0, count),
  };
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

async function fetchFeedResponse(initialUrl: string): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = validatePublicFeedUrl(initialUrl);
  const visited = new Set<string>();
  const signal = AbortSignal.timeout(RSS_FETCH_TIMEOUT_MS);

  for (let redirects = 0; redirects <= RSS_FETCH_MAX_REDIRECTS; redirects += 1) {
    if (visited.has(currentUrl)) {
      throw new RssFetchError(502, "upstream-unavailable", "Feed redirect loop detected");
    }

    visited.add(currentUrl);

    let response: Response;

    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        headers: {
          "User-Agent": RSS_FETCH_USER_AGENT,
          Accept: RSS_FETCH_ACCEPT,
        },
        signal,
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new RssFetchError(504, "upstream-timeout", "Feed origin timed out");
      }

      throw new RssFetchError(502, "upstream-unavailable", "Feed origin is unavailable");
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");

      if (!location) {
        throw new RssFetchError(502, "upstream-unavailable", "Feed redirect did not include a destination");
      }

      if (redirects === RSS_FETCH_MAX_REDIRECTS) {
        throw new RssFetchError(502, "upstream-unavailable", "Feed redirect limit was reached");
      }

      currentUrl = validatePublicFeedUrl(new URL(location, currentUrl).toString());
      continue;
    }

    if (!response.ok) {
      throw new RssFetchError(502, "upstream-unavailable", "Feed origin returned an error");
    }

    return {
      response,
      finalUrl: currentUrl,
    };
  }

  throw new RssFetchError(502, "upstream-unavailable", "Feed redirect limit was reached");
}

async function getRssCacheEntry(env: Env, key: string): Promise<RssCacheEntry | null> {
  if (!env.VOXYL_CACHE) {
    return null;
  }

  try {
    const entry = await env.VOXYL_CACHE.get<RssCacheEntry>(key, "json");
    return entry?.data?.items ? entry : null;
  } catch {
    return null;
  }
}

async function putRssCacheEntry(env: Env, key: string, feed: NormalizedFeed): Promise<void> {
  if (!env.VOXYL_CACHE) {
    return;
  }

  try {
    await env.VOXYL_CACHE.put(
      key,
      JSON.stringify({ cachedAt: Date.now(), data: cloneFeedWithCount(feed, 100) }),
      { expirationTtl: RSS_FETCH_KV_TTL_SECONDS },
    );
  } catch {
    // Cache writes should not make a valid feed request fail.
  }
}

async function rssFetchResponse(request: Request, env: Env): Promise<Response> {
  const payload = await parseRssFetchRequest(request);
  const cacheKey = `rss-feed:v2:${payload.count}:${await sha256Hex(payload.url)}`;
  const cached = await getRssCacheEntry(env, cacheKey);

  if (cached && Date.now() - cached.cachedAt <= RSS_FETCH_FRESH_TTL_MS) {
    return jsonResponse(cloneFeedWithCount(cached.data, payload.count), 200, {
      ...getCorsHeaders(request, env),
      "X-Voxyl-Cache": "HIT",
    });
  }

  try {
    const { response, finalUrl } = await fetchFeedResponse(payload.url);
    const feed = await parseNormalizedFeedStream(response, payload.url, finalUrl, payload.count);
    await putRssCacheEntry(env, cacheKey, feed);

    return jsonResponse(cloneFeedWithCount(feed, payload.count), 200, {
      ...getCorsHeaders(request, env),
      "X-Voxyl-Cache": "MISS",
    });
  } catch (error) {
    if (cached) {
      return jsonResponse(cloneFeedWithCount(cached.data, payload.count), 200, {
        ...getCorsHeaders(request, env),
        "X-Voxyl-Cache": "STALE",
      });
    }

    throw error;
  }
}

export async function generatePodcastIndexAuthHeaders(
  apiKey: string,
  apiSecret: string,
  timestamp = Math.floor(Date.now() / 1000),
): Promise<Record<string, string>> {
  return {
    "User-Agent": PODCAST_INDEX_USER_AGENT,
    "X-Auth-Date": String(timestamp),
    "X-Auth-Key": apiKey,
    Authorization: await sha1Hex(`${apiKey}${apiSecret}${timestamp}`),
  };
}

function parseOptionalString(value: unknown, fieldName: string): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    throw new PodcastSearchError(400, "invalid-request", `${fieldName} must be a string`);
  }

  return value.trim();
}

async function parsePodcastSearchRequest(request: Request): Promise<PodcastSearchRequest> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new PodcastSearchError(400, "invalid-request", "Request body must be valid JSON");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new PodcastSearchError(400, "invalid-request", "Request body must be a JSON object");
  }

  const payload = body as Record<string, unknown>;
  const query = parseOptionalString(payload.query, "query");

  if (!query) {
    throw new PodcastSearchError(400, "invalid-request", "query is required");
  }

  if (query.length > PODCAST_SEARCH_MAX_QUERY_LENGTH) {
    throw new PodcastSearchError(400, "invalid-request", `query must be ${PODCAST_SEARCH_MAX_QUERY_LENGTH} characters or less`);
  }

  const language = parseOptionalString(payload.language, "language").toLowerCase();
  const sortBy = parseOptionalString(payload.sortBy, "sortBy").toLowerCase();
  const category = parseOptionalString(payload.category, "category").toLowerCase();
  const maxDuration = payload.maxDuration === undefined || payload.maxDuration === null || payload.maxDuration === ""
    ? 0
    : Number(payload.maxDuration);

  if (!Number.isFinite(maxDuration) || maxDuration < 0 || maxDuration > 24 * 60) {
    throw new PodcastSearchError(400, "invalid-request", "maxDuration must be a number between 0 and 1440");
  }

  if (language && !/^[a-z]{2}(-[a-z0-9]+)?$/i.test(language)) {
    throw new PodcastSearchError(400, "invalid-request", "language must be a valid language code");
  }

  if (!allowedPodcastSorts.has(sortBy)) {
    throw new PodcastSearchError(400, "invalid-request", "sortBy is not supported");
  }

  if (category.length > 80) {
    throw new PodcastSearchError(400, "invalid-request", "category must be 80 characters or less");
  }

  return {
    query,
    maxDuration,
    language,
    sortBy: sortBy || "relevance",
    category,
  };
}

function normalizePodcastLanguage(language: string): string {
  return language.toLowerCase().replace(/_/g, "-").split("-")[0].trim();
}

function matchesPodcastLanguage(feedLanguage: string, requestedLanguage: string): boolean {
  if (!requestedLanguage) {
    return true;
  }

  if (!feedLanguage) {
    return false;
  }

  const normalized = normalizePodcastLanguage(feedLanguage);
  const aliases = podcastLanguageAliases[requestedLanguage] || [requestedLanguage];
  return aliases.some((alias) => normalized === alias || feedLanguage.toLowerCase().startsWith(alias));
}

function getProviderSearchUrl(payload: PodcastSearchRequest): URL {
  const url = new URL(`${PODCAST_INDEX_BASE_URL}/search/byterm`);
  url.searchParams.set("q", payload.query);
  url.searchParams.set("max", String(PODCAST_SEARCH_PROVIDER_MAX_RESULTS));
  url.searchParams.set("fulltext", "");
  url.searchParams.set("similar", "");

  return url;
}

function stringFromProvider(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberFromProvider(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizePodcastCategories(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const categories: Record<string, string> = {};

  for (const [key, category] of Object.entries(value as Record<string, unknown>)) {
    if (typeof category === "string") {
      categories[key] = category;
    }
  }

  return categories;
}

function normalizePodcastFeed(feed: unknown): PodcastSearchResult | null {
  if (!feed || typeof feed !== "object") {
    return null;
  }

  const typedFeed = feed as Record<string, unknown>;
  const id = numberFromProvider(typedFeed.id)?.toString() || stringFromProvider(typedFeed.id);
  const title = stringFromProvider(typedFeed.title).trim();
  const feedUrl = stringFromProvider(typedFeed.url).trim();

  if (!id || !title || !feedUrl) {
    return null;
  }

  return {
    id,
    title,
    author: stringFromProvider(typedFeed.author),
    description: stringFromProvider(typedFeed.description),
    image: stringFromProvider(typedFeed.image) || stringFromProvider(typedFeed.artwork),
    feedUrl,
    website: stringFromProvider(typedFeed.link),
    language: stringFromProvider(typedFeed.language),
    categories: normalizePodcastCategories(typedFeed.categories),
    episodeCount: numberFromProvider(typedFeed.episodeCount) || 0,
    latestPublishTime: numberFromProvider(typedFeed.newestItemPublishTime),
    oldestPublishTime: numberFromProvider(typedFeed.oldestItemPublishTime),
    lastUpdateTime: numberFromProvider(typedFeed.lastUpdateTime),
  };
}

function getPodcastFrequencyScore(podcast: PodcastSearchResult): number {
  if (!podcast.episodeCount || !podcast.oldestPublishTime || !podcast.latestPublishTime) {
    return 0;
  }

  const days = (podcast.latestPublishTime - podcast.oldestPublishTime) / 86400;

  if (!Number.isFinite(days) || days <= 0) {
    return 0;
  }

  return podcast.episodeCount / days;
}

function sortPodcastResults(results: PodcastSearchResult[], sortBy: string): PodcastSearchResult[] {
  if (sortBy === "episodes") {
    return [...results].sort((left, right) => right.episodeCount - left.episodeCount);
  }

  if (sortBy === "recent") {
    return [...results].sort((left, right) => (right.latestPublishTime || right.lastUpdateTime || 0) - (left.latestPublishTime || left.lastUpdateTime || 0));
  }

  if (sortBy === "frequency") {
    return [...results].sort((left, right) => getPodcastFrequencyScore(right) - getPodcastFrequencyScore(left));
  }

  return results;
}

function filterPodcastResults(results: PodcastSearchResult[], payload: PodcastSearchRequest): PodcastSearchResult[] {
  let filtered = payload.language
    ? results.filter((podcast) => matchesPodcastLanguage(podcast.language, payload.language))
    : results;
  const categoryId = payload.category ? podcastCategoryMap[payload.category] : null;

  if (categoryId) {
    const matches = filtered.filter((podcast) => Object.prototype.hasOwnProperty.call(podcast.categories, categoryId));
    const nonMatches = filtered.filter((podcast) => !Object.prototype.hasOwnProperty.call(podcast.categories, categoryId));
    filtered = [...matches, ...nonMatches];
  }

  return sortPodcastResults(filtered, payload.sortBy).slice(0, PODCAST_SEARCH_MAX_RESULTS);
}

function podcastSearchErrorResponse(error: PodcastSearchError, request: Request, env: Env): Response {
  return jsonResponse(
    {
      ok: false,
      code: error.code,
      error: error.message,
    },
    error.status,
    getCorsHeaders(request, env),
  );
}

async function podcastSearchResponse(request: Request, env: Env): Promise<Response> {
  const payload = await parsePodcastSearchRequest(request);

  if (!env.PODCAST_INDEX_API_KEY || !env.PODCAST_INDEX_API_SECRET) {
    throw new PodcastSearchError(503, "provider-configuration", "Podcast search is not configured");
  }

  const headers = await generatePodcastIndexAuthHeaders(env.PODCAST_INDEX_API_KEY, env.PODCAST_INDEX_API_SECRET);
  const providerUrl = getProviderSearchUrl(payload);
  let providerResponse: Response;

  try {
    providerResponse = await fetch(providerUrl, {
      headers,
      signal: AbortSignal.timeout(PODCAST_SEARCH_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new PodcastSearchError(504, "provider-timeout", "Podcast search provider timed out");
    }

    throw new PodcastSearchError(502, "provider-unavailable", "Podcast search provider is unavailable");
  }

  if (providerResponse.status === 401 || providerResponse.status === 403) {
    throw new PodcastSearchError(502, "provider-authentication", "Podcast search provider authentication failed");
  }

  if (providerResponse.status === 429) {
    throw new PodcastSearchError(429, "provider-rate-limit", "Podcast search provider rate limit reached");
  }

  if (!providerResponse.ok) {
    throw new PodcastSearchError(502, "provider-unavailable", "Podcast search provider is unavailable");
  }

  let providerData: unknown;

  try {
    providerData = await providerResponse.json();
  } catch {
    throw new PodcastSearchError(502, "provider-response", "Podcast search provider returned malformed data");
  }

  const feeds = (providerData as { feeds?: unknown }).feeds;

  if (!Array.isArray(feeds)) {
    throw new PodcastSearchError(502, "provider-response", "Podcast search provider returned malformed data");
  }

  const normalizedResults = feeds.map(normalizePodcastFeed).filter((podcast): podcast is PodcastSearchResult => podcast !== null);
  const results = filterPodcastResults(normalizedResults, payload);
  const ignoredFilters = [
    ...(payload.maxDuration > 0 ? ["maxDuration"] : []),
    ...(payload.category && !podcastCategoryMap[payload.category] ? ["category"] : []),
  ];

  return jsonResponse(
    {
      ok: true,
      results,
      meta: {
        source: "podcastindex",
        ignoredFilters,
      },
    },
    200,
    getCorsHeaders(request, env),
  );
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

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];

    if (!payload) {
      return null;
    }

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function decodeJwtPart(part: string): Uint8Array {
  const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function decodeJwtJsonPart(part: string): Record<string, unknown> | null {
  try {
    const text = new TextDecoder().decode(decodeJwtPart(part));
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isExpectedIssuer(issuer: string | null, env: Env): boolean {
  if (!issuer || !env.CLERK_ISSUER) {
    return false;
  }

  return issuer === env.CLERK_ISSUER;
}

function hasValidAuthorizedParty(claims: Record<string, unknown>, env: Env): boolean {
  const azp = claims.azp;

  if (typeof azp !== "string") {
    return true;
  }

  return getAuthorizedParties(env).includes(azp);
}

function hasValidTimeClaims(claims: Record<string, unknown>): boolean {
  const now = Math.floor(Date.now() / 1000);
  const exp = typeof claims.exp === "number" ? claims.exp : null;
  const nbf = typeof claims.nbf === "number" ? claims.nbf : null;

  if (exp !== null && exp <= now) {
    return false;
  }

  if (nbf !== null && nbf > now) {
    return false;
  }

  return true;
}

async function verifyTokenWithPinnedIssuerJwks(token: string, env: Env): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const header = decodeJwtJsonPart(parts[0]);
  const claims = decodeJwtJsonPart(parts[1]);
  const issuer = typeof claims?.iss === "string" ? claims.iss : null;

  if (!header || !claims || !isExpectedIssuer(issuer, env)) {
    return null;
  }

  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    return null;
  }

  if (!hasValidAuthorizedParty(claims, env) || !hasValidTimeClaims(claims)) {
    return null;
  }

  const jwksResponse = await fetch(`${issuer}/.well-known/jwks.json`, {
    headers: {
      accept: "application/json",
    },
  });

  if (!jwksResponse.ok) {
    return null;
  }

  const jwks = (await jwksResponse.json()) as { keys?: JsonWebKey[] };
  const jwk = jwks.keys?.find((key) => key.kid === header.kid);

  if (!jwk) {
    return null;
  }

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["verify"],
  );
  const signature = decodeJwtPart(parts[2]);
  const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signedData);

  return verified ? claims : null;
}

function logAuthVerification(request: Request, env: Env, message: string, error?: unknown): void {
  const token = getBearerToken(request);
  const payload = token ? decodeJwtPayload(token) : null;
  const issuer = typeof payload?.iss === "string" ? payload.iss : null;
  const authorizedParties = getAuthorizedParties(env);

  console.warn("Clerk auth verification", {
    message,
    hasAuthorizationHeader: Boolean(request.headers.get("authorization")),
    hasBearerToken: Boolean(token),
    tokenIssuer: issuer,
    expectedIssuer: env.CLERK_ISSUER || null,
    allowedOrigin: request.headers.get("origin"),
    authorizedParties,
    hasSecretKey: Boolean(env.CLERK_SECRET_KEY),
    hasJwtKey: Boolean(env.CLERK_JWT_KEY),
    error: error instanceof Error ? error.message : error ? String(error) : null,
  });
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

type ClerkProfile = {
  email: string | null;
  name: string | null;
};

async function getVerifiedClerkClaims(request: Request, env: Env): Promise<ClerkClaims | null> {
  const token = getBearerToken(request);

  if (!token) {
    logAuthVerification(request, env, "missing bearer token");
    return null;
  }

  let verifiedToken: unknown;

  try {
    verifiedToken = await verifyToken(token, {
      jwtKey: env.CLERK_JWT_KEY,
      secretKey: env.CLERK_SECRET_KEY,
      authorizedParties: getAuthorizedParties(env),
    });
  } catch (error) {
    logAuthVerification(request, env, "primary token verification failed, trying pinned issuer JWKS", error);
    verifiedToken = await verifyTokenWithPinnedIssuerJwks(token, env);

    if (!verifiedToken) {
      logAuthVerification(request, env, "pinned issuer JWKS verification failed");
      return null;
    }
  }

  try {
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
  } catch (error) {
    logAuthVerification(request, env, "verified token claims parsing failed", error);
    return null;
  }
}

async function getOptionalVerifiedClerkClaims(request: Request, env: Env): Promise<ClerkClaims | null> {
  const authorization = request.headers.get("authorization");

  if (authorization === null) {
    return null;
  }

  const claims = await getVerifiedClerkClaims(request, env);

  if (!claims) {
    throw new PodcastPlayError(401, "unauthorized", "Unauthorized");
  }

  return claims;
}

function normalizeEmail(email: string | null): string | null {
  return email?.trim().toLowerCase() || null;
}

async function getClerkProfile(env: Env, clerkUserId: string): Promise<ClerkProfile> {
  try {
    const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}`, {
      headers: {
        authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
        accept: "application/json",
      },
    });

    if (!response.ok) {
      return { email: null, name: null };
    }

    const data = (await response.json()) as {
      first_name?: string | null;
      last_name?: string | null;
      full_name?: string | null;
      primary_email_address_id?: string | null;
      email_addresses?: Array<{ id?: string | null; email_address?: string | null }>;
    };
    const primaryEmail =
      data.email_addresses?.find((email) => email.id === data.primary_email_address_id)?.email_address ||
      data.email_addresses?.[0]?.email_address ||
      null;
    const name = data.full_name || [data.first_name, data.last_name].filter(Boolean).join(" ").trim() || null;

    return {
      email: normalizeEmail(primaryEmail),
      name,
    };
  } catch {
    return { email: null, name: null };
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
  imported_at: string | null;
  created_at: string;
  updated_at: string;
};

type PublicUserSearchResult = {
  id: string;
  username: string;
  profile_hidden: boolean;
};

type D1UserSearchRow = {
  id: string;
  username: string;
  profile_hidden: number | string | boolean | null;
};

type PublicUserProfile = {
  id: string;
  username: string | null;
  full_name: string | null;
  profile_picture: string | null;
  created_at: string;
};

type D1UserPlaylistRow = {
  id: string;
  title: string;
  description: string | null;
  cover_image: string | null;
  creator_id: string;
  creator_username: string | null;
  creator_picture: string | null;
  visibility: string;
  created_at: string;
  updated_at: string;
};

type PublicUserPlaylist = {
  id: string;
  name: string;
  title: string;
  description: string | null;
  cover_image: string | null;
  creator_id: string;
  creator_username: string | null;
  creator_picture: string | null;
  visibility: string;
  created_at: string;
  updated_at: string;
  created_date: string;
  updated_date: string;
};

function isTruthyD1Flag(value: number | string | boolean | null): boolean {
  return value === true || value === 1 || value === "1";
}

function toPublicUserSearchResult(row: D1UserSearchRow): PublicUserSearchResult {
  return {
    id: row.id,
    username: row.username,
    profile_hidden: isTruthyD1Flag(row.profile_hidden),
  };
}

async function getUserByClerkUserId(env: Env, clerkUserId: string): Promise<D1User | null> {
  return env.DB.prepare(
    `SELECT id, clerk_user_id, legacy_base44_user_id, email, name, username, role,
      profile_picture, profile_hidden, imported_at, created_at, updated_at
     FROM users
     WHERE clerk_user_id = ?`,
  )
    .bind(clerkUserId)
    .first<D1User>();
}

async function getUsersByEmail(env: Env, email: string): Promise<D1User[]> {
  const { results } = await env.DB.prepare(
     `SELECT id, clerk_user_id, legacy_base44_user_id, email, name, username, role,
      profile_picture, profile_hidden, imported_at, created_at, updated_at
     FROM users
     WHERE lower(TRIM(email)) = lower(TRIM(?))
     ORDER BY imported_at IS NULL, created_at ASC`,
  )
    .bind(email)
    .all<D1User>();

  return results || [];
}

async function createUserFromClerkClaims(env: Env, claims: ClerkClaims): Promise<void> {
  await env.DB.prepare(
     `INSERT INTO users (id, clerk_user_id, email, name)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(clerk_user_id) DO NOTHING`,
  )
    .bind(claims.userId, claims.userId, normalizeEmail(claims.email), claims.name)
    .run();
}

type CountRow = {
  count: number;
};

async function runD1Batch(env: Env, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  if (typeof env.DB.batch === "function") {
    return env.DB.batch(statements);
  }

  const results: D1Result[] = [];

  for (const statement of statements) {
    results.push(await statement.run());
  }

  return results;
}

function normalizeLegacyBase44UserId(value: string | null): string | null {
  return value?.trim() || null;
}

function isTemporaryClerkDuplicate(conflict: D1User, claims: ClerkClaims, email: string | null): boolean {
  return conflict.id === claims.userId &&
    conflict.clerk_user_id === claims.userId &&
    !normalizeLegacyBase44UserId(conflict.legacy_base44_user_id) &&
    normalizeEmail(conflict.email) === email;
}

async function getUserReferenceCount(env: Env, userId: string, clerkUserId: string | null = null): Promise<number> {
  const clerkIdentity = clerkUserId || "";
  const row = await env.DB.prepare(
    `SELECT (
       (SELECT COUNT(*) FROM playlists WHERE creator_id = ? OR creator_clerk_user_id = ?) +
       (SELECT COUNT(*) FROM playlist_likes WHERE user_id = ? OR clerk_user_id = ?) +
       (SELECT COUNT(*) FROM podcast_likes WHERE user_id = ? OR clerk_user_id = ?) +
       (SELECT COUNT(*) FROM podcast_plays WHERE user_id = ? OR clerk_user_id = ?) +
       (SELECT COUNT(*) FROM episode_progress WHERE user_id = ? OR clerk_user_id = ?) +
       (SELECT COUNT(*) FROM follows WHERE follower_id = ? OR follower_clerk_user_id = ? OR following_id = ? OR following_clerk_user_id = ?) +
       (SELECT COUNT(*) FROM blocks WHERE blocker_id = ? OR blocker_clerk_user_id = ? OR blocked_id = ? OR blocked_clerk_user_id = ?) +
       (SELECT COUNT(*) FROM reports WHERE reporter_id = ? OR reporter_clerk_user_id = ? OR reported_user_id = ?) +
       (SELECT COUNT(*) FROM referrals WHERE inviter_id = ? OR inviter_clerk_user_id = ? OR invitee_user_id = ? OR invitee_clerk_user_id = ?)
     ) AS count`,
  )
    .bind(
      userId, clerkIdentity,
      userId, clerkIdentity,
      userId, clerkIdentity,
      userId, clerkIdentity,
      userId, clerkIdentity,
      userId, clerkIdentity, userId, clerkIdentity,
      userId, clerkIdentity, userId, clerkIdentity,
      userId, clerkIdentity, userId,
      userId, clerkIdentity, userId, clerkIdentity,
    )
    .first<CountRow>();

  return row?.count || 0;
}

async function getStableUserReferenceCount(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT (
       (SELECT COUNT(*) FROM playlists WHERE creator_id = ?) +
       (SELECT COUNT(*) FROM playlist_likes WHERE user_id = ?) +
       (SELECT COUNT(*) FROM podcast_likes WHERE user_id = ?) +
       (SELECT COUNT(*) FROM podcast_plays WHERE user_id = ?) +
       (SELECT COUNT(*) FROM episode_progress WHERE user_id = ?) +
       (SELECT COUNT(*) FROM follows WHERE follower_id = ? OR following_id = ?) +
       (SELECT COUNT(*) FROM blocks WHERE blocker_id = ? OR blocked_id = ?) +
       (SELECT COUNT(*) FROM reports WHERE reporter_id = ? OR reported_user_id = ?) +
       (SELECT COUNT(*) FROM referrals WHERE inviter_id = ? OR invitee_user_id = ?)
     ) AS count`,
  )
    .bind(userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId)
    .first<CountRow>();

  return row?.count || 0;
}

async function isHarmlessClerkPlaceholder(env: Env, user: D1User, claims: ClerkClaims, email: string | null): Promise<boolean> {
  if (!isTemporaryClerkDuplicate(user, claims, email)) {
    return false;
  }

  return (await getUserReferenceCount(env, user.id, claims.userId)) === 0;
}

function normalizeIdentityName(name: string | null): string | null {
  return name?.trim().toLowerCase() || null;
}

function hasDefaultOrphanProfile(user: D1User): boolean {
  return user.clerk_user_id === null &&
    !normalizeLegacyBase44UserId(user.legacy_base44_user_id) &&
    user.username === null &&
    user.profile_picture === null &&
    (user.role || "user") === "user" &&
    Number(user.profile_hidden || 0) === 0 &&
    user.imported_at === null;
}

function orphanNameMatchesCanonical(user: D1User, canonicalUser: D1User): boolean {
  const orphanName = normalizeIdentityName(user.name);

  return !orphanName || orphanName === normalizeIdentityName(canonicalUser.name);
}

async function isHarmlessOrphanClerkKeyedPlaceholder(
  env: Env,
  user: D1User,
  canonicalUser: D1User,
  email: string,
): Promise<boolean> {
  return hasDefaultOrphanProfile(user) &&
    orphanNameMatchesCanonical(user, canonicalUser) &&
    normalizeEmail(user.email) === email &&
    user.id === canonicalUser.clerk_user_id &&
    (await getStableUserReferenceCount(env, user.id)) === 0;
}

function identityConflict(): PodcastPlayError {
  return new PodcastPlayError(409, "identity-conflict", "Authenticated identity conflicts with an existing Voxyl user");
}

async function assertClerkUserIdCanBeReassigned(
  env: Env,
  user: D1User,
  claims: ClerkClaims,
  email: string | null,
): Promise<{ conflictingTemporaryUserId: string | null }> {
  const conflict = await getUserByClerkUserId(env, claims.userId);

  if (!conflict || conflict.id === user.id) {
    return { conflictingTemporaryUserId: null };
  }

  if (!(await isHarmlessClerkPlaceholder(env, conflict, claims, email))) {
    throw identityConflict();
  }

  return { conflictingTemporaryUserId: conflict.id };
}

type ResolvedEmailUser = {
  user: D1User | null;
  orphanPlaceholderUserId: string | null;
};

async function resolveUniqueUserByEmail(
  env: Env,
  email: string,
  claims: ClerkClaims,
  clerkUser: D1User | null,
): Promise<ResolvedEmailUser> {
  const candidates = await getUsersByEmail(env, email);

  if (candidates.length === 0) {
    return { user: null, orphanPlaceholderUserId: null };
  }

  const classified = await Promise.all(
    candidates.map(async (candidate) => ({
      user: candidate,
      harmlessPlaceholder: await isHarmlessClerkPlaceholder(env, candidate, claims, email),
      harmlessOrphanPlaceholder: false,
    })),
  );

  let meaningfulCandidates = classified
    .filter((candidate) => !candidate.harmlessPlaceholder)
    .map((candidate) => candidate.user);
  let legacyCandidates = meaningfulCandidates.filter((candidate) => normalizeLegacyBase44UserId(candidate.legacy_base44_user_id));

  if (legacyCandidates.length === 1 && meaningfulCandidates.length === 2) {
    const canonicalUser = legacyCandidates[0];
    const orphanCandidate = classified.find((candidate) =>
      candidate.user.id !== canonicalUser.id &&
      !candidate.harmlessPlaceholder
    );

    if (orphanCandidate && await isHarmlessOrphanClerkKeyedPlaceholder(env, orphanCandidate.user, canonicalUser, email)) {
      orphanCandidate.harmlessOrphanPlaceholder = true;
      meaningfulCandidates = classified
        .filter((candidate) => !candidate.harmlessPlaceholder && !candidate.harmlessOrphanPlaceholder)
        .map((candidate) => candidate.user);
      legacyCandidates = meaningfulCandidates.filter((candidate) => normalizeLegacyBase44UserId(candidate.legacy_base44_user_id));
    }
  }

  const clerkCandidate = clerkUser ? classified.find((candidate) => candidate.user.id === clerkUser.id) : null;
  const orphanPlaceholder = classified.find((candidate) => candidate.harmlessOrphanPlaceholder)?.user || null;

  if (legacyCandidates.length > 1 || meaningfulCandidates.length > 1) {
    throw identityConflict();
  }

  if (meaningfulCandidates.length === 1) {
    const canonicalUser = meaningfulCandidates[0];

    if (clerkUser && clerkUser.id !== canonicalUser.id && !clerkCandidate?.harmlessPlaceholder) {
      throw identityConflict();
    }

    return { user: canonicalUser, orphanPlaceholderUserId: orphanPlaceholder?.id || null };
  }

  if (clerkUser && clerkCandidate) {
    return { user: clerkUser, orphanPlaceholderUserId: null };
  }

  throw identityConflict();
}

async function linkClerkUserToLegacyData(
  env: Env,
  user: D1User,
  claims: ClerkClaims,
  orphanPlaceholderUserId: string | null = null,
): Promise<void> {
  const email = normalizeEmail(claims.email || user.email);
  const name = claims.name || user.name;
  const legacyBase44UserId = normalizeLegacyBase44UserId(user.legacy_base44_user_id);
  const oldClerkUserId = user.clerk_user_id === claims.userId ? null : user.clerk_user_id;

  if (!oldClerkUserId && !legacyBase44UserId) {
    await env.DB.prepare(
      `UPDATE users
       SET email = COALESCE(email, ?),
           name = COALESCE(name, ?),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(email, name, user.id)
      .run();
    return;
  }

  const { conflictingTemporaryUserId } = await assertClerkUserIdCanBeReassigned(env, user, claims, email);
  const canonicalClerkPrecondition = user.clerk_user_id;
  const relatedIdentityParams = [
    claims.userId,
    user.id,
    legacyBase44UserId || "",
    oldClerkUserId || "",
  ];
  const statements: D1PreparedStatement[] = [];

  if (conflictingTemporaryUserId) {
    statements.push(
      env.DB.prepare(
        `DELETE FROM users
         WHERE id = ?
           AND clerk_user_id = ?
           AND legacy_base44_user_id IS NULL
           AND lower(TRIM(COALESCE(email, ''))) = lower(TRIM(?))
           AND EXISTS (
             SELECT 1 FROM users canonical
             WHERE canonical.id = ?
               AND ((? IS NULL AND canonical.clerk_user_id IS NULL) OR canonical.clerk_user_id = ?)
           )
           AND NOT EXISTS (SELECT 1 FROM playlists WHERE creator_id = ? OR creator_clerk_user_id = ?)
           AND NOT EXISTS (SELECT 1 FROM playlist_likes WHERE user_id = ? OR clerk_user_id = ?)
           AND NOT EXISTS (SELECT 1 FROM podcast_likes WHERE user_id = ? OR clerk_user_id = ?)
           AND NOT EXISTS (SELECT 1 FROM podcast_plays WHERE user_id = ? OR clerk_user_id = ?)
           AND NOT EXISTS (SELECT 1 FROM episode_progress WHERE user_id = ? OR clerk_user_id = ?)
           AND NOT EXISTS (
             SELECT 1 FROM follows
             WHERE follower_id = ? OR follower_clerk_user_id = ? OR following_id = ? OR following_clerk_user_id = ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM blocks
             WHERE blocker_id = ? OR blocker_clerk_user_id = ? OR blocked_id = ? OR blocked_clerk_user_id = ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM reports
             WHERE reporter_id = ? OR reporter_clerk_user_id = ? OR reported_user_id = ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM referrals
             WHERE inviter_id = ? OR inviter_clerk_user_id = ? OR invitee_user_id = ? OR invitee_clerk_user_id = ?
           )`,
      )
        .bind(
          conflictingTemporaryUserId,
          claims.userId,
          email || "",
          user.id,
          canonicalClerkPrecondition,
          canonicalClerkPrecondition,
          conflictingTemporaryUserId, claims.userId,
          conflictingTemporaryUserId, claims.userId,
          conflictingTemporaryUserId, claims.userId,
          conflictingTemporaryUserId, claims.userId,
          conflictingTemporaryUserId, claims.userId,
          conflictingTemporaryUserId, claims.userId, conflictingTemporaryUserId, claims.userId,
          conflictingTemporaryUserId, claims.userId, conflictingTemporaryUserId, claims.userId,
          conflictingTemporaryUserId, claims.userId, conflictingTemporaryUserId,
          conflictingTemporaryUserId, claims.userId, conflictingTemporaryUserId, claims.userId,
        ),
    );
  }

  if (orphanPlaceholderUserId) {
    statements.push(
      env.DB.prepare(
        `DELETE FROM users
         WHERE id = ?
           AND clerk_user_id IS NULL
           AND (legacy_base44_user_id IS NULL OR TRIM(legacy_base44_user_id) = '')
           AND lower(TRIM(COALESCE(email, ''))) = lower(TRIM(?))
           AND username IS NULL
           AND profile_picture IS NULL
           AND COALESCE(role, 'user') = 'user'
           AND COALESCE(profile_hidden, 0) = 0
           AND imported_at IS NULL
           AND ? IS NOT NULL
           AND id = ?
           AND EXISTS (
             SELECT 1 FROM users canonical
             WHERE canonical.id = ?
               AND canonical.clerk_user_id = ?
               AND (
                 TRIM(COALESCE(users.name, '')) = ''
                 OR lower(TRIM(users.name)) = lower(TRIM(COALESCE(canonical.name, '')))
               )
           )
           AND NOT EXISTS (SELECT 1 FROM playlists WHERE creator_id = ?)
           AND NOT EXISTS (SELECT 1 FROM playlist_likes WHERE user_id = ?)
           AND NOT EXISTS (SELECT 1 FROM podcast_likes WHERE user_id = ?)
           AND NOT EXISTS (SELECT 1 FROM podcast_plays WHERE user_id = ?)
           AND NOT EXISTS (SELECT 1 FROM episode_progress WHERE user_id = ?)
           AND NOT EXISTS (SELECT 1 FROM follows WHERE follower_id = ? OR following_id = ?)
           AND NOT EXISTS (SELECT 1 FROM blocks WHERE blocker_id = ? OR blocked_id = ?)
           AND NOT EXISTS (SELECT 1 FROM reports WHERE reporter_id = ? OR reported_user_id = ?)
           AND NOT EXISTS (SELECT 1 FROM referrals WHERE inviter_id = ? OR invitee_user_id = ?)`,
      )
        .bind(
          orphanPlaceholderUserId,
          email || "",
          canonicalClerkPrecondition,
          canonicalClerkPrecondition,
          user.id,
          canonicalClerkPrecondition,
          orphanPlaceholderUserId,
          orphanPlaceholderUserId,
          orphanPlaceholderUserId,
          orphanPlaceholderUserId,
          orphanPlaceholderUserId,
          orphanPlaceholderUserId, orphanPlaceholderUserId,
          orphanPlaceholderUserId, orphanPlaceholderUserId,
          orphanPlaceholderUserId, orphanPlaceholderUserId,
          orphanPlaceholderUserId, orphanPlaceholderUserId,
        ),
    );
  }

  const canonicalUpdateIndex = statements.length;

  statements.push(
    env.DB.prepare(
      `UPDATE users
       SET clerk_user_id = ?,
           email = COALESCE(email, ?),
           name = COALESCE(name, ?),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND ((? IS NULL AND clerk_user_id IS NULL) OR clerk_user_id = ?)
         AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = ?))`,
    )
      .bind(
        claims.userId,
        email,
        name,
        user.id,
        canonicalClerkPrecondition,
        canonicalClerkPrecondition,
        orphanPlaceholderUserId,
        orphanPlaceholderUserId,
      ),
    env.DB.prepare(
      `UPDATE playlists
       SET creator_clerk_user_id = ?
       WHERE (creator_id = ?
          OR (creator_legacy_base44_user_id IS NOT NULL AND creator_legacy_base44_user_id = ?)
          OR (creator_clerk_user_id IS NOT NULL AND creator_clerk_user_id = ?))
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND clerk_user_id = ?)`,
    )
      .bind(...relatedIdentityParams, user.id, claims.userId),
    env.DB.prepare(
      `UPDATE playlist_likes
       SET clerk_user_id = ?
       WHERE (user_id = ?
          OR (legacy_base44_user_id IS NOT NULL AND legacy_base44_user_id = ?)
          OR (clerk_user_id IS NOT NULL AND clerk_user_id = ?))
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND clerk_user_id = ?)`,
    )
      .bind(...relatedIdentityParams, user.id, claims.userId),
    env.DB.prepare(
      `UPDATE podcast_likes
       SET clerk_user_id = ?
       WHERE (user_id = ?
          OR (legacy_base44_user_id IS NOT NULL AND legacy_base44_user_id = ?)
          OR (clerk_user_id IS NOT NULL AND clerk_user_id = ?))
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND clerk_user_id = ?)`,
    )
      .bind(...relatedIdentityParams, user.id, claims.userId),
    env.DB.prepare(
      `UPDATE podcast_plays
       SET clerk_user_id = ?
       WHERE (user_id = ?
          OR (legacy_base44_user_id IS NOT NULL AND legacy_base44_user_id = ?)
          OR (clerk_user_id IS NOT NULL AND clerk_user_id = ?))
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND clerk_user_id = ?)`,
    )
      .bind(...relatedIdentityParams, user.id, claims.userId),
    env.DB.prepare(
      `UPDATE episode_progress
       SET clerk_user_id = ?
       WHERE (user_id = ?
          OR (legacy_base44_user_id IS NOT NULL AND legacy_base44_user_id = ?)
          OR (clerk_user_id IS NOT NULL AND clerk_user_id = ?))
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND clerk_user_id = ?)`,
    )
      .bind(...relatedIdentityParams, user.id, claims.userId),
    env.DB.prepare(
      `UPDATE follows
       SET follower_clerk_user_id = ?
       WHERE (follower_id = ?
          OR (follower_legacy_base44_user_id IS NOT NULL AND follower_legacy_base44_user_id = ?)
          OR (follower_clerk_user_id IS NOT NULL AND follower_clerk_user_id = ?))
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND clerk_user_id = ?)`,
    )
      .bind(...relatedIdentityParams, user.id, claims.userId),
    env.DB.prepare(
      `UPDATE follows
       SET following_clerk_user_id = ?
       WHERE (following_id = ?
          OR (following_legacy_base44_user_id IS NOT NULL AND following_legacy_base44_user_id = ?)
          OR (following_clerk_user_id IS NOT NULL AND following_clerk_user_id = ?))
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND clerk_user_id = ?)`,
    )
      .bind(...relatedIdentityParams, user.id, claims.userId),
    env.DB.prepare(
      `UPDATE blocks
       SET blocker_clerk_user_id = ?
       WHERE (blocker_id = ?
          OR (blocker_legacy_base44_user_id IS NOT NULL AND blocker_legacy_base44_user_id = ?)
          OR (blocker_clerk_user_id IS NOT NULL AND blocker_clerk_user_id = ?))
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND clerk_user_id = ?)`,
    )
      .bind(...relatedIdentityParams, user.id, claims.userId),
    env.DB.prepare(
      `UPDATE blocks
       SET blocked_clerk_user_id = ?
       WHERE (blocked_id = ?
          OR (blocked_legacy_base44_user_id IS NOT NULL AND blocked_legacy_base44_user_id = ?)
          OR (blocked_clerk_user_id IS NOT NULL AND blocked_clerk_user_id = ?))
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND clerk_user_id = ?)`,
    )
      .bind(...relatedIdentityParams, user.id, claims.userId),
    env.DB.prepare(
      `UPDATE reports
       SET reporter_clerk_user_id = ?
       WHERE (reporter_id = ?
          OR (reporter_legacy_base44_user_id IS NOT NULL AND reporter_legacy_base44_user_id = ?)
          OR (reporter_clerk_user_id IS NOT NULL AND reporter_clerk_user_id = ?))
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND clerk_user_id = ?)`,
    )
      .bind(...relatedIdentityParams, user.id, claims.userId),
    env.DB.prepare(
      `UPDATE referrals
       SET inviter_clerk_user_id = ?
       WHERE (inviter_id = ?
          OR (inviter_legacy_base44_user_id IS NOT NULL AND inviter_legacy_base44_user_id = ?)
          OR (inviter_clerk_user_id IS NOT NULL AND inviter_clerk_user_id = ?))
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND clerk_user_id = ?)`,
    )
      .bind(...relatedIdentityParams, user.id, claims.userId),
    env.DB.prepare(
      `UPDATE referrals
       SET invitee_clerk_user_id = ?
       WHERE (invitee_user_id = ?
          OR (invitee_legacy_base44_user_id IS NOT NULL AND invitee_legacy_base44_user_id = ?)
          OR (invitee_clerk_user_id IS NOT NULL AND invitee_clerk_user_id = ?))
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND clerk_user_id = ?)`,
    )
      .bind(...relatedIdentityParams, user.id, claims.userId),
  );

  let results: D1Result[];

  try {
    results = await runD1Batch(env, statements);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: users\.clerk_user_id/i.test(error.message)) {
      throw identityConflict();
    }

    throw error;
  }

  const canonicalUpdateChanges = results[canonicalUpdateIndex]?.meta?.changes;

  if (canonicalUpdateChanges !== 1) {
    throw identityConflict();
  }
}

async function resolveD1UserFromClerkClaims(env: Env, claims: ClerkClaims): Promise<D1User | null> {
  const profile = !claims.email || !claims.name ? await getClerkProfile(env, claims.userId) : { email: null, name: null };
  const enrichedClaims = {
    ...claims,
    email: normalizeEmail(claims.email || profile.email),
    name: claims.name || profile.name,
  };

  let user = await getUserByClerkUserId(env, enrichedClaims.userId);
  const emailResolution = enrichedClaims.email
    ? await resolveUniqueUserByEmail(env, enrichedClaims.email, enrichedClaims, user)
    : { user: null, orphanPlaceholderUserId: null };
  const emailUser = emailResolution.user;
  const expectedUserId = emailUser?.id || user?.id || null;

  if (expectedUserId) {
    user = user?.id === expectedUserId
      ? user
      : emailUser?.id === expectedUserId
        ? emailUser
        : null;
  }

  if (user) {
    await linkClerkUserToLegacyData(env, user, enrichedClaims, emailResolution.orphanPlaceholderUserId);
    user = await getUserByClerkUserId(env, enrichedClaims.userId);

    if (!user || user.id !== expectedUserId) {
      throw identityConflict();
    }
  }

  if (!user) {
    await createUserFromClerkClaims(env, enrichedClaims);
    user = await getUserByClerkUserId(env, enrichedClaims.userId);
  }

  return user;
}

function toClientUser(user: D1User): D1User & { full_name: string | null; picture: string | null } {
  return {
    ...user,
    full_name: user.name,
    picture: user.profile_picture,
  };
}

async function meResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const claims = await getVerifiedClerkClaims(request, env);

  if (!claims) {
    return jsonResponse(unauthenticatedResponse, 401, corsHeaders);
  }

  const user = await resolveD1UserFromClerkClaims(env, claims);

  if (!user) {
    return jsonResponse({ ok: false, error: "User bootstrap failed" }, 500, corsHeaders);
  }

  return jsonResponse({ ok: true, user: toClientUser(user) }, 200, corsHeaders);
}

async function updateMeResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const claims = await getVerifiedClerkClaims(request, env);

  if (!claims) {
    return jsonResponse(unauthenticatedResponse, 401, corsHeaders);
  }

  const user = await resolveD1UserFromClerkClaims(env, claims);

  if (!user) {
    return jsonResponse({ ok: false, error: "User bootstrap failed" }, 500, corsHeaders);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be valid JSON");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be a JSON object");
  }

  const payload = body as Record<string, unknown>;
  const updates: string[] = [];
  const params: unknown[] = [];

  if (Object.prototype.hasOwnProperty.call(payload, "profile_picture")) {
    const profilePicture = validateBoundedString(payload.profile_picture, "profile_picture", 2048);
    updates.push("profile_picture = ?");
    params.push(profilePicture);
  }

  if (Object.prototype.hasOwnProperty.call(payload, "profile_hidden")) {
    updates.push("profile_hidden = ?");
    params.push(payload.profile_hidden ? 1 : 0);
  }

  if (updates.length > 0) {
    updates.push("updated_at = CURRENT_TIMESTAMP");
    await env.DB.prepare(
      `UPDATE users
       SET ${updates.join(", ")}
       WHERE id = ?`,
    )
      .bind(...params, user.id)
      .run();
  }

  const updated = await env.DB.prepare(
    `SELECT id, clerk_user_id, legacy_base44_user_id, email, name, username, role,
      profile_picture, profile_hidden, imported_at, created_at, updated_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(user.id)
    .first<D1User>();

  if (!updated) {
    return jsonResponse(notFoundResponse, 404, corsHeaders);
  }

  return jsonResponse(
    {
      ok: true,
      user: toClientUser(updated),
      data: toClientUser(updated),
    },
    200,
    corsHeaders,
  );
}

async function parseSearchUsersPayload(request: Request): Promise<{ query: string }> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be valid JSON");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be a JSON object");
  }

  const query = validateBoundedString((body as Record<string, unknown>).query, "query", 64) || "";
  return { query };
}

async function handleSearchUsers(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const { query } = await parseSearchUsersPayload(request);
  const normalizedQuery = query.trim();
  let results: D1UserSearchRow[];

  if (!normalizedQuery) {
    const response = await env.DB.prepare(
      `SELECT id, username, profile_hidden
       FROM users
       WHERE username IS NOT NULL
         AND TRIM(username) <> ''
         AND COALESCE(profile_hidden, 0) = 0
       ORDER BY datetime(COALESCE(NULLIF(TRIM(created_at), ''), '1970-01-01')) DESC,
         id ASC
       LIMIT 10`,
    ).all<D1UserSearchRow>();
    results = response.results || [];
  } else {
    const response = await env.DB.prepare(
      `SELECT id, username, profile_hidden
       FROM users
       WHERE username IS NOT NULL
         AND TRIM(username) <> ''
         AND LOWER(username) LIKE LOWER(? || '%')
         AND (COALESCE(profile_hidden, 0) = 0 OR LOWER(username) = LOWER(?))
       ORDER BY
         CASE WHEN LOWER(username) = LOWER(?) THEN 0 ELSE 1 END,
         LOWER(username) ASC,
         id ASC
       LIMIT 25`,
    )
      .bind(normalizedQuery, normalizedQuery, normalizedQuery)
      .all<D1UserSearchRow>();
    results = response.results || [];
  }

  return jsonResponse(
    {
      data: {
        users: results.map(toPublicUserSearchResult),
      },
    },
    200,
    corsHeaders,
  );
}

async function parseUserIdPayload(request: Request): Promise<{ userId: string }> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be valid JSON");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be a JSON object");
  }

  return {
    userId: validateBoundedString((body as Record<string, unknown>).userId, "userId", 128, true) || "",
  };
}

function toPublicUserProfile(user: D1User): PublicUserProfile {
  return {
    id: user.id,
    username: user.username,
    full_name: user.name,
    profile_picture: user.profile_picture,
    created_at: user.created_at,
  };
}

async function handleGetPublicUserProfile(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const { userId } = await parseUserIdPayload(request);
  const user = await env.DB.prepare(
    `SELECT id, clerk_user_id, legacy_base44_user_id, email, name, username, role,
      profile_picture, profile_hidden, imported_at, created_at, updated_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(userId)
    .first<D1User>();

  if (!user) {
    return jsonResponse({ data: {} }, 200, corsHeaders);
  }

  if (isTruthyD1Flag(user.profile_hidden)) {
    return jsonResponse(notFoundResponse, 404, corsHeaders);
  }

  return jsonResponse({ data: toPublicUserProfile(user) }, 200, corsHeaders);
}

function toPublicUserPlaylist(row: D1UserPlaylistRow): PublicUserPlaylist {
  return {
    id: row.id,
    name: row.title,
    title: row.title,
    description: row.description,
    cover_image: row.cover_image,
    creator_id: row.creator_id,
    creator_username: row.creator_username,
    creator_picture: row.creator_picture,
    visibility: row.visibility,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_date: row.created_at,
    updated_date: row.updated_at,
  };
}

async function handleGetUserPlaylists(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const { userId } = await parseUserIdPayload(request);
  const { results } = await env.DB.prepare(
    `SELECT id, title, description, cover_image, creator_id, creator_username,
      creator_picture, visibility, created_at, updated_at
     FROM playlists
     WHERE creator_id = ?
       AND visibility = 'public'
     ORDER BY datetime(COALESCE(NULLIF(TRIM(created_at), ''), '1970-01-01')) DESC,
       id ASC
     LIMIT 50`,
  )
    .bind(userId)
    .all<D1UserPlaylistRow>();

  return jsonResponse(
    {
      data: {
        playlists: (results || []).map(toPublicUserPlaylist),
      },
    },
    200,
    corsHeaders,
  );
}

function sanitizeUploadFileName(fileName: string): string {
  const sanitized = fileName
    .trim()
    .replace(/[/\\]/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);

  return sanitized || "profile-photo";
}

async function handleFileUpload(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const claims = await getVerifiedClerkClaims(request, env);

  if (!claims) {
    return jsonResponse(unauthenticatedResponse, 401, corsHeaders);
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return jsonResponse({ ok: false, error: "Request body must be multipart form data" }, 400, corsHeaders);
  }

  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return jsonResponse({ ok: false, error: "No file provided" }, 400, corsHeaders);
  }

  if (!file.type.startsWith("image/")) {
    return jsonResponse({ ok: false, error: "Only image files are allowed" }, 400, corsHeaders);
  }

  if (file.size > 5 * 1024 * 1024) {
    return jsonResponse({ ok: false, error: "File too large (max 5MB)" }, 400, corsHeaders);
  }

  const fileName = sanitizeUploadFileName(file.name);
  const objectKey = `profiles/${claims.userId}/${Date.now()}-${crypto.randomUUID()}-${fileName}`;

  await env.VOXYL_MEDIA.put(objectKey, await file.arrayBuffer(), {
    httpMetadata: {
      contentType: file.type,
    },
  });

  return jsonResponse(
    {
      file_url: `https://media.renbrant.com/${objectKey}`,
    },
    200,
    corsHeaders,
  );
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
  max_duration: number | null;
  time_filter_hours: number | null;
  episodes_sort_order: string | null;
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
  created_date: string;
  updated_date: string;
};

type D1RankedPlaylist = D1Playlist & {
  recent_plays_count: number;
};

type RankedPublicPlaylist = PublicPlaylist & {
  recent_plays_count: number;
};

const playlistSelect = `SELECT id, legacy_base44_playlist_id, creator_id, creator_clerk_user_id,
  creator_legacy_base44_user_id, title, description, cover_image, visibility, rss_feeds,
  max_duration, time_filter_hours, episodes_sort_order, likes_count, plays_count,
  creator_username, creator_picture, creator_hidden, created_at, updated_at
 FROM playlists`;

const rankedPlaylistSelect = `SELECT p.id, p.legacy_base44_playlist_id, p.creator_id, p.creator_clerk_user_id,
  p.creator_legacy_base44_user_id, p.title, p.description, p.cover_image, p.visibility, p.rss_feeds,
  p.max_duration, p.time_filter_hours, p.episodes_sort_order, p.likes_count, p.plays_count,
  p.creator_username, p.creator_picture, p.creator_hidden, p.created_at, p.updated_at`;

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
    max_duration: Number(playlist.max_duration) || 0,
    time_filter_hours: Number(playlist.time_filter_hours) || 0,
    episodes_sort_order: playlist.episodes_sort_order || "newest_first",
    likes_count: playlist.likes_count ?? 0,
    plays_count: playlist.plays_count ?? 0,
    creator_username: playlist.creator_username,
    creator_picture: playlist.creator_picture,
    creator_hidden: playlist.creator_hidden ?? 0,
    created_at: playlist.created_at,
    updated_at: playlist.updated_at,
    created_date: playlist.created_at,
    updated_date: playlist.updated_at,
  };
}

function toRankedPublicPlaylist(playlist: D1RankedPlaylist): RankedPublicPlaylist {
  return {
    ...toPublicPlaylist(playlist),
    recent_plays_count: Number(playlist.recent_plays_count) || 0,
  };
}

type PlaylistUpdatePayload = {
  name?: string;
  description?: string | null;
  max_duration?: number;
  time_filter_hours?: number;
  episodes_sort_order?: string;
  rss_feeds?: unknown[];
  cover_image?: string | null;
  visibility?: string;
};

function hasOwn(payload: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function validateOptionalPlaylistString(
  payload: Record<string, unknown>,
  key: string,
  fieldName: string,
  maxLength: number,
  required = false,
): string | null | undefined {
  if (!hasOwn(payload, key)) {
    return undefined;
  }

  return validateBoundedString(payload[key], fieldName, maxLength, required);
}

function validateOptionalPlaylistInteger(payload: Record<string, unknown>, key: string, fieldName: string): number | undefined {
  if (!hasOwn(payload, key)) {
    return undefined;
  }

  const value = payload[key];

  if (value === null || value === "") {
    throw new PodcastPlayError(400, "invalid-request", `${fieldName} must be a non-negative integer`);
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new PodcastPlayError(400, "invalid-request", `${fieldName} must be a non-negative integer`);
  }

  return Math.trunc(parsed);
}

function validateOptionalPlaylistVisibility(payload: Record<string, unknown>): string | undefined {
  if (!hasOwn(payload, "visibility")) {
    return undefined;
  }

  const visibility = validateBoundedString(payload.visibility, "visibility", 32, true);
  const allowed = new Set(["public", "friends_only", "private"]);

  if (!visibility || !allowed.has(visibility)) {
    throw new PodcastPlayError(400, "invalid-request", "visibility is invalid");
  }

  return visibility;
}

function validateOptionalPlaylistSortOrder(payload: Record<string, unknown>): string | undefined {
  if (!hasOwn(payload, "episodes_sort_order")) {
    return undefined;
  }

  const sortOrder = validateBoundedString(payload.episodes_sort_order, "episodes_sort_order", 32, true);
  const allowed = new Set(["newest_first", "oldest_first"]);

  if (!sortOrder || !allowed.has(sortOrder)) {
    throw new PodcastPlayError(400, "invalid-request", "episodes_sort_order is invalid");
  }

  return sortOrder;
}

function validatePlaylistFeed(feed: unknown, index: number): unknown {
  if (!feed || typeof feed !== "object" || Array.isArray(feed)) {
    throw new PodcastPlayError(400, "invalid-request", `rss_feeds[${index}] must be an object`);
  }

  const typedFeed = feed as Record<string, unknown>;
  const url = typedFeed.url ?? typedFeed.feed_url;

  if (typeof url !== "string" || !normalizePlaybackFeedUrl(url)) {
    throw new PodcastPlayError(400, "invalid-request", `rss_feeds[${index}].url must be a valid absolute HTTP or HTTPS URL`);
  }

  return {
    ...typedFeed,
    url,
    skip_start_seconds: coerceNonNegativeInteger(typedFeed.skip_start_seconds),
    skip_end_seconds: coerceNonNegativeInteger(typedFeed.skip_end_seconds),
  };
}

async function parsePlaylistUpdatePayload(request: Request): Promise<PlaylistUpdatePayload> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be valid JSON");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be a JSON object");
  }

  const payload = body as Record<string, unknown>;
  const rssFeeds = hasOwn(payload, "rss_feeds") ? payload.rss_feeds : undefined;

  if (rssFeeds !== undefined && !Array.isArray(rssFeeds)) {
    throw new PodcastPlayError(400, "invalid-request", "rss_feeds must be an array");
  }

  return {
    name: validateOptionalPlaylistString(payload, "name", "name", 200, true) ?? undefined,
    description: validateOptionalPlaylistString(payload, "description", "description", 4000),
    max_duration: validateOptionalPlaylistInteger(payload, "max_duration", "max_duration"),
    time_filter_hours: validateOptionalPlaylistInteger(payload, "time_filter_hours", "time_filter_hours"),
    episodes_sort_order: validateOptionalPlaylistSortOrder(payload),
    rss_feeds: rssFeeds?.map(validatePlaylistFeed),
    cover_image: validateOptionalPlaylistString(payload, "cover_image", "cover_image", 2048),
    visibility: validateOptionalPlaylistVisibility(payload),
  };
}

function isPlaylistOwner(playlist: D1Playlist, user: D1User, claims: ClerkClaims): boolean {
  return playlist.creator_id === user.id ||
    playlist.creator_clerk_user_id === claims.userId ||
    playlist.creator_clerk_user_id === user.clerk_user_id ||
    Boolean(user.legacy_base44_user_id && playlist.creator_legacy_base44_user_id === user.legacy_base44_user_id);
}

function getPlaylistOwnerUpdatePredicate(user: D1User, claims: ClerkClaims): { sql: string; params: string[] } {
  const predicates = ["creator_id = ?", "creator_clerk_user_id = ?"];
  const params = [user.id, claims.userId];

  if (user.clerk_user_id && user.clerk_user_id !== claims.userId) {
    predicates.push("creator_clerk_user_id = ?");
    params.push(user.clerk_user_id);
  }

  if (user.legacy_base44_user_id) {
    predicates.push("creator_legacy_base44_user_id = ?");
    params.push(user.legacy_base44_user_id);
  }

  return {
    sql: `(${predicates.join(" OR ")})`,
    params,
  };
}

type D1Follow = {
  id: string;
  legacy_base44_follow_id: string | null;
  follower_id: string;
  follower_clerk_user_id: string | null;
  follower_legacy_base44_user_id: string | null;
  following_id: string;
  following_clerk_user_id: string | null;
  following_legacy_base44_user_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  follower_email: string | null;
  follower_name: string | null;
  follower_username: string | null;
  following_email: string | null;
  following_name: string | null;
  following_username: string | null;
  base44_created_date: string | null;
  base44_updated_date: string | null;
};

type PublicFollow = D1Follow & {
  created_date: string;
  updated_date: string;
};

const followSelect = `SELECT id, legacy_base44_follow_id, follower_id, follower_clerk_user_id,
  follower_legacy_base44_user_id, following_id, following_clerk_user_id,
  following_legacy_base44_user_id, status, created_at, updated_at, follower_email,
  follower_name, follower_username, following_email, following_name, following_username,
  base44_created_date, base44_updated_date
 FROM follows`;

function toPublicFollow(follow: D1Follow): PublicFollow {
  return {
    ...follow,
    created_date: follow.base44_created_date || follow.created_at,
    updated_date: follow.base44_updated_date || follow.updated_at,
  };
}

async function parseTargetUserPayload(request: Request): Promise<{ targetUserId: string }> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be valid JSON");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be a JSON object");
  }

  const targetUserId = validateBoundedString((body as Record<string, unknown>).targetUserId, "targetUserId", 128, true);

  return { targetUserId: targetUserId! };
}

async function getUserById(env: Env, userId: string): Promise<D1User | null> {
  return env.DB.prepare(
    `SELECT id, clerk_user_id, legacy_base44_user_id, email, name, username, role,
      profile_picture, profile_hidden, imported_at, created_at, updated_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(userId)
    .first<D1User>();
}

type D1Block = {
  id: string;
  blocked_id: string;
  created_at: string;
  blocked_name: string | null;
  blocked_username: string | null;
  blocked_profile_picture: string | null;
  imported_blocked_name: string | null;
  base44_created_date: string | null;
};

type PublicBlock = {
  id: string;
  blocked_user: {
    id: string;
    name: string | null;
    username: string | null;
    profile_picture: string | null;
  };
  created_at: string;
  created_date: string;
};

type BlockIdentityScope = {
  predicates: string[];
  params: string[];
};

const blockListSelect = `SELECT b.id, b.blocked_id, b.created_at, b.base44_created_date,
  b.blocked_name AS imported_blocked_name,
  u.name AS blocked_name, u.username AS blocked_username, u.profile_picture AS blocked_profile_picture
 FROM blocks b
 LEFT JOIN users u ON u.id = b.blocked_id`;

function getBlockIdentityScope(user: D1User, prefix: "blocker" | "blocked"): BlockIdentityScope {
  const predicates = [`${prefix}_id = ?`];
  const params = [user.id];

  if (user.clerk_user_id) {
    predicates.push(`${prefix}_clerk_user_id = ?`);
    params.push(user.clerk_user_id);
  }

  const legacyUserId = user.legacy_base44_user_id?.trim();

  if (legacyUserId) {
    predicates.push(`${prefix}_legacy_base44_user_id = ?`);
    params.push(legacyUserId);
  }

  return { predicates, params };
}

function getBlockIdentityValues(user: Pick<D1User, "id" | "clerk_user_id" | "legacy_base44_user_id">): string[] {
  return [
    user.id,
    user.clerk_user_id,
    user.legacy_base44_user_id?.trim() || null,
  ].filter((value): value is string => Boolean(value));
}

function getFollowUserPredicate(prefix: "follower" | "following", values: string[]): string {
  const columns = [`${prefix}_id`, `${prefix}_clerk_user_id`, `${prefix}_legacy_base44_user_id`];
  return `(${columns.map((column) => `${column} IN (${values.map(() => "?").join(", ")})`).join(" OR ")})`;
}

function toPublicBlock(block: D1Block): PublicBlock {
  const name = block.blocked_name || block.imported_blocked_name || null;
  const createdAt = block.base44_created_date || block.created_at;

  return {
    id: block.id,
    blocked_user: {
      id: block.blocked_id,
      name,
      username: block.blocked_username,
      profile_picture: block.blocked_profile_picture,
    },
    created_at: createdAt,
    created_date: createdAt,
  };
}

type PublicPlaylistLike = {
  id: string;
  playlist_id: string;
  created_at: string;
  created_date: string;
};

type D1PlaylistLike = {
  id: string;
  playlist_id: string;
  created_at: string;
  base44_created_date: string | null;
};

type D1PodcastLike = {
  id: string;
  feed_url: string;
  podcast_title: string | null;
  podcast_author: string | null;
  podcast_image: string | null;
  podcast_description: string | null;
  created_at: string;
  updated_at: string;
  base44_created_date: string | null;
  base44_updated_date: string | null;
};

type PublicPodcastLike = {
  id: string;
  feed_url: string;
  podcast_title: string | null;
  podcast_author: string | null;
  podcast_image: string | null;
  podcast_description: string | null;
  created_at: string;
  created_date: string;
  updated_at: string;
  updated_date: string;
};

type D1EpisodeProgress = {
  id: string;
  feed_url: string | null;
  podcast_title: string | null;
  episode_title: string | null;
  audio_url: string;
  position_seconds: number | null;
  duration_seconds: number | null;
  completed: number | string | boolean | null;
  finished: number | string | boolean | null;
  last_played_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  base44_created_date: string | null;
  base44_updated_date: string | null;
};

type PublicEpisodeProgress = {
  id: string;
  audio_url: string;
  feed_url: string | null;
  podcast_title: string | null;
  episode_title: string | null;
  position_seconds: number;
  duration_seconds: number;
  finished: boolean;
  last_played_at: string | null;
  server_updated_at: string | null;
  created_at: string | null;
  created_date: string | null;
  updated_at: string | null;
  updated_date: string | null;
};

type PlaylistLikePayload = {
  playlistId: string;
};

type PodcastLikePayload = {
  originalFeedUrl: string;
  feedUrl: string;
  feedUrlCandidates: string[];
  podcastTitle: string | null;
  podcastAuthor: string | null;
  podcastImage: string | null;
  podcastDescription: string | null;
};

type EpisodeProgressPayload = {
  audioUrl?: string;
  audioUrlCandidates?: string[];
  feedUrl?: string | null;
  podcastTitle?: string | null;
  episodeTitle?: string | null;
  positionSeconds?: number;
  durationSeconds?: number;
  finished?: boolean;
  lastPlayedAt?: string;
  baseServerUpdatedAt?: string;
};

type SavedIdentityScope = {
  predicates: string[];
  params: string[];
  legacyUserId: string | null;
};

function parseSavedContentLimit(request: Request): number {
  const value = new URL(request.url).searchParams.get("limit");
  const parsed = Number(value);

  if (!value || !Number.isFinite(parsed)) {
    return 100;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}

function getSavedIdentityScope(user: D1User, clerkUserId: string): SavedIdentityScope {
  const predicates = ["user_id = ?", "clerk_user_id = ?"];
  const params = [user.id, clerkUserId];
  const legacyUserId = user.legacy_base44_user_id?.trim() || null;

  if (legacyUserId) {
    predicates.push("legacy_base44_user_id = ?");
    params.push(legacyUserId);
  }

  return { predicates, params, legacyUserId };
}

async function requireSavedContentUser(request: Request, env: Env): Promise<{ response?: Response; claims?: ClerkClaims; user?: D1User }> {
  const corsHeaders = getCorsHeaders(request, env);
  const claims = await getVerifiedClerkClaims(request, env);

  if (!claims) {
    return { response: jsonResponse(unauthenticatedResponse, 401, corsHeaders) };
  }

  const user = await resolveD1UserFromClerkClaims(env, claims);

  if (!user) {
    return { response: jsonResponse({ ok: false, error: "User bootstrap failed" }, 500, corsHeaders) };
  }

  return { claims, user };
}

function toPublicPlaylistLike(row: D1PlaylistLike): PublicPlaylistLike {
  const createdAt = row.base44_created_date || row.created_at;

  return {
    id: row.id,
    playlist_id: row.playlist_id,
    created_at: createdAt,
    created_date: createdAt,
  };
}

function toPublicPodcastLike(row: D1PodcastLike): PublicPodcastLike {
  const createdAt = row.base44_created_date || row.created_at;
  const updatedAt = row.base44_updated_date || row.updated_at;

  return {
    id: row.id,
    feed_url: row.feed_url,
    podcast_title: row.podcast_title,
    podcast_author: row.podcast_author,
    podcast_image: row.podcast_image,
    podcast_description: row.podcast_description,
    created_at: createdAt,
    created_date: createdAt,
    updated_at: updatedAt,
    updated_date: updatedAt,
  };
}

function coerceNonNegativeInteger(value: unknown): number {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }

  return Math.trunc(numeric);
}

function normalizeTimestamp(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function episodeProgressTimestampValue(value: unknown): number {
  if (typeof value !== "string") {
    return 0;
  }

  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function isIncomingEpisodeProgressCurrent(incoming: string, existing: Pick<D1EpisodeProgress, "last_played_at"> | null): boolean {
  return episodeProgressTimestampValue(incoming) >= episodeProgressTimestampValue(existing?.last_played_at);
}

function isEpisodeProgressBaseCurrent(baseServerUpdatedAt: string | undefined, existing: Pick<D1EpisodeProgress, "updated_at"> | null): boolean | null {
  if (!baseServerUpdatedAt) {
    return null;
  }

  const incomingBase = normalizeTimestamp(baseServerUpdatedAt);
  const existingRevision = normalizeTimestamp(existing?.updated_at);

  if (!incomingBase || !existingRevision) {
    return false;
  }

  return incomingBase === existingRevision;
}

function episodeProgressD1Value<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

function episodeProgressNextRevisionSql(column = "updated_at"): string {
  return `strftime('%Y-%m-%dT%H:%M:%fZ', MAX(julianday('now'), COALESCE(julianday(NULLIF(TRIM(${column}), '')), 0) + (1.0 / 86400000.0)))`;
}

function episodeProgressRevisionPredicateSql(column = "updated_at"): string {
  return `strftime('%Y-%m-%dT%H:%M:%fZ', ${column}) = ?`;
}

function isEpisodeProgressFinished(row: Pick<D1EpisodeProgress, "finished" | "completed">): boolean {
  return row.finished === true ||
    row.finished === 1 ||
    row.finished === "1" ||
    row.completed === 1 ||
    row.completed === "1";
}

function toPublicEpisodeProgress(row: D1EpisodeProgress): PublicEpisodeProgress {
  const createdAt = normalizeTimestamp(row.base44_created_date) || normalizeTimestamp(row.created_at);
  const updatedAt = normalizeTimestamp(row.base44_updated_date) || normalizeTimestamp(row.updated_at);
  const serverUpdatedAt = normalizeTimestamp(row.updated_at);

  return {
    id: row.id,
    audio_url: row.audio_url,
    feed_url: row.feed_url || null,
    podcast_title: row.podcast_title || null,
    episode_title: row.episode_title || null,
    position_seconds: coerceNonNegativeInteger(row.position_seconds),
    duration_seconds: coerceNonNegativeInteger(row.duration_seconds),
    finished: isEpisodeProgressFinished(row),
    last_played_at: normalizeTimestamp(row.last_played_at),
    server_updated_at: serverUpdatedAt,
    created_at: createdAt,
    created_date: createdAt,
    updated_at: updatedAt,
    updated_date: updatedAt,
  };
}

function parsePlaylistLikePayloadValue(value: unknown): PlaylistLikePayload {
  const playlistId = validateBoundedString(value, "playlist_id", 128, true);

  if (!playlistId) {
    throw new PodcastPlayError(400, "invalid-request", "playlist_id is required");
  }

  return { playlistId };
}

async function parsePlaylistLikePayload(request: Request): Promise<PlaylistLikePayload> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be valid JSON");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be a JSON object");
  }

  return parsePlaylistLikePayloadValue((body as Record<string, unknown>).playlist_id);
}

function parsePodcastLikePayloadValue(payload: Record<string, unknown>): PodcastLikePayload {
  const originalFeedUrl = validateBoundedString(payload.feed_url, "feed_url", 2048, true) || "";
  const feedUrl = validateAbsoluteHttpUrl(originalFeedUrl, "feed_url", true) || "";

  return {
    originalFeedUrl,
    feedUrl,
    feedUrlCandidates: getSavedPodcastFeedUrlCandidates(originalFeedUrl, feedUrl),
    podcastTitle: validateBoundedString(payload.podcast_title, "podcast_title", 500),
    podcastAuthor: validateBoundedString(payload.podcast_author, "podcast_author", 500),
    podcastImage: validateAbsoluteHttpUrl(payload.podcast_image, "podcast_image", false),
    podcastDescription: validateBoundedString(payload.podcast_description, "podcast_description", 4000),
  };
}

async function parsePodcastLikePayload(request: Request): Promise<PodcastLikePayload> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be valid JSON");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be a JSON object");
  }

  return parsePodcastLikePayloadValue(body as Record<string, unknown>);
}

function getSavedPodcastFeedUrlCandidates(originalFeedUrl: string, canonicalFeedUrl: string): string[] {
  const candidates = [canonicalFeedUrl, originalFeedUrl.trim()].filter(Boolean);

  try {
    const parsed = new URL(canonicalFeedUrl);

    if (parsed.pathname === "/" && !parsed.search) {
      candidates.push(`${parsed.protocol}//${parsed.host}`);
    }
  } catch {}

  return [...new Set(candidates)];
}

function getSavedPodcastFeedUrlFilterCandidates(rawFeedUrl: string): string[] {
  const originalFeedUrl = validateBoundedString(rawFeedUrl, "feed_url", 2048, true) || "";
  const canonicalFeedUrl = validateAbsoluteHttpUrl(originalFeedUrl, "feed_url", true) || "";
  return getSavedPodcastFeedUrlCandidates(originalFeedUrl, canonicalFeedUrl);
}

function parseEpisodeProgressLimit(request: Request): number {
  const value = new URL(request.url).searchParams.get("limit");
  const parsed = Number(value);

  if (!value || !Number.isFinite(parsed)) {
    return 500;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 500);
}

function getEpisodeProgressOrderBy(request: Request): string {
  const sort = new URL(request.url).searchParams.get("sort") || "-last_played_at";
  const allowed: Record<string, string> = {
    last_played_at: "datetime(COALESCE(NULLIF(TRIM(last_played_at), ''), updated_at, created_at)) ASC, updated_at ASC, id ASC",
    "-last_played_at": "datetime(COALESCE(NULLIF(TRIM(last_played_at), ''), updated_at, created_at)) DESC, updated_at DESC, id DESC",
    created_at: "datetime(COALESCE(NULLIF(TRIM(base44_created_date), ''), created_at)) ASC, created_at ASC, id ASC",
    "-created_at": "datetime(COALESCE(NULLIF(TRIM(base44_created_date), ''), created_at)) DESC, created_at DESC, id DESC",
    updated_at: "datetime(COALESCE(NULLIF(TRIM(base44_updated_date), ''), updated_at)) ASC, updated_at ASC, id ASC",
    "-updated_at": "datetime(COALESCE(NULLIF(TRIM(base44_updated_date), ''), updated_at)) DESC, updated_at DESC, id DESC",
  };

  return allowed[sort] || allowed["-last_played_at"];
}

function getEpisodeAudioUrlCandidates(originalAudioUrl: string, canonicalAudioUrl: string): string[] {
  const candidates = [canonicalAudioUrl, originalAudioUrl.trim()].filter(Boolean);

  try {
    const parsed = new URL(canonicalAudioUrl);

    if (parsed.pathname.endsWith("/") && parsed.pathname.length > 1 && !parsed.search) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
      candidates.push(parsed.toString());
    } else if (!parsed.search) {
      parsed.pathname = `${parsed.pathname}/`;
      candidates.push(parsed.toString());
    }
  } catch {}

  return [...new Set(candidates)];
}

function getEpisodeAudioUrlFilterCandidates(rawAudioUrl: string): string[] {
  const originalAudioUrl = validateBoundedString(rawAudioUrl, "audio_url", 4096, true) || "";
  const canonicalAudioUrl = validateAbsoluteHttpUrl(originalAudioUrl, "audio_url", true) || "";
  return getEpisodeAudioUrlCandidates(originalAudioUrl, canonicalAudioUrl);
}

function validateEpisodeInteger(value: unknown, fieldName: string, required: boolean): number | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new PodcastPlayError(400, "invalid-request", `${fieldName} is required`);
    }

    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2147483647) {
    throw new PodcastPlayError(400, "invalid-request", `${fieldName} must be a finite non-negative number`);
  }

  return Math.trunc(value);
}

function validateEpisodeFinished(value: unknown, required: boolean): boolean | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new PodcastPlayError(400, "invalid-request", "finished is required");
    }

    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value === 0 || value === 1) {
    return value === 1;
  }

  throw new PodcastPlayError(400, "invalid-request", "finished must be a boolean");
}

function validateEpisodeTimestamp(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new PodcastPlayError(400, "invalid-request", "last_played_at must be an ISO timestamp");
  }

  const trimmed = value.trim();
  const time = Date.parse(trimmed);

  if (!trimmed || !Number.isFinite(time)) {
    throw new PodcastPlayError(400, "invalid-request", "last_played_at must be an ISO timestamp");
  }

  return new Date(time).toISOString();
}

async function parseEpisodeProgressPayload(request: Request, mode: "create" | "update"): Promise<EpisodeProgressPayload> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be valid JSON");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be a JSON object");
  }

  const payload = body as Record<string, unknown>;
  const rawAudioUrl = mode === "create" || payload.audio_url !== undefined
    ? validateBoundedString(payload.audio_url, "audio_url", 4096, true) || ""
    : undefined;
  const audioUrl = rawAudioUrl === undefined ? undefined : validateAbsoluteHttpUrl(rawAudioUrl, "audio_url", true) || "";

  return {
    audioUrl,
    audioUrlCandidates: rawAudioUrl === undefined || audioUrl === undefined ? undefined : getEpisodeAudioUrlCandidates(rawAudioUrl, audioUrl),
    feedUrl: payload.feed_url === undefined ? undefined : validateAbsoluteHttpUrl(payload.feed_url, "feed_url", false),
    podcastTitle: payload.podcast_title === undefined ? undefined : validateBoundedString(payload.podcast_title, "podcast_title", 500),
    episodeTitle: payload.episode_title === undefined ? undefined : validateBoundedString(payload.episode_title, "episode_title", 500),
    positionSeconds: validateEpisodeInteger(payload.position_seconds, "position_seconds", mode === "create"),
    durationSeconds: validateEpisodeInteger(payload.duration_seconds, "duration_seconds", false),
    finished: validateEpisodeFinished(payload.finished, false),
    lastPlayedAt: validateEpisodeTimestamp(payload.last_played_at),
    baseServerUpdatedAt: validateEpisodeTimestamp(payload.base_server_updated_at),
  };
}

function episodeProgressSelect(): string {
  return `SELECT id, feed_url, podcast_title, episode_title, audio_url,
       position_seconds, duration_seconds, completed, finished, last_played_at,
       created_at, updated_at, base44_created_date, base44_updated_date
     FROM episode_progress`;
}

async function episodeProgressResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const auth = await requireSavedContentUser(request, env);

  if (auth.response) {
    return auth.response;
  }

  const url = new URL(request.url);
  const rawAudioUrl = url.searchParams.get("audio_url");
  const rawFinished = url.searchParams.get("finished");
  const scope = getSavedIdentityScope(auth.user!, auth.claims!.userId);
  const where = [`(${scope.predicates.join(" OR ")})`];
  const params = [...scope.params];

  if (rawAudioUrl) {
    const audioUrlCandidates = getEpisodeAudioUrlFilterCandidates(rawAudioUrl);
    where.push(`audio_url IN (${audioUrlCandidates.map(() => "?").join(", ")})`);
    params.push(...audioUrlCandidates);
  }

  if (rawFinished !== null && rawFinished !== "") {
    const finished = rawFinished === "true" ? 1 : rawFinished === "false" ? 0 : rawFinished === "1" ? 1 : rawFinished === "0" ? 0 : null;

    if (finished === null) {
      throw new PodcastPlayError(400, "invalid-request", "finished filter must be true, false, 1, or 0");
    }

    const finishedExpression = "(COALESCE(CAST(finished AS INTEGER), 0) = 1 OR COALESCE(CAST(completed AS INTEGER), 0) = 1)";
    const unfinishedExpression = "(COALESCE(CAST(finished AS INTEGER), 0) = 0 AND COALESCE(CAST(completed AS INTEGER), 0) = 0)";
    where.push(finished === 1 ? finishedExpression : unfinishedExpression);
  }

  const { results } = await env.DB.prepare(
    `${episodeProgressSelect()}
     WHERE ${where.join(" AND ")}
     ORDER BY ${getEpisodeProgressOrderBy(request)}
     LIMIT ?`,
  )
    .bind(...params, parseEpisodeProgressLimit(request))
    .all<D1EpisodeProgress>();
  const items = (results || []).map(toPublicEpisodeProgress);

  return jsonResponse({ ok: true, items, data: items }, 200, corsHeaders);
}

async function fetchEpisodeProgressByOwnedId(env: Env, id: string, scope: SavedIdentityScope): Promise<D1EpisodeProgress | null> {
  return env.DB.prepare(
    `${episodeProgressSelect()}
     WHERE id = ?
       AND (${scope.predicates.join(" OR ")})
     LIMIT 1`,
  )
    .bind(id, ...scope.params)
    .first<D1EpisodeProgress>();
}

async function fetchEpisodeProgressByUserAndAudioUrl(env: Env, userId: string, audioUrlCandidates: string[]): Promise<D1EpisodeProgress | null> {
  return env.DB.prepare(
    `${episodeProgressSelect()}
     WHERE user_id = ?
       AND audio_url IN (${audioUrlCandidates.map(() => "?").join(", ")})
     ORDER BY CASE WHEN audio_url = ? THEN 0 ELSE 1 END,
       updated_at DESC,
       id DESC
     LIMIT 1`,
  )
    .bind(userId, ...audioUrlCandidates, audioUrlCandidates[0])
    .first<D1EpisodeProgress>();
}

async function createEpisodeProgressResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const auth = await requireSavedContentUser(request, env);

  if (auth.response) {
    return auth.response;
  }

  const payload = await parseEpisodeProgressPayload(request, "create");
  const scope = getSavedIdentityScope(auth.user!, auth.claims!.userId);
  const audioUrlCandidates = payload.audioUrlCandidates || [payload.audioUrl!];
  const existing = await env.DB.prepare(
    `SELECT id, last_played_at, updated_at
     FROM episode_progress
     WHERE audio_url IN (${audioUrlCandidates.map(() => "?").join(", ")})
       AND (${scope.predicates.join(" OR ")})
     LIMIT 1`,
  )
    .bind(...audioUrlCandidates, ...scope.params)
    .first<Pick<D1EpisodeProgress, "id" | "last_played_at" | "updated_at">>();
  const id = existing?.id || crypto.randomUUID();
  const finished = payload.finished === true ? 1 : 0;
  const lastPlayedAt = payload.lastPlayedAt || new Date().toISOString();

  if (existing) {
    const baseIsCurrent = isEpisodeProgressBaseCurrent(payload.baseServerUpdatedAt, existing);
    const hasBaseRevision = baseIsCurrent !== null;
    const isCurrent = hasBaseRevision ? true : isIncomingEpisodeProgressCurrent(lastPlayedAt, existing);
    const result = isCurrent
      ? await env.DB.prepare(
        `UPDATE episode_progress
         SET user_id = ?,
             clerk_user_id = ?,
             legacy_base44_user_id = ?,
             audio_url = ?,
             feed_url = COALESCE(?, feed_url),
             podcast_title = COALESCE(?, podcast_title),
             episode_title = COALESCE(?, episode_title),
             position_seconds = ?,
             duration_seconds = ?,
             finished = ?,
             completed = ?,
             last_played_at = ?,
             updated_at = ${episodeProgressNextRevisionSql()}
         WHERE id = ?
           AND (${scope.predicates.join(" OR ")})
           ${hasBaseRevision ? `AND ${episodeProgressRevisionPredicateSql()}` : ""}`,
      )
        .bind(
          auth.user!.id,
          auth.claims!.userId,
          scope.legacyUserId,
          payload.audioUrl,
          episodeProgressD1Value(payload.feedUrl),
          episodeProgressD1Value(payload.podcastTitle),
          episodeProgressD1Value(payload.episodeTitle),
          payload.positionSeconds,
          payload.durationSeconds ?? 0,
          finished,
          finished,
          lastPlayedAt,
          id,
          ...scope.params,
          ...(hasBaseRevision ? [payload.baseServerUpdatedAt] : []),
        )
        .run()
      : hasBaseRevision
        ? { meta: { changes: 0 } }
      : await env.DB.prepare(
        `UPDATE episode_progress
         SET user_id = ?,
             clerk_user_id = ?,
             legacy_base44_user_id = ?,
             audio_url = ?,
             updated_at = ${episodeProgressNextRevisionSql()}
         WHERE id = ?
           AND (${scope.predicates.join(" OR ")})`,
      )
        .bind(
          auth.user!.id,
          auth.claims!.userId,
          scope.legacyUserId,
          payload.audioUrl,
          id,
          ...scope.params,
        )
        .run();
    const changes = Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);

    if (changes === 0) {
      if (hasBaseRevision) {
        const item = await fetchEpisodeProgressByOwnedId(env, id, scope) ||
          await fetchEpisodeProgressByUserAndAudioUrl(env, auth.user!.id, audioUrlCandidates);

        if (!item) {
          return jsonResponse(notFoundResponse, 404, corsHeaders);
        }

        const publicItem = toPublicEpisodeProgress(item);
        return jsonResponse({ ok: true, item: publicItem, data: publicItem }, 200, corsHeaders);
      }

      return jsonResponse(notFoundResponse, 404, corsHeaders);
    }
  } else {
    const result = await env.DB.prepare(
      `INSERT INTO episode_progress (
         id, user_id, clerk_user_id, legacy_base44_user_id, audio_url, feed_url,
         podcast_title, episode_title, position_seconds, duration_seconds,
         finished, completed, last_played_at, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(user_id, audio_url) DO UPDATE SET
         clerk_user_id = excluded.clerk_user_id,
         legacy_base44_user_id = excluded.legacy_base44_user_id,
         feed_url = COALESCE(excluded.feed_url, episode_progress.feed_url),
         podcast_title = COALESCE(excluded.podcast_title, episode_progress.podcast_title),
         episode_title = COALESCE(excluded.episode_title, episode_progress.episode_title),
         position_seconds = excluded.position_seconds,
         duration_seconds = excluded.duration_seconds,
         finished = excluded.finished,
         completed = excluded.completed,
         last_played_at = excluded.last_played_at,
         updated_at = ${episodeProgressNextRevisionSql("episode_progress.updated_at")}
       WHERE ? IS NULL
          OR ${episodeProgressRevisionPredicateSql("episode_progress.updated_at")}`,
    )
      .bind(
        id,
        auth.user!.id,
        auth.claims!.userId,
        scope.legacyUserId,
        payload.audioUrl,
        episodeProgressD1Value(payload.feedUrl),
        episodeProgressD1Value(payload.podcastTitle),
        episodeProgressD1Value(payload.episodeTitle),
        payload.positionSeconds,
        payload.durationSeconds ?? 0,
        finished,
        finished,
        lastPlayedAt,
        payload.baseServerUpdatedAt ?? null,
        payload.baseServerUpdatedAt ?? null,
      )
      .run();
    const changes = Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);

    if (changes === 0 && payload.baseServerUpdatedAt) {
      const item = await fetchEpisodeProgressByUserAndAudioUrl(env, auth.user!.id, audioUrlCandidates);

      if (!item) {
        return jsonResponse(notFoundResponse, 404, corsHeaders);
      }

      const publicItem = toPublicEpisodeProgress(item);
      return jsonResponse({ ok: true, item: publicItem, data: publicItem }, 200, corsHeaders);
    }
  }

  const item = await fetchEpisodeProgressByUserAndAudioUrl(env, auth.user!.id, audioUrlCandidates);

  if (!item) {
    throw new PodcastPlayError(500, "internal-error", "Episode progress unavailable");
  }

  const publicItem = toPublicEpisodeProgress(item);

  return jsonResponse({ ok: true, item: publicItem, data: publicItem }, 200, corsHeaders);
}

async function updateEpisodeProgressResponse(request: Request, env: Env, id: string): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const auth = await requireSavedContentUser(request, env);

  if (auth.response) {
    return auth.response;
  }

  const scope = getSavedIdentityScope(auth.user!, auth.claims!.userId);
  const existing = await fetchEpisodeProgressByOwnedId(env, id, scope);

  if (!existing) {
    return jsonResponse(notFoundResponse, 404, corsHeaders);
  }

  const payload = await parseEpisodeProgressPayload(request, "update");

  if (payload.audioUrl && !(payload.audioUrlCandidates || [payload.audioUrl]).includes(existing.audio_url)) {
    const existingCandidates = getEpisodeAudioUrlCandidates(existing.audio_url, validateAbsoluteHttpUrl(existing.audio_url, "audio_url", true) || existing.audio_url);
    const overlaps = (payload.audioUrlCandidates || [payload.audioUrl]).some((candidate) => existingCandidates.includes(candidate));

    if (!overlaps) {
      throw new PodcastPlayError(400, "invalid-request", "audio_url cannot be changed to another episode");
    }
  }

  const nextFinished = payload.finished === undefined
    ? isEpisodeProgressFinished(existing)
    : payload.finished;

  await env.DB.prepare(
    `UPDATE episode_progress
     SET user_id = ?,
         clerk_user_id = ?,
         legacy_base44_user_id = ?,
         audio_url = COALESCE(?, audio_url),
         feed_url = COALESCE(?, feed_url),
         podcast_title = COALESCE(?, podcast_title),
         episode_title = COALESCE(?, episode_title),
         position_seconds = COALESCE(?, position_seconds),
         duration_seconds = COALESCE(?, duration_seconds),
         finished = ?,
         completed = ?,
         last_played_at = COALESCE(?, last_played_at, CURRENT_TIMESTAMP),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND (${scope.predicates.join(" OR ")})`,
  )
    .bind(
      auth.user!.id,
      auth.claims!.userId,
      scope.legacyUserId,
      episodeProgressD1Value(payload.audioUrl),
      episodeProgressD1Value(payload.feedUrl),
      episodeProgressD1Value(payload.podcastTitle),
      episodeProgressD1Value(payload.episodeTitle),
      episodeProgressD1Value(payload.positionSeconds),
      episodeProgressD1Value(payload.durationSeconds),
      nextFinished ? 1 : 0,
      nextFinished ? 1 : 0,
      episodeProgressD1Value(payload.lastPlayedAt),
      id,
      ...scope.params,
    )
    .run();

  const item = await fetchEpisodeProgressByOwnedId(env, id, scope);

  if (!item) {
    return jsonResponse(notFoundResponse, 404, corsHeaders);
  }

  const publicItem = toPublicEpisodeProgress(item);

  return jsonResponse({ ok: true, item: publicItem, data: publicItem }, 200, corsHeaders);
}

async function deleteEpisodeProgressResponse(request: Request, env: Env, id: string): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const auth = await requireSavedContentUser(request, env);

  if (auth.response) {
    return auth.response;
  }

  const scope = getSavedIdentityScope(auth.user!, auth.claims!.userId);
  const result = await env.DB.prepare(
    `DELETE FROM episode_progress
     WHERE id = ?
       AND (${scope.predicates.join(" OR ")})`,
  )
    .bind(id, ...scope.params)
    .run();
  const changes = Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);

  if (changes === 0) {
    return jsonResponse(notFoundResponse, 404, corsHeaders);
  }

  return jsonResponse({ ok: true, deleted: true }, 200, corsHeaders);
}

async function playlistLikesResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const auth = await requireSavedContentUser(request, env);

  if (auth.response) {
    return auth.response;
  }

  const url = new URL(request.url);
  const playlistId = url.searchParams.get("playlist_id")?.trim();
  const scope = getSavedIdentityScope(auth.user!, auth.claims!.userId);
  const where = [`(${scope.predicates.join(" OR ")})`];
  const params = [...scope.params];

  if (playlistId) {
    where.push("playlist_id = ?");
    params.push(playlistId);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, playlist_id, created_at, base44_created_date
     FROM playlist_likes
     WHERE ${where.join(" AND ")}
     ORDER BY datetime(COALESCE(NULLIF(TRIM(base44_created_date), ''), created_at)) DESC,
       created_at DESC,
       id DESC
     LIMIT ?`,
  )
    .bind(...params, parseSavedContentLimit(request))
    .all<D1PlaylistLike>();
  const likes = (results || []).map(toPublicPlaylistLike);

  return jsonResponse({ ok: true, items: likes, data: likes }, 200, corsHeaders);
}

async function canLikePlaylist(env: Env, playlist: PlaybackPlaylist, user: D1User, claims: ClerkClaims): Promise<boolean> {
  if (playlist.visibility === "public") {
    return true;
  }

  const legacyUserId = user.legacy_base44_user_id?.trim();
  const legacyCreatorId = (playlist as PlaybackPlaylist & { creator_legacy_base44_user_id?: string | null }).creator_legacy_base44_user_id?.trim();

  if (playlist.creator_id === user.id ||
    playlist.creator_clerk_user_id === claims.userId ||
    Boolean(legacyUserId && legacyCreatorId && legacyUserId === legacyCreatorId)) {
    return true;
  }

  if (playlist.visibility !== "friends_only") {
    return false;
  }

  const followerScope = getSavedIdentityScope(user, claims.userId);
  const followingPredicates = ["following_id = ?"];
  const followingParams = [playlist.creator_id];

  if (playlist.creator_clerk_user_id) {
    followingPredicates.push("following_clerk_user_id = ?");
    followingParams.push(playlist.creator_clerk_user_id);
  }

  if (legacyCreatorId) {
    followingPredicates.push("following_legacy_base44_user_id = ?");
    followingParams.push(legacyCreatorId);
  }

  const follow = await env.DB.prepare(
    `SELECT id
     FROM follows
     WHERE status = 'accepted'
       AND (${followerScope.predicates.map((predicate) => predicate.replace(/^user_id/, "follower_id").replace(/^clerk_user_id/, "follower_clerk_user_id").replace(/^legacy_base44_user_id/, "follower_legacy_base44_user_id")).join(" OR ")})
       AND (${followingPredicates.join(" OR ")})
     LIMIT 1`,
  )
    .bind(...followerScope.params, ...followingParams)
    .first<{ id: string }>();

  return Boolean(follow);
}

async function togglePlaylistLikeResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const auth = await requireSavedContentUser(request, env);

  if (auth.response) {
    return auth.response;
  }

  const payload = await parsePlaylistLikePayload(request);
  const playlist = await env.DB.prepare(
    `SELECT id, creator_id, creator_clerk_user_id, creator_legacy_base44_user_id, visibility, rss_feeds
     FROM playlists
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(payload.playlistId)
    .first<PlaybackPlaylist & { creator_legacy_base44_user_id?: string | null }>();

  if (!playlist) {
    return jsonResponse(notFoundResponse, 404, corsHeaders);
  }

  if (!(await canLikePlaylist(env, playlist, auth.user!, auth.claims!))) {
    return jsonResponse(notFoundResponse, 404, corsHeaders);
  }

  const scope = getSavedIdentityScope(auth.user!, auth.claims!.userId);
  const existing = await env.DB.prepare(
    `SELECT id
     FROM playlist_likes
     WHERE playlist_id = ?
       AND (${scope.predicates.join(" OR ")})
     LIMIT 1`,
  )
    .bind(payload.playlistId, ...scope.params)
    .first<{ id: string }>();

  let liked = false;
  const updateCountStatement = env.DB.prepare(
    `UPDATE playlists
     SET likes_count = (
       SELECT COUNT(*)
       FROM playlist_likes
       WHERE playlist_id = ?
     ),
     updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).bind(payload.playlistId, payload.playlistId);

  if (existing) {
    const mutationStatement = env.DB.prepare(
      `DELETE FROM playlist_likes
       WHERE id = ?`,
    )
      .bind(existing.id);
    await env.DB.batch([mutationStatement, updateCountStatement]);
  } else {
    const mutationStatement = env.DB.prepare(
      `INSERT OR IGNORE INTO playlist_likes (
         id, playlist_id, user_id, clerk_user_id, legacy_base44_user_id, created_at
       )
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
      .bind(crypto.randomUUID(), payload.playlistId, auth.user!.id, auth.claims!.userId, scope.legacyUserId);
    await env.DB.batch([mutationStatement, updateCountStatement]);
    liked = true;
  }

  const countRow = await env.DB.prepare(
    `SELECT likes_count
     FROM playlists
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(payload.playlistId)
    .first<{ likes_count: number }>();
  const likesCount = Number(countRow?.likes_count || 0);

  return jsonResponse({ liked, likes_count: likesCount }, 200, corsHeaders);
}

async function podcastLikesResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const auth = await requireSavedContentUser(request, env);

  if (auth.response) {
    return auth.response;
  }

  const url = new URL(request.url);
  const rawFeedUrl = url.searchParams.get("feed_url");
  const scope = getSavedIdentityScope(auth.user!, auth.claims!.userId);
  const where = [`(${scope.predicates.join(" OR ")})`];
  const params = [...scope.params];

  if (rawFeedUrl) {
    const feedUrlCandidates = getSavedPodcastFeedUrlFilterCandidates(rawFeedUrl);
    where.push(`feed_url IN (${feedUrlCandidates.map(() => "?").join(", ")})`);
    params.push(...feedUrlCandidates);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, feed_url, podcast_title, podcast_author, podcast_image, podcast_description,
       created_at, updated_at, base44_created_date, base44_updated_date
     FROM podcast_likes
     WHERE ${where.join(" AND ")}
     ORDER BY datetime(COALESCE(NULLIF(TRIM(base44_created_date), ''), created_at)) DESC,
       created_at DESC,
       id DESC
     LIMIT ?`,
  )
    .bind(...params, parseSavedContentLimit(request))
    .all<D1PodcastLike>();
  const likes = (results || []).map(toPublicPodcastLike);

  return jsonResponse({ ok: true, items: likes, data: likes }, 200, corsHeaders);
}

async function fetchPodcastLikeByUserAndFeedUrl(env: Env, userId: string, feedUrlCandidates: string[]): Promise<D1PodcastLike | null> {
  return env.DB.prepare(
    `SELECT id, feed_url, podcast_title, podcast_author, podcast_image, podcast_description,
       created_at, updated_at, base44_created_date, base44_updated_date
     FROM podcast_likes
     WHERE user_id = ?
       AND feed_url IN (${feedUrlCandidates.map(() => "?").join(", ")})
     ORDER BY CASE WHEN feed_url = ? THEN 0 ELSE 1 END,
       created_at DESC,
       id DESC
     LIMIT 1`,
  )
    .bind(userId, ...feedUrlCandidates, feedUrlCandidates[0])
    .first<D1PodcastLike>();
}

async function createPodcastLikeResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const auth = await requireSavedContentUser(request, env);

  if (auth.response) {
    return auth.response;
  }

  const payload = await parsePodcastLikePayload(request);
  const scope = getSavedIdentityScope(auth.user!, auth.claims!.userId);
  const existing = await env.DB.prepare(
    `SELECT id
     FROM podcast_likes
     WHERE feed_url IN (${payload.feedUrlCandidates.map(() => "?").join(", ")})
       AND (${scope.predicates.join(" OR ")})
     LIMIT 1`,
  )
    .bind(...payload.feedUrlCandidates, ...scope.params)
    .first<{ id: string }>();
  const id = existing?.id || crypto.randomUUID();

  if (existing) {
    await env.DB.prepare(
      `UPDATE podcast_likes
       SET user_id = ?,
           clerk_user_id = ?,
           legacy_base44_user_id = ?,
           feed_url = ?,
           podcast_title = COALESCE(?, podcast_title),
           podcast_author = COALESCE(?, podcast_author),
           podcast_image = COALESCE(?, podcast_image),
           podcast_description = COALESCE(?, podcast_description),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(
        auth.user!.id,
        auth.claims!.userId,
        scope.legacyUserId,
        payload.feedUrl,
        payload.podcastTitle,
        payload.podcastAuthor,
        payload.podcastImage,
        payload.podcastDescription,
        id,
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO podcast_likes (
         id, user_id, clerk_user_id, legacy_base44_user_id, feed_url,
         podcast_title, podcast_author, podcast_image, podcast_description,
         created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, feed_url) DO UPDATE SET
         clerk_user_id = excluded.clerk_user_id,
         legacy_base44_user_id = excluded.legacy_base44_user_id,
         podcast_title = COALESCE(excluded.podcast_title, podcast_likes.podcast_title),
         podcast_author = COALESCE(excluded.podcast_author, podcast_likes.podcast_author),
         podcast_image = COALESCE(excluded.podcast_image, podcast_likes.podcast_image),
         podcast_description = COALESCE(excluded.podcast_description, podcast_likes.podcast_description),
         updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(
        id,
        auth.user!.id,
        auth.claims!.userId,
        scope.legacyUserId,
        payload.feedUrl,
        payload.podcastTitle,
        payload.podcastAuthor,
        payload.podcastImage,
        payload.podcastDescription,
      )
      .run();
  }

  const item = await fetchPodcastLikeByUserAndFeedUrl(env, auth.user!.id, payload.feedUrlCandidates);

  if (!item) {
    throw new PodcastPlayError(500, "internal-error", "Saved podcast unavailable");
  }

  const publicItem = toPublicPodcastLike(item);

  return jsonResponse({ ok: true, item: publicItem, data: publicItem }, 200, corsHeaders);
}

async function deletePodcastLikeResponse(request: Request, env: Env, id: string): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const auth = await requireSavedContentUser(request, env);

  if (auth.response) {
    return auth.response;
  }

  const scope = getSavedIdentityScope(auth.user!, auth.claims!.userId);
  const result = await env.DB.prepare(
    `DELETE FROM podcast_likes
     WHERE id = ?
       AND (${scope.predicates.join(" OR ")})`,
  )
    .bind(id, ...scope.params)
    .run();
  const changes = Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);

  if (changes === 0) {
    return jsonResponse(notFoundResponse, 404, corsHeaders);
  }

  return jsonResponse({ ok: true, deleted: true }, 200, corsHeaders);
}

async function blockListResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const auth = await requireSavedContentUser(request, env);

  if (auth.response) {
    return auth.response;
  }

  const limit = parseSavedContentLimit(request);
  const blockerScope = getBlockIdentityScope(auth.user!, "blocker");
  const { results } = await env.DB.prepare(
    `${blockListSelect}
     WHERE ${blockerScope.predicates.map((predicate) => `b.${predicate}`).join(" OR ")}
     ORDER BY datetime(COALESCE(NULLIF(TRIM(b.base44_created_date), ''), b.created_at)) DESC,
       b.created_at DESC, b.id DESC
     LIMIT ?`,
  )
    .bind(...blockerScope.params, limit)
    .all<D1Block>();
  const blocks = (results || []).map(toPublicBlock);

  return jsonResponse(
    {
      ok: true,
      data: blocks,
      items: blocks,
    },
    200,
    corsHeaders,
  );
}

async function parseBlockPayload(request: Request): Promise<{ blockedId: string }> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be valid JSON");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be a JSON object");
  }

  const blockedId = validateBoundedString((body as Record<string, unknown>).blocked_id, "blocked_id", 128, true);

  return { blockedId: blockedId! };
}

async function createBlockResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const auth = await requireSavedContentUser(request, env);

  if (auth.response) {
    return auth.response;
  }

  const payload = await parseBlockPayload(request);
  const targetUser = await env.DB.prepare(
    `SELECT id, clerk_user_id, legacy_base44_user_id, email, name, username, role,
      profile_picture, profile_hidden, imported_at, created_at, updated_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(payload.blockedId)
    .first<D1User>();

  if (!targetUser) {
    return jsonResponse(notFoundResponse, 404, corsHeaders);
  }

  const currentUser = auth.user!;

  if (targetUser.id === currentUser.id) {
    throw new PodcastPlayError(400, "invalid-request", "Cannot block yourself");
  }

  const blockerScope = getBlockIdentityScope(currentUser, "blocker");
  const existing = await env.DB.prepare(
    `SELECT id FROM blocks
     WHERE (${blockerScope.predicates.join(" OR ")})
       AND blocked_id = ?
     LIMIT 1`,
  )
    .bind(...blockerScope.params, targetUser.id)
    .first<{ id: string }>();
  const blockId = existing?.id || crypto.randomUUID();
  const currentIdentityValues = getBlockIdentityValues(currentUser);
  const targetIdentityValues = getBlockIdentityValues(targetUser);
  const currentAsFollower = getFollowUserPredicate("follower", currentIdentityValues);
  const targetAsFollowing = getFollowUserPredicate("following", targetIdentityValues);
  const targetAsFollower = getFollowUserPredicate("follower", targetIdentityValues);
  const currentAsFollowing = getFollowUserPredicate("following", currentIdentityValues);
  const deleteFollowsStatement = env.DB.prepare(
    `DELETE FROM follows
     WHERE (${currentAsFollower} AND ${targetAsFollowing})
        OR (${targetAsFollower} AND ${currentAsFollowing})`,
  )
    .bind(
      ...currentIdentityValues,
      ...currentIdentityValues,
      ...currentIdentityValues,
      ...targetIdentityValues,
      ...targetIdentityValues,
      ...targetIdentityValues,
      ...targetIdentityValues,
      ...targetIdentityValues,
      ...targetIdentityValues,
      ...currentIdentityValues,
      ...currentIdentityValues,
      ...currentIdentityValues,
    );

  if (!existing) {
    await env.DB.batch([
      env.DB.prepare(
      `INSERT INTO blocks (
         id, blocker_id, blocker_clerk_user_id, blocker_legacy_base44_user_id,
         blocked_id, blocked_clerk_user_id, blocked_legacy_base44_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(blocker_id, blocked_id) DO NOTHING`,
      )
        .bind(
        blockId,
        currentUser.id,
        auth.claims!.userId,
        currentUser.legacy_base44_user_id,
        targetUser.id,
        targetUser.clerk_user_id,
        targetUser.legacy_base44_user_id,
        ),
      deleteFollowsStatement,
    ]);
  } else {
    await env.DB.batch([deleteFollowsStatement]);
  }

  const block = await env.DB.prepare(
    `${blockListSelect}
     WHERE (${blockerScope.predicates.map((predicate) => `b.${predicate}`).join(" OR ")})
       AND b.blocked_id = ?
     LIMIT 1`,
  )
    .bind(...blockerScope.params, targetUser.id)
    .first<D1Block>();

  if (!block) {
    throw new Error("Block creation failed");
  }

  return jsonResponse(
    {
      ok: true,
      block: toPublicBlock(block),
    },
    200,
    corsHeaders,
  );
}

async function deleteBlockResponse(request: Request, env: Env, id: string): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const auth = await requireSavedContentUser(request, env);

  if (auth.response) {
    return auth.response;
  }

  const blockerScope = getBlockIdentityScope(auth.user!, "blocker");
  const result = await env.DB.prepare(
    `DELETE FROM blocks
     WHERE id = ?
       AND (${blockerScope.predicates.join(" OR ")})`,
  )
    .bind(id, ...blockerScope.params)
    .run();
  const changes = Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);

  if (changes === 0) {
    return jsonResponse(notFoundResponse, 404, corsHeaders);
  }

  return jsonResponse({ ok: true, deleted: true }, 200, corsHeaders);
}

async function blockStatusResponse(request: Request, env: Env, targetUserId: string): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const auth = await requireSavedContentUser(request, env);

  if (auth.response) {
    return auth.response;
  }

  const targetUser = await env.DB.prepare(
    `SELECT id, clerk_user_id, legacy_base44_user_id, email, name, username, role,
      profile_picture, profile_hidden, imported_at, created_at, updated_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(targetUserId)
    .first<D1User>();

  if (!targetUser) {
    return jsonResponse(notFoundResponse, 404, corsHeaders);
  }

  const currentUser = auth.user!;
  const currentAsBlocker = getBlockIdentityScope(currentUser, "blocker");
  const targetAsBlocked = getBlockIdentityScope(targetUser, "blocked");
  const targetAsBlocker = getBlockIdentityScope(targetUser, "blocker");
  const currentAsBlocked = getBlockIdentityScope(currentUser, "blocked");
  const outbound = await env.DB.prepare(
    `SELECT id FROM blocks
     WHERE (${currentAsBlocker.predicates.join(" OR ")})
       AND (${targetAsBlocked.predicates.join(" OR ")})
     LIMIT 1`,
  )
    .bind(...currentAsBlocker.params, ...targetAsBlocked.params)
    .first<{ id: string }>();
  const inbound = outbound ? null : await env.DB.prepare(
    `SELECT 1 AS found FROM blocks
     WHERE (${targetAsBlocker.predicates.join(" OR ")})
       AND (${currentAsBlocked.predicates.join(" OR ")})
     LIMIT 1`,
  )
    .bind(...targetAsBlocker.params, ...currentAsBlocked.params)
    .first<{ found: number }>();

  return jsonResponse(
    {
      ok: true,
      hidden: Boolean(outbound || inbound),
      can_unblock: Boolean(outbound),
      outbound_block_id: outbound?.id || null,
    },
    200,
    corsHeaders,
  );
}

async function hiddenBlockUsersResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const auth = await requireSavedContentUser(request, env);

  if (auth.response) {
    return auth.response;
  }

  const blockerScope = getBlockIdentityScope(auth.user!, "blocker");
  const blockedScope = getBlockIdentityScope(auth.user!, "blocked");
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT
       CASE
         WHEN ${blockerScope.predicates.map((predicate) => `b.${predicate}`).join(" OR ")}
         THEN b.blocked_id
         ELSE b.blocker_id
       END AS user_id
     FROM blocks b
     WHERE (${blockerScope.predicates.map((predicate) => `b.${predicate}`).join(" OR ")})
        OR (${blockedScope.predicates.map((predicate) => `b.${predicate}`).join(" OR ")})`,
  )
    .bind(...blockerScope.params, ...blockerScope.params, ...blockedScope.params)
    .all<{ user_id: string }>();
  const hiddenUserIds = [...new Set((results || []).map((row) => row.user_id).filter((userId) => userId && userId !== auth.user!.id))];

  return jsonResponse(
    {
      ok: true,
      user_ids: hiddenUserIds,
    },
    200,
    corsHeaders,
  );
}

async function playlistsResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const url = new URL(request.url);
  const creatorId = url.searchParams.get("creator_id");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);
  const sort = url.searchParams.get("sort") || "-created_date";
  const orderBy = sort === "-plays_count"
    ? "plays_count DESC, created_at DESC"
    : sort === "plays_count"
      ? "plays_count ASC, created_at DESC"
      : sort === "created_date" || sort === "created_at"
        ? "created_at ASC"
        : "created_at DESC";

  if (creatorId) {
    const claims = await getVerifiedClerkClaims(request, env);

    if (!claims) {
      return jsonResponse(unauthenticatedResponse, 401, corsHeaders);
    }

    const user = await getUserByClerkUserId(env, claims.userId);

    if (!user || user.id !== creatorId) {
      return jsonResponse({ ok: false, error: "Forbidden" }, 403, corsHeaders);
    }

    const { results } = await env.DB.prepare(
      `${playlistSelect}
       WHERE creator_id = ?
       ORDER BY ${orderBy}
       LIMIT ?`,
    )
      .bind(creatorId, limit)
      .all<D1Playlist>();

    return jsonResponse(
      {
        ok: true,
        playlists: results.map(toPublicPlaylist),
      },
      200,
      corsHeaders,
    );
  }

  const { results } = await env.DB.prepare(
    `${playlistSelect}
     WHERE visibility = 'public'
     ORDER BY ${orderBy}
     LIMIT ?`,
  )
    .bind(limit)
    .all<D1Playlist>();

  return jsonResponse(
    {
      ok: true,
      playlists: results.map(toPublicPlaylist),
    },
    200,
    corsHeaders,
  );
}

async function updatePlaylistResponse(request: Request, env: Env, playlistId: string): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const claims = await getVerifiedClerkClaims(request, env);

  if (!claims) {
    return jsonResponse(unauthenticatedResponse, 401, corsHeaders);
  }

  const user = await resolveD1UserFromClerkClaims(env, claims);

  if (!user) {
    return jsonResponse({ ok: false, error: "User bootstrap failed" }, 500, corsHeaders);
  }

  const payload = await parsePlaylistUpdatePayload(request);
  const playlist = await env.DB.prepare(
    `${playlistSelect}
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(playlistId)
    .first<D1Playlist>();

  if (!playlist) {
    return jsonResponse(notFoundResponse, 404, corsHeaders);
  }

  if (!isPlaylistOwner(playlist, user, claims)) {
    return jsonResponse({ ok: false, error: "Forbidden" }, 403, corsHeaders);
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (payload.name !== undefined) {
    updates.push("title = ?");
    params.push(payload.name);
  }

  if (payload.description !== undefined) {
    updates.push("description = ?");
    params.push(payload.description);
  }

  if (payload.max_duration !== undefined) {
    updates.push("max_duration = ?");
    params.push(payload.max_duration);
  }

  if (payload.time_filter_hours !== undefined) {
    updates.push("time_filter_hours = ?");
    params.push(payload.time_filter_hours);
  }

  if (payload.episodes_sort_order !== undefined) {
    updates.push("episodes_sort_order = ?");
    params.push(payload.episodes_sort_order);
  }

  if (payload.rss_feeds !== undefined) {
    updates.push("rss_feeds = ?");
    params.push(JSON.stringify(payload.rss_feeds));
  }

  if (payload.cover_image !== undefined) {
    updates.push("cover_image = ?");
    params.push(payload.cover_image);
  }

  if (payload.visibility !== undefined) {
    updates.push("visibility = ?");
    params.push(payload.visibility);
  }

  if (updates.length > 0) {
    updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
    const ownerPredicate = getPlaylistOwnerUpdatePredicate(user, claims);
    const result = await env.DB.prepare(
      `UPDATE playlists
       SET ${updates.join(", ")}
       WHERE id = ? AND ${ownerPredicate.sql}`,
    )
      .bind(...params, playlistId, ...ownerPredicate.params)
      .run();
    const changes = Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);

    if (changes === 0) {
      return jsonResponse({ ok: false, error: "Playlist was not updated" }, 409, corsHeaders);
    }
  }

  const updatedPlaylist = await env.DB.prepare(
    `${playlistSelect}
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(playlistId)
    .first<D1Playlist>();

  if (!updatedPlaylist) {
    return jsonResponse(notFoundResponse, 404, corsHeaders);
  }

  return jsonResponse(
    {
      ok: true,
      playlist: toPublicPlaylist(updatedPlaylist),
    },
    200,
    corsHeaders,
  );
}

async function followsResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const claims = await getVerifiedClerkClaims(request, env);

  if (!claims) {
    return jsonResponse(unauthenticatedResponse, 401, corsHeaders);
  }

  const currentUser = await getUserByClerkUserId(env, claims.userId);

  if (!currentUser) {
    return jsonResponse({ ok: false, error: "User not found" }, 403, corsHeaders);
  }

  const url = new URL(request.url);
  const followerId = url.searchParams.get("follower_id");
  const followingId = url.searchParams.get("following_id");
  const status = url.searchParams.get("status");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 100);
  const allowedUserIds = new Set([
    currentUser.id,
    currentUser.clerk_user_id,
    currentUser.legacy_base44_user_id,
  ].filter((value): value is string => Boolean(value)));
  const queryInvolvesCurrentUser =
    (followerId !== null && allowedUserIds.has(followerId)) ||
    (followingId !== null && allowedUserIds.has(followingId));

  if (currentUser.role !== "admin" && !queryInvolvesCurrentUser) {
    return jsonResponse({ ok: false, error: "Forbidden" }, 403, corsHeaders);
  }

  const where: string[] = [];
  const params: string[] = [];

  if (followerId) {
    where.push("follower_id = ?");
    params.push(followerId);
  }

  if (followingId) {
    where.push("following_id = ?");
    params.push(followingId);
  }

  if (status) {
    where.push("status = ?");
    params.push(status);
  }

  const sql = `${followSelect}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC
    LIMIT ?`;
  const { results } = await env.DB.prepare(sql)
    .bind(...params, limit)
    .all<D1Follow>();
  const follows = (results || []).map(toPublicFollow);

  return jsonResponse(
    {
      ok: true,
      data: follows,
      items: follows,
    },
    200,
    corsHeaders,
  );
}

async function handleRequestFollow(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const auth = await requireSavedContentUser(request, env);

  if (auth.response) {
    return auth.response;
  }

  const { targetUserId } = await parseTargetUserPayload(request);
  const follower = auth.user!;

  if (targetUserId === follower.id) {
    throw new PodcastPlayError(400, "invalid-request", "Cannot follow yourself");
  }

  const target = await getUserById(env, targetUserId);

  if (!target) {
    return jsonResponse(notFoundResponse, 404, corsHeaders);
  }

  const existing = await env.DB.prepare(
    `${followSelect}
     WHERE follower_id = ?
       AND following_id = ?
     LIMIT 1`,
  )
    .bind(follower.id, target.id)
    .first<D1Follow>();

  if (existing) {
    const publicFollow = toPublicFollow(existing);
    return jsonResponse({ ok: true, data: publicFollow, item: publicFollow }, 200, corsHeaders);
  }

  const followId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO follows (
       id, follower_id, follower_clerk_user_id, follower_legacy_base44_user_id,
       follower_email, follower_name, follower_username,
       following_id, following_clerk_user_id, following_legacy_base44_user_id,
       following_email, following_name, following_username, status, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  )
    .bind(
      followId,
      follower.id,
      auth.claims!.userId,
      follower.legacy_base44_user_id,
      follower.email,
      follower.name,
      follower.username,
      target.id,
      target.clerk_user_id,
      target.legacy_base44_user_id,
      target.email,
      target.name,
      target.username,
    )
    .run();

  const follow = await env.DB.prepare(
    `${followSelect}
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(followId)
    .first<D1Follow>();

  if (!follow) {
    throw new PodcastPlayError(500, "internal-error", "Follow request unavailable");
  }

  const publicFollow = toPublicFollow(follow);
  return jsonResponse({ ok: true, data: publicFollow, item: publicFollow }, 201, corsHeaders);
}

async function handleCancelFollowRequest(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const auth = await requireSavedContentUser(request, env);

  if (auth.response) {
    return auth.response;
  }

  const { targetUserId } = await parseTargetUserPayload(request);
  const result = await env.DB.prepare(
    `DELETE FROM follows
     WHERE follower_id = ?
       AND following_id = ?`,
  )
    .bind(auth.user!.id, targetUserId)
    .run();
  const changes = Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);

  return jsonResponse(
    {
      ok: true,
      data: {
        deleted: changes > 0,
      },
    },
    200,
    corsHeaders,
  );
}

async function playlistResponse(request: Request, env: Env, playlistId: string): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const playlist = await env.DB.prepare(
    `${playlistSelect}
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(playlistId)
    .first<D1Playlist>();

  if (!playlist) {
    return jsonResponse(notFoundResponse, 404, corsHeaders);
  }

  if (playlist.visibility !== "public") {
    const claims = await getOptionalVerifiedClerkClaims(request, env);

    if (!claims) {
      return jsonResponse(notFoundResponse, 404, corsHeaders);
    }

    const user = await resolveD1UserFromClerkClaims(env, claims);

    if (!user || !(await canLikePlaylist(env, playlist as D1Playlist & PlaybackPlaylist, user, claims))) {
      return jsonResponse(notFoundResponse, 404, corsHeaders);
    }
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

type PodcastPlayRequest = {
  eventId: string;
  playlistId: string | null;
  feedUrl: string;
  podcastTitle: string | null;
  podcastImage: string | null;
  audioUrl: string;
  episodeTitle: string | null;
};

type PlaybackPlaylist = {
  id: string;
  creator_id: string;
  creator_clerk_user_id: string | null;
  visibility: string;
  rss_feeds: string | null;
};

type PublicPodcastPlay = {
  id: string;
  playlist_id: string | null;
  feed_url: string | null;
  podcast_title: string | null;
  podcast_image: string | null;
  audio_url: string | null;
  episode_title: string | null;
  played_at: string | null;
  created_at: string;
};

function parsePodcastPlayHistoryLimit(request: Request): number {
  const value = new URL(request.url).searchParams.get("limit");
  const parsed = Number(value);

  if (!value || !Number.isFinite(parsed)) {
    return 100;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}

function validateBoundedString(value: unknown, fieldName: string, maxLength: number, required = false): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new PodcastPlayError(400, "invalid-request", `${fieldName} is required`);
    }

    return null;
  }

  if (typeof value !== "string") {
    throw new PodcastPlayError(400, "invalid-request", `${fieldName} must be a string`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    if (required) {
      throw new PodcastPlayError(400, "invalid-request", `${fieldName} is required`);
    }

    return null;
  }

  if (trimmed.length > maxLength) {
    throw new PodcastPlayError(400, "invalid-request", `${fieldName} is too long`);
  }

  return trimmed;
}

function validateClientEventId(value: unknown): string {
  const eventId = validateBoundedString(value, "event_id", 128, true);

  if (!eventId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
    throw new PodcastPlayError(400, "invalid-request", "event_id must be a valid UUID");
  }

  return eventId;
}

function validateAbsoluteHttpUrl(value: unknown, fieldName: string, required = true): string | null {
  const rawUrl = validateBoundedString(value, fieldName, 2048, required);

  if (!rawUrl) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new PodcastPlayError(400, "invalid-request", `${fieldName} must be a valid absolute HTTP or HTTPS URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PodcastPlayError(400, "invalid-request", `${fieldName} must use HTTP or HTTPS`);
  }

  parsed.hash = "";
  return parsed.toString();
}

function normalizePlaybackFeedUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function getConfiguredPlaylistFeedUrl(feed: unknown): string | null {
  if (typeof feed === "string") {
    return normalizePlaybackFeedUrl(feed);
  }

  if (!feed || typeof feed !== "object") {
    return null;
  }

  const value = (feed as { url?: unknown; feed_url?: unknown }).url ?? (feed as { feed_url?: unknown }).feed_url;
  return typeof value === "string" ? normalizePlaybackFeedUrl(value) : null;
}

async function parsePodcastPlayRequest(request: Request): Promise<PodcastPlayRequest> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be valid JSON");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new PodcastPlayError(400, "invalid-request", "Request body must be a JSON object");
  }

  const payload = body as Record<string, unknown>;

  return {
    eventId: validateClientEventId(payload.event_id),
    playlistId: validateBoundedString(payload.playlist_id, "playlist_id", 128),
    feedUrl: validateAbsoluteHttpUrl(payload.feed_url, "feed_url", true) || "",
    podcastTitle: validateBoundedString(payload.podcast_title, "podcast_title", 500),
    podcastImage: validateAbsoluteHttpUrl(payload.podcast_image, "podcast_image", false),
    audioUrl: validateAbsoluteHttpUrl(payload.audio_url, "audio_url", true) || "",
    episodeTitle: validateBoundedString(payload.episode_title, "episode_title", 500),
  };
}

async function validatePlaybackPlaylist(env: Env, playlistId: string, feedUrl: string, user: D1User | null): Promise<void> {
  const playlist = await env.DB.prepare(
    `SELECT id, creator_id, creator_clerk_user_id, visibility, rss_feeds
     FROM playlists
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(playlistId)
    .first<PlaybackPlaylist>();

  if (!playlist) {
    throw new PodcastPlayError(400, "invalid-playlist", "Invalid playlist");
  }

  const hasAccess = playlist.visibility === "public" ||
    Boolean(user && (playlist.creator_id === user.id || playlist.creator_clerk_user_id === user.clerk_user_id));

  if (!hasAccess) {
    throw new PodcastPlayError(400, "invalid-playlist", "Invalid playlist");
  }

  const suppliedFeedUrl = normalizePlaybackFeedUrl(feedUrl);
  const configuredFeedUrls = new Set(
    parseRssFeeds(playlist.rss_feeds)
      .map(getConfiguredPlaylistFeedUrl)
      .filter((value): value is string => Boolean(value)),
  );

  if (!suppliedFeedUrl || !configuredFeedUrls.has(suppliedFeedUrl)) {
    throw new PodcastPlayError(400, "invalid-playlist", "Invalid playlist");
  }
}

async function podcastPlayResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const claims = await getOptionalVerifiedClerkClaims(request, env);
  const payload = await parsePodcastPlayRequest(request);
  const user = claims ? await resolveD1UserFromClerkClaims(env, claims) : null;

  if (claims && !user) {
    throw new PodcastPlayError(500, "internal-error", "User bootstrap failed");
  }

  if (payload.playlistId) {
    await validatePlaybackPlaylist(env, payload.playlistId, payload.feedUrl, user);
  }

  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO podcast_plays (
       id, client_event_id, user_id, clerk_user_id, playlist_id, feed_url,
       podcast_title, podcast_image, audio_url, episode_title, played_at,
       created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  )
    .bind(
      crypto.randomUUID(),
      payload.eventId,
      user?.id || null,
      claims?.userId || null,
      payload.playlistId,
      payload.feedUrl,
      payload.podcastTitle,
      payload.podcastImage,
      payload.audioUrl,
      payload.episodeTitle,
    )
    .run();
  const changes = Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);

  return jsonResponse(
    {
      ok: true,
      recorded: true,
      duplicate: changes === 0,
    },
    200,
    corsHeaders,
  );
}

async function podcastPlayHistoryResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const claims = await getVerifiedClerkClaims(request, env);

  if (!claims) {
    return jsonResponse(unauthenticatedResponse, 401, corsHeaders);
  }

  const user = await resolveD1UserFromClerkClaims(env, claims);

  if (!user) {
    throw new PodcastPlayError(500, "internal-error", "User bootstrap failed");
  }

  const identityPredicates = ["user_id = ?", "clerk_user_id = ?"];
  const identityParams = [user.id, claims.userId];
  const legacyUserId = user.legacy_base44_user_id?.trim();

  if (legacyUserId) {
    identityPredicates.push("legacy_base44_user_id = ?");
    identityParams.push(legacyUserId);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, playlist_id, feed_url, podcast_title, podcast_image, audio_url,
       episode_title, played_at, created_at
     FROM podcast_plays
     WHERE ${identityPredicates.join(" OR ")}
     ORDER BY datetime(COALESCE(NULLIF(TRIM(played_at), ''), created_at)) DESC,
       created_at DESC,
       id DESC
     LIMIT ?`,
  )
    .bind(...identityParams, parsePodcastPlayHistoryLimit(request))
    .all<PublicPodcastPlay>();
  const plays = results || [];

  return jsonResponse(
    {
      ok: true,
      items: plays,
      data: plays,
    },
    200,
    corsHeaders,
  );
}

type TopPodcast = {
  feedUrl: string;
  title: string | null;
  author: string | null;
  image: string | null;
  description: string | null;
  playCount: number;
};

function getFeedUrl(feed: unknown): string | null {
  if (!feed || typeof feed !== "object") {
    return null;
  }

  const value = (feed as { url?: unknown; feed_url?: unknown }).url ?? (feed as { feed_url?: unknown }).feed_url;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toTopPodcast(feed: unknown, playCount: number): TopPodcast | null {
  const feedUrl = getFeedUrl(feed);

  if (!feedUrl || !feed || typeof feed !== "object") {
    return null;
  }

  const typedFeed = feed as {
    title?: unknown;
    author?: unknown;
    image?: unknown;
    description?: unknown;
  };

  return {
    feedUrl,
    title: typeof typedFeed.title === "string" ? typedFeed.title : null,
    author: typeof typedFeed.author === "string" ? typedFeed.author : null,
    image: typeof typedFeed.image === "string" ? typedFeed.image : null,
    description: typeof typedFeed.description === "string" ? typedFeed.description : null,
    playCount,
  };
}

async function topPodcastsByPlaybackResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const playlistRows = await env.DB.prepare(
    `SELECT rss_feeds
     FROM playlists
     WHERE visibility = 'public'
     LIMIT 1000`,
  ).all<{ rss_feeds: string | null }>();
  const playRows = await env.DB.prepare(
    `SELECT pp.feed_url AS feed_url, COUNT(*) AS play_count
     FROM podcast_plays pp
     INNER JOIN playlists p ON p.id = pp.playlist_id
     WHERE p.visibility = 'public'
       AND pp.feed_url IS NOT NULL
     GROUP BY pp.feed_url`,
  ).all<{ feed_url: string; play_count: number }>();
  const playsByFeedUrl = new Map<string, number>();

  for (const row of playRows.results || []) {
    playsByFeedUrl.set(row.feed_url, Number(row.play_count) || 0);
  }

  const podcastsByFeedUrl = new Map<string, TopPodcast>();

  for (const row of playlistRows.results || []) {
    for (const feed of parseRssFeeds(row.rss_feeds)) {
      const feedUrl = getFeedUrl(feed);

      if (!feedUrl || podcastsByFeedUrl.has(feedUrl)) {
        continue;
      }

      const podcast = toTopPodcast(feed, playsByFeedUrl.get(feedUrl) || 0);

      if (podcast) {
        podcastsByFeedUrl.set(feedUrl, podcast);
      }
    }
  }

  const podcasts = [...podcastsByFeedUrl.values()]
    .sort((left, right) => right.playCount - left.playCount)
    .slice(0, 50);

  return jsonResponse(
    {
      ok: true,
      podcasts,
    },
    200,
    corsHeaders,
  );
}

async function topPlaylistsByPlaybackResponse(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const { results } = await env.DB.prepare(
    `${rankedPlaylistSelect},
       COUNT(pp.id) AS recent_plays_count
     FROM playlists p
     LEFT JOIN podcast_plays pp
       ON pp.playlist_id = p.id
      AND datetime(COALESCE(NULLIF(TRIM(pp.played_at), ''), pp.created_at)) >= datetime('now', '-7 days')
     WHERE p.visibility = 'public'
     GROUP BY p.id, p.legacy_base44_playlist_id, p.creator_id, p.creator_clerk_user_id,
       p.creator_legacy_base44_user_id, p.title, p.description, p.cover_image, p.visibility,
       p.rss_feeds, p.max_duration, p.time_filter_hours, p.episodes_sort_order, p.likes_count,
       p.plays_count, p.creator_username, p.creator_picture, p.creator_hidden, p.created_at, p.updated_at
     ORDER BY recent_plays_count DESC, p.plays_count DESC, p.likes_count DESC,
       p.updated_at DESC, p.id ASC
     LIMIT 50`,
  ).all<D1RankedPlaylist>();

  return jsonResponse(
    {
      ok: true,
      playlists: (results || []).map(toRankedPublicPlaylist),
    },
    200,
    corsHeaders,
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const { pathname } = new URL(request.url);

      if (request.method === "OPTIONS") {
        return optionsResponse(request, env);
      }

      if ((request.method === "GET" || request.method === "HEAD") && (pathname === "/health" || pathname === "/api/health")) {
        return withCors(healthCheckResponse(request), request, env);
      }

      if (request.method === "GET" && (pathname === "/diagnostics" || pathname === "/api/diagnostics")) {
        if (!isDiagnosticsAuthorized(request, env)) {
          return withCors(jsonResponse(unauthorizedResponse, 401), request, env);
        }

        return withCors(await diagnosticsResponse(env), request, env);
      }

      if (request.method === "GET" && (pathname === "/clerk/diagnostics" || pathname === "/api/clerk/diagnostics")) {
        if (!isDiagnosticsAuthorized(request, env)) {
          return withCors(jsonResponse(unauthorizedResponse, 401), request, env);
        }

        return withCors(await clerkDiagnosticsResponse(env), request, env);
      }

      if (request.method === "GET" && isAuthDiagnosticsRoute(pathname)) {
        return withCors(await authDiagnosticsResponse(request, env), request, env);
      }

      if (request.method === "GET" && isMeRoute(pathname)) {
        return withCors(await meResponse(request, env), request, env);
      }

      if (request.method === "PATCH" && isMeRoute(pathname)) {
        return withCors(await updateMeResponse(request, env), request, env);
      }

      if (request.method === "GET" && (isPlaylistsRoute(pathname) || isEntityPlaylistRoute(pathname))) {
        return withCors(await playlistsResponse(request, env), request, env);
      }

      if (request.method === "GET" && isEntityFollowRoute(pathname)) {
        return withCors(await followsResponse(request, env), request, env);
      }

      if (request.method === "GET" && isBlocksRoute(pathname)) {
        return withCors(await blockListResponse(request, env), request, env);
      }

      if (request.method === "POST" && isBlocksRoute(pathname)) {
        return withCors(await createBlockResponse(request, env), request, env);
      }

      if (request.method === "GET" && isHiddenBlockUsersRoute(pathname)) {
        return withCors(await hiddenBlockUsersResponse(request, env), request, env);
      }

      const blockStatusTargetId = getBlockStatusTargetId(pathname);

      if (request.method === "GET" && blockStatusTargetId) {
        return withCors(await blockStatusResponse(request, env, blockStatusTargetId), request, env);
      }

      if ((request.method === "GET" || request.method === "POST") && isTopPodcastsRoute(pathname)) {
        return withCors(await topPodcastsByPlaybackResponse(request, env), request, env);
      }

      if ((request.method === "GET" && isTopPlaylistsDiscoveryRoute(pathname)) ||
        (request.method === "POST" && isTopPlaylistsLegacyRoute(pathname))) {
        return withCors(await topPlaylistsByPlaybackResponse(request, env), request, env);
      }

      if (request.method === "POST" && isSearchUsersRoute(pathname)) {
        return withCors(await handleSearchUsers(request, env), request, env);
      }

      if (request.method === "POST" && isGetPublicUserProfileRoute(pathname)) {
        return withCors(await handleGetPublicUserProfile(request, env), request, env);
      }

      if (request.method === "POST" && isGetUserPlaylistsRoute(pathname)) {
        return withCors(await handleGetUserPlaylists(request, env), request, env);
      }

      if (request.method === "POST" && isFileUploadRoute(pathname)) {
        return withCors(await handleFileUpload(request, env), request, env);
      }

      if (request.method === "POST" && isPodcastSearchRoute(pathname)) {
        return withCors(await podcastSearchResponse(request, env), request, env);
      }

      if (request.method === "POST" && isRssFetchRoute(pathname)) {
        return withCors(await rssFetchResponse(request, env), request, env);
      }

      if (request.method === "POST" && isPodcastPlayRoute(pathname)) {
        return withCors(await podcastPlayResponse(request, env), request, env);
      }

      if (request.method === "GET" && isPodcastPlayHistoryRoute(pathname)) {
        return withCors(await podcastPlayHistoryResponse(request, env), request, env);
      }

      if (request.method === "GET" && isPlaylistLikeRoute(pathname)) {
        return withCors(await playlistLikesResponse(request, env), request, env);
      }

      if (request.method === "POST" && isTogglePlaylistLikeRoute(pathname)) {
        return withCors(await togglePlaylistLikeResponse(request, env), request, env);
      }

      if (request.method === "POST" && isRequestFollowRoute(pathname)) {
        return withCors(await handleRequestFollow(request, env), request, env);
      }

      if (request.method === "POST" && isCancelFollowRequestRoute(pathname)) {
        return withCors(await handleCancelFollowRequest(request, env), request, env);
      }

      if (request.method === "GET" && isPodcastLikeRoute(pathname)) {
        return withCors(await podcastLikesResponse(request, env), request, env);
      }

      if (request.method === "POST" && isPodcastLikeRoute(pathname)) {
        return withCors(await createPodcastLikeResponse(request, env), request, env);
      }

      if (request.method === "GET" && isEpisodeProgressRoute(pathname)) {
        return withCors(await episodeProgressResponse(request, env), request, env);
      }

      if (request.method === "POST" && isEpisodeProgressRoute(pathname)) {
        return withCors(await createEpisodeProgressResponse(request, env), request, env);
      }

      const podcastLikeId = getPodcastLikeId(pathname);

      if (request.method === "DELETE" && podcastLikeId) {
        return withCors(await deletePodcastLikeResponse(request, env, podcastLikeId), request, env);
      }

      const episodeProgressId = getEpisodeProgressId(pathname);

      if (request.method === "PATCH" && episodeProgressId) {
        return withCors(await updateEpisodeProgressResponse(request, env, episodeProgressId), request, env);
      }

      if (request.method === "DELETE" && episodeProgressId) {
        return withCors(await deleteEpisodeProgressResponse(request, env, episodeProgressId), request, env);
      }

      const blockId = getBlockId(pathname);

      if (request.method === "DELETE" && blockId) {
        return withCors(await deleteBlockResponse(request, env, blockId), request, env);
      }

      const playlistId = getPlaylistId(pathname);

      if (request.method === "GET" && playlistId) {
        return withCors(await playlistResponse(request, env, playlistId), request, env);
      }

      if (request.method === "PATCH" && playlistId) {
        return withCors(await updatePlaylistResponse(request, env, playlistId), request, env);
      }

      return withCors(jsonResponse(notFoundResponse, 404), request, env);
    } catch (error) {
      if (error instanceof PodcastSearchError) {
        return withCors(podcastSearchErrorResponse(error, request, env), request, env);
      }

      if (error instanceof RssFetchError) {
        return withCors(rssFetchErrorResponse(error, request, env), request, env);
      }

      if (error instanceof PodcastPlayError) {
        return withCors(podcastPlayErrorResponse(error, request, env), request, env);
      }

      console.error("Unhandled Worker error", error instanceof Error ? error.message : error);
      return withCors(
        jsonResponse(
          {
            ok: false,
            error: "Internal server error",
          },
          500,
        ),
        request,
        env,
      );
    }
  },
};
