import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

const root = new URL('..', import.meta.url).pathname;

// Public contact data that is intentionally published.
const ALLOWED_FILES = new Set([
  'src/data/support-contact.json',
  'src/data/privacy-policy.json',
]);

const PERSONAL_EMAIL = /[A-Za-z0-9._%+-]+@(?:gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|proton|protonmail)\.[A-Za-z.]+/i;
const SOURCE_EXTENSIONS = /\.(?:js|jsx|ts|tsx|mjs|json|html|css)$/;

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (SOURCE_EXTENSIONS.test(name)) files.push(path);
  }
  return files;
}

describe('no hardcoded personal identities in shipped code (issue #145)', () => {
  it('has no personal email address in src/ or workers/', () => {
    const offenders = [];
    for (const base of ['src', 'workers/api/src']) {
      for (const file of walk(join(root, base))) {
        const rel = relative(root, file).split('\\').join('/');
        if (ALLOWED_FILES.has(rel)) continue;
        if (PERSONAL_EMAIL.test(readFileSync(file, 'utf8'))) offenders.push(rel);
      }
    }
    assert.deepEqual(offenders, [], `personal email found in: ${offenders.join(', ')}`);
  });

  it('decides admin access on the Worker only, never from a client-side email check', () => {
    for (const path of ['src/pages/Admin.jsx', 'src/components/common/Sidebar.jsx', 'src/pages/Settings.jsx']) {
      const source = readFileSync(join(root, path), 'utf8');
      assert.match(source, /is_admin === true/, `${path} must use is_admin`);
      assert.doesNotMatch(source, /[uU]ser\?\.role === 'admin'/, `${path} must not infer admin from role`);
      assert.doesNotMatch(source, /email\?\.toLowerCase\(\) ===/, `${path} must not compare emails`);
    }
  });

  it('uses one admin criterion for playlist limits and follows', () => {
    const worker = readFileSync(join(root, 'workers/api/src/index.ts'), 'utf8');
    assert.doesNotMatch(worker, /user\.role === "admin" \?/);
    assert.doesNotMatch(worker, /currentUser\.role !== "admin"/);
  });
});
