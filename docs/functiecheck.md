# Werkt alles echt?

Onafhankelijke review, 3 november 2026, commit `158102b`. Alles gedraaid in deze sessie op Linux met Node 22 en de
voorgeïnstalleerde Chromium 153 (Playwright 1.64 met `executablePath`), met nepdata en een nagebootste `api.github.com`
(`tests/e2e/helpers/fake-github.ts`). `logboek-data` is niet aangeraakt.

## 1. Testuitslagen

| Wat | Uitslag | Duur | Opmerkingen |
|---|---|---|---|
| `npm run typecheck` (`tsc -b`) | groen | — | |
| `npm run lint` (eslint) | groen, 0 meldingen | — | |
| `npm test` (Vitest) | **103 bestanden, 1.305 tests geslaagd, 6 overgeslagen, 1 bestand overgeslagen** | 244 s | De 6 overgeslagen tests en het overgeslagen bestand zijn allemaal `tests/integratie/github.test.ts` (`describe.skipIf(!TOKEN)`: alleen in CI met een token); verder is niets overgeslagen |
| `npx playwright test` zonder `upgrade` en `schermafbeeldingen` | **153 geslaagd, 0 gefaald** | 9,4 min, 3 workers, `retries: 0` | Geen flaky test gezien in deze ene run; CI draait met `retries: 1`, dus een incidentele flake blijft daar onzichtbaar |
| `tests/e2e/upgrade.spec.ts` (vanaf de vorige release op main, `.vorige/`) | **5 geslaagd**: bijwerken in dezelfde opslag en een schoon apparaat leest alles (1,5 min); de telefoon van 28 oktober (lus op het herstelscherm) komt in de app; bijwerken vanuit eerste keer, ontgrendelen en herstellen | 2,0 min | `npm run upgrade:vorige` slaagde (worktree, npm ci, generator, build); de drie oudere releases (`voorvorige`, `6fc2e72`, `41071c6`) niet lokaal gedraaid, wel in CI |
| `tests/e2e/screenshots.spec.ts` | niet gedraaid (8 rondes × ~6 min); CI bewaart ze als artifact | | |
| `tests/review-sommen.test.ts` (nieuw, zie 4) | 4 geslaagd, 1 overgeslagen (fixme) | 0,5 s | |
| `tests/e2e/review-kernstromen.spec.ts` (nieuw, zie 3) | **8 geslaagd** in één run (na correctie van eigen locators) | 2,6 min | |
| `npm audit` | 0 kwetsbaarheden (505 pakketten in de lockfile) | | |

## 2. Functie-inventaris

Status: **werkt** = in deze sessie gezien in een geslaagde test of eigen doorloop; **werkt (test)** = alleen door een
geslaagde bestaande test gedekt, niet zelf doorlopen; **werkt deels** = werkt, maar met een bevinding; **niet getest** =
geen test gevonden en niet zelf doorlopen. Bewijs = testbestand of schermafbeelding in `docs/screens/`.

