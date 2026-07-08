#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CSV_FILES = {
  Playlist: 'Playlist_export.csv',
  PlaylistLike: 'PlaylistLike_export.csv',
  PodcastLike: 'PodcastLike_export.csv',
  PodcastPlay: 'PodcastPlay_export.csv',
  EpisodeProgress: 'EpisodeProgress_export.csv',
  Follow: 'Follow_export.csv',
  Block: 'Block_export.csv',
  Report: 'Report_export.csv',
  Referral: 'Referral_export.csv',
  RSSCache: 'RSSCache_export.csv',
  PlaylistEpisodesCache: 'PlaylistEpisodesCache_export.csv',
};

const DEFAULT_MANUAL_USERS_FILE = 'User_manual.csv';
const GENERATED_AT = new Date().toISOString();

function parseArgs(argv) {
  const args = {
    input: null,
    manualUsers: null,
    out: 'migration-output',
    dryRun: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--input') {
      args.input = next;
      i += 1;
    } else if (arg === '--manual-users') {
      args.manualUsers = next;
      i += 1;
    } else if (arg === '--out') {
      args.out = next;
      i += 1;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/import-base44-csv-to-d1.mjs --input "C:\\Voxyl-Migration\\base44-export" --manual-users "C:\\Voxyl-Migration\\base44-export\\User_manual.csv" --out migration-output --dry-run',
    '',
    'This script only reads local CSVs and writes SQL/report files. It never executes D1 commands.',
  ].join('\n');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = '';
  };

  const pushRow = () => {
    if (row.length > 1 || row[0] !== '') {
      rows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      pushCell();
    } else if (ch === '\n') {
      pushCell();
      pushRow();
    } else if (ch !== '\r') {
      cell += ch;
    }
  }

  pushCell();
  pushRow();

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header) => normalizeHeader(header));
  return rows.slice(1).map((values, index) => {
    const record = { __rowNumber: index + 2 };
    headers.forEach((header, headerIndex) => {
      record[header] = values[headerIndex] ?? '';
    });
    return record;
  });
}

function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function readCsvIfPresent(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }

  const raw = readFileSync(filePath, 'utf8');
  return parseCsv(raw);
}

