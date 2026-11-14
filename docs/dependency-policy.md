# Dependency Policy

## Monitoring

- Dependabot (`.github/dependabot.yml`) opens weekly grouped npm updates and monthly GitHub Actions updates.
- Run `npm audit` before every release. Never run `npm audit fix --force` blindly: review each breaking change, then run `npm test`, `npm run lint` and `npm run build`.
- `@capgo/capacitor-native-audio` is patched through `patches/` and `patch-package` (`postinstall`). After any dependency update, run `npm ci` and confirm that the patch reports as applied.
- Dependencies that nothing imports are removed. Capacitor packages are the exception: they are native plugins loaded by `cap sync`, not by JavaScript imports.

## Residual advisories (v0.6.3)

`npm audit` reports 2 moderate findings, both in `react-router` / `react-router-dom` 6.x (GHSA-337j-9hxr-rhxg, `deserializeErrors()` during server-side hydration). Voxyl is a client-rendered SPA and never server-renders or hydrates router state, so the vulnerable path is not reachable. The only fix is a major upgrade to React Router 7, which is tracked separately because it needs route and data-API migration and device testing.

## History

v0.6.3 removed 16 unused direct dependencies (`@hookform/resolvers`, `@radix-ui/react-toast`, `@stripe/react-stripe-js`, `@stripe/stripe-js`, `canvas-confetti`, `fast-xml-parser`, `html2canvas`, `jspdf`, `lodash`, `moment`, `react-hot-toast`, `react-leaflet`, `react-markdown`, `react-quill`, `three`, `zod`) and applied the non-breaking `npm audit fix`, reducing the audit from 33 findings (3 critical) to 2 moderate.