| Functie | Waar in de UI | Code | Unit-tests | E2E-tests | Status, bewijs |
|---|---|---|---|---|---|
| Nieuw logboek (token, repo, wachtzin, herstelcode) | Eerste keer → Begin je eigen logboek | `src/screens/Setup.tsx`, `src/session.ts`, `src/crypto/keys.ts` | `session`, `crypto`, `key-invariant`, `meta-salt`, `tweede-gebruiker` | `setup-unlock`, `nieuwe-gebruiker`, `review-kernstromen` 1 | werkt; `docs/screens/01-…07-…` |
| Demo zonder GitHub | Eerste keer → Bekijk de demo; Instellingen → Demomodus | `src/demo.ts`, `src/demo/data.ts` | `demo` | `demo`, `nieuwe-gebruiker` | werkt (test) |
| Bestaand logboek koppelen (2e apparaat) | Eerste keer → Bestaand logboek koppelen | `Session.link` | `session` | `setup-unlock`, `review-kernstromen` 2 | werkt deels: repo van Olivier voorgevuld (review D-4); `10-koppelen-voorgevuld.png` |
| Vergrendelen na 5 min, hervatten, sessiesleutel | overal; Instellingen → Vergrendelen | `src/session.ts`, `src/storage/idb.ts` | `session`, `klok` | `session`, `setup-unlock` | werkt (test + doorloop 1) |
| Vingerafdruk (WebAuthn PRF) | Instellingen; Ontgrendelen | `src/crypto/webauthn.ts`, `src/storage/fingerprint.ts` | — | `screens` (virtuele authenticator) | werkt (test) |
| Wachtzin wijzigen, herstelcode tonen, token vervangen | Instellingen | `src/session.ts`, `src/screens/Settings.tsx` | `session`, `meta-salt` | `screens`, `review-kernstromen` 1 | werkt; `09b-herstelcode-tonen.png` |
| Sync met GitHub, conflicten, outbox, offline | status bovenaan; omlaag trekken | `src/storage/store.ts`, `sync.ts`, `github.ts`, `writer.ts` | `storage`, `opslag`, `storingen`, `github-gedrag`, `sync-randen`, `foutmatrix` | `alles-gesynct`, `opslag`, `review-kernstromen` 2 en 8 | werkt; `12-zonder-verbinding.png`, `13-na-conflict-beide-trips.png` |
| Integriteit (sha), bewijs, Alles herstellen | Meer → Opslag | `integrity.ts`, `evidence.ts`, `Store.repairAll` | `bewijs`, `opslag`, `foutmatrix`, `diagnose` | `bewijs`, `opslag`, `diagnose` | werkt (test) |
| Onleesbaar bestand per onderdeel, Logboek herstellen, Sleutel past niet, meta terugzetten | meldingen; `KeyProblem` | `src/repair.ts`, `src/screens/KeyProblem.tsx` | `unreadable`, `repair`, `repair-loop`, `foutmatrix`, `screen-files` | `unreadable`, `key-mismatch`, `losse-fouten` | werkt (test) |
| Schrijfversie, "Werk de app bij", ouder venster | status | `src/model/schema.ts`, `src/storage/versions.ts` | `schrijfversie`, `nieuwere-velden`, `updates` | `updates`, `upgrade`, `review-kernstromen` 8 | werkt; `72-oud-venster-werk-de-app-bij.png` |
| Updates: service worker, herladen, reset.html | balk "Nieuwe versie"; `reset.html` | `src/updates.ts`, `public/sw-vensters.js`, `public/reset.js` | `updates` | `updates`, `key-mismatch` ("nieuwe versies ruimen op"), `upgrade` | werkt (test) |
| Upgrade vanaf oudere releases | — | `scripts/build-previous.mjs`, `tests/upgrade/*` | `upgrade-samples` | `upgrade` (×4 in CI) | werkt: 5 geslaagd vanaf de vorige release (zie 1) |
| Back-up downloaden en terugzetten | Meer → Opslag | `src/storage/backup.ts` | `storage`, `foutmatrix` | `opslag` | werkt (test) |
| Exporteren naar Excel (CSV-zip, onversleuteld) | Meer → Opslag → Exporteren | `src/model/export.ts`, `ExportSection.tsx` | `export`, `privacy` | `exporteren` | werkt (test) |
| Opslag controleren, Gezondheid | Meer → Opslag | `storage-log.ts`, `src/domain/invariants.ts`, `gezondheid.ts` | `diagnose`, `domeinlaag`, `eigenschappen` | `opslag`, `diagnose` | werkt deels: fix van één tik voor 2 van 9 regels (review W-5) |
| Trip toevoegen via + | + → Trip | `src/components/QuickTrip.tsx`, `src/domain/trips.ts` | `quick-trip`, `trip-name` | `snelle-trip`, `review-kernstromen` 3 | werkt deels: standaardsoort "Training geven" en meteen Nakijken (review D-2); `21b-…png` |
| Nieuwe trip (volledig blad), bewerken, deelnemers | Logboek/Deze trip → Nieuwe trip; potlood | `WeekSheet.tsx`, `TripSheets.tsx`, `src/model/weeks.ts` | `weeks`, `week-links`, `guests`, `trip-ops` | `weeks`, `trips`, `edit`, `verwijderen`, `trip-overal-hetzelfde` | werkt; `23-trip-bewerken.png` |
| Dag loggen, bewerken, van/naar, afstandsvoorstel | + → Dag; Deze trip → Dag toevoegen | `QuickAdd.tsx`, `src/domain/dagen.ts`, `leg-trip.ts`, `estimate.ts` | `trip-dagen`, `periode`, `routes`, `waterroute`, `invoer-juist` | `quickadd`, `income`, `trip-dagen`, `routes`, `review-kernstromen` 3 | werkt; `22-deze-trip.png` |
| Periode verwijderen via ⋯, prullenbak, geschiedenis, ongedaan maken | ⋯; Meer → Prullenbak/Geschiedenis | `PeriodMenu.tsx`, `src/domain/prullenbak.ts`, `history.ts`, `commit.ts` | `prullenbak`, `geschiedenis`, `domeinlaag-ongedaan`, `eigenschappen` | `verwijderen`, `terug-waar-ik-was`, `review-kernstromen` 3 | werkt; `24-…`, `25-…`, `26-…png` |
| Excel/CSV importeren en opnieuw importeren | Logboek → Importeren; Opslag → Excel opnieuw importeren | `src/import/*`, `MileageImport.tsx` | `import`, `xlsx`, `excel-herstart`, `gouden`, `migraties-gouden` | `sailing`, `excel-herstart`, `boats`, `review-kernstromen` 4 | werkt; `31-import-controle.png`, `34-…png` |
| Boten uit de import controleren, Meer → Boten | na import; Meer → Boten | `src/model/boats.ts`, `Boats.tsx` | `boats` | `boats`, `verwijderen` | werkt; `32-boten-controle.png` |
| Plaatsen, pins, pin-assistent, samenvoegen | Meer → Plaatsen; kaartknop | `src/model/places.ts`, `pin-suggest.ts`, `PinSheet.tsx` | `places`, `pins` | `places`, `pins`, `map` | werkt (test) |
| Kaart (offline, OSM-detail, gebaren, meten, Kaarten offline) | kaarten overal; Meer → Kaarten | `SeaMap.tsx`, `map-view.ts`, `map-labels.ts`, `measure.ts`, `offline-maps.ts` | `map-view`, `map-labels`, `measure`, `offline-maps`, `osm-lib`, `waterroute` | `kaart`, `kaart-gebaren`, `meten`, `kaarten`, `map` | werkt (test) |
| Agenda: dagsoorten, periodes aan land, dagkaart, dagblad, periode markeren | Agenda | `src/model/calendar.ts`, `periods.ts`, `Agenda.tsx`, `DaySheet.tsx` | `calendar`, `periodes`, `periode`, `trip-agenda` | `agenda`, `agenda-links`, `periodes`, `onbeschikbaar`, `review-kernstromen` 5 | werkt; `40-agenda-overlap.png`, `41-dagkaart.png` |
| Planning importeren, seizoen, delen (PDF) | Agenda | `src/import/planning.ts`, `Season.tsx`, `AgendaShare.tsx` | `planning` | `agenda-planning`, `delen` | werkt (test) |
| Nakijken | Meer → Nakijken | `src/model/review.ts`, `Review.tsx` | `periodes` | `periodes`, `review-kernstromen` 3 | werkt; `21c-nakijken.png` |
| Periodes-lijst | Meer → Periodes | `period-list.ts`, `Periods.tsx` | `periodelijst` | `periodelijst`, `periodepagina` | werkt; `42-periodes.png` |
| Periodepagina / tripoverzicht, trip delen | Deze trip; tik op een trip | `PeriodPage.tsx`, `TripOverview.tsx`, `TripShare.tsx` | `periodepagina`, `trip-route` | `periodepagina`, `bekijken`, `delen`, `vandaag` | werkt |
| Vandaag (lopende trip, vragen, jaardoel, termijnen, weer) | Vandaag | `Today.tsx`, `src/model/weather.ts`, `WeatherCard.tsx` | `weather`, `daily`, `gaps` | `vandaag`, `weer`, `fill`, `herinnering` | werkt; `07-vandaag-leeg.png` |
| Trip afronden, weekafsluiting (+ geldstap) | Deze trip; zondag op Vandaag | `week-close.ts`, `week-money.ts`, `WeekClose.tsx` | `week-close`, `week-money` | `closing`, `weekafsluiting`, `weekgeld` | werkt (test) |
| Checklists per trip, studenten, cursussen, planning (les) | Deze trip; Meer → Cursussen/Studentenarchief | `checklists.ts`, `students.ts`, `curricula.ts`, `plans.ts`, `Planning.tsx` | `checklists`, `students`, `student-groups`, `curricula`, `plans`, `planning-grof` | `students`, `training`, `planning`, `studentenarchief` | werkt (test) |
| Organisaties instelbaar, teller | Instellingen → Organisaties | `src/basis/organisatie.ts`, `counters.ts`, `OrganisationSheet.tsx` | `organisaties`, `counters`, `review-sommen` | `teller`, `review-kernstromen` 6 | werkt deels: trip-soort niet "zeker" bij een eigen organisatie (W-3) |
| Salaris per trip, standaardbedrag, vraag op Vandaag, uitbetaling | Trip bewerken → Geld; Vandaag; Geld → Uitbetalingen | `salary.ts`, `money-path.ts`, `src/domain/geldmodel.ts` | `salary`, `salaris-resultaat`, `money-path`, `geld-dubbel`, `geld-gouden` | `salaris`, `geldpad`, `trip-geld`, `review-kernstromen` 6 | werkt; `51-salarisblad.png`, `52-vandaag-salarisvraag.png` |
| Inkomsten, fooi (ook USD), van wie, uitgave met Hoort bij | + → Inkomsten/Uitgave | `QuickAdd.tsx`, `src/domain/geld.ts`, `expenses.ts`, `TipFromPicker.tsx` | `money`, `rates`, `uitgaven`, `guests`, `rekenen` | `income`, `tips`, `uitgaven`, `geld-kiezer`, `review-kernstromen` 6 | werkt; `53-fooi-dollars.png`, `54-uitgave.png` |
| Eerder seizoen | Geld → Eerder seizoen | `EarlierSeason.tsx`, `addEarlierSeason` | `geld-seizoen` | `geld-kiezer`, `review-kernstromen` 6 | werkt |
| Geld: Werkelijk, totalen, per organisatie, per werkdag, transacties, doorklikken | Meer → Geld | `Money.tsx`, `src/domain/geldrapport.ts`, `doorklik.ts`, `DrillSheet.tsx` | `geld-rapporten`, `doorklik`, `review-sommen`, `werkelijk-verwacht` | `money`, `geld-rapporten`, `doorklik`, `werkelijk-verwacht` | werkt; `55-…`, `56-doorklik-inkomsten.png` |
| Jaaroverzicht voor de belasting (PDF) | Geld | `tax-year.ts`, `TaxYear.tsx` | `tax-year`, `review-sommen` | `jaaroverzicht` | werkt; `57-jaaroverzicht.png` |
| Rekeningen, standen, import van bankexports, netto waarde, tempo | Meer → Rekeningen | `accounts.ts`, `src/import/accounts.ts`, `Accounts.tsx` | `accounts` | `rekeningen` | werkt (test); importvoorinstellingen "nog te testen met een echte export" staat in de app zelf |
| Mijn positie, verandering, beginsaldo, uitsplitsing | Geld → Werkelijk | `position.ts`, `Position.tsx`, `beginsaldiInvoeren` | `position`, `doorklik` | `positie`, `review-kernstromen` 7 | werkt; `61-…`, `62-…`, `63-…png` |
| Verwacht: Gepland en Scenario, vooruitblik, aannames, eenmalig | Geld → Verwacht | `position.ts` (`forecast`), `scenario.ts`, `Scenario.tsx` | `scenario`, `position`, `costs` | `scenario`, `positie`, `kosten`, `review-kernstromen` 7 | werkt; `64-…`, `65-verwacht-scenario.png` |
| Kosten: vaste lasten (boeken na tik), gemiddelde per dagsoort | Geld → Verwacht → Kosten | `costs.ts`, `fixed-bookings.ts`, `actual-costs.ts` | `costs`, `werkelijk-verwacht` | `kosten`, `werkelijk-verwacht` | werkt (test) |
| Declaraties met bonnetje | + → Declaratie; Deze trip; Geld | `claims.ts`, `Claims.tsx`, `src/storage/documents.ts` | `claims`, `documents` | `declaraties` | werkt (test) |
| Kluis | Meer → Kluis | `documents.ts`, `DocumentSheets.tsx`, `Vault.tsx` | `documents`, `foutmatrix` | `kluis` | werkt (test); **testfase**, `VAULT_REVIEWED = false` |
| Termijnen, .ics, dagelijkse herinnering | Meer → Termijnen; Instellingen | `reminders.ts`, `ics.ts`, `daily.ts` | `reminders`, `daily` | `reminders`, `herinnering` | werkt (test) |
| Doelen en skills | Meer → Doelen; + → Skill | `goals.ts`, `GoalSheets.tsx` | `goals` | `doelen` | werkt (test) |
| Carrière | Meer → Carrière | `career.ts`, `Career.tsx` | `career` | `carriere` | werkt (test) |
| Statistieken, Waar ik gevaren heb, zeiltijd-export | Meer → Statistieken; Logboek | `stats.ts`, `Stats.tsx`, `sailtime.ts`, `SailedMap.tsx` | `stats`, `derive` | `statistieken`, `sailing` | werkt (test) |
| Taal nl/en | Instellingen → Taal | `src/i18n/*` | `i18n` | `language`, alle specs met `(en)` | werkt (test) |
| Terugknop, terug waar je was, navigatie | overal | `src/back.ts`, `navigation.ts`, `Home.tsx` | — | `terugknop`, `terug-waar-ik-was`, `navigation` | werkt (test) |
| Geld omzetten (eenmalig), periodemodel-migratie | na de eerste sync | `src/domain/geld-omzetten.ts`, `migrate-periods.ts` | `geld-gouden`, `migraties-gouden`, `periodes` | `upgrade` | werkt (test) |
| Integratietest tegen de echte GitHub-API | CI, job `integratie` | `tests/integratie/*` | — | — | niet gedraaid hier (alleen CI met token) |
| Schermafbeeldingen 360/412 licht/donker nl/en | CI-artifact | `tests/e2e/screenshots.spec.ts` | — | — | niet gedraaid hier |

