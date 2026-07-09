#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';

const DEFAULT_INPUT = 'migration-output/base44-file-url-unique.txt';
const DEFAULT_OUT_DIR = 'migration-output';
const DEFAULT_BUCKET = 'voxyl-media';
const DEFAULT_PUBLIC_BASE_URL = 'https://media.renbrant.com';
const DOWNLOAD_DIR_NAME = 'base44-files';
const R2_PREFIX = 'legacy-base44';

const CONTENT_TYPE_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/svg+xml', '.svg'],
  ['image/avif', '.avif'],
  ['audio/mpeg', '.mp3'],
  ['audio/mp3', '.mp3'],
  ['audio/mp4', '.m4a'],
  ['audio/aac', '.aac'],
  ['audio/ogg', '.ogg'],
  ['video/mp4', '.mp4'],
  ['application/pdf', '.pdf'],
]);

const EXTENSION_CONTENT_TYPES = new Map(
  [...CONTENT_TYPE_EXTENSIONS.entries()].map(([contentType, extension]) => [extension, contentType]),
);

const SQL_FIELDS = [
  ['users', 'profile_picture'],
  ['users', 'base44_picture'],
  ['users', 'base44_avatar_url'],
  ['users', 'base44_photo_url'],
  ['playlists', 'cover_image'],
  ['playlists', 'creator_picture'],
];

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    out: DEFAULT_OUT_DIR,
    bucket: DEFAULT_BUCKET,
    publicBaseUrl: DEFAULT_PUBLIC_BASE_URL,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--input') {
      args.input = next;
      i += 1;
    } else if (arg === '--out') {
      args.out = next;
      i += 1;
    } else if (arg === '--bucket') {
      args.bucket = next;
      i += 1;
    } else if (arg === '--public-base-url') {
      args.publicBaseUrl = next;
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
    '  node scripts/migrate-base44-files-to-r2.mjs --dry-run',
    '',
    'Options:',
    `  --input ${DEFAULT_INPUT}`,
    `  --out ${DEFAULT_OUT_DIR}`,
    `  --bucket ${DEFAULT_BUCKET}`,
    `  --public-base-url ${DEFAULT_PUBLIC_BASE_URL}`,
    '',
    'Dry-run downloads files and writes CSV/JSON/SQL, but does not upload to R2.',
  ].join('\n');
}

function readUrls(inputPath) {
  if (!existsSync(inputPath)) {
    throw new Error(`Input URL file does not exist: ${inputPath}`);
  }

  const seen = new Set();
  return readFileSync(inputPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .filter((line) => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    });
}

function contentTypeBase(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

function extensionFromContentType(contentType) {
  return CONTENT_TYPE_EXTENSIONS.get(contentTypeBase(contentType)) || '.bin';
}

function contentTypeFromExtension(extension) {
  return EXTENSION_CONTENT_TYPES.get(String(extension || '').toLowerCase()) || null;
}

function safeFilenamePart(value) {
  return String(value || '')
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/\.+$/g, '')
    .replace(/^-|-$/g, '');
}

function detectMagicType(localPath) {
  const bytes = readFileSync(localPath);
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { extension: '.png', contentType: 'image/png' };
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: '.jpg', contentType: 'image/jpeg' };
  }

  if (
    bytes.length >= 12
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { extension: '.webp', contentType: 'image/webp' };
  }

  const textStart = bytes.toString('utf8', 0, Math.min(bytes.length, 2048)).trimStart().toLowerCase();
  if (textStart.startsWith('<?xml') || textStart.startsWith('<svg') || textStart.includes('<svg')) {
    return textStart.includes('<svg') ? { extension: '.svg', contentType: 'image/svg+xml' } : null;
  }

  return null;
}

function filenameFromUrl(url, contentType, detectedType = null) {
  let name = '';
  try {
    const parsed = new URL(url);
    name = decodeURIComponent(path.posix.basename(parsed.pathname || ''));
  } catch {
    name = '';
  }

  const hash = createHash('sha256').update(url).digest('hex').slice(0, 12);
  const safeName = safeFilenamePart(name) || `base44-file-${hash}`;
  const ext = path.extname(safeName);
  const detectedExtension = detectedType?.extension || extensionFromContentType(contentType);

  if (ext) {
    return `${path.basename(safeName, ext)}-${hash}${ext}`;
  }

  return `${safeName}-${hash}${detectedExtension}`;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function csvValue(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function publicUrl(publicBaseUrl, key) {
  return `${publicBaseUrl.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function powershellSingleQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function downloadFile(url, outputDir) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`);
  }

  const httpContentType = contentTypeBase(response.headers.get('content-type')) || 'application/octet-stream';
  const tempName = `${createHash('sha256').update(url).digest('hex').slice(0, 16)}.download`;
  const tempPath = path.join(outputDir, tempName);
  await pipeline(response.body, createWriteStream(tempPath));

  const magicType = detectMagicType(tempPath);
  let contentType = httpContentType;
  if (httpContentType === 'application/octet-stream' && magicType) {
    contentType = magicType.contentType;
  }

  const filename = filenameFromUrl(url, contentType, magicType);
  const extension = path.extname(filename);
  if (!contentType || contentType === 'application/octet-stream') {
    contentType = magicType?.contentType || contentTypeFromExtension(extension);
  }
  if (!contentType || contentType === 'application/octet-stream' || extension === '.bin') {
    throw new Error('Unable to determine file type');
  }

  const localPath = path.join(outputDir, filename);
  renameSync(tempPath, localPath);

  return {
    contentType,
    filename,
    localPath,
  };
}