function pick(row, names, fallback = '') {
  for (const name of names) {
    const normalized = normalizeHeader(name);
    const value = row[normalized];
    if (value !== undefined && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return fallback;
}

function nullable(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

function toInteger(value, fallback = 0) {
  const trimmed = String(value ?? '').trim();
  if (trimmed === '') return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function toBooleanInteger(value, fallback = 0) {
  const trimmed = String(value ?? '').trim().toLowerCase();
  if (trimmed === '') return fallback;
  if (['true', '1', 'yes', 'y'].includes(trimmed)) return 1;
  if (['false', '0', 'no', 'n'].includes(trimmed)) return 0;
  return fallback;
}

function stableId(prefix, parts) {
  const input = parts.filter(Boolean).join('|') || `${prefix}|unknown`;
  const hash = createHash('sha256').update(input).digest('hex').slice(0, 16);
  return `${prefix}_${hash}`;
}

function sqlValue(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function normalizeEmail(value) {
  const clean = nullable(value);
  return clean ? clean.toLowerCase() : null;
}

function cleanUsername(value) {
  const clean = nullable(value);
  return clean ? clean.replace(/^@+/, '') : null;
}

function normalizeUsernameKey(value) {
  const clean = cleanUsername(value);
  return clean ? clean.toLowerCase() : null;
}

function createUserReconciliation() {
  return {
    mergedByEmail: [],
    mergedByUsername: [],
    usernamesRenamed: [],
    emailsHandled: [],
    duplicateUsernamesBefore: [],
    duplicateEmailsBefore: [],
    duplicateUsernamesAfter: [],
    duplicateEmailsAfter: [],
  };
}

function createDedupeStats() {
  return {
    episode_progress: emptyDedupeStats(),
    playlist_likes: emptyDedupeStats(),
    podcast_likes: emptyDedupeStats(),
    follows: emptyDedupeStats(),
    blocks: emptyDedupeStats(),
    rss_cache: emptyDedupeStats(),
    playlist_episodes_cache: emptyDedupeStats(),
  };
}

function emptyDedupeStats() {
  return {
    duplicateKeyCount: 0,
    rowsMerged: 0,
    samples: [],
  };
}

function userLabel(user) {
  return user.legacy_base44_user_id || user.email || user.username || user.id;
}

function findUserByEmail(users, email) {
  const key = normalizeEmail(email);
  if (!key) return null;
  return [...users.values()].find((user) => normalizeEmail(user.email) === key) || null;
}

function findUserByUsername(users, username) {
  const key = normalizeUsernameKey(username);
  if (!key) return null;
  return [...users.values()].find((user) => normalizeUsernameKey(user.username) === key) || null;
}

function mergePatchIntoUser(user, patch, source) {
  for (const [field, value] of Object.entries(patch)) {
    const clean = field === 'profile_hidden' ? value : nullable(value);
    if ((user[field] === null || user[field] === '' || user[field] === 0) && clean !== null && clean !== '') {
      user[field] = field === 'username' ? cleanUsername(clean) : clean;
    }
  }

  if (!user.base44_full_name && user.name) user.base44_full_name = user.name;
  if (!user.profile_picture && user.base44_picture) user.profile_picture = user.base44_picture;
  user.sources.add(source);
}

function mergeUserRecords(users, target, source, reason, reconciliation) {
  const sourceKey = source.id;
  mergePatchIntoUser(target, source, 'manual_users_csv');
  target.sources = new Set([...target.sources, ...source.sources]);
  users.delete(sourceKey);

  const summary = {
    into: userLabel(target),
    from: userLabel(source),
    email: target.email || source.email || null,
    username: target.username || source.username || null,
  };

  if (reason === 'email') {
    reconciliation.mergedByEmail.push(summary);
  } else {
    reconciliation.mergedByUsername.push(summary);
  }
}

function addManualUser(users, row, reconciliation) {
  const legacyId = pick(row, ['id', 'user_id', 'legacy_base44_user_id']);
  const patch = {
    email: pick(row, ['email', 'user_email']),
    name: pick(row, ['name', 'full_name', 'base44_full_name']),
    username: pick(row, ['username']),
    role: pick(row, ['role'], 'user'),
    profile_picture: pick(row, ['profile_picture', 'picture', 'avatar_url', 'photo_url']),
    profile_hidden: toBooleanInteger(pick(row, ['profile_hidden']), 0),
    base44_created_date: pick(row, ['created_date', 'base44_created_date']),
    base44_updated_date: pick(row, ['updated_date', 'base44_updated_date']),
    base44_picture: pick(row, ['picture']),
    base44_avatar_url: pick(row, ['avatar_url']),
    base44_photo_url: pick(row, ['photo_url']),
    auth_provider: pick(row, ['auth_provider']),
  };

  if (legacyId) {
    addUser(users, legacyId, patch, 'manual_users_csv');
    return;
  }

  const emailMatch = findUserByEmail(users, patch.email);
  if (emailMatch) {
    mergePatchIntoUser(emailMatch, patch, 'manual_users_csv');
    reconciliation.mergedByEmail.push({
      into: userLabel(emailMatch),
      from: normalizeEmail(patch.email),
      email: nullable(patch.email),
      username: nullable(patch.username),
    });
    return;
  }

  const usernameMatch = findUserByUsername(users, patch.username);
  const manualEmail = normalizeEmail(patch.email);
  const matchedEmail = normalizeEmail(usernameMatch?.email);
  if (usernameMatch && (!manualEmail || !matchedEmail || manualEmail === matchedEmail)) {
    mergePatchIntoUser(usernameMatch, patch, 'manual_users_csv');
    reconciliation.mergedByUsername.push({
      into: userLabel(usernameMatch),
      from: cleanUsername(patch.username),
      email: nullable(patch.email),
      username: nullable(patch.username),
    });
    return;
  }

  addUser(users, null, patch, 'manual_users_csv');
}

function duplicateGroups(users, field, normalizer) {
  const groups = new Map();
  for (const user of users.values()) {
    const key = normalizer(user[field]);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(user);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([value, group]) => ({
      value,
      users: group.map((user) => userLabel(user)),
    }));
}

function shortLegacySuffix(user) {
  const seed = user.legacy_base44_user_id || user.id || user.email || user.username || 'user';
  const clean = String(seed).toLowerCase().replace(/[^a-z0-9]/g, '');
  return (clean || createHash('sha256').update(seed).digest('hex')).slice(0, 6);
}

function uniqueUsername(baseUsername, user, usedUsernames) {
  const base = cleanUsername(baseUsername) || 'user';
  let candidate = `${base}_${shortLegacySuffix(user)}`;
  let index = 2;
  while (usedUsernames.has(normalizeUsernameKey(candidate))) {
    candidate = `${base}_${shortLegacySuffix(user)}_${index}`;
    index += 1;
  }
  return candidate;
}

function reconcileUserCollisions(users, reconciliation) {
  reconciliation.duplicateUsernamesBefore = duplicateGroups(users, 'username', normalizeUsernameKey);
  reconciliation.duplicateEmailsBefore = duplicateGroups(users, 'email', normalizeEmail);

  const usedEmails = new Set();
  for (const user of users.values()) {
    user.email = normalizeEmail(user.email);
    const emailKey = normalizeEmail(user.email);
    if (!emailKey) {
      user.email = null;
      continue;
    }
    if (usedEmails.has(emailKey)) {
      reconciliation.emailsHandled.push({
        user: userLabel(user),
        email: user.email,
        action: 'set to NULL after collision',
      });
      user.email = null;
      continue;
    }
    usedEmails.add(emailKey);
  }

  const usedUsernames = new Set();
  for (const user of users.values()) {
    user.username = cleanUsername(user.username);
    const usernameKey = normalizeUsernameKey(user.username);
    if (!usernameKey) {
      user.username = null;
      continue;
    }
    if (usedUsernames.has(usernameKey)) {
      const original = user.username;
      user.username = uniqueUsername(original, user, usedUsernames);
      reconciliation.usernamesRenamed.push({
        user: userLabel(user),
        from: original,
        to: user.username,
      });
    }
    usedUsernames.add(normalizeUsernameKey(user.username));
  }

  reconciliation.duplicateUsernamesAfter = duplicateGroups(users, 'username', normalizeUsernameKey);
  reconciliation.duplicateEmailsAfter = duplicateGroups(users, 'email', normalizeEmail);
}

function normalizeKeyPart(value) {
  return String(value ?? '').trim();
}

function normalizedNaturalKey(parts) {
  const normalized = parts.map((part) => normalizeKeyPart(part));
  return normalized.every(Boolean) ? normalized.join('||') : null;
}

function parseTime(value) {
  const clean = nullable(value);
  if (!clean) return null;
  const time = Date.parse(clean);
  return Number.isFinite(time) ? time : null;
}

function latestTextDate(...values) {
  let bestValue = null;
  let bestTime = null;
  for (const value of values) {
    const time = parseTime(value);
    if (time === null) continue;
    if (bestTime === null || time > bestTime) {
      bestTime = time;
      bestValue = value;
    }
  }
  return bestValue || values.find((value) => nullable(value)) || null;
}

function earliestTextDate(...values) {
  let bestValue = null;
  let bestTime = null;
  for (const value of values) {
    const time = parseTime(value);
    if (time === null) continue;
    if (bestTime === null || time < bestTime) {
      bestTime = time;
      bestValue = value;
    }
  }
  return bestValue || values.find((value) => nullable(value)) || null;
}

function rowFreshness(row) {
  return Math.max(
    parseTime(row.updated_at) ?? Number.NEGATIVE_INFINITY,
    parseTime(row.base44_updated_date) ?? Number.NEGATIVE_INFINITY,
    parseTime(row.last_played_at) ?? Number.NEGATIVE_INFINITY,
    parseTime(row.cached_at) ?? Number.NEGATIVE_INFINITY,
    parseTime(row.created_at) ?? Number.NEGATIVE_INFINITY,
    parseTime(row.base44_created_date) ?? Number.NEGATIVE_INFINITY,
  );
}

function chooseNewestRow(rows) {
  return rows.reduce((best, row) => (rowFreshness(row) > rowFreshness(best) ? row : best), rows[0]);
}

function sanitizeSampleKey(key) {
  const text = String(key ?? '').replace(/\s+/g, ' ');
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

function firstNonNull(...values) {
  return values.find((value) => value !== null && value !== undefined && value !== '') ?? null;
}

function mergeEpisodeProgressGroup(group, key) {
  const newest = { ...chooseNewestRow(group) };
  newest.id = stableId('episode_progress', [newest.user_id, newest.audio_url]);
  newest.legacy_base44_episode_progress_id = firstNonNull(newest.legacy_base44_episode_progress_id, ...group.map((row) => row.legacy_base44_episode_progress_id));
  newest.position_seconds = Math.max(...group.map((row) => toInteger(row.position_seconds, 0)));
  newest.duration_seconds = Math.max(...group.map((row) => toInteger(row.duration_seconds, 0)));
  newest.completed = group.some((row) => toBooleanInteger(row.completed, 0) === 1) ? 1 : 0;
  newest.finished = group.some((row) => toBooleanInteger(row.finished, 0) === 1) ? 1 : 0;
  newest.created_at = earliestTextDate(...group.map((row) => row.created_at)) || newest.created_at;
  newest.updated_at = latestTextDate(...group.map((row) => row.updated_at)) || newest.updated_at;
  newest.last_played_at = latestTextDate(...group.map((row) => row.last_played_at)) || newest.last_played_at;
  newest.base44_created_date = earliestTextDate(...group.map((row) => row.base44_created_date)) || newest.base44_created_date;
  newest.base44_updated_date = latestTextDate(...group.map((row) => row.base44_updated_date)) || newest.base44_updated_date;
  newest.imported_at = GENERATED_AT;
  return newest;
}

function mergeNewestGroup(group, idPrefix, idParts) {
  const newest = { ...chooseNewestRow(group) };
  newest.id = stableId(idPrefix, idParts(newest));
  for (const column of Object.keys(newest).filter((key) => key.startsWith('legacy_base44_'))) {
    newest[column] = firstNonNull(newest[column], ...group.map((row) => row[column]));
  }
  newest.created_at = earliestTextDate(...group.map((row) => row.created_at)) || newest.created_at;
  newest.updated_at = latestTextDate(...group.map((row) => row.updated_at)) || newest.updated_at;
  newest.base44_created_date = earliestTextDate(...group.map((row) => row.base44_created_date)) || newest.base44_created_date;
  newest.base44_updated_date = latestTextDate(...group.map((row) => row.base44_updated_date)) || newest.base44_updated_date;
  newest.imported_at = GENERATED_AT;
  return newest;
}

function dedupeRowsByNaturalKey(rows, table, keyFn, mergeFn, dedupeStats) {
  const groups = new Map();
  const orderedItems = [];

  for (const row of rows) {
    const key = keyFn(row);
    if (!key) {
      orderedItems.push({ key: null, row });
      continue;
    }
    if (!groups.has(key)) {
      groups.set(key, []);
      orderedItems.push({ key, row: null });
    }
    groups.get(key).push(row);
  }

  const stats = dedupeStats[table];
  const deduped = [];
  const seen = new Set();
  for (const item of orderedItems) {
    const { key, row } = item;
    if (!key) {
      deduped.push(row);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const group = groups.get(key);
    if (group.length > 1) {
      stats.duplicateKeyCount += 1;
      stats.rowsMerged += group.length - 1;
      if (stats.samples.length < 10) {
        stats.samples.push({
          key: sanitizeSampleKey(key),
          rows: group.length,
        });
      }
      deduped.push(mergeFn(group, key));
    } else {
      deduped.push(group[0]);
    }
  }

  return deduped;
}

function dedupeUniqueTables(rows, dedupeStats) {
  rows.episode_progress = dedupeRowsByNaturalKey(
    rows.episode_progress,
    'episode_progress',
    (row) => normalizedNaturalKey([row.user_id, row.audio_url]),
    mergeEpisodeProgressGroup,
    dedupeStats,
  );

  rows.playlist_likes = dedupeRowsByNaturalKey(
    rows.playlist_likes,
    'playlist_likes',
    (row) => normalizedNaturalKey([row.playlist_id, row.user_id]),
    (group) => mergeNewestGroup(group, 'playlist_like', (row) => [row.playlist_id, row.user_id]),
    dedupeStats,
  );

  rows.podcast_likes = dedupeRowsByNaturalKey(
    rows.podcast_likes,
    'podcast_likes',
    (row) => normalizedNaturalKey([row.user_id, row.feed_url]),
    (group) => mergeNewestGroup(group, 'podcast_like', (row) => [row.user_id, row.feed_url]),
    dedupeStats,
  );

  rows.follows = dedupeRowsByNaturalKey(
    rows.follows,
    'follows',
    (row) => normalizedNaturalKey([row.follower_id, row.following_id]),
    (group) => mergeNewestGroup(group, 'follow', (row) => [row.follower_id, row.following_id]),
    dedupeStats,
  );

  rows.blocks = dedupeRowsByNaturalKey(
    rows.blocks,
    'blocks',
    (row) => normalizedNaturalKey([row.blocker_id, row.blocked_id]),
    (group) => mergeNewestGroup(group, 'block', (row) => [row.blocker_id, row.blocked_id]),
    dedupeStats,
  );

  rows.rss_cache = dedupeRowsByNaturalKey(
    rows.rss_cache,
    'rss_cache',
    (row) => normalizedNaturalKey([row.feed_url]),
    (group) => mergeNewestGroup(group, 'rss_cache', (row) => [row.feed_url]),
    dedupeStats,
  );

  rows.playlist_episodes_cache = dedupeRowsByNaturalKey(
    rows.playlist_episodes_cache,
    'playlist_episodes_cache',
    (row) => normalizedNaturalKey([row.playlist_id, row.cache_key]),
    (group) => mergeNewestGroup(group, 'playlist_episodes_cache', (row) => [row.playlist_id, row.cache_key]),
    dedupeStats,
  );
}

function insertSql(table, row, conflictColumn = 'id') {
  const columns = Object.keys(row);
  const values = columns.map((column) => sqlValue(row[column]));
  const updates = columns
    .filter((column) => column !== conflictColumn)
    .map((column) => `${column}=excluded.${column}`)
    .join(', ');

  return [
    `INSERT INTO ${table} (${columns.join(', ')})`,
    `VALUES (${values.join(', ')})`,
    `ON CONFLICT(${conflictColumn}) DO UPDATE SET ${updates};`,
  ].join(' ');
}

function validateJson(value, label, errors) {
  const text = String(value ?? '').trim();
  if (!text) {
    errors.push(`${label}: missing JSON`);
    return null;
  }
  try {
    JSON.parse(text);
    return text;
  } catch (error) {
    errors.push(`${label}: ${error.message}`);
    return null;
  }
}

function addUser(users, legacyId, patch = {}, source = 'unknown') {
  const cleanLegacyId = nullable(legacyId);
  const key = cleanLegacyId || stableId('manual_user', [patch.email, patch.username, patch.name, source]);
  const existing = users.get(key) || {
    id: key,
    legacy_base44_user_id: cleanLegacyId,
    email: null,
    name: null,
    username: null,
    role: 'user',
    profile_picture: null,
    profile_hidden: 0,
    base44_created_date: null,
    base44_updated_date: null,
    base44_full_name: null,
    base44_picture: null,
    base44_avatar_url: null,
    base44_photo_url: null,
    auth_provider: null,
    sources: new Set(),
  };

  for (const [field, value] of Object.entries(patch)) {
    const clean = field === 'profile_hidden' ? value : nullable(value);
    if ((existing[field] === null || existing[field] === '' || existing[field] === 0) && clean !== null && clean !== '') {
      if (field === 'email') {
        existing[field] = normalizeEmail(clean);
      } else if (field === 'username') {
        existing[field] = cleanUsername(clean);
      } else {
        existing[field] = clean;
      }
    }
  }

  if (!existing.base44_full_name && existing.name) existing.base44_full_name = existing.name;
  if (!existing.profile_picture && existing.base44_picture) existing.profile_picture = existing.base44_picture;
  existing.sources.add(source);
  users.set(key, existing);
  return existing;
}

function getUserId(users, legacyId, patch = {}, source = 'unknown') {
  return addUser(users, legacyId, patch, source).id;
}

function loadInputs(inputDir, manualUsersPath) {
  const loaded = {};
  const counts = {};

  for (const [entity, fileName] of Object.entries(CSV_FILES)) {
    const filePath = path.join(inputDir, fileName);
    const rows = readCsvIfPresent(filePath);
    loaded[entity] = rows || [];
    counts[fileName] = rows ? rows.length : null;
  }

  const explicitManualPath = manualUsersPath || path.join(inputDir, DEFAULT_MANUAL_USERS_FILE);
  const manualUsers = readCsvIfPresent(explicitManualPath) || [];
  counts[path.basename(explicitManualPath)] = existsSync(explicitManualPath) ? manualUsers.length : null;

  return { loaded, manualUsers, counts, manualUsersPath: explicitManualPath };
}

function reconstructUsers(loaded, manualUsers, reconciliation) {
  const users = new Map();

  for (const row of loaded.Playlist) {
    getUserId(users, pick(row, ['creator_id']), {
      email: pick(row, ['creator_email']),
      name: pick(row, ['creator_name']),
      username: pick(row, ['creator_username']),
      profile_picture: pick(row, ['creator_picture']),
      profile_hidden: toBooleanInteger(pick(row, ['creator_hidden']), 0),
    }, 'playlist.creator');
  }

  for (const row of loaded.PlaylistLike) {
    getUserId(users, pick(row, ['user_id']), { email: pick(row, ['user_email']) }, 'playlist_like.user');
  }

  for (const row of loaded.PodcastLike) {
    getUserId(users, pick(row, ['user_id']), { email: pick(row, ['user_email']) }, 'podcast_like.user');
  }

  for (const row of loaded.PodcastPlay) {
    getUserId(users, pick(row, ['user_id']), {}, 'podcast_play.user');
  }

  for (const row of loaded.EpisodeProgress) {
    getUserId(users, pick(row, ['user_id']), {}, 'episode_progress.user');
  }

  for (const row of loaded.Follow) {
    getUserId(users, pick(row, ['follower_id']), {
      email: pick(row, ['follower_email']),
      name: pick(row, ['follower_name']),
      username: pick(row, ['follower_username']),
    }, 'follow.follower');
    getUserId(users, pick(row, ['following_id']), {
      email: pick(row, ['following_email']),
    }, 'follow.following');
  }

  for (const row of loaded.Block) {
    getUserId(users, pick(row, ['blocker_id']), { email: pick(row, ['blocker_email']) }, 'block.blocker');
    getUserId(users, pick(row, ['blocked_id']), {
      email: pick(row, ['blocked_email']),
      name: pick(row, ['blocked_name']),
    }, 'block.blocked');
  }

  for (const row of loaded.Report) {
    getUserId(users, pick(row, ['reporter_id']), { email: pick(row, ['reporter_email']) }, 'report.reporter');
    getUserId(users, pick(row, ['reported_user_id']), { email: pick(row, ['reported_user_email']) }, 'report.reported_user');
  }

  for (const row of loaded.Referral) {
    getUserId(users, pick(row, ['inviter_id']), {
      email: pick(row, ['inviter_email']),
      name: pick(row, ['inviter_name']),
    }, 'referral.inviter');
    const inviteeId = pick(row, ['invitee_user_id', 'invitee_id']);
    if (inviteeId) {
      getUserId(users, inviteeId, { email: pick(row, ['invitee_email']) }, 'referral.invitee');
    }
  }

  for (const row of manualUsers) {
    addManualUser(users, row, reconciliation);
  }

  return users;
}

function mapRows(loaded, users, quarantine, jsonErrors, orphanRefs, reconciliation) {
  const rows = {
    users: [],
    playlists: [],
    playlist_likes: [],
    podcast_likes: [],
    podcast_plays: [],
    episode_progress: [],
    follows: [],
    blocks: [],
    reports: [],
    referrals: [],
    rss_cache: [],
    playlist_episodes_cache: [],
  };
  const playlistIds = new Set();

  for (const row of loaded.Playlist) {
    const errors = [];
    const id = pick(row, ['id']);
    const creatorLegacyId = pick(row, ['creator_id']);
    const rssFeeds = validateJson(pick(row, ['rss_feeds'], '[]'), `Playlist row ${row.__rowNumber} rss_feeds`, errors);

    if (!id) errors.push('missing playlist id');
    if (!creatorLegacyId) errors.push('missing creator_id');
    if (errors.length) {
      quarantine.push({ entity: 'Playlist', row: row.__rowNumber, errors, source: row });
      jsonErrors.push(...errors.filter((error) => error.includes('JSON') || error.includes('rss_feeds')));
      continue;
    }

    const creatorId = getUserId(users, creatorLegacyId, {
      email: pick(row, ['creator_email']),
      name: pick(row, ['creator_name']),
      username: pick(row, ['creator_username']),
      profile_picture: pick(row, ['creator_picture']),
      profile_hidden: toBooleanInteger(pick(row, ['creator_hidden']), 0),
    }, 'playlist.creator');
    const name = pick(row, ['name', 'title'], 'Untitled playlist');
    const visibility = pick(row, ['visibility'], pick(row, ['is_public']).toLowerCase() === 'false' ? 'private' : 'public');
    const isPublic = pick(row, ['is_public']) ? toBooleanInteger(pick(row, ['is_public']), visibility === 'public' ? 1 : 0) : (visibility === 'public' ? 1 : 0);

    playlistIds.add(id);
    rows.playlists.push({
      id,
      legacy_base44_playlist_id: id,
      creator_id: creatorId,
      creator_legacy_base44_user_id: creatorLegacyId,
      title: name,
      base44_name: name,
      description: nullable(pick(row, ['description'])),
      cover_image: nullable(pick(row, ['cover_image'])),
      visibility,
      is_public: isPublic,
      rss_feeds: rssFeeds,
      likes_count: toInteger(pick(row, ['likes_count']), 0),
      plays_count: toInteger(pick(row, ['plays_count']), 0),
      creator_name: nullable(pick(row, ['creator_name'])),
      creator_email: nullable(pick(row, ['creator_email'])),
      creator_username: nullable(pick(row, ['creator_username'])),
      creator_picture: nullable(pick(row, ['creator_picture'])),
      creator_hidden: toBooleanInteger(pick(row, ['creator_hidden']), 0),
      max_duration: toInteger(pick(row, ['max_duration']), 0),
      time_filter_hours: toInteger(pick(row, ['time_filter_hours']), 0),
      episodes_sort_order: nullable(pick(row, ['episodes_sort_order'], 'newest_first')),
      share_token: nullable(pick(row, ['share_token'])),
      reports_count: toInteger(pick(row, ['reports_count']), 0),
      created_at: nullable(pick(row, ['created_date'])) || GENERATED_AT,
      updated_at: nullable(pick(row, ['updated_date'])) || GENERATED_AT,
      base44_created_date: nullable(pick(row, ['created_date'])),
      base44_updated_date: nullable(pick(row, ['updated_date'])),
      imported_at: GENERATED_AT,
    });
  }

  const hasPlaylist = (id, entity, rowNumber, field) => {
    if (!id || playlistIds.has(id)) return true;
    orphanRefs.push({ entity, row: rowNumber, field, value: id });
    return false;
  };

  for (const row of loaded.PlaylistLike) {
    const playlistId = pick(row, ['playlist_id']);
    const userLegacyId = pick(row, ['user_id']);
    if (!playlistId || !userLegacyId) {
      quarantine.push({ entity: 'PlaylistLike', row: row.__rowNumber, errors: ['missing playlist_id or user_id'], source: row });
      continue;
    }
    if (!hasPlaylist(playlistId, 'PlaylistLike', row.__rowNumber, 'playlist_id')) {
      quarantine.push({ entity: 'PlaylistLike', row: row.__rowNumber, errors: ['playlist_id not found'], source: row });
      continue;
    }
    rows.playlist_likes.push({
      id: pick(row, ['id']) || stableId('playlist_like', [playlistId, userLegacyId]),
      legacy_base44_playlist_like_id: nullable(pick(row, ['id'])),
      playlist_id: playlistId,
      user_id: getUserId(users, userLegacyId, { email: pick(row, ['user_email']) }, 'playlist_like.user'),
      legacy_base44_user_id: nullable(userLegacyId),
      user_email: nullable(pick(row, ['user_email'])),
      created_at: nullable(pick(row, ['created_date'])) || GENERATED_AT,
      base44_created_date: nullable(pick(row, ['created_date'])),
      base44_updated_date: nullable(pick(row, ['updated_date'])),
      imported_at: GENERATED_AT,
    });
  }

  for (const row of loaded.PodcastLike) {
    const userLegacyId = pick(row, ['user_id']);
    const feedUrl = pick(row, ['feed_url']);
    if (!userLegacyId || !feedUrl) {
      quarantine.push({ entity: 'PodcastLike', row: row.__rowNumber, errors: ['missing user_id or feed_url'], source: row });
      continue;
    }
    rows.podcast_likes.push({
      id: pick(row, ['id']) || stableId('podcast_like', [userLegacyId, pick(row, ['feed_url'])]),
      legacy_base44_podcast_like_id: nullable(pick(row, ['id'])),
      user_id: getUserId(users, userLegacyId, { email: pick(row, ['user_email']) }, 'podcast_like.user'),
      legacy_base44_user_id: nullable(userLegacyId),
      user_email: nullable(pick(row, ['user_email'])),
      feed_url: feedUrl,
      podcast_title: nullable(pick(row, ['podcast_title'])),
      podcast_author: nullable(pick(row, ['podcast_author'])),
      podcast_image: nullable(pick(row, ['podcast_image'])),
      podcast_description: nullable(pick(row, ['podcast_description'])),
      created_at: nullable(pick(row, ['created_date'])) || GENERATED_AT,
      updated_at: nullable(pick(row, ['updated_date'])) || GENERATED_AT,
      base44_created_date: nullable(pick(row, ['created_date'])),
      base44_updated_date: nullable(pick(row, ['updated_date'])),
      imported_at: GENERATED_AT,
    });
  }

  for (const row of loaded.PodcastPlay) {
    const userLegacyId = pick(row, ['user_id']);
    const playlistId = nullable(pick(row, ['playlist_id']));
    if (playlistId) hasPlaylist(playlistId, 'PodcastPlay', row.__rowNumber, 'playlist_id');
    rows.podcast_plays.push({
      id: pick(row, ['id']) || stableId('podcast_play', [userLegacyId, pick(row, ['feed_url']), pick(row, ['audio_url'])]),
      legacy_base44_podcast_play_id: nullable(pick(row, ['id'])),
      user_id: userLegacyId ? getUserId(users, userLegacyId, {}, 'podcast_play.user') : null,
      legacy_base44_user_id: nullable(userLegacyId),
      playlist_id: playlistId && playlistIds.has(playlistId) ? playlistId : null,
      feed_url: nullable(pick(row, ['feed_url'])),
      podcast_title: nullable(pick(row, ['podcast_title'])),
      podcast_image: nullable(pick(row, ['podcast_image'])),
      episode_title: nullable(pick(row, ['episode_title'])),
      audio_url: nullable(pick(row, ['audio_url'])),
      played_at: nullable(pick(row, ['played_at'])) || nullable(pick(row, ['created_date'])) || GENERATED_AT,
      created_at: nullable(pick(row, ['created_date'])) || GENERATED_AT,
      updated_at: nullable(pick(row, ['updated_date'])) || GENERATED_AT,
      base44_created_date: nullable(pick(row, ['created_date'])),
      base44_updated_date: nullable(pick(row, ['updated_date'])),
      imported_at: GENERATED_AT,
    });
  }

  for (const row of loaded.EpisodeProgress) {
    const userLegacyId = pick(row, ['user_id']);
    const audioUrl = pick(row, ['audio_url']);
    if (!userLegacyId || !audioUrl) {
      quarantine.push({ entity: 'EpisodeProgress', row: row.__rowNumber, errors: ['missing user_id or audio_url'], source: row });
      continue;
    }
    rows.episode_progress.push({
      id: pick(row, ['id']) || stableId('episode_progress', [userLegacyId, pick(row, ['audio_url'])]),
      legacy_base44_episode_progress_id: nullable(pick(row, ['id'])),
      user_id: getUserId(users, userLegacyId, {}, 'episode_progress.user'),
      legacy_base44_user_id: nullable(userLegacyId),
      feed_url: nullable(pick(row, ['feed_url'])),
      podcast_title: nullable(pick(row, ['podcast_title'])),
      episode_title: nullable(pick(row, ['episode_title'])),
      audio_url: audioUrl,
      position_seconds: toInteger(pick(row, ['position_seconds']), 0),
      duration_seconds: toInteger(pick(row, ['duration_seconds']), 0),
      completed: toBooleanInteger(pick(row, ['completed', 'finished']), 0),
      finished: toBooleanInteger(pick(row, ['finished', 'completed']), 0),
      last_played_at: nullable(pick(row, ['last_played_at'])),
      created_at: nullable(pick(row, ['created_date'])) || GENERATED_AT,
      updated_at: nullable(pick(row, ['updated_date'])) || GENERATED_AT,
      base44_created_date: nullable(pick(row, ['created_date'])),
      base44_updated_date: nullable(pick(row, ['updated_date'])),
      imported_at: GENERATED_AT,
    });
  }

  for (const row of loaded.Follow) {
    const followerLegacyId = pick(row, ['follower_id']);
    const followingLegacyId = pick(row, ['following_id']);
    if (!followerLegacyId || !followingLegacyId) {
      quarantine.push({ entity: 'Follow', row: row.__rowNumber, errors: ['missing follower_id or following_id'], source: row });
      continue;
    }
    rows.follows.push({
      id: pick(row, ['id']) || stableId('follow', [followerLegacyId, followingLegacyId]),
      legacy_base44_follow_id: nullable(pick(row, ['id'])),
      follower_id: getUserId(users, followerLegacyId, {
        email: pick(row, ['follower_email']),
        name: pick(row, ['follower_name']),
        username: pick(row, ['follower_username']),
      }, 'follow.follower'),
      follower_legacy_base44_user_id: nullable(followerLegacyId),
      follower_email: nullable(pick(row, ['follower_email'])),
      follower_name: nullable(pick(row, ['follower_name'])),
      follower_username: nullable(pick(row, ['follower_username'])),
      following_id: getUserId(users, followingLegacyId, { email: pick(row, ['following_email']) }, 'follow.following'),
      following_legacy_base44_user_id: nullable(followingLegacyId),
      following_email: nullable(pick(row, ['following_email'])),
      status: nullable(pick(row, ['status'])) || 'pending',
      created_at: nullable(pick(row, ['created_date'])) || GENERATED_AT,
      updated_at: nullable(pick(row, ['updated_date'])) || GENERATED_AT,
      base44_created_date: nullable(pick(row, ['created_date'])),
      base44_updated_date: nullable(pick(row, ['updated_date'])),
      imported_at: GENERATED_AT,
    });
  }

  for (const row of loaded.Block) {
    const blockerLegacyId = pick(row, ['blocker_id']);
    const blockedLegacyId = pick(row, ['blocked_id']);
    if (!blockerLegacyId || !blockedLegacyId) {
      quarantine.push({ entity: 'Block', row: row.__rowNumber, errors: ['missing blocker_id or blocked_id'], source: row });
      continue;
    }
    rows.blocks.push({
      id: pick(row, ['id']) || stableId('block', [blockerLegacyId, blockedLegacyId]),
      legacy_base44_block_id: nullable(pick(row, ['id'])),
      blocker_id: getUserId(users, blockerLegacyId, { email: pick(row, ['blocker_email']) }, 'block.blocker'),
      blocker_legacy_base44_user_id: nullable(blockerLegacyId),
      blocker_email: nullable(pick(row, ['blocker_email'])),
      blocked_id: getUserId(users, blockedLegacyId, {
        email: pick(row, ['blocked_email']),
        name: pick(row, ['blocked_name']),
      }, 'block.blocked'),
      blocked_legacy_base44_user_id: nullable(blockedLegacyId),
      blocked_email: nullable(pick(row, ['blocked_email'])),
      blocked_name: nullable(pick(row, ['blocked_name'])),
      created_at: nullable(pick(row, ['created_date'])) || GENERATED_AT,
      base44_created_date: nullable(pick(row, ['created_date'])),
      base44_updated_date: nullable(pick(row, ['updated_date'])),
      imported_at: GENERATED_AT,
    });
  }

  for (const row of loaded.Report) {
    const contentType = nullable(pick(row, ['content_type']));
    const contentId = nullable(pick(row, ['content_id']));
    if (contentType === 'playlist' && contentId) hasPlaylist(contentId, 'Report', row.__rowNumber, 'content_id');
    const reporterLegacyId = pick(row, ['reporter_id']);
    const reportedLegacyId = pick(row, ['reported_user_id']);
    rows.reports.push({
      id: pick(row, ['id']) || stableId('report', [reporterLegacyId, contentType, contentId, pick(row, ['reason'])]),
      legacy_base44_report_id: nullable(pick(row, ['id'])),
      reporter_id: reporterLegacyId ? getUserId(users, reporterLegacyId, { email: pick(row, ['reporter_email']) }, 'report.reporter') : null,
      reporter_legacy_base44_user_id: nullable(reporterLegacyId),
      reporter_email: nullable(pick(row, ['reporter_email'])),
      reported_user_id: reportedLegacyId ? getUserId(users, reportedLegacyId, { email: pick(row, ['reported_user_email']) }, 'report.reported_user') : null,
      reported_user_email: nullable(pick(row, ['reported_user_email'])),
      reported_playlist_id: contentType === 'playlist' && contentId && playlistIds.has(contentId) ? contentId : null,
      content_type: contentType,
      content_id: contentId,
      content_title: nullable(pick(row, ['content_title'])),
      reason: nullable(pick(row, ['reason'])),
      details: nullable(pick(row, ['details'])),
      status: nullable(pick(row, ['status'])) || 'pending',
      created_at: nullable(pick(row, ['created_date'])) || GENERATED_AT,
      updated_at: nullable(pick(row, ['updated_date'])) || GENERATED_AT,
      base44_created_date: nullable(pick(row, ['created_date'])),
      base44_updated_date: nullable(pick(row, ['updated_date'])),
      imported_at: GENERATED_AT,
    });
  }

  for (const row of loaded.Referral) {
    const inviterLegacyId = pick(row, ['inviter_id']);
    const inviteeLegacyId = pick(row, ['invitee_user_id', 'invitee_id']);
    const playlistId = nullable(pick(row, ['playlist_id']));
    if (playlistId) hasPlaylist(playlistId, 'Referral', row.__rowNumber, 'playlist_id');
    rows.referrals.push({
      id: pick(row, ['id']) || stableId('referral', [inviterLegacyId, pick(row, ['invitee_email']), playlistId]),
      legacy_base44_referral_id: nullable(pick(row, ['id'])),
      inviter_id: inviterLegacyId ? getUserId(users, inviterLegacyId, {
        email: pick(row, ['inviter_email']),
        name: pick(row, ['inviter_name']),
      }, 'referral.inviter') : null,
      inviter_legacy_base44_user_id: nullable(inviterLegacyId),
      inviter_email: nullable(pick(row, ['inviter_email'])),
      inviter_name: nullable(pick(row, ['inviter_name'])),
      invitee_user_id: inviteeLegacyId ? getUserId(users, inviteeLegacyId, { email: pick(row, ['invitee_email']) }, 'referral.invitee') : null,
      invitee_legacy_base44_user_id: nullable(inviteeLegacyId),
      invitee_email: nullable(pick(row, ['invitee_email'])),
      playlist_id: playlistId && playlistIds.has(playlistId) ? playlistId : null,
      status: nullable(pick(row, ['status'])) || 'pending',
      created_at: nullable(pick(row, ['created_date'])) || GENERATED_AT,
      updated_at: nullable(pick(row, ['updated_date'])) || GENERATED_AT,
      base44_created_date: nullable(pick(row, ['created_date'])),
      base44_updated_date: nullable(pick(row, ['updated_date'])),
      imported_at: GENERATED_AT,
    });
  }

  for (const row of loaded.RSSCache) {
    const errors = [];
    const feedUrl = pick(row, ['feed_url']);
    if (!feedUrl) errors.push('missing feed_url');
    const data = validateJson(pick(row, ['data', 'response_json']), `RSSCache row ${row.__rowNumber} data`, errors);
    if (errors.length) {
      quarantine.push({ entity: 'RSSCache', row: row.__rowNumber, errors, source: row });
      jsonErrors.push(...errors);
      continue;
    }
    rows.rss_cache.push({
      id: pick(row, ['id']) || stableId('rss_cache', [pick(row, ['feed_url'])]),
      legacy_base44_rss_cache_id: nullable(pick(row, ['id'])),
      feed_url: feedUrl,
      response_json: data,
      data,
      cached_at: nullable(pick(row, ['cached_at'])) || GENERATED_AT,
      created_at: nullable(pick(row, ['created_date'])) || GENERATED_AT,
      updated_at: nullable(pick(row, ['updated_date'])) || GENERATED_AT,
      base44_created_date: nullable(pick(row, ['created_date'])),
      base44_updated_date: nullable(pick(row, ['updated_date'])),
      imported_at: GENERATED_AT,
    });
  }

  for (const row of loaded.PlaylistEpisodesCache) {
    const errors = [];
    const playlistId = pick(row, ['playlist_id']);
    const episodesData = validateJson(pick(row, ['episodes_data', 'episodes_json']), `PlaylistEpisodesCache row ${row.__rowNumber} episodes_data`, errors);
    if (!playlistId) {
      errors.push('missing playlist_id');
    }
    if (!hasPlaylist(playlistId, 'PlaylistEpisodesCache', row.__rowNumber, 'playlist_id')) {
      errors.push('playlist_id not found');
    }
    if (errors.length) {
      quarantine.push({ entity: 'PlaylistEpisodesCache', row: row.__rowNumber, errors, source: row });
      jsonErrors.push(...errors.filter((error) => error.includes('JSON') || error.includes('episodes_data')));
      continue;
    }
    rows.playlist_episodes_cache.push({
      id: pick(row, ['id']) || stableId('playlist_episodes_cache', [playlistId, pick(row, ['episodes_hash'])]),
      legacy_base44_playlist_episodes_cache_id: nullable(pick(row, ['id'])),
      playlist_id: playlistId,
      cache_key: nullable(pick(row, ['cache_key', 'episodes_hash'])),
      episodes_json: episodesData,
      episodes_hash: nullable(pick(row, ['episodes_hash'])),
      episodes_data: episodesData,
      last_updated: nullable(pick(row, ['last_updated'])),
      cached_at: nullable(pick(row, ['last_updated', 'cached_at'])) || GENERATED_AT,
      created_at: nullable(pick(row, ['created_date'])) || GENERATED_AT,
      updated_at: nullable(pick(row, ['updated_date'])) || GENERATED_AT,
      base44_created_date: nullable(pick(row, ['created_date'])),
      base44_updated_date: nullable(pick(row, ['updated_date'])),
      imported_at: GENERATED_AT,
    });
  }

  reconcileUserCollisions(users, reconciliation);

  rows.users = [...users.values()].map((user) => ({
    id: user.id,
    legacy_base44_user_id: user.legacy_base44_user_id,
    email: user.email,
    name: user.name || user.base44_full_name,
    username: user.username,
    role: user.role || 'user',
    profile_picture: user.profile_picture,
    profile_hidden: user.profile_hidden || 0,
    base44_created_date: user.base44_created_date,
    base44_updated_date: user.base44_updated_date,
    base44_full_name: user.base44_full_name || user.name,
    base44_picture: user.base44_picture,
    base44_avatar_url: user.base44_avatar_url,
    base44_photo_url: user.base44_photo_url,
    auth_provider: user.auth_provider,
    imported_at: GENERATED_AT,
  }));

  return rows;
}

function buildSql(rows) {
  const order = [
    ['users', 'users'],
    ['playlists', 'playlists'],
    ['playlist_likes', 'playlist_likes'],
    ['podcast_likes', 'podcast_likes'],
    ['podcast_plays', 'podcast_plays'],
    ['episode_progress', 'episode_progress'],
    ['follows', 'follows'],
    ['blocks', 'blocks'],
    ['reports', 'reports'],
    ['referrals', 'referrals'],
    ['rss_cache', 'rss_cache'],
    ['playlist_episodes_cache', 'playlist_episodes_cache'],
  ];
  const statements = [
    '-- Generated by scripts/import-base44-csv-to-d1.mjs',
    `-- Generated at ${GENERATED_AT}`,
    '-- Review validation-report.md before applying this SQL to D1.',
    'PRAGMA foreign_keys = ON;',
    'BEGIN TRANSACTION;',
  ];

  for (const [key, table] of order) {
    statements.push('', `-- ${table}`);
    for (const row of rows[key]) {
      statements.push(insertSql(table, row));
    }
  }

  statements.push('', 'COMMIT;', '');
  return statements.join('\n');
}

function buildReport({ inputDir, manualUsersPath, outputDir, dryRun, counts, rows, users, quarantine, jsonErrors, orphanRefs, reconciliation, dedupeStats }) {
  const visibilityCounts = rows.playlists.reduce((acc, row) => {
    const key = row.visibility || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const usersWithLegacy = [...users.values()].filter((user) => user.legacy_base44_user_id).length;
  const usersWithoutEmail = [...users.values()].filter((user) => !user.email).length;

  const lines = [
    '# Base44 CSV to D1 Validation Report',
    '',
    `Generated at: ${GENERATED_AT}`,
    `Input folder: ${inputDir}`,
    `Manual users CSV: ${manualUsersPath}`,
    `Output folder: ${outputDir}`,
    `Dry run: ${dryRun ? 'yes' : 'yes (remote execution is not implemented)'}`,
    '',
    '## CSV Row Counts',
    '',
    '| File | Rows |',
    '| --- | ---: |',
  ];

  for (const [file, count] of Object.entries(counts)) {
    lines.push(`| ${file} | ${count === null ? 'missing' : count} |`);
  }

  lines.push(
    '',
    '## Generated SQL Row Counts',
    '',
    '| Table | Rows |',
    '| --- | ---: |',
  );

  for (const [table, tableRows] of Object.entries(rows)) {
    lines.push(`| ${table} | ${tableRows.length} |`);
  }

  lines.push(
    '',
    '## Users Reconstructed',
    '',
    `- Total reconstructed users: ${users.size}`,
    `- Users with known Base44 legacy IDs: ${usersWithLegacy}`,
    `- Users without email: ${usersWithoutEmail}`,
    '',
    '## User Reconciliation',
    '',
    `- Users merged by email: ${reconciliation.mergedByEmail.length}`,
    `- Users merged by username: ${reconciliation.mergedByUsername.length}`,
    `- Usernames renamed due to collision: ${reconciliation.usernamesRenamed.length}`,
    `- Emails set to NULL due to collision: ${reconciliation.emailsHandled.length}`,
    '',
    '### Duplicate Detection',
    '',
    `- Duplicate usernames before reconciliation: ${reconciliation.duplicateUsernamesBefore.length}`,
    `- Duplicate emails before reconciliation: ${reconciliation.duplicateEmailsBefore.length}`,
    `- Duplicate usernames after reconciliation: ${reconciliation.duplicateUsernamesAfter.length}`,
    `- Duplicate emails after reconciliation: ${reconciliation.duplicateEmailsAfter.length}`,
    '',
    '### Username Renames',
    '',
    reconciliation.usernamesRenamed.length ? '| User | From | To |' : 'No username collisions required renaming.',
  );

  if (reconciliation.usernamesRenamed.length) {
    lines.push('| --- | --- | --- |');
    for (const item of reconciliation.usernamesRenamed.slice(0, 200)) {
      lines.push(`| ${String(item.user).replaceAll('|', '\\|')} | ${String(item.from).replaceAll('|', '\\|')} | ${String(item.to).replaceAll('|', '\\|')} |`);
    }
    if (reconciliation.usernamesRenamed.length > 200) lines.push(`| ... | ... | ${reconciliation.usernamesRenamed.length - 200} additional username renames omitted |`);
  }

  lines.push(
    '',
    '### Email Collision Handling',
    '',
    reconciliation.emailsHandled.length ? '| User | Email | Action |' : 'No email collisions required handling.',
  );

  if (reconciliation.emailsHandled.length) {
    lines.push('| --- | --- | --- |');
    for (const item of reconciliation.emailsHandled.slice(0, 200)) {
      lines.push(`| ${String(item.user).replaceAll('|', '\\|')} | ${String(item.email).replaceAll('|', '\\|')} | ${String(item.action).replaceAll('|', '\\|')} |`);
    }
    if (reconciliation.emailsHandled.length > 200) lines.push(`| ... | ... | ${reconciliation.emailsHandled.length - 200} additional email collision actions omitted |`);
  }

  lines.push(
    '',
    '## Natural Key Deduplication',
    '',
    '| Table | Duplicate keys | Rows merged |',
    '| --- | ---: | ---: |',
  );

  for (const [table, stats] of Object.entries(dedupeStats)) {
    lines.push(`| ${table} | ${stats.duplicateKeyCount} | ${stats.rowsMerged} |`);
  }

  const sampleTables = Object.entries(dedupeStats).filter(([, stats]) => stats.samples.length);
  lines.push(
    '',
    '### Duplicate Key Samples',
    '',
    sampleTables.length ? '| Table | Key | Source rows merged |' : 'No natural-key duplicates were merged.',
  );

  if (sampleTables.length) {
    lines.push('| --- | --- | ---: |');
    for (const [table, stats] of sampleTables) {
      for (const sample of stats.samples) {
        lines.push(`| ${table} | ${String(sample.key).replaceAll('|', '\\|')} | ${sample.rows} |`);
      }
    }
  }

  lines.push(
    '',
    '## Playlists by Visibility',
    '',
    '| Visibility | Count |',
    '| --- | ---: |',
  );

  for (const [visibility, count] of Object.entries(visibilityCounts)) {
    lines.push(`| ${visibility} | ${count} |`);
  }

  lines.push(
    '',
    '## Orphan References',
    '',
    orphanRefs.length ? '| Entity | Row | Field | Value |' : 'No orphan references found.',
  );
  if (orphanRefs.length) {
    lines.push('| --- | ---: | --- | --- |');
    for (const item of orphanRefs.slice(0, 200)) {
      lines.push(`| ${item.entity} | ${item.row} | ${item.field} | ${String(item.value).replaceAll('|', '\\|')} |`);
    }
    if (orphanRefs.length > 200) lines.push(`| ... | ... | ... | ${orphanRefs.length - 200} additional orphan references omitted |`);
  }

  lines.push(
    '',
    '## Skipped or Quarantined Rows',
    '',
    quarantine.length ? '| Entity | Row | Errors |' : 'No rows quarantined.',
  );
  if (quarantine.length) {
    lines.push('| --- | ---: | --- |');
    for (const item of quarantine.slice(0, 200)) {
      lines.push(`| ${item.entity} | ${item.row} | ${item.errors.join('; ').replaceAll('|', '\\|')} |`);
    }
    if (quarantine.length > 200) lines.push(`| ... | ... | ${quarantine.length - 200} additional quarantined rows omitted |`);
  }

  lines.push(
    '',
    '## JSON Parse Errors',
    '',
    jsonErrors.length ? jsonErrors.map((error) => `- ${error}`).join('\n') : 'No JSON parse errors found.',
    '',
    '## Output Files',
    '',
    '- `base44-d1-import.sql`',
    '- `validation-report.md`',
    '- `quarantine.json`',
    '',
    '## Next Step',
    '',
    'Review this report and the generated SQL before applying anything to local or remote D1. This script does not execute Wrangler or remote D1 commands.',
    '',
  );

  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }

  const inputDir = path.resolve(args.input);
  const outputDir = path.resolve(args.out);
  if (!existsSync(inputDir)) {
    throw new Error(`Input folder does not exist: ${inputDir}`);
  }

  mkdirSync(outputDir, { recursive: true });

  const { loaded, manualUsers, counts, manualUsersPath } = loadInputs(inputDir, args.manualUsers);
  const reconciliation = createUserReconciliation();
  const dedupeStats = createDedupeStats();
  const users = reconstructUsers(loaded, manualUsers, reconciliation);
  const quarantine = [];
  const jsonErrors = [];
  const orphanRefs = [];
  const rows = mapRows(loaded, users, quarantine, jsonErrors, orphanRefs, reconciliation);
  dedupeUniqueTables(rows, dedupeStats);
  const sql = buildSql(rows);
  const report = buildReport({
    inputDir,
    manualUsersPath,
    outputDir,
    dryRun: args.dryRun,
    counts,
    rows,
    users,
    quarantine,
    jsonErrors,
    orphanRefs,
    reconciliation,
    dedupeStats,
  });

  writeFileSync(path.join(outputDir, 'base44-d1-import.sql'), sql, 'utf8');
  writeFileSync(path.join(outputDir, 'validation-report.md'), report, 'utf8');
  writeFileSync(path.join(outputDir, 'quarantine.json'), JSON.stringify({ generated_at: GENERATED_AT, quarantine, orphanRefs, jsonErrors, reconciliation, dedupeStats }, null, 2), 'utf8');

  console.log(`Wrote ${path.join(outputDir, 'base44-d1-import.sql')}`);
  console.log(`Wrote ${path.join(outputDir, 'validation-report.md')}`);
  console.log(`Wrote ${path.join(outputDir, 'quarantine.json')}`);
  console.log('Dry run complete. No D1 commands were executed.');
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