## 3. Eigen doorloop op 360 px (`tests/e2e/review-kernstromen.spec.ts`)

De doorloop is één nieuwe spec met acht tests, als nieuwe gebruiker (geen organisaties van Olivier), met
schermafbeeldingen in `screenshots/review/` (kopie in `docs/screens/`). De eerste run van de spec legde vijf fouten in
mijn eigen locators bloot (verkeerde knopnaam, een komende trip zoeken in het Logboek, een balk per weekrij) en één echte
bevinding (de eerste trip staat in Nakijken); de tweede run staat hieronder.

| # | Stroom | Uitslag | Schermafbeeldingen | Opmerkingen |
|---|---|---|---|---|
| 1 | Nieuw logboek aanmaken (eigen repo-naam, foutmelding bij een onbekende repo, wachtzin, 24 woorden, controle), Vandaag, Deze trip, Agenda, Meer leeg; vergrendelen en ontgrendelen met de wachtzin; herstelcode tonen na de wachtzin | geslaagd | `01`–`09b` | De 24 woorden na "Herstelcode tonen" zijn gelijk aan die bij het aanmaken |
| 2 | Tweede apparaat koppelen met de wachtzin; beide apparaten zonder verbinding een trip maken; weer online: A synct, B synct (conflict op de sha, samenvoegen), A nog eens; beide zien drie trips; elke PUT heeft een commitbericht zonder inhoud | geslaagd | `10`–`13` | Bevinding D-4 (repo voorgevuld); een komende trip staat niet in het Logboek maar onder Periodes (D-3) |
| 3 | Trip via + met alleen datums; Vandaag toont "Eén ding nakijken"; twee dagen loggen; Deze trip "7 dagen · 2 gelogd"; naam bewerken; verwijderen via ⋯ ("Hieraan hangt: 2 gelogde dagen"); prullenbak; terugzetten | geslaagd | `20`–`26` | Bevinding D-2: de trip heet "Werk · Training geven" en staat in Nakijken |
| 4 | `mijlen-nep.xlsx` importeren (controlescherm, boten controleren, overslaan), 3 trips en 240 nm; hetzelfde bestand nog eens: zelfde aantal trips en dezelfde totalen | geslaagd | `30`–`34` | Geen dubbelingen |
| 5 | Twee overlappende trips met dezelfde deelnemer via Nieuwe trip; agenda zonder melding; dagkaart; Periodes; Nakijken noemt alleen "organisatie", niet overlap of de deelnemer | geslaagd | `40`–`43` | Bevinding D-2 ook via het volledige blad |
| 6 | Eigen organisatie "Nepzeil (NZ)"; twee trips; salaris € 1.000 via Trip bewerken → Geld; "Salaris van NZ #1 · Nepweek voorbij ontvangen?" op Vandaag → Ja; fooi $ 250; uitgave € 42,80; eerder seizoen € 3.000 + € 400; Geld: Inkomsten € 4.600, Kosten € 42,80, resultaat € 4.557,20; per organisatie Nepzeil; doorklik Inkomsten telt op en toont per kalenderjaar; jaaroverzicht per organisatie | geslaagd | `50`–`57` | De valuta van een nieuwe uitgave en van Eerder seizoen volgt de laatst gebruikte valuta (na de dollarfooi dus USD): in de eerste run werden € 42,80 en het seizoen als dollars geboekt (D-7) |
| 7 | Rekeningen ASN en DUO; standen € 2.500 en € 12.000 via Mijn positie; netto waarde −€ 9.500; eigen periode zonder beginstand → "Verandering onbekend" → Beginsaldo invoeren (2.000 en 12.500) → verandering +€ 1.000 uitgesplitst; Verwacht: Gepland; scenario met één blok (10 weken × € 1.000): scenario-inkomen +€ 10.000, einde € 500 | geslaagd | `60`–`65` | Met een zelf gekozen einddatum knipt de app het scenario af naar rato (€ 8.571,43 bij 60 van 70 dagen) en zegt dat erbij: bedoeld gedrag |
| 8 | Zonder verbinding een dag loggen ("wijziging wacht"), weer online: tik op de status → Gesynct met een nieuwe PUT; daarna een nieuwere build "gestart" in `localStorage`: een nieuwe dag geeft "Werk de app bij" en geen enkele PUT | geslaagd | `70`–`72` | |

