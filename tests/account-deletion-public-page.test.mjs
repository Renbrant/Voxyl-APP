import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

function source(path) {
  return fs.readFileSync(new URL(path, import.meta.url), 'utf8');
}

const appSource = source('../src/App.jsx');
const pageSource = source('../src/pages/AccountDeletion.jsx');
const supportSource = source('../src/data/support-contact.json');

describe('Issue #104 public account-deletion page', () => {
  it('publishes a stable public /account-deletion route', () => {
    assert.match(
      appSource,
      /path="\/account-deletion" element=\{<AccountDeletion \/>\}/,
    );

    assert.match(
      appSource,
      /import AccountDeletion from '@\/pages\/AccountDeletion';/,
    );
  });

  it('uses the existing authenticated deletion confirmation flow', () => {
    assert.match(
      pageSource,
      /<DeleteAccountModal/,
    );

    assert.match(
      pageSource,
      /isAuthenticated && user/,
    );

    assert.match(
      pageSource,
      /onClick=\{\(\) => setShowDelete\(true\)\}/,
    );
  });

  it('offers login and a public email fallback when direct deletion is unavailable', () => {
    assert.match(
      pageSource,
      /navigateToLogin/,
    );

    assert.match(
      pageSource,
      /mailto:/,
    );

    assert.match(
      pageSource,
      /supportContact\.supportEmail/,
    );

    assert.match(
      supportSource,
      /voxyl\.app@gmail\.com/,
    );
  });

  it('describes permanent deletion in both supported languages', () => {
    assert.match(
      pageSource,
      /exclusão permanente/,
    );

    assert.match(
      pageSource,
      /permanent deletion/i,
    );

    assert.match(
      pageSource,
      /Playlists criadas por você/,
    );

    assert.match(
      pageSource,
      /Listening history and episode progress/,
    );

    assert.match(
      pageSource,
      /Profile media stored by Voxyl/,
    );
  });

  it('links the public deletion resource back to the privacy policy', () => {
    assert.match(
      pageSource,
      /navigate\('\/privacy'\)/,
    );
  });
});
