# Logboek

Persoonlijke, versleutelde PWA voor een zeiljaar. Ontwerp, regels en volgorde staan in [CLAUDE.md](CLAUDE.md).

App: https://logboek-olivier.github.io/logboek/

## Ontwikkelen

```powershell
npm install
npm run dev          # lokale ontwikkelserver
npm run typecheck
npm run lint
npm test             # Vitest
npx playwright install chromium
npm run test:e2e     # Playwright (bouwt en start een preview)
npm run build
```
