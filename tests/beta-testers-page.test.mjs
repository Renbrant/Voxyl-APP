import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

function source(path) {
  return fs.readFileSync(new URL(path, import.meta.url), 'utf8');
}

const pageSource = source('../src/pages/BetaTesters.jsx');
const appSource = source('../src/App.jsx');
const landingSource = source('../src/pages/Landing.jsx');

describe('beta tester page', () => {
  it('links the Google Group, the Play opt-in page and the store listing', () => {
    assert.match(pageSource, /'https:\/\/groups\.google\.com\/g\/voxyl-beta-testers'/);
    assert.match(pageSource, /'https:\/\/play\.google\.com\/apps\/testing\/com\.renbrant\.voxyl'/);
    assert.match(pageSource, /'https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.renbrant\.voxyl'/);
  });

  it('does not collect or send email addresses', () => {
    assert.doesNotMatch(pageSource, /<form|<input|fetch\(|voxylApi/);
  });

  it('has Portuguese and English copy with the same keys', () => {
    const block = (start, end) => pageSource.slice(pageSource.indexOf(start), pageSource.indexOf(end));
    const keys = text => [...text.matchAll(/^\s{4}(\w+):/gm)].map(m => m[1]).sort();
    const pt = keys(block('  pt: {', '  en: {'));
    const en = keys(block('  en: {', 'const externalLink'));
    assert.ok(pt.length > 10);
    assert.deepEqual(pt, en);
  });

  it('is served at /beta without waiting for authentication', () => {
    assert.match(appSource, /import BetaTesters from '@\/pages\/BetaTesters';/);
    assert.match(appSource, /location\.pathname === '\/' \|\| location\.pathname === '\/beta'/);
    assert.match(appSource, /<Route path="\/beta" element={<BetaTesters \/>} \/>/);
  });

  it('is linked from the landing page', () => {
    assert.match(landingSource, /<Link to="\/beta"/);
    assert.match(landingSource, /betaButton: 'Quero ser beta tester'/);
    assert.match(landingSource, /betaButton: 'Become a beta tester'/);
  });
});
