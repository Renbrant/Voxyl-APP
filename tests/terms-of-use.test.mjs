import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const appSource = read('src/App.jsx');
const settingsSource = read('src/pages/Settings.jsx');
const landingSource = read('src/pages/Landing.jsx');
const gateSource = read('src/components/legal/TermsAcceptanceGate.jsx');
const workerSource = read('workers/api/src/index.ts');
const migrationSource = read('workers/api/migrations/0010_terms_acceptance.sql');
const terms = JSON.parse(read('src/data/terms-of-use.json'));

// The version the Worker enforces, read from its source so the three copies
// (bundle, seed and Worker) cannot drift apart silently.
const workerVersion = workerSource.match(/const TERMS_OF_USE_VERSION = "([^"]+)";/)?.[1];

describe('Terms of Use contract', () => {
  it('uses the same version in the bundle, the Worker and the seed migration', () => {
    assert.ok(workerVersion, 'Worker declares TERMS_OF_USE_VERSION');
    assert.equal(terms.version, workerVersion);
    assert.equal(terms.effectiveDate, workerVersion);
    assert.ok(migrationSource.includes(`'${workerVersion}'`), 'migration seeds the same version');
  });

  it('seeds exactly the bundled content for every locale', () => {
    for (const [locale, body] of Object.entries(terms.locales)) {
      const literal = JSON.stringify(body).replace(/'/g, "''");
      assert.ok(
        migrationSource.includes(`'${literal}'`),
        `migration content for ${locale} matches src/data/terms-of-use.json`,
      );
    }
  });

  it('publishes English and Brazilian Portuguese with the required sections', () => {
    assert.equal(terms.publicUrl, 'https://v.renbrant.com/terms');

    for (const locale of ['en-US', 'pt-BR']) {
      const body = terms.locales[locale];
      assert.ok(body, `${locale} present`);
      const titles = body.sections.map((section) => section.title).join(' | ');
      assert.match(titles, /[Cc]ontent|[Cc]onte/, 'covers user content');
      assert.match(titles, /[Pp]rohibited|[Pp]roibido/, 'covers prohibited content');
      assert.match(titles, /[Rr]eport|[Dd]enúncia/, 'covers reporting and blocking');
      assert.match(titles, /[Ee]ligib|[Qq]uem pode/, 'covers minimum age');
    }
  });

  it('keeps the support address out of the bundle, so it is read from one place', () => {
    assert.doesNotMatch(JSON.stringify(terms), /@/);
  });

  it('does not reuse a version that a previous deployment already accepted', () => {
    assert.match(workerVersion, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('Terms acceptance migration', () => {
  it('adds acceptance columns to users', () => {
    assert.match(migrationSource, /ALTER TABLE users ADD COLUMN terms_accepted_version TEXT;/);
    assert.match(migrationSource, /ALTER TABLE users ADD COLUMN terms_accepted_at TEXT;/);
  });

  it('archives the terms as the current document for each locale', () => {
    assert.match(migrationSource, /'terms_of_use', 'en-US'/);
    assert.match(migrationSource, /'terms_of_use', 'pt-BR'/);
    assert.match(migrationSource, /ON CONFLICT \(document_type, locale, version\) DO NOTHING;/);
  });
});

describe('Terms routes and gate', () => {
  it('serves a public /terms route next to the privacy policy', () => {
    assert.match(appSource, /<Route path="\/terms" element={<TermsOfUse \/>} \/>/);
    assert.match(appSource, /<Route path="\/privacy" element={<PrivacyPolicy \/>} \/>/);
  });

  it('links the terms from Settings and the landing footer', () => {
    assert.match(settingsSource, /navigate\('\/terms'\)/);
    assert.match(landingSource, /href="\/terms"/);
  });

  it('renders the acceptance gate inside the router, on every authenticated screen', () => {
    assert.match(appSource, /<TermsAcceptanceGate \/>/);
  });

  it('keeps the terms and privacy pages readable without accepting first', () => {
    assert.match(gateSource, /PUBLIC_LEGAL_PATHS = \['\/terms', '\/privacy', '\/account-deletion'\]/);
  });

  it('gates the write paths the issue names, and no others', () => {
    const gateCalls = workerSource.match(/await assertTermsAcceptedForUserId\(/g) || [];
    assert.equal(gateCalls.length, 3, 'playlist creation, file upload and username claim are gated');
  });

  it('registers the accept endpoint on the authenticated profile path', () => {
    assert.match(workerSource, /isAcceptTermsRoute\(pathname\)/);
    assert.match(workerSource, /pathname === "\/me\/accept-terms" \|\| pathname === "\/api\/me\/accept-terms"/);
  });
});