Twee kanttekeningen bij de afbeeldingen: `60-rekeningen-leeg.png` is te vroeg gemaakt (toont alleen "Synchroniseren…"),
en de datumvelden tonen "11/03/2026" omdat de headless Chromium van de test Engelstalig is; op een Nederlandse telefoon
toont de browser dd-mm-jjjj. Alle acht slaagden; in de eerste runs faalden er zes door mijn eigen locators (verkeerde knopnaam, komende trip in het
Logboek zoeken, een balk per weekrij, de valuta die de laatste keuze volgt, de periode die het scenario afknipt). Die
fouten zijn zelf ook informatie: ze zijn precies de plekken waar een nieuwe gebruiker iets anders verwacht dan de app doet
(D-2, D-3, D-7 en de scenario-afkap).

## 4. Sommen met code gecontroleerd

Bestaande tests die dit al afdekken: `tests/doorklik.test.ts` (profiel A en B: elk doorklikscherm telt op tot het getikte
bedrag; verandering netto waarde sluit), `tests/geld-rapporten.test.ts` (gouden dataset: per organisatie = jaaroverzicht
= transactielijst; resultaat per tocht), `tests/scenario.test.ts` (de som van de vooruitblik sluit in centen),
`tests/position.test.ts`.

Nieuw: `tests/review-sommen.test.ts`:
- voor profiel A én B: per organisatie = jaaroverzicht = transactielijst (verdiend, kosten en saldo, per jaar), elke groep
  van het jaaroverzicht staat met hetzelfde bedrag in per organisatie, en elk tochtresultaat is salaris + fooi + overig −
  uitgaven;
