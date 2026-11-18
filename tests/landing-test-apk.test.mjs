import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const landing = readFileSync(new URL('../src/pages/Landing.jsx', import.meta.url), 'utf8');

test('landing page offers only the beta APK, labeled with the source version', () => {
  assert.match(landing, /releases\/download\/android-test\/Voxyl-test\.apk/);
  assert.match(landing, /href=\{BETA_APK_DOWNLOAD_URL\}/);
  assert.match(landing, /Baixar APK beta v\$\{APP_VERSION\}/);
  assert.match(landing, /Download beta APK v\$\{APP_VERSION\}/);
  assert.doesNotMatch(landing, /0\.4\.13/);
});

test('landing page reads the beta version label from package.json', () => {
  assert.match(landing, /import \{ version as APP_VERSION \} from '..\/..\/package.json'/);
});
