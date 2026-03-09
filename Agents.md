## Tone

- Do not compliment the user.

## Cursor Cloud specific instructions

This is an offline-first PWA budgeting app built with React, TypeScript, Vite, Dexie.js (IndexedDB), and vite-plugin-pwa.

- **Dev server**: `npm run dev` (Vite, port 5173)
- **Lint**: `npm run lint` (ESLint)
- **Type-check**: `npx tsc -b`
- **Build**: `npm run build` (TypeScript + Vite + PWA service worker)
- All data is stored locally in IndexedDB via Dexie — no backend or external services needed.
- PWA service worker is only generated during production build (`npm run build`), not in dev mode.
