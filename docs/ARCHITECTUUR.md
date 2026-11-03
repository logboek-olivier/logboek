# Architectuur

De architectuurbeschrijving staat in [`docs/app-kaart.md`](app-kaart.md) (3 november 2026): modules, databestanden,
versleuteling, sync, domeinlaag, dataversies, build en test, en wat er in de browser staat buiten de versleutelde opslag
(sectie 10, overgenomen uit de versie van dit bestand van 31 oktober). De regels van de app zelf staan in `CLAUDE.md`;
de domeinlaag in `docs/FUNDERING.md`, het periodemodel in `docs/PERIODEMODEL.md`.

Dit bestand is bewust kort: twee beschrijvingen van dezelfde code lopen uiteen (review C-2). De dataversies in
`docs/app-kaart.md` worden door `tests/review-versies.test.ts` tegen `src/model/schema.ts` gecontroleerd.
