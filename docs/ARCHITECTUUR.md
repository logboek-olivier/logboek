# Architectuur van Logboek

Kort en feitelijk: hoe de app in elkaar zit, stand 31 oktober 2026 (na ronde 3, de controle van de fundering en het
periodemodel uit `docs/PERIODEMODEL.md`). CLAUDE.md is de bron van waarheid voor
regels en gedrag; dit bestand beschrijft waar die regels in de code zitten. Wijkt dit bestand af van de code, dan is dit
bestand verouderd.

## 1. Modules en verantwoordelijkheden

| Laag | Bestanden | Verantwoordelijkheid |
|---|---|---|
| Opstart | `index.html`, `src/main.tsx`, `src/App.tsx`, `src/splash.css` | CSP (meta-tag), niet in een frame, opstartscherm, registratie van de service worker, bouw noteren (`noteStartedBuild`), keuze tussen sessie en demo |
| Service worker | `vite.config.ts` (Workbox), `public/sw-vensters.js`, `src/updates.ts`, `public/reset.html` + `reset.js` | Precache, runtime-caches (koersen, weer, kaart-osm), nieuwe versie neemt over en herlaadt vensters, noodpagina |
| Sessie | `src/session.ts` | Eerste keer (nieuw of koppelen), ontgrendelen (wachtzin, herstelcode, vingerafdruk, sessiesleutel), vergrendelen na 5 minuten, wachtzin wijzigen, token vervangen, "Logboek herstellen", meta terugzetten |
| Crypto | `src/crypto/encrypt.ts`, `keys.ts`, `passphrase.ts`, `recovery.ts`, `webauthn.ts` | AES-GCM-objecten met pad als AAD, meta.json.enc (verpakte hoofdsleutel, check-veld), PBKDF2, herstelcode (BIP39), WebAuthn-PRF |
| Opslag op het apparaat | `src/storage/idb.ts`, `outbox.ts`, `token.ts`, `fingerprint.ts`, `writer.ts` | IndexedDB (`objects`, `local`, `session`), outbox, versleutelde token en vingerafdruk-verpakking, Web Locks (`lokaal`, `sync`) |
| Store | `src/storage/store.ts` | Ontsleutelde records in het geheugen, opslaan (één schrijver), sync-rondes, sleutel-invariant, onleesbare bestanden, herstellen, controle (Opslag), kluisbestanden |
| GitHub | `src/storage/github.ts`, `sync.ts`, `integrity.ts`, `versions.ts`, `evidence.ts`, `device.ts` | Enige netwerklaag (api.github.com; de data-repo staat bij de token, standaard `logboek-olivier/logboek-data`), samenvoegen per record, `sealForUpload`, sha-controle, schrijfverbod voor oudere vensters, bewijs per bestand, commitberichten |
| Herstel en diagnose | `src/repair.ts`, `src/errors.ts`, `src/storage/storage-log.ts` | Diagnose lokaal en op GitHub, herstelverslag, foutdetails zonder inhoud, opslaglogboek in `localStorage` |
| Back-up en export | `src/storage/backup.ts`, `src/model/export.ts`, `src/components/ExportSection.tsx`, `src/share.ts` | Versleutelde back-up (tekstbestand), onversleutelde CSV-export na waarschuwing, delen of downloaden |
| Demo | `src/demo.ts`, `src/demo/data.ts` | Eigen IndexedDB `logboek-demo`, eigen sleutel, `blockNetwork` |
| Model | `src/model/*.ts` | Typen (`types.ts`), afgeleide data, bewerkingen met ongedaan maken (`edit.ts`, `trip-ops.ts`, ...), geld, agenda, statistieken |
| Import | `src/import/*.ts` | CSV/Excel lezen (`rows.ts`, `csv.ts`, `xlsx.ts`, `xml.ts`), mijlenregistratie (`mileage-csv.ts`, `apply.ts`), planning, bankstanden |
| Schermen | `src/screens/*.tsx`, `src/components/*.tsx`, `src/lazy.ts`, `src/back.ts`, `src/navigation.ts`, `src/screen-files.ts` | UI; alleen Vandaag laadt direct, de rest lui; terugknop; welke bestanden bij welk scherm horen |
| Taal | `src/i18n/` | `nl.ts` (bron, getypeerde sleutels), `en.ts`, `labels.ts` |
| Bouw en CI | `.github/workflows/*.yml`, `scripts/*` | Deploy (Pages, koersen, weer), tests (unit, e2e, upgrade, integratie), kaartdata |