function runWranglerUpload({ bucket, key, localPath, contentType }) {
  const args = [
    'wrangler',
    'r2',
    'object',
    'put',
    `${bucket}/${key}`,
    '--file',
    localPath,
    '--content-type',
    contentType,
    '--remote',
  ];

  const powershellCommand = [
    '&',
    'npx',
    'wrangler',
    'r2',
    'object',
    'put',
    powershellSingleQuote(`${bucket}/${key}`),
    '--file',
    powershellSingleQuote(localPath),
    '--content-type',
    powershellSingleQuote(contentType),
    '--remote',
  ].join(' ');

  const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      powershellCommand,
    ], {
      stdio: 'inherit',
    })
    : spawnSync('npx', args, {
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Wrangler upload failed with exit code ${result.status}`);
  }
}

function buildCsv(rows) {
  const headers = ['old_url', 'new_url', 'r2_key', 'local_file', 'content_type', 'uploaded', 'error'];
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(',')),
    '',
  ].join('\n');
}

function buildSql(rows) {
  const successfulRows = rows.filter((row) => row.new_url && !row.error);
  const lines = [
    '-- Generated by scripts/migrate-base44-files-to-r2.mjs',
    '-- Review before applying to D1. This file only rewrites imported Base44 media URLs.',
  ];

  for (const row of successfulRows) {
    lines.push('');
    lines.push(`-- ${row.old_url}`);
    for (const [table, field] of SQL_FIELDS) {
      lines.push(
        `UPDATE ${table} SET ${field} = REPLACE(${field}, ${sqlString(row.old_url)}, ${sqlString(row.new_url)}) WHERE ${field} IS NOT NULL AND instr(${field}, ${sqlString(row.old_url)}) > 0;`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  const inputPath = path.resolve(args.input);
  const outputDir = path.resolve(args.out);
  const downloadDir = path.join(outputDir, DOWNLOAD_DIR_NAME);
  mkdirSync(downloadDir, { recursive: true });

  const urls = readUrls(inputPath);
  const rows = [];
  let downloadedCount = 0;
  let uploadedCount = 0;
  let failedCount = 0;

  console.log(`Upload target: ${args.dryRun ? 'none (dry-run)' : 'remote Cloudflare R2'}`);

  for (const oldUrl of urls) {
    const row = {
      old_url: oldUrl,
      new_url: '',
      r2_key: '',
      local_file: '',
      content_type: '',
      uploaded: 'no',
      error: '',
    };

    try {
      const downloaded = await downloadFile(oldUrl, downloadDir);
      downloadedCount += 1;

      const key = `${R2_PREFIX}/${downloaded.filename}`;
      const newUrl = publicUrl(args.publicBaseUrl, key);
      let uploaded = false;

      row.new_url = newUrl;
      row.r2_key = key;
      row.local_file = downloaded.localPath;
      row.content_type = downloaded.contentType;

      if (!args.dryRun) {
        runWranglerUpload({
          bucket: args.bucket,
          key,
          localPath: downloaded.localPath,
          contentType: downloaded.contentType,
        });
        uploaded = true;
        uploadedCount += 1;
      }

      row.uploaded = uploaded ? 'yes' : 'dry-run';
    } catch (error) {
      failedCount += 1;
      row.uploaded = 'no';
      row.error = error.message;
    }

    rows.push(row);
  }

  const csvPath = path.join(outputDir, 'base44-r2-url-map.csv');
  const jsonPath = path.join(outputDir, 'base44-r2-url-map.json');
  const sqlPath = path.join(outputDir, 'base44-r2-update.sql');

  writeFileSync(csvPath, buildCsv(rows), 'utf8');
  writeFileSync(jsonPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    dry_run: args.dryRun,
    bucket: args.bucket,
    public_base_url: args.publicBaseUrl,
    total_url_count: urls.length,
    downloaded_count: downloadedCount,
    uploaded_count: uploadedCount,
    failed_count: failedCount,
    rows,
  }, null, 2), 'utf8');
  writeFileSync(sqlPath, buildSql(rows), 'utf8');

  console.log(`Total URL count: ${urls.length}`);
  console.log(`Downloaded count: ${downloadedCount}`);
  console.log(`Uploaded count: ${uploadedCount}`);
  console.log(`Failed count: ${failedCount}`);
  console.log(`Generated CSV path: ${csvPath}`);
  console.log(`Generated JSON path: ${jsonPath}`);
  console.log(`Generated SQL path: ${sqlPath}`);
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
