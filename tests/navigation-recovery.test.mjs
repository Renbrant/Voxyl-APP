import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('browser Back/Forward is owned by React Router (issue #117)', () => {
  const app = read('src/App.jsx');

  it('does not listen to popstate or issue a second history traversal', () => {
    assert.doesNotMatch(app, /addEventListener\(\s*['"]popstate['"]/);
    assert.doesNotMatch(app, /navigate\(\s*-1\s*\)/);
    assert.doesNotMatch(app, /BackButtonHandler/);
  });

  it('adds no popstate handling anywhere else in the app source', () => {
    for (const path of ['src/main.jsx', 'src/components/Layout.jsx', 'src/lib/entryRouting.js']) {
      assert.doesNotMatch(read(path), /popstate/, `${path} must not handle popstate`);
    }
  });
});

describe('account sync failure always offers a way out (issue #140)', () => {
  const library = read('src/pages/Library.jsx');

  it('shows both a retry and a sign-out action on the account sync screen', () => {
    const start = library.indexOf('if (accountSyncError) {');
    const block = library.slice(start, library.indexOf('const hasRemoteError', start));
    assert.match(block, /onClick=\{checkUserAuth\}/);
    assert.match(block, /onClick=\{\(\) => logout\(\)\}/);
    assert.match(block, /t\('settingsLogout'\)/);
  });

  it('takes logout from the auth context', () => {
    assert.match(library, /checkUserAuth,\s*logout,\s*\} = useAuth\(\)/);
  });
});