## 2. Databestanden in logboek-data

Alle databestanden hebben hetzelfde formaat: `versie(1) | iv(12) | AES-GCM(ciphertext + tag)` onder de hoofdsleutel, met het
pad als AAD; de inhoud is `{format: 'logboek-collection', schemaVersion: 1, minWriterVersion, records: [...]}`. Elk record heeft `id`,
`updatedAt`, `deletedAt`. Samenvoegen per `id`, laatste `updatedAt` wint (`mergeRecords` in `src/storage/sync.ts`).

**Schemaversie:** alle bestanden staan op `SCHEMA_VERSION = 1` (`src/model/schema.ts`). Er is nog nooit een migratie
nodig geweest: nieuwe velden zijn optioneel en worden bij het lezen aangevuld of afgeleid (bijvoorbeeld tripdatums uit de
dagen, `currentSettings` met standaardwaarden, `deletedAt` ontbreekt = `null`). Een hogere versie of objectformaat →
`NewerSchemaError` → niets schrijven, "Werk de app bij".

**Schrijfversie:** elk bestand draagt `minWriterVersion`, de schrijfversie van de build die het schreef (`WRITER_VERSION`
in `src/model/schema.ts`). Een build met een lagere schrijfversie krijgt `NewerWriterError` (een `NewerSchemaError`) en
schrijft dus niets over dat bestand; zonder het veld telt een bestand als 0, een onbekende waarde als nieuwer. Een bestand
met een lagere schrijfversie schrijft `syncCollection` één keer opnieuw. Omhoog als een oudere build niet meer over de
bestanden van een nieuwe build mag schrijven, ook zonder nieuw schema; nooit omlaag.

**Aanmaken op GitHub:** een databestand ontstaat op GitHub alleen in `Store.syncPath` (na de meta-controle van die ronde
en een tweede GET), en wordt daarna één keer teruggelezen (`verifyCreated`). Herstellen (`replaceRemote`) maakt nooit iets
aan. Elke upload gaat door `sealForUpload` (versleutelen en weer ontsleutelen) en `putFile` (sha als voorwaarde,
`assertCurrentBuild`, sha van het antwoord gecontroleerd).