- voor 500 willekeurige logboeken (alle soorten geld, verwijderde tochten, seizoenen, geld zonder tocht, verwachte en
  ontvangen salarissen, EUR en USD): dezelfde gelijkheden, plus "alle tochtresultaten + het geld zonder levende tocht =
  het saldo in Geld + de verwachte salarissen". **Alles slaagt.** Het geldmodel is dus consistent, ook buiten Oliviers
  profiel.
- overgeslagen (`it.skip`, FIXME W-3): een trip bij een eigen organisatie zonder type is niet "zeker" werk, een trip bij
  Sailing Virgins wel (`src/model/trip-kind.ts:45`). Eén keer bewust gedraaid: faalt (`{"kind":"werk","type":"overig","sure":false}`).

Tweede nepprofiel (één organisatie, alleen USD, geen rekeningen, geen planning, geen carrièrestart): `profileB` in
`tests/helpers/profielen.ts`, gebruikt in `doorklik.test.ts` (verandering = "geen rekeningen", periode = dit jaar,
bedragen in euro kloppen) en nu ook in `review-sommen.test.ts`.

## 5. Olivier-specifieke dingen in de code

Gemeten met `grep` op `src/` zonder `src/i18n/` (91 regels noemen Sailing Virgins, Yacht Week, logboek-olivier of Olivier,
grotendeels commentaar). Wat gedrag beïnvloedt:

