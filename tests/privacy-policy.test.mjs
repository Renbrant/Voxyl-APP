import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const settingsSource = fs.readFileSync(new URL('../src/pages/Settings.jsx', import.meta.url), 'utf8');
const privacyPageSource = fs.readFileSync(new URL('../src/pages/PrivacyPolicy.jsx', import.meta.url), 'utf8');
const manifestSource = fs.readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const migrationSource = fs.readFileSync(new URL('../workers/api/migrations/0005_legal_documents.sql', import.meta.url), 'utf8');
const supportMigrationSource = fs.readFileSync(new URL('../workers/api/migrations/0006_legal_document_support_email.sql', import.meta.url), 'utf8');
const privacyPolicy = JSON.parse(
  fs.readFileSync(new URL('../src/data/privacy-policy.json', import.meta.url), 'utf8'),
);
const supportContact = JSON.parse(
  fs.readFileSync(new URL('../src/data/support-contact.json', import.meta.url), 'utf8'),
);

describe('Google Play privacy policy contract', () => {
  it('keeps a public in-app privacy route and Settings entry point', () => {
    assert.match(appSource, /<Route path="\/privacy" element={<PrivacyPolicy \/>} \/>/);
    assert.match(settingsSource, /navigate\('\/privacy'\)/);
    assert.doesNotMatch(privacyPageSource, /dangerouslySetInnerHTML/);
  });

  it('publishes the current policy in English and Brazilian Portuguese', () => {
    assert.equal(privacyPolicy.version, '2026-08-29');
    assert.equal(privacyPolicy.effectiveDate, '2026-08-29');
    assert.equal(privacyPolicy.publicUrl, 'https://v.renbrant.com/privacy');
    assert.ok(privacyPolicy.locales['en-US']);
    assert.ok(privacyPolicy.locales['pt-BR']);

    const english = JSON.stringify(privacyPolicy.locales['en-US']);
    const portuguese = JSON.stringify(privacyPolicy.locales['pt-BR']);

    assert.match(english, /Clerk/);
    assert.match(english, /Cloudflare/);
    assert.match(english, /Podcast Index/);
    assert.match(english, /Account deletion/);
    assert.match(portuguese, /Clerk/);
    assert.match(portuguese, /Cloudflare/);
    assert.match(portuguese, /Exclusão da conta/);
  });

  it('uses the official Voxyl support and privacy email in the public policy and D1 ledger', () => {
    assert.equal(supportContact.supportEmail, 'voxyl.app@gmail.com');
    assert.equal(supportContact.effectiveDate, '2026-08-29');
    assert.match(privacyPageSource, /@\/data\/support-contact\.json/);
    assert.match(privacyPageSource, /mailto:\$\{supportContact\.supportEmail\}/);

    const english = JSON.stringify(privacyPolicy.locales['en-US']);
    const portuguese = JSON.stringify(privacyPolicy.locales['pt-BR']);
    assert.match(english, /voxyl\.app@gmail\.com/);
    assert.match(portuguese, /voxyl\.app@gmail\.com/);

    assert.match(migrationSource, /voxyl\.app@gmail\.com/);
    assert.match(supportMigrationSource, /ADD COLUMN support_email TEXT/);
    assert.match(supportMigrationSource, /voxyl\.app@gmail\.com/);
    assert.match(supportMigrationSource, /document_type = 'privacy_policy'/);
    assert.match(supportMigrationSource, /version = '2026-08-29'/);
  });

  it('describes Android permissions from the current manifest instead of stale camera claims', () => {
    assert.match(manifestSource, /android\.permission\.INTERNET/);
    assert.match(manifestSource, /android\.permission\.FOREGROUND_SERVICE_MEDIA_PLAYBACK/);
    assert.match(manifestSource, /android\.permission\.WAKE_LOCK/);
    assert.doesNotMatch(manifestSource, /android\.permission\.CAMERA/);

    const renderedPolicy = JSON.stringify(privacyPolicy);
    assert.doesNotMatch(renderedPolicy, /android\.permission\.CAMERA/);
    assert.doesNotMatch(renderedPolicy, /within 30 days/i);
    assert.doesNotMatch(renderedPolicy, /em até 30 dias/i);
  });

  it('archives the exact localized policy payloads in the D1 migration', () => {
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS legal_documents/);
    assert.match(migrationSource, /idx_legal_documents_one_current/);
    assert.match(migrationSource, /'privacy_policy'/);
    assert.match(migrationSource, /'en-US'/);
    assert.match(migrationSource, /'pt-BR'/);
    assert.match(migrationSource, /'2026-08-29'/);

    const englishPayload = JSON.stringify(privacyPolicy.locales['en-US']);
    const portuguesePayload = JSON.stringify(privacyPolicy.locales['pt-BR']);

    assert.ok(
      migrationSource.includes(`'${englishPayload}'`),
      'English policy stored in D1 must match the bundled public policy',
    );
    assert.ok(
      migrationSource.includes(`'${portuguesePayload}'`),
      'Portuguese policy stored in D1 must match the bundled public policy',
    );
  });

  it('keeps the policy page independent from authentication and backend availability', () => {
    assert.match(privacyPageSource, /@\/data\/privacy-policy\.json/);
    assert.doesNotMatch(privacyPageSource, /voxylApi/);
    assert.doesNotMatch(privacyPageSource, /useAuth/);
  });
});
