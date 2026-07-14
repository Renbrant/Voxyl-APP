import { verifyToken } from "@clerk/backend";
import { XMLParser, XMLValidator } from "fast-xml-parser";

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
const RSS_FETCH_MAX_BYTES = 2 * 1024 * 1024;
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

function isTopPodcastsRoute(pathname: string): boolean {
  return pathname === "/functions/getTopPodcastsByPlayback" || pathname === "/api/functions/getTopPodcastsByPlayback";
}

function isPodcastSearchRoute(pathname: string): boolean {
  return pathname === "/api/functions/searchPodcasts" || pathname === "/api/podcasts/search";
}

function isRssFetchRoute(pathname: string): boolean {
  return pathname === "/api/functions/fetchRSSFeed" || pathname === "/functions/fetchRSSFeed" || pathname === "/api/rss/fetch";
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

function isPrivateIpv6(value: bigint): boolean {
  return value === 0n ||
    value === 1n ||
    (value >> 120n) === 0xffn ||
    (value >> 121n) === 0b1111110n ||
    (value >> 122n) === 0b1111111010n ||
    (value >> 112n) === 0x64ff9bn ||
    (value >> 32n) === 0xffffn;
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

  if (ipv6Hostname.includes(":") &&
      (ipv6Hostname === "::" ||
       ipv6Hostname === "::1" ||
       ipv6Hostname.startsWith("fc") ||
       ipv6Hostname.startsWith("fd") ||
       ipv6Hostname.startsWith("fe80:") ||
       ipv6Hostname.startsWith("ff"))) {
    throw new RssFetchError(403, "unsafe-feed-url", "Feed URL host is not public");
  }

  const ipv6 = parseIpv6Literal(hostname);

  if (ipv6 !== null && isPrivateIpv6(ipv6)) {
    throw new RssFetchError(403, "unsafe-feed-url", "Feed URL host is not public");
  }

  if (ipv6Hostname.includes(":") && ipv6 === null) {
    throw new RssFetchError(403, "unsafe-feed-url", "Feed URL host is not allowed");
  }

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

function getRssAudioUrl(item: Record<string, unknown>, baseUrl: string): string {
  for (const enclosure of asArray(item.enclosure)) {
    const url = attr(enclosure, "url");

    if (url) {
      return absolutePublicUrl(url, baseUrl);
    }
  }

  for (const media of asArray(item["media:content"])) {
    const url = attr(media, "url");
    const type = attr(media, "type").toLowerCase();
    const medium = attr(media, "medium").toLowerCase();

    if (url && (type.startsWith("audio/") || medium === "audio" || /\.(mp3|m4a|aac|ogg|opus|wav)(\?|$)/i.test(url))) {
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

    if (href && rel === "enclosure" && (type.startsWith("audio/") || /\.(mp3|m4a|aac|ogg|opus|wav)(\?|$)/i.test(href))) {
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

function normalizeRssItem(item: Record<string, unknown>, feed: Omit<NormalizedFeed, "items">): NormalizedEpisode | null {
  const audioUrl = getRssAudioUrl(item, feed.feedUrl);

  if (!audioUrl) {
    return null;
  }

  const guid = firstText(item.guid);
  const link = absolutePublicUrl(item.link, feed.feedUrl);
  const image = absolutePublicUrl(firstImage(item["itunes:image"], item["media:thumbnail"], item["media:content"]), feed.feedUrl) || feed.image;

  return {
    id: stableEpisodeId(guid, audioUrl, link, firstText(item.title)),
    guid,
    title: firstText(item.title) || "Untitled episode",
    description: htmlToText(item["content:encoded"] ?? item.description ?? item.summary),
    audioUrl,
    link,
    pubDate: firstText(item.pubDate, item["dc:date"]),
    duration: firstText(item["itunes:duration"], item.duration),
    image,
    author: firstText(item["itunes:author"], item.author, item["dc:creator"], feed.author),
    feedTitle: feed.title,
    feedUrl: feed.feedUrl,
  };
}

function normalizeAtomItem(entry: Record<string, unknown>, feed: Omit<NormalizedFeed, "items">): NormalizedEpisode | null {
  const audioUrl = getAtomAudioUrl(entry, feed.feedUrl);

  if (!audioUrl) {
    return null;
  }

  const guid = firstText(entry.id);
  const link = getAtomAlternateLink(entry, feed.feedUrl);
  const image = absolutePublicUrl(firstImage(entry["itunes:image"], entry["media:thumbnail"], entry["media:content"]), feed.feedUrl) || feed.image;

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
    author: firstText(entry.author, feed.author),
    feedTitle: feed.title,
    feedUrl: feed.feedUrl,
  };
}

function parseNormalizedFeed(xml: string, feedUrl: string): NormalizedFeed {
  let parsed: unknown;

  try {
    const validation = XMLValidator.validate(xml, { allowBooleanAttributes: true });

    if (validation !== true) {
      throw new Error("Invalid XML");
    }

    parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      cdataPropName: "#cdata",
      processEntities: true,
      htmlEntities: true,
      trimValues: true,
      parseTagValue: false,
      parseAttributeValue: false,
      allowBooleanAttributes: true,
    }).parse(xml);
  } catch {
    throw new RssFetchError(422, "invalid-feed-xml", "Feed XML is invalid or unsupported");
  }

  if (!isRecord(parsed)) {
    throw new RssFetchError(422, "invalid-feed-xml", "Feed XML is invalid or unsupported");
  }

  const rssChannel = isRecord(parsed.rss) && isRecord(parsed.rss.channel) ? parsed.rss.channel : null;
  const rdfChannel = isRecord(parsed["rdf:RDF"]) && isRecord(parsed["rdf:RDF"].channel) ? parsed["rdf:RDF"].channel : null;
  const atomFeed = isRecord(parsed.feed) ? parsed.feed : null;

  if (rssChannel || rdfChannel) {
    const channel = (rssChannel || rdfChannel) as Record<string, unknown>;
    const feedImage = absolutePublicUrl(firstImage(channel["itunes:image"], isRecord(channel.image) ? channel.image.url : undefined), feedUrl);
    const feed: Omit<NormalizedFeed, "items"> = {
      title: firstText(channel.title),
      description: htmlToText(channel.description),
      image: feedImage,
      author: firstText(channel["itunes:author"], channel["dc:creator"], channel.managingEditor),
      feedUrl,
      link: absolutePublicUrl(channel.link, feedUrl),
    };
    const sourceItems = rssChannel ? asArray(channel.item) : asArray((parsed["rdf:RDF"] as Record<string, unknown>).item);
    const items = sourceItems
      .filter(isRecord)
      .map((item) => normalizeRssItem(item, feed))
      .filter((item): item is NormalizedEpisode => item !== null);

    if (!feed.title && items.length === 0) {
      throw new RssFetchError(422, "invalid-feed-xml", "Feed XML is invalid or unsupported");
    }

    return { ...feed, items };
  }

  if (atomFeed) {
    const feedImage = absolutePublicUrl(firstImage(atomFeed["itunes:image"], atomFeed.logo, atomFeed.icon), feedUrl);
    const feed: Omit<NormalizedFeed, "items"> = {
      title: firstText(atomFeed.title),
      description: htmlToText(atomFeed.subtitle),
      image: feedImage,
      author: firstText(atomFeed.author),
      feedUrl,
      link: getAtomAlternateLink(atomFeed, feedUrl),
    };
    const items = asArray(atomFeed.entry)
      .filter(isRecord)
      .map((entry) => normalizeAtomItem(entry, feed))
      .filter((item): item is NormalizedEpisode => item !== null);

    if (!feed.title && items.length === 0) {
      throw new RssFetchError(422, "invalid-feed-xml", "Feed XML is invalid or unsupported");
    }

    return { ...feed, items };
  }

  throw new RssFetchError(422, "invalid-feed-xml", "Feed XML is invalid or unsupported");
}

function cloneFeedWithCount(feed: NormalizedFeed, count: number): NormalizedFeed {
  return {
    ...feed,
    items: feed.items.slice(0, count),
  };
}

async function readResponseBodyLimited(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");

  if (contentLength && Number(contentLength) > RSS_FETCH_MAX_BYTES) {
    throw new RssFetchError(413, "feed-too-large", "Feed response is too large");
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (value) {
        total += value.byteLength;

        if (total > RSS_FETCH_MAX_BYTES) {
          throw new RssFetchError(413, "feed-too-large", "Feed response is too large");
        }

        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(body);
}

async function fetchFeedXml(initialUrl: string): Promise<{ xml: string; finalUrl: string }> {
  let currentUrl = validatePublicFeedUrl(initialUrl);
  const visited = new Set<string>();

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
        signal: AbortSignal.timeout(RSS_FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
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
      xml: await readResponseBodyLimited(response),
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
  const cacheKey = `rss-feed:v1:${await sha256Hex(payload.url)}`;
  const cached = await getRssCacheEntry(env, cacheKey);

  if (cached && Date.now() - cached.cachedAt <= RSS_FETCH_FRESH_TTL_MS) {
    return jsonResponse(cloneFeedWithCount(cached.data, payload.count), 200, {
      ...getCorsHeaders(request, env),
      "X-Voxyl-Cache": "HIT",
    });
  }

  try {
    const { xml, finalUrl } = await fetchFeedXml(payload.url);
    const feed = parseNormalizedFeed(xml, finalUrl);
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

async function getUserByEmail(env: Env, email: string): Promise<D1User | null> {
  return env.DB.prepare(
    `SELECT id, clerk_user_id, legacy_base44_user_id, email, name, username, role,
      profile_picture, profile_hidden, created_at, updated_at
     FROM users
     WHERE lower(email) = lower(?)
     ORDER BY imported_at IS NULL, created_at ASC
     LIMIT 1`,
  )
    .bind(email)
    .first<D1User>();
}

async function getLegacyUserByEmail(env: Env, email: string, clerkUserId: string): Promise<D1User | null> {
  return env.DB.prepare(
    `SELECT id, clerk_user_id, legacy_base44_user_id, email, name, username, role,
      profile_picture, profile_hidden, created_at, updated_at
     FROM users
     WHERE lower(email) = lower(?)
       AND legacy_base44_user_id IS NOT NULL
       AND (clerk_user_id IS NULL OR clerk_user_id = ?)
     ORDER BY imported_at IS NULL, created_at ASC
     LIMIT 1`,
  )
    .bind(email, clerkUserId)
    .first<D1User>();
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

async function linkClerkUserToLegacyData(env: Env, user: D1User, claims: ClerkClaims): Promise<void> {
  const email = normalizeEmail(claims.email || user.email);
  const name = claims.name || user.name;

  if (user.legacy_base44_user_id) {
    await env.DB.prepare(
      `UPDATE users
       SET clerk_user_id = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE clerk_user_id = ?
         AND id != ?
         AND legacy_base44_user_id IS NULL
         AND lower(COALESCE(email, '')) = lower(?)`,
    )
      .bind(claims.userId, user.id, email || "")
      .run();
  }

  await env.DB.prepare(
    `UPDATE users
     SET clerk_user_id = COALESCE(clerk_user_id, ?),
         email = COALESCE(email, ?),
         name = COALESCE(name, ?),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(claims.userId, email, name, user.id)
    .run();

  await env.DB.prepare(
    `UPDATE playlists
     SET creator_clerk_user_id = ?
     WHERE creator_clerk_user_id IS NULL
       AND (
         creator_id = ?
         OR creator_legacy_base44_user_id = ?
         OR lower(COALESCE(creator_email, '')) = lower(?)
       )`,
  )
    .bind(claims.userId, user.id, user.legacy_base44_user_id || "", email || "")
    .run();

  await env.DB.prepare(
    `UPDATE playlist_likes
     SET clerk_user_id = ?
     WHERE clerk_user_id IS NULL
       AND (user_id = ? OR legacy_base44_user_id = ? OR lower(COALESCE(user_email, '')) = lower(?))`,
  )
    .bind(claims.userId, user.id, user.legacy_base44_user_id || "", email || "")
    .run();

  await env.DB.prepare(
    `UPDATE podcast_likes
     SET clerk_user_id = ?
     WHERE clerk_user_id IS NULL
       AND (user_id = ? OR legacy_base44_user_id = ? OR lower(COALESCE(user_email, '')) = lower(?))`,
  )
    .bind(claims.userId, user.id, user.legacy_base44_user_id || "", email || "")
    .run();

  await env.DB.prepare(
    `UPDATE podcast_plays
     SET clerk_user_id = ?
     WHERE clerk_user_id IS NULL
       AND (user_id = ? OR legacy_base44_user_id = ?)`,
  )
    .bind(claims.userId, user.id, user.legacy_base44_user_id || "")
    .run();

  await env.DB.prepare(
    `UPDATE episode_progress
     SET clerk_user_id = ?
     WHERE clerk_user_id IS NULL
       AND (user_id = ? OR legacy_base44_user_id = ?)`,
  )
    .bind(claims.userId, user.id, user.legacy_base44_user_id || "")
    .run();
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

  const profile = !claims.email || !claims.name ? await getClerkProfile(env, claims.userId) : { email: null, name: null };
  const enrichedClaims = {
    ...claims,
    email: normalizeEmail(claims.email || profile.email),
    name: claims.name || profile.name,
  };

  let user = await getUserByClerkUserId(env, enrichedClaims.userId);

  if (user && !user.legacy_base44_user_id && enrichedClaims.email) {
    const legacyUser = await getLegacyUserByEmail(env, enrichedClaims.email, enrichedClaims.userId);

    if (legacyUser) {
      user = legacyUser;
    }
  }

  if (!user) {
    user = enrichedClaims.email ? await getUserByEmail(env, enrichedClaims.email) : null;
  }

  if (user) {
    await linkClerkUserToLegacyData(env, user, enrichedClaims);
    user = await getUserByClerkUserId(env, enrichedClaims.userId);
  }

  if (!user) {
    await createUserFromClerkClaims(env, enrichedClaims);
    user = await getUserByClerkUserId(env, enrichedClaims.userId);
  }

  if (!user) {
    return jsonResponse({ ok: false, error: "User bootstrap failed" }, 500, corsHeaders);
  }

  return jsonResponse({ ok: true, user: toClientUser(user) }, 200, corsHeaders);
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
  created_date: string;
  updated_date: string;
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
    created_date: playlist.created_at,
    updated_date: playlist.updated_at,
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
  follower_name, follower_username, following_email, base44_created_date,
  base44_updated_date
 FROM follows`;

function toPublicFollow(follow: D1Follow): PublicFollow {
  return {
    ...follow,
    created_date: follow.base44_created_date || follow.created_at,
    updated_date: follow.base44_updated_date || follow.updated_at,
  };
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

      if (request.method === "GET" && (isPlaylistsRoute(pathname) || isEntityPlaylistRoute(pathname))) {
        return withCors(await playlistsResponse(request, env), request, env);
      }

      if (request.method === "GET" && isEntityFollowRoute(pathname)) {
        return withCors(await followsResponse(request, env), request, env);
      }

      if ((request.method === "GET" || request.method === "POST") && isTopPodcastsRoute(pathname)) {
        return withCors(await topPodcastsByPlaybackResponse(request, env), request, env);
      }

      if (request.method === "POST" && isPodcastSearchRoute(pathname)) {
        return withCors(await podcastSearchResponse(request, env), request, env);
      }

      if (request.method === "POST" && isRssFetchRoute(pathname)) {
        return withCors(await rssFetchResponse(request, env), request, env);
      }

      const playlistId = getPlaylistId(pathname);

      if (request.method === "GET" && playlistId) {
        return withCors(await playlistResponse(request, env, playlistId), request, env);
      }

      return withCors(jsonResponse(notFoundResponse, 404), request, env);
    } catch (error) {
      if (error instanceof PodcastSearchError) {
        return withCors(podcastSearchErrorResponse(error, request, env), request, env);
      }

      if (error instanceof RssFetchError) {
        return withCors(rssFetchErrorResponse(error, request, env), request, env);
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
