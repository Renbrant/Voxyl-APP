import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

function source(path) {
  return fs.readFileSync(new URL(path, import.meta.url), 'utf8');
}

function section(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);

  assert.ok(start >= 0, `Missing section start: ${startMarker}`);
  assert.ok(end > start, `Missing section end: ${endMarker}`);

  return text.slice(start, end);
}

const apiSource = source('../src/api/voxylApiClient.js');
const modalSource = source('../src/components/profile/DeleteAccountModal.jsx');
const i18nSource = source('../src/lib/i18n.js');

describe('Issue #104 account deletion client contract', () => {
  it('uses canonical authenticated DELETE /me', () => {
    const authSource = section(
      apiSource,
      '  auth: {',
      '  entities:',
    );

    assert.match(authSource, /async deleteMe\(\)/);
    assert.match(
      authSource,
      /apiFetch\("\/me", \{ method: "DELETE" \}\)/,
    );
    assert.match(authSource, /data\?\.deleted !== true/);
  });

  it('does not use logout as a substitute for deletion', () => {
    const handler = section(
      modalSource,
      '  const handleDelete = async () => {',
      '  const current = steps[step];',
    );

    assert.doesNotMatch(
      handler,
      /functions\.invoke\(['"]deleteAccount['"]/,
    );

    const deleteIndex = handler.indexOf(
      'await voxylApi.auth.deleteMe()',
    );

    const logoutIndex = handler.indexOf(
      "await voxylApi.auth.logout('/')",
    );

    const deleteCatchIndex = handler.indexOf(
      '} catch (deleteError) {',
    );

    assert.ok(deleteIndex >= 0);
    assert.ok(logoutIndex > deleteIndex);
    assert.ok(deleteCatchIndex > logoutIndex);

    const failureSource = handler.slice(deleteCatchIndex);

    assert.match(
      failureSource,
      /setError\(t\('deleteError'\)\)/,
    );

    assert.match(
      failureSource,
      /setLoading\(false\)/,
    );

    assert.doesNotMatch(failureSource, /auth\.logout/);
  });

  it('uses permanent deletion copy and exposes a visible error', () => {
    assert.match(modalSource, /DELETE MY ACCOUNT/);
    assert.match(modalSource, /EXCLUIR MINHA CONTA/);
    assert.match(modalSource, /role="alert"/);

    assert.doesNotMatch(
      modalSource,
      /DEACTIVATE MY ACCOUNT/,
    );

    assert.doesNotMatch(
      modalSource,
      /DESATIVAR MINHA CONTA/,
    );

    assert.match(
      i18nSource,
      /deleteStep2Body:[\s\S]*?listening history[\s\S]*?social relationships/,
    );

    assert.match(i18nSource, /deleteError:/);
  });
});