| Bestand | Recordtype (`types.ts`) | Schrijvers (model) | Belangrijkste lezers | Bijzonderheden |
|---|---|---|---|---|
| `meta.json.enc` | `Meta` (geen collectie) | `Session.finishNewVault`, `doChangePassphrase`, `doRestoreRemoteMeta` | sessie (ontgrendelen), `Store.checkMeta` | Niet onder de hoofdsleutel: JSON met salts, verpakte MK (wachtzin, herstelcode) en `check` (binding aan MK). Lokaal als platte JSON in `objects` |
| `trips.json.enc` | `Trip` | `weeks`, `trip-ops`, `trip-dates`, `edit`, `salary`, `money-path`, `boats`, `gaps`, `guests`, `counters`, `checklists`, `calendar`, `import/apply`, `import/planning`, QuickAdd, MoneyPath | bijna alle schermen | Periode op het water (werk, training, plezier): `kind` opgeslagen of afgeleid (`trip-kind`), `type` is het subtype. Alle velden optioneel; type, datums en boot afgeleid. Salaris met status verwacht, ontvangen of `geen`; wat meetelt bepaalt `countedSalary` (geen 0, geen "Geen salaris", een standaardbedrag alleen bij een trip van die organisatie) |
| `legs.json.enc` | `Leg` | `edit`, `trip-ops`, `places`, `routes`, `boats`, `gaps`, `import/apply`, QuickAdd | Vandaag, Deze trip, Logboek, Agenda, Statistieken, Plaatsen | Import vervangt alle `source: import`-legs |
| `transactions.json.enc` | `Transaction` | `edit`, `salary`, `money-path`, `claims`, `trip-ops`, `rates` (koers vastleggen), QuickAdd | Geld, Deze trip, Agenda, positie, kosten | `tripId` is het periode-id (trip of periode aan land). Soort (`category`) bij elke uitgave; opleiding en uitrusting zijn `investering`. `source` afgeleid uit de periode (`expenses`). Geboekte vaste last: `fixedCostId`, id `vast:<vaste last>:<jjjj-mm>` (`fixed-bookings`). Richting volgt uit `kind`; `payoutId`, `claimId` koppelen. Vaste id's voor wat de app zelf boekt: `salaris:<trip>` (salaris ontvangen of uitbetaling), `uitgave:<declaratie>` en `terugbetaling:<declaratie>`, zodat een tweede tik of een tweede apparaat nooit dubbel boekt |
| `settings.json.enc` | `Settings` | `settings`, `trip-dates` | overal | Hoofdrecord `settings` plus per apparaat `laatst:<apparaat-id>` (laatst gebruikte boot, rol, valuta enzovoort), zodat loggen op het ene apparaat nooit een instelling van het andere overschrijft; `currentSettings` legt ze over elkaar en vult standaardwaarden |
| `curricula.json.enc` | `Curriculum` | `curricula` | Cursussen, studenten, planning | Alleen eigen en bewerkte; seeds in de code. Onleesbaar → vanzelf hersteld |
| `students.json.enc` | `Student` | `students`, `weeks`, `trip-ops` | Deze trip, Studentenarchief | Regel 14; archiveren na 12 maanden |
| `plans.json.enc` | `WeekPlan` | `plans`, `trip-ops` | Planning, Vandaag | Blok standaard voor alle groepen samen; `ownThemes` (eigen thema's als tekst); concept en opgeslagen planning bewerkt via `applyBlockEdit` |
| `places.json.enc` | `Place` | `places` | kaarten, Plaatsen, afstandsvoorstel | Pinregels in `pinQuestion` |
| `reminders.json.enc` | `Reminder` | `reminders`, `edit` | Termijnen, Vandaag, Agenda | |
| `checklists.json.enc` | `Checklist` | `checklists` | Deze trip | Alleen eigen en bewerkte; seeds in de code. Onleesbaar → vanzelf hersteld |
| `calendar.json.enc` | `CalendarDay` | `calendar`, `import/planning`, DaySheet | Agenda, Vandaag, Statistieken, kosten | id = `dag:<datum>` |
| `weekreviews.json.enc` | `WeekClosing` | `week-close`, `edit` | Vandaag, Agenda, kosten | id = `week:<jjjj>-W<ww>` |
| `goals.json.enc` | `Goal` | `goals`, `edit` | Doelen | |
| `skills.json.enc` | `Skill` | `goals`, `edit` | Doelen, Toevoegen | |
| `sessions.json.enc` | `Session` | `goals`, `edit` | Doelen | Losse records per sessie of meting |
| `documents/index.json.enc` | `VaultDocument` | `documents`, `claims`, `edit`, `trip-ops` | Kluis, Termijnen, declaraties | Tombstone zonder titel (`scrubbedDocument`) |
| `documents/<uuid>.bin` | bytes (geen collectie) | `Store.putDocumentFile` → `uploadDocumentFiles` | Kluis, declaraties | AAD = pad; pas na `match` en ná de databestanden; na een dag verwijderd → DELETE |
| `career.json.enc` | `CareerRecord` | `career`, `edit` | Carrière, Termijnen | Tombstone zonder inhoud |
| `accounts.json.enc` | `Account` | `accounts` | Rekeningen, positie | Niet in de demo |
| `balances.json.enc` | `Balance` | `accounts`, `week-money`, Accounts | Rekeningen, positie | id = `stand:<rekening>:<jjjj-mm>` |
| `fixedcosts.json.enc` | `FixedCost` | `costs` | Geld → Kosten, vooruitblik | |
| `claims.json.enc` | `Claim` | `claims`, `trip-ops` | Deze trip, Geld, positie | Bonnetje in de kluis; uitgave met `claimId` |
| `periods.json.enc` | `StayPeriod` | `periods` (`setStayDays`, `updateStay`), `migrate-periods`, `calendar` (`followTrip`), `trip-dates`, `import/planning`, `expenses` | Agenda, periodepagina, Periodes, Nakijken, Geld | Periodes aan land (reis, thuis, vrij). Water gaat voor land: een trip maakt ze korter of splitst ze. Migratie-id `periode:<soort>:<start>` |

**Eenmalig en terugkerend na een geslaagde sync** (`src/screens/Home.tsx`, nooit in de demo): de migratie naar het
periodemodel (`migrate-periods.ts`, één keer per logboek, `settings.periodsMigratedAt`; zonder iets om te zetten schrijft
hij niets) en het boeken van vaste lasten van voorbije maanden (`fixed-bookings.ts`, vaste id's, nooit opnieuw na
aanpassen of verwijderen). Wijzigingen over meerdere bestanden met ongedaan maken gaan via `changes.ts`
(`applyChanges`, `undoableIn`).

## 3. Levenscyclus van een wijziging

1. **Invoer** (scherm) → een modelfunctie (`src/model/*.ts`) maakt een nieuw record met nieuwe `updatedAt` en roept
   `store.put` / `putMany` aan. Verwijderen = tombstone (`deletedAt`), vaak geschoond (`scrubbed*`), met ongedaan maken
   uit het geheugen. Bewerken neemt velden die deze build niet kent ongewijzigd mee (`keepUnknownFields`), zodat een
   oudere build niets weggooit wat een nieuwere schreef.
2. **Geheugen:** `putMany` werkt de collectie in het geheugen bij en zet het record in de outbox (`markPending`) en in
   `unsaved`. Een `updatedAt` die niet later is dan die van de vorige versie (een klok die achterloopt, of een record
   met een tijd in de toekomst) wordt `justAfter(vorige)`, zodat de laatste wijziging echt wint. Wat de app vanzelf
   vastlegt (koers, archiveren) krijgt `justAfter` van het record waarop het rekende, zodat het nooit wint van een echte
   wijziging op een ander apparaat. Een lokaal bestand van een nieuwere app (`frozen`) → weigeren vóór er iets verandert.
3. **Apparaat (`persist`):** onder het slot `lokaal` (Web Locks): de kopie op schijf lezen en samenvoegen (een ander
   venster kan geschreven hebben), versleutelen, en bestand plus outbox in één IndexedDB-transactie schrijven, alleen als
   de lokale meta nog het check-veld van deze sessie heeft (`putObjectAndLocal`). Daarna `BroadcastChannel` naar andere
   vensters (`absorbDisk`) en na 0,8 s een sync (`changedOnly`).
4. **Sync-ronde (`runSync`)**, onder het slot `sync` (één venster tegelijk):
   - geen ronde als de sleutel niet past (`mismatch`), het bestand van een nieuwere app is (`outdated`) of een nieuwere
     build gestart is (`newerBuildStarted`);
   - `assertVault` (lokale meta hoort bij de sleutel), `absorbAll` (wat andere vensters opsloegen);
   - `checkMeta`: meta.json.enc op GitHub moet `match` zijn, anders `KeyMismatchError` (niets schrijven);
   - leespas: alle betrokken bestanden ophalen (`getFile`, sha-controle) en ontsleutelen vóór er iets geschreven wordt;
     onleesbare bestanden worden overgeslagen en gemeld; seedbestanden worden vanzelf hersteld;
   - per bestand `syncPath` → `syncCollection`: samenvoegen, `sealForUpload`, `putFile` met de oude sha; conflict →
     opnieuw (3×); daarna lokaal opslaan (samengevoegd met wat intussen gebeurde) en de outbox leegmaken voor wat mee ging;
   - kluisbestanden uploaden (alleen na `match`, ná de databestanden), verwijderde documentbestanden van GitHub halen;
   - bewijs ophalen voor onleesbare bestanden (alleen lezen).
5. **GitHub:** commitbericht `sync <tijd> v<versie>+<commit> d<apparaat>`; de app praat alleen met api.github.com.
6. **Ander apparaat:** bij ontgrendelen, verversen of na een eigen opslag een volledige of gedeeltelijke ronde: ophalen,
   ontsleutelen, samenvoegen (laatste `updatedAt` wint, bij gelijk wint GitHub), lokaal opslaan.

## 4. Sleutelbeheer

- **Nieuw logboek:** `createVault` maakt een willekeurige MK, verpakt hem onder de wachtzin-KEK (PBKDF2, 600.000) en de
  herstelcode-KEK (HKDF uit 24 woorden), plus `check` (de verpakkingen versleuteld onder MK). `finishNewVault` zet
  meta.json.enc op GitHub (PUT zonder sha), vergrendelt andere tabbladen, wist de lokale opslag en opent.
- **Data-repo:** bij de eerste keer (en bij herstel met een nieuwe token) "eigenaar/naam", standaard
  `logboek-olivier/logboek-data`; bewaard bij de token (`StoredToken.repo`), dus per apparaat en browserprofiel één
  logboek. Een tweede gebruiker heeft een eigen repo, token, wachtzin en hoofdsleutel (CLAUDE.md, Twee gebruikers).
- **Koppelen:** meta.json.enc ophalen, `unlock` met wachtzin of herstelcode, lokale opslag wissen, openen.
- **Ontgrendelen:** `unlock` (wachtzin of herstelcode) of de vingerafdruk (WebAuthn-PRF → KEK → MK, verpakking in
  IndexedDB `local` onder `fingerprint`, AAD `local/fingerprint#masterKey`). `bindKey`: de MK moet via `check` bij de lokale meta horen; anders "Sleutel past niet" of
  "Logboek herstellen".
- **Sessiesleutel (regel 10):** de niet-exporteerbare MK met `lastUsed` in IndexedDB-store `session`
  (`putSessionKeyIfVault`), hoogstens elke 15 s bijgewerkt; bij openen alleen gebruikt als jonger dan 5 minuten, niet
  in de toekomst en jonger dan het laatste vergrendelen (`logboek-vergrendeld:<db>` in `localStorage`).
- **Vergrendelen:** timer (monotone klok) of handmatig; in elk tabblad (`BroadcastChannel logboek-session:<db>`):
  sessiesleutel wissen, Store wissen (`lock`), naar het ontgrendelscherm.
- **Wachtzin wijzigen:** zelfde MK opnieuw verpakken, nieuwe meta naar GitHub (sha als voorwaarde) en lokaal.
- **Meta van GitHub overnemen** (`refreshMeta`, en bij een conflict tijdens wachtzin wijzigen): alleen als `safeToAdopt`
  klopt: een verpakking van de wachtzin of herstelcode die niet veranderd is, houdt dezelfde salt, rondes en kdf. Zo kan
  wie alleen de token heeft de wachtzin of herstelcode niet onbruikbaar maken door de salt te wijzigen (het check-veld
  dekt de salts niet).
- **Herstel:** `src/repair.ts` + `Session.doRepair`: na wachtzin of herstelcode alleen wissen wat met de sleutel niet te
  ontsleutelen is, en op GitHub alleen niet te ontsleutelen bestanden vervangen.
- **Meta terugzetten:** `doRestoreRemoteMeta` als meta.json.enc op GitHub ontbreekt of kapot is en er geen ander logboek
  staat.

## 5. Service worker en updates

- Workbox met `skipWaiting` en `clientsClaim`; `sw-vensters.js` herlaadt bij een update alle vensters (hoogstens één keer
  per minuut); een venster dat zelf herlaadt (`src/updates.ts`) wacht tot niets halverwege is (eerste keer, wachtzin,
  herstellen).
- De pagina komt altijd van het netwerk (`NetworkOnly`, offline `index.html` uit de precache).
- `rates.json` en `weather.json`: `NetworkFirst`; `osm/`: `StaleWhileRevalidate` (cache `kaart-osm`); kaartvakken
  van `coast/` in de precache. De service worker raakt api.github.com niet (geen route).
- `noteStartedBuild` bij elke start; een ouder venster schrijft daarna niet meer (`assertCurrentBuild` in `putFile` en
  `deleteFile`, `newerBuildStarted` in `runSync`).
- `src/lazy.ts`: mislukt laden van een lui scherm na een update → één keer herladen (`logboek-herladen-na-update`).

## 6. Demomodus

`startDemo`: `blockNetwork(true)` (elk verzoek naar GitHub faalt vóór fetch, lopende verzoeken worden afgebroken), eigen
IndexedDB `logboek-demo` (eerst gewist), eigen sleutel in het geheugen, Store met `demo: true` (synct en controleert nooit)
en een client zonder netwerk. Stoppen of vergrendelen wist de demo-database en zet de eigen taal terug. Herladen tijdens
de demo start de demo opnieuw (`sessionStorage logboek-demo-actief`).

## 7. Kluis

`documents.ts` (model): toevoegen (foto verkleind tot JPEG, PDF herkend aan `%PDF`, max 20 MB), index-record met willekeurige
`fileId`. `Store.putDocumentFile` versleutelt (AAD = `documents/<uuid>.bin`), ontsleutelt ter controle en zet het
bestand met `sha: null` op het apparaat. De sync uploadt na `match` en na de databestanden; een losgeraakt bestand gaat
nooit mee. Openen: lokale kopie, anders GitHub (blob-API boven 1 MB). Verwijderen: geschoonde tombstone, na een dag
weg van apparaat en GitHub (DELETE met sha, één keer per apparaat; `logboek-kluis-weg:<db>`). Declaraties gebruiken
dezelfde weg voor het bonnetje.

## 8. Import en export

- **Import:** `readRowSources` herkent CSV of Excel aan de inhoud; `mileage-csv.ts` + `apply.ts` (mijlen, vervangt
  `source: import`-legs, houdt trip-id's bij dezelfde naam en eerste dag), `planning.ts` (trips en agendadagen),
  `import/accounts.ts` (standen). Meldingen noemen rij en kolom, nooit celinhoud.
- **Back-up:** `encodeBackup` = meta + alle records (ook tombstones) als één AES-GCM-blok onder MK (AAD
  `backup/inhoud`). Terugzetten: alleen wat helemaal ontbreekt, na een geslaagde sync, met ongedaan maken.
- **Export:** CSV in een zip (fflate), onversleuteld, pas na de waarschuwing; geen deelnemers, rekeningen, declaraties.
- **Delen:** `src/share.ts` (`navigator.share`, anders downloaden); PDF's via de printfunctie.

## 9. Afgeleide data (nooit opgeslagen)

| Onderwerp | Bestanden | Bron |
|---|---|---|
| Mijlen en totalen | `derive.ts`, `sailtime.ts`, `stats.ts` | legs, trips |
| Periodes | `periods.ts` (`Period`, `allPeriods`, `periodAt`), `trip-kind.ts`, `period-list.ts`, `review.ts` (Nakijken), `leg-trip.ts` (`placeLeg`, `splitLegs`) | trips, legs, periods, calendar, transactions, places |
| Agenda | `calendar.ts` (`buildIndex`, dagsoort met voorrang: trip > periode aan land > eigen dagtoestand) | calendar, trips, legs, periods |
| Trips | `weeks.ts`, `trip-dates.ts`, `trip-route.ts`, `routes.ts`, `counters.ts`, `trip-name.ts`, `gaps.ts`, `boats.ts` | trips, legs, settings |
| Geld in euro | `money.ts` (bedragen lezen en tonen), `rates.ts` (koers van de dag, `public/rates.json`) | transactions |
| Salaris en geldpad | `salary.ts`, `money-path.ts` (ook `tripResult`: resultaat per trip) | trips, transactions, settings |
| Uitgaven | `expenses.ts` (soort, Hoort bij, bron, investering) | transactions, trips, periods |
| Kosten werkelijk | `actual-costs.ts` (per maand: geboekte vaste lasten, losse kosten, weekschatting) | transactions, weekreviews |
| Positie en vooruitblik | `position.ts` (`resolvePeriod`: periode zelf kiezen), `costs.ts` | accounts, balances, transactions, trips, claims, fixedcosts, weekreviews, calendar |
| Belasting | `tax-year.ts` | transactions, trips |
| Weekafsluiting | `week-close.ts`, `week-money.ts` | legs, calendar, trips, students |
| Doelen | `goals.ts` | goals, sessions, legs, trips, transactions |
| Kaart | `osm.ts`, `waterroute.ts`, `estimate.ts`, `places.ts`, `pin-suggest.ts`, `measure.ts`, `offline-maps.ts` | places, legs, `public/osm/`, `public/coast/` |
| Weer | `weather.ts` (`choosePoint`: zelf gekozen, laatste pin, GPS als toegestaan, gebied van de trip) | `public/weather.json`, places |

## 10. Wat in de browser staat buiten de versleutelde opslag

| Plek | Sleutel | Inhoud |
|---|---|---|
| IndexedDB `logboek` | `objects` | versleutelde databestanden (met sha), lokale meta (platte JSON), documentbestanden, apart gezette bestanden (`apart/<pad>/<tijd>`) |
| | `local` | outbox, token (met vervaldatum en data-repo), vingerafdruk-verpakking (versleuteld onder MK) |
| | `session` | niet-exporteerbare MK met `lastUsed` (hoogstens 5 minuten) |
| `localStorage` | `logboek-taal`, `logboek-apparaat`, `logboek-gestarte-build`, `logboek-vergrendeld:<db>`, `logboek-opslag:<db>` (opslaglogboek: paden, aantallen, tijden, bewijs zonder inhoud), `logboek-herstel:<db>` (herstelverslag: paden), `logboek-herstelpogingen:<db>`, `logboek-vervangen:<db>` (sha's), `logboek-kluis-weg:<db>` (bestands-id's), `logboek-geld-periode` (periode in Geld: keuze en twee datums), `logboek-geld-weergave` (Werkelijk of Verwacht), `logboek-weerpunt` (zelf gekozen weerpunt) | geen inhoud, geen sleutels |
| `sessionStorage` | `logboek-demo-actief`, `logboek-herladen-na-update` | vlaggen |
| Cache Storage | precache, `koersen`, `weer`, `kaart-osm`, `logboek-sw-vensters` | openbare bestanden; nooit een API-antwoord |
