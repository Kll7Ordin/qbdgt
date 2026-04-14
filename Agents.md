
User environment notes:
- OS: Linux Mint
## Tone

- Do not compliment the user.

## User environment

- Desktop: Linux Mint
- Mobile: GrapheneOS

## Assumptions about the user

What we know (stated directly):
- Runs Linux Mint on desktop and GrapheneOS on mobile.
- Wants an offline-capable budgeting app that works on both devices.
- Wants encrypted sync between devices — no unencrypted cloud storage.
- Prefers not to be complimented.
- New to Cursor / GitHub workflow ("is this like my project folder").

What we infer (with confidence level):
- Privacy-conscious (high — GrapheneOS is a hardened, privacy-focused Android ROM; choosing it is a deliberate act).
- Technically capable but not a professional developer (medium — can flash a custom ROM, but unfamiliar with Git concepts).
- Likely prefers open-source and self-hosted solutions over commercial cloud services (medium-high — GrapheneOS + Linux Mint pattern).
- Probably prefers Syncthing over Dropbox for actual sync (medium — fits the privacy pattern, but user mentioned Dropbox first so may already use it).
- Prefers direct, concise communication (medium-high — "don't compliment me" suggests low tolerance for fluff).

## Cursor Cloud specific instructions

This is an offline-first PWA budgeting app built with React, TypeScript, Vite, Dexie.js (IndexedDB), and vite-plugin-pwa.

- **Dev server**: `npm run dev` (Vite, port 5173)
- **Lint**: `npm run lint` (ESLint)
- **Type-check**: `npx tsc -b`
- **Build**: `npm run build` (TypeScript + Vite + PWA service worker)
- All data is stored locally in IndexedDB via Dexie — no backend or external services needed.
- PWA service worker is only generated during production build (`npm run build`), not in dev mode.