| Waar | Wat | Gevolg voor een andere gebruiker |
|---|---|---|
| `src/model/trip-kind.ts:30-35,45` | `WORK_NAME` kent alleen "yacht week", "sailing virgins", "SV", "YW"; alleen de organisaties `sailing-virgins` en `yacht-week` maken een trip zonder type "zeker" | Trips van een eigen organisatie zonder type belanden in Nakijken (bevestigd) |
| `src/components/QuickTrip.tsx:30` | Standaardsoort `training-geven` | Elke eerste trip van een niet-instructeur heet "Werk · Training geven" |
| `src/model/types.ts:248` | `TransactionSource = 'yacht-week' \| 'sailing-virgins' \| 'delivery' \| 'overig'` | Terugval van het jaaroverzicht (`tax-year.ts:68`) en de demo; een eigen organisatie is altijd `overig` in dit veld (werkt, maar de twee namen staan vast in het dataformaat) |
| `src/basis/organisatie.ts:18` | `LEGACY_ORGS` voor een logboek zonder `organisations` en zonder `startedEmpty` | Alleen Oliviers oude logboek; goed afgebakend |
| `src/storage/github.ts:16`, `src/screens/Setup.tsx:121` | `DATA_REPO` als voorgevulde repo bij koppelen | Een andere gebruiker ziet Oliviers repo-naam |
| `src/model/daily.ts:12` | Terugval-URL `logboek-olivier.github.io` in het .ics-bestand | Alleen zonder `location`; in de browser altijd de eigen origin |
| `src/model/types.ts:674` | Rekeningaanbieders ASN, Revolut, BUX, DEGIRO, DUO | Nederlandse keuzes; "Overig" bestaat |
| `src/model/weather.ts`, `src/model/offline-maps.ts` | Vaste weerpunten en vier kaartgebieden | Geen weer en geen detailkaart buiten die gebieden (netjes afwezig, niet fout) |
| `src/demo/data.ts` | Demo met Sailing Virgins en Yacht Week | Alleen beeld |
| `src/import/mileage-csv.ts` | Kopregel `Datum; Van (plaats); …` van Oliviers Excel verplicht, Nederlandse namen | Een andere registratie importeert niet zonder het bestand om te bouwen |
| `index.html:2`, `vite.config.ts:46` | `lang="nl"`, manifest `lang: 'nl'`, Nederlandse beschrijving | De installatieprompt en de app-store-achtige metadata zijn Nederlands, ook voor een Engelse telefoon |
| `src/i18n/index.ts:29` | Zonder browsertaal: `nl` | Alleen in rare omgevingen |
| Datums | Overal `jjjj-mm-dd` als invoer, weergave via `Intl` met `nl-NL`/`en-GB` | Goed |
| Valuta | Negen valuta's vast in `Currency` (`types.ts:249`), ECB-koersen; geen AUD, CAD, NZD, ZAR, THB | Een schipper buiten die valuta's kan niet invoeren |
| Teksten in één taal | Geen hardgecodeerde Nederlandse UI-tekst gevonden buiten `src/i18n` (grep op JSX-tekst leverde 0 treffers); `Unlock.tsx:67` toont "Logboek" (de naam) | Goed |

## 6. Wat niet is gecontroleerd

De integratietest tegen de echte GitHub-API (alleen in CI), de schermafbeeldingrondes, de kaartdata-build (`kaart.yml`),
de weer- en koersscripts tegen de echte bronnen, vingerafdruk op een echte telefoon, en alles in `logboek-data`.
