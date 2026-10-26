# Logboek

Persoonlijke app van Olivier voor zijn zeiljaar: zeillogboek, zeilgeld, trainingsapp als zeilinstructeur (cursussen, studenten, weekplanning), later documentenkluis, skills, doelen en overige financiën.
Eén gebruiker. Gratis. Alleen GitHub. Alles versleuteld. Werkt offline op zee.

Dit bestand is de bron van waarheid voor ontwerp, regels en volgorde. Wijkt code af van dit bestand, dan is de code fout, tenzij Olivier dit bestand aanpast.

## Gebruiksdoel en tijdsbudget

- Olivier wil er **maximaal 2 minuten per dag** en **5–10 minuten per week** aan kwijt zijn.
- Elke invoer: maximaal 3 velden, de rest standaard ingevuld (datum = vandaag, boot/rol/valuta/bron = laatst gebruikte waarde).
- Importeren gaat boven typen.
- De app signaleert; Olivier hoeft niets te controleren.
- Nieuwe functie? Eerst de vraag: kost dit Olivier per week meer dan 30 seconden? Dan anders ontwerpen of niet bouwen.
- Geen lege of "binnenkort"-schermen. Wat nog niet gebouwd is, is niet zichtbaar.

## Stack

| Onderdeel | Keuze |
|---|---|
| App | React 18 + Vite + TypeScript, PWA (vite-plugin-pwa, Workbox) |
| Styling | Eén CSS-bestand (`src/app.css`) met het ontwerpsysteem als variabelen: kleuren (marineblauw, zeegroen accent, warm lichte achtergrond), typografie (systeemlettertype, tabular-nums voor getallen), ruimtes, hoekradius, schaduwen. Geen UI-framework. Licht/donker via `prefers-color-scheme`. Iconen: lucide-react, één lijndikte (1,75) en maat via `--icon`. Grafieken in eigen SVG (`src/components/BarChart.tsx`) |
| Opslag telefoon | IndexedDB via `idb` |
| Opslag bron | Private GitHub-repo `logboek-olivier/logboek-data`, via GitHub REST API (`api.github.com`) |
| Hosting | GitHub Pages vanuit publieke repo `logboek-olivier/logboek`. URL: `https://logboek-olivier.github.io/logboek/`. Vite `base: '/logboek/'`, PWA-scope en start_url `/logboek/`. Geen aparte testorganisatie |
| Crypto | WebCrypto (ingebouwd). Geen crypto-bibliotheken |
| Ontgrendelen | Wachtzin; daarna WebAuthn (vingerafdruk, Chrome op Android) |
| Automatisering | GitHub Actions: `deploy.yml`, `test.yml`. Later in `logboek-data`: koersen, vervaldatum, back-up |
| Tests | Vitest + Playwright |
| Ontwikkelomgeving | Windows, VS Code, Claude Code. Scripts moeten werken in PowerShell (geen bash-only scripts in `package.json`) |
| Taal | Nederlands en Engels. Eigen vertaalsysteem in `src/i18n/` (`nl.ts` is de bron met getypeerde sleutels; `en.ts` moet elke sleutel hebben, anders faalt `tsc`; een test controleert beide talen). Getallen en datums volgen de taal (nl-NL / en-GB). Standaard de taal van de telefoon; keuze per apparaat in Instellingen → Taal (`localStorage`, niet gesynct). Engelse vaktermen (skipper, Yacht Week, tide) blijven ook in het Nederlands Engels |

Geen Supabase, geen Vercel, geen Cloudflare, geen externe API's in de app, geen analytics, geen fonts van buiten.

## Harde beveiligingsregels

Deze regels zijn niet onderhandelbaar. Twijfel? Niet doen en vragen.

1. **Niets verlaat het apparaat onversleuteld.** Elke byte die naar `logboek-data` gaat is AES-GCM-versleuteld vóór de upload. Ook bestandsnamen, ook metadata, ook de index.
2. **De app praat uitsluitend met `api.github.com`.** Content-Security-Policy (meta-tag in `index.html`): `default-src 'self'; connect-src 'self' https://api.github.com; img-src 'self' blob: data:; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`. Geen uitzonderingen. Externe data komt later via Actions in de repo.
3. **Geen externe scripts, geen CDN, geen inline scripts of inline styles.** Alles meegebundeld door Vite.
4. **Geheimen staan nooit in een repo.** Geen tokens, geen wachtzinnen, geen echte gegevens in tests of fixtures. `.gitignore` sluit `.env*`, `*.key`, `secrets/`, `*.csv`, `*.xlsx` uit. Testfixtures zijn gegenereerd en staan in `tests/fixtures/` met een expliciete uitzondering in `.gitignore`.
5. **De GitHub-token** is fine-grained, alleen `Contents: read/write` op `logboek-data`, en wordt na ontgrendelen versleuteld bewaard onder de hoofdsleutel. Vóór ontgrendelen staat de token alleen in het geheugen.
6. **Claude Code, cloud-sessies en agents raken `logboek-data` nooit aan.** Niet lezen, niet clonen, niet schrijven, ook niet via `gh`. Testen gebeurt met gegenereerde nepdata en een gemockte `api.github.com`.
7. **Oliviers echte importbestanden** (`C:\Users\<naam>\logboek-invoer\`) mag Claude Code alleen lezen om kolommen en opbouw te begrijpen. Nooit kopiëren naar de repo, nooit inhoud in code, tests, commits of PR-teksten.
8. **Bestandsnamen in de kluis zijn willekeurige UUID's.** Echte namen staan alleen in de versleutelde index.
9. **Logs bevatten nooit inhoud.** Geen bedragen, plaatsnamen, documentnamen of sleutels in `console.log`, foutmeldingen of commitberichten. Commitberichten in `logboek-data` zijn altijd `sync <ISO-tijd>`.
10. **Vergrendelen na 5 minuten zonder gebruik.** Binnen die 5 minuten blijft de niet-exporteerbare hoofdsleutel in IndexedDB staan, zodat verversen of wisselen van app niet vergrendelt; daarna wordt hij gewist. Toelichting: gebruik = tikken, typen of scrollen in de app; openen of hervatten telt niet. Wissen gebeurt door de timer zolang de app draait, anders uiterlijk bij het volgende openen (een opgeslagen sleutel ouder dan 5 minuten, of met een tijdstip in de toekomst, wordt nooit gebruikt). Ook de browser sluiten of de telefoon herstarten binnen 5 minuten hervat dus. Niet-exporteerbaar betekent dat JavaScript de bytes niet kan uitlezen; de browser bewaart ze wel op de schijf van het apparaat, beschermd door de apparaatversleuteling. Vergrendelen (na 5 minuten of handmatig, in elk tabblad) = sleutels en ontsleutelde data uit het geheugen wissen én de opgeslagen hoofdsleutel uit IndexedDB verwijderen.
11. **Mijlen en zeilgeld zijn in gebruik sinds 25 oktober 2026; crypto en storage zijn onafhankelijk gereviewd in PR 2, 3 en 6; de opgeslagen sessiesleutel (regel 10) door een review-agent in release 1. Documenten pas na de volledige beveiligingsreview uit Werkwijze.**
12. **Identiteitsdocumenten (paspoort, rijbewijs, ID) alleen als het nodig is.** De categorie `identiteit` bestaat, maar blijft standaard leeg. De app vraagt er nooit om.
13. **Nooit een tweede GitHub Pages-site in organisatie logboek-olivier: die deelt opslag en vingerafdruk met Logboek.**
14. **Studentgegevens: alleen voornaam, cursus, niveau, voortgang en examenuitslag. Geen contactgegevens, geen gezondheids- of identiteitsgegevens. Nooit in logs of foutdetails. Na 12 maanden automatisch archiveren; archief is te wissen.**

## Cryptografisch ontwerp

- **Hoofdsleutel (MK):** 256-bit willekeurig, `crypto.getRandomValues`. Versleutelt alle data.
- **Sleutelversleutelsleutel (KEK):** afgeleid van de wachtzin met PBKDF2-SHA256, 600.000 rondes, 16-byte willekeurige salt. KEK versleutelt alleen MK (AES-KW of AES-GCM).
- **Herstelcode:** 24 willekeurige woorden uit de BIP39-woordenlijst (meegebundeld in `public/`). Leidt een tweede KEK af, die ook MK versleutelt. Olivier schrijft de herstelcode op papier. Zonder wachtzin én zonder herstelcode is alles weg; dat is bedoeld.
- **Wachtzin wijzigen** = MK opnieuw versleutelen, geen data-herversleuteling.
- **Per object:** AES-GCM-256, 12-byte willekeurige IV, nooit hergebruikt. Formaat: `versie(1) | iv(12) | ciphertext | tag(16)`.
- **Associated data (AAD):** het objectpad, zodat een bestand niet onder een andere naam kan worden teruggezet.
- **Vingerafdruk:** WebAuthn met `prf`-extensie als beschikbaar; de PRF-uitkomst leidt een derde KEK af voor MK. Niet beschikbaar? Knop verborgen, alleen wachtzin. Nooit een zwakkere fallback.
- **In het geheugen:** MK als `CryptoKey` met `extractable: false`. Nooit als bytes in een variabele langer dan nodig. Dezelfde niet-exporteerbare `CryptoKey` staat hoogstens 5 minuten na het laatste gebruik in IndexedDB (regel 10); zolang hij daar staat, zijn ook de lokaal versleutelde token en data te ontsleutelen.
- **Testvectoren:** vaste bekende sleutel/IV/plaintext-paren in `tests/crypto.test.ts`; een test die één byte in de ciphertext wijzigt en controleert dat ontsleutelen faalt; een test dat een object met verkeerde AAD (ander pad) niet ontsleutelt.

## Eerste keer op een apparaat

Twee paden, gekozen op het eerste scherm:

- **Nieuw logboek:** token invoeren → controleren dat `logboek-data` leeg is (geen `meta.json.enc`) → wachtzin kiezen (twee keer) → herstelcode tonen en laten bevestigen door drie willekeurige woorden in te typen → `meta.json.enc` aanmaken.
- **Bestaand logboek koppelen** (bijvoorbeeld de telefoon nadat de laptop het logboek aanmaakte): token invoeren → `meta.json.enc` ophalen → wachtzin of herstelcode → alle data ophalen.

Daarna: vingerafdruk aanzetten aanbieden (alleen als `prf` beschikbaar is).

## Opslag en synchronisatie

```
logboek-data/
  meta.json.enc          # MK versleuteld onder KEK's (wachtzin, herstelcode, vingerafdruk), salts, versie
  trips.json.enc
  legs.json.enc
  transactions.json.enc
  settings.json.enc
  curricula.json.enc     # alleen eigen en bewerkte cursussen; meegeleverde staan in de code
  students.json.enc
  plans.json.enc
  documents/index.json.enc   # release 3
  documents/<uuid>.bin       # release 3
```

- **Bron van waarheid:** `logboek-data` op GitHub. Elk apparaat heeft een versleutelde kopie in IndexedDB plus een outbox.
- **Elk record** heeft `id` (UUIDv4), `updatedAt` (ISO), `deletedAt` (ISO of null). Verwijderen is een tombstone.
- **Sync:** (1) haal huidige SHA en inhoud op, (2) ontsleutel, (3) voeg samen per `id`, laatste `updatedAt` wint, (4) versleutel, (5) schrijf met de oude SHA als voorwaarde. Conflict (409/422)? Opnieuw vanaf stap 1. Maximaal 3 pogingen, daarna melding.
- **Offline:** lezen altijd; schrijven naar outbox; sync bij ontgrendelen en bij handmatig verversen als er verbinding is. Geen achtergrondsync. Sync-status altijd zichtbaar bovenaan Vandaag: "gesynct", "3 wijzigingen wachten" of "geen verbinding".

## Datamodel

Alle typen in `src/model/types.ts`. Geen `any`.

### Zeilen

De opbouw volgt Oliviers bestaande mijlenregistratie. Eén rij = één dag(tocht), een tocht is een reeks dagen.

**Trip** (tocht, bijv. "Yacht week 7", "RYA Offshore exam")
`id, name, updatedAt, deletedAt`
Begin- en einddatum, boot en totalen worden afgeleid uit de legs.

**Leg** (één dag op het water)
`id, tripId, date, fromPlace, fromCountry, toPlace, toCountry, role (schipper|co-schipper|bemanningslid|trainee|instructeur), boat, skipperName?, coSkipperName?, windBft? (tekst, bijv. "2-3"), nmInland, nmSea, nmTidal, nightHours, notes?, dateEstimated (boolean), source (import|manual), updatedAt, deletedAt`
- Totaal nm = `nmInland + nmSea + nmTidal`, altijd berekend.
- Rollen tonen zoals Olivier ze schrijft: Schipper, Co-schipper, Bemanningslid, Trainee, Instructeur.

**Afgeleiden** (`src/model/derive.ts`, met tests): totaal nm, nm per rol, nm per watertype (binnenwater / zee / getijdenwater), nachturen, aantal dagen, aantal tochten, nm dit kalenderjaar, laatste tocht.

### Zeilgeld

Vandaag alleen geld dat met zeilen te maken heeft. Opgeslagen als `Transaction` in `transactions.json.enc`, zodat de latere volledige geldmodule (rekeningen, bankimports, netto waarde) zonder migratie kan aansluiten.

**Transaction** (velden voor vandaag)
`id, date, kind (fooi|loon|kosten|investering), amount (positief getal), currency (EUR|USD|GBP|…), amountEur? , source (yacht-week|sailing-virgins|delivery|overig), tripId?, note?, updatedAt, deletedAt`
- `fooi` en `loon` zijn inkomsten; `kosten` en `investering` uitgaven. Richting volgt uit `kind`, niet uit het teken.
- `investering` = uitgaven die het zeiljaar mogelijk maken (cursussen, examens, uitrusting).
- `amountEur`: bij EUR gelijk aan `amount`. Bij andere valuta leeg tot de koersen-Action bestaat (release 4); het overzicht toont die bedragen dan apart per valuta, nooit omgerekend met een verzonnen koers.
- `tripId` wordt automatisch gezet als de datum binnen een tocht valt; Olivier kiest dit niet zelf.
- Later toe te voegen (release 4): `accountId, priority, tag, counterparty, importId`, volgens Oliviers categorieën (1 loon, 2 lening, 3 gift, 4 overig; −1 verplicht, −2 normaal, −3 eigen tijd, −4 vakantie; 0 overboeking).

### Training

**Curriculum** (`curricula.json.enc`, met `schemaVersion` zoals elk bestand)
`id, body (ASA|RYA|CWO|eigen), courseCode, name {nl,en}, groups: [{id, title {nl,en}, topics: [{id, title {nl,en}, kind (theorie|praktijk), examCritical}]}], source (seed|eigen), updatedAt, deletedAt`
- Meegeleverd in `src/model/seed-curricula.ts` met vaste id's (`seed-asa-101` …): ASA 101, 103, 104 en 114 met onderwerpen in eigen woorden (nl+en, geen officiële teksten) en de notitie "Controleer tegen de officiële ASA-standaard"; RYA (Competent Crew, Day Skipper, Coastal Skipper, Yachtmaster Offshore) en CWO (Kajuitzeilen I–III) alleen als lege structuur.
- Een meegeleverde cursus wordt pas opgeslagen als Olivier hem bewerkt (zelfde id, `source: seed`); een tombstone verbergt hem. Alles is bewerkbaar.
- Import en export als JSON (`format: logboek-curriculum`, delen via `navigator.share` of download). Een export bevat alleen de cursusopbouw, geen studenten; een import krijgt altijd nieuwe id's.

**Student** (`students.json.enc`, regel 14)
`id, firstName, curriculumId, level (beginner|gemiddeld|gevorderd), progress: {[topicId]: {status (nieuw|geoefend|beheerst), updatedAt}}, exam?: {date, passed, note?}, note?, startedAt?, archivedAt?, updatedAt, deletedAt`
- `startedAt` bepaalt de week in het overzicht en telt mee als activiteit.
- Na 12 maanden zonder activiteit (begin, examen, voortgang of wijziging) automatisch gearchiveerd, pas na een geslaagde sync. Het archief is te wissen.
- Wissen maakt een tombstone met alleen `id` en tijden. Oudere versies blijven versleuteld in de git-geschiedenis van `logboek-data` tot die repo opnieuw wordt aangemaakt.
- Groepsafvinken verlaagt nooit een status.

**WeekPlan** (`plans.json.enc`)
`id, title, startDate, dayCount, tripId?, groups: [{id, name, curriculumId, level, studentIds}], days: [{date, blocks: [{id, slot (ochtend|middag|avond), groupIds, topicIds, location?, note?}]}], updatedAt, deletedAt`
- Concept (`src/model/plans.ts`, zonder netwerk): theorie 's ochtends, praktijk 's middags, examenkritisch eerst, beginners gelijk verdeeld over alle lesdagen, gemiddeld/gevorderd minstens 3/4 onderwerpen per blok, laatste dag herhaling van de examenkritische onderwerpen en examen.
- Groepen verwijzen naar studenten via id; gedeelde tekst, printweergave en "Toon aan studenten" tonen groepsnamen, nooit studentnamen of voortgang.

### Kluis (release 3)

**Document**
`id, title, category (identiteit|certificaten|verzekering|reis-visa|werk-contracten|financieel|overig), issuedAt?, expiresAt?, notes?, mime, size, offline, updatedAt, deletedAt`
Foto's schalen tot max 1600 px lange zijde, JPEG 0,8. PDF ongewijzigd. Max 20 MB. `identiteit` en `certificaten` standaard offline beschikbaar.

### Instellingen

`settings.json.enc`: laatst gebruikte boot, rol, valuta, bron, soort en watertype; jaardoel in nm; afstudeerdatum (later). Alleen lokaal, niet gesynct: vingerafdruk aan/uit en de taal (`localStorage` `logboek-taal`).

## Import mijlenregistratie

Bron: Oliviers Excel, direct als **.xlsx** of opgeslagen als **CSV**. Het formaat wordt herkend aan de inhoud, niet aan naam of MIME-type; de bestandskiezer heeft geen `accept`-filter (Android en Google Drive grijzen anders bestanden uit). CSV zonder externe bibliotheek: `;`, `,` of tab, UTF-8 (met of zonder BOM), UTF-16 of Windows-1252, CRLF of LF, aanhalingstekens. Datums als `d-m-jjjj`, `dd-mm-jjjj` en `jjjj-mm-dd`. Excel: fflate pakt uit, een eigen kleine XML-lezer leest workbook, sharedStrings, styles en het werkblad; datums zijn serienummers (let op `date1904`); formulecellen gebruiken de opgeslagen waarde, en ontbreekt die, dan geldt de datum van de vorige rij met `dateEstimated` en een waarschuwing. Een rij zonder dag-inhoud (alleen een datum- of Totaal-formule) scheidt tochten. Meldingen noemen rijnummer en kolom, nooit celinhoud.

Opbouw van het bestand:
- Rijen 1–4: samenvattingsregels (totalen per rol). Overslaan.
- Kopregel (vinden door te zoeken naar de rij die begint met `Datum`): `Datum; Van (plaats); Van (land); Naar (plaats); Naar (land); Rol; Schip; Schipper/trainer; Co-schipper (flot.leider); Wind (bft); Binnenwater; Zee; Zee (getijnavigatie); Totaal; Nacht-uren; Bijzonderheden`
- Daaronder: één rij per dag. **Een lege rij scheidt tochten.**
- `Bijzonderheden` op de eerste rij van een tocht = naam van de tocht. Op latere rijen = `notes`. Geen naam? Tochtnaam = `<boot> <maand jaar>`.
- `Datum` leeg = datum van de vorige rij, met `dateEstimated = true`.
- Mijlen en nachturen leeg = 0. De kolom `Totaal` wordt genegeerd (wordt berekend).
- Rol: `Schipper → schipper`, `Co-schipper → co-schipper`, `Bemanningslid → bemanningslid`, `Trainee → trainee`. Onbekende waarde: import stopt met melding van het rijnummer.

Controle na import (scherm toont deze getallen; Olivier vergelijkt met zijn Excel): aantal dagen, aantal tochten, totaal nm, nm per rol, nm per watertype, nachturen.
Opnieuw importeren mag niet dubbelen: legs krijgen `source = import` en een import vervangt alle eerdere `import`-legs (handmatige legs blijven).

Testfixtures `tests/fixtures/mijlen-nep.xlsx` (gegenereerd met `npm run fixtures`, zelfde opbouw als het origineel: Sheet1 met samenvattingsformules in J1:O4 en kopregel op rij 6, Blad1 met de rollenlijst, data-validatie-extensie) en `tests/fixtures/mijlen-nep.csv`: gegenereerd, zelfde opbouw (samenvattingsregels, kopregel, lege rijen tussen tochten, lege datums, `;` als scheidingsteken), verzonnen plaatsen en getallen.

## Schermen

Onderste balk: **Vandaag · Training · + · Zeilen · Meer**, vijf gelijke vakken met het + in het midden als ronde knop. Onder **Meer**: Geld en Instellingen (met een terugknop naar Meer). Kluis komt erbij zodra die gebouwd is.

1. **Ontgrendelen:** wachtzin of vingerafdruk. Niets anders zichtbaar. Binnen 5 minuten na het laatste gebruik hervat de app zonder dit scherm (regel 10).
2. **Eerste keer:** zie "Eerste keer op een apparaat".
3. **Vandaag:** sync-status bovenaan (tikken of omlaag trekken synchroniseert). Geen bedragen en geen geldkaarten: Vandaag staat ook open als studenten meekijken. Kaarten: planning van vandaag uit de lopende weekplanning (alleen als er vandaag iets gepland is; tik op een onderwerp = geoefend voor de hele groep), nm dit jaar met voortgang naar een instelbaar jaardoel (standaard 2.500 nm, in `settings.json.enc`), nm totaal (nm per maand), dagen tot de volgende vervaldatum (nu de token; de kluis voegt documenten toe), laatste tocht (naam, datum, nm).
4. **Snel toevoegen (+):** tabs **Fooi · Kosten · Dag**.
   - Fooi: bedrag (groot numeriek toetsenbord), bron, valuta. Datum vandaag, aanpasbaar via een klein datumveld.
   - Kosten: bedrag, omschrijving, soort (kosten/investering). Bron en valuta laatst gebruikt.
   - Dag: naar (plaats), nm, watertype (zee/getij/binnen). Van = vorige "naar", boot/rol/tocht = laatst gebruikt, datum vandaag. "Meer velden" klapt de overige velden open (nachturen, wind, nieuwe tocht).
   - Opslaan = één tik met een korte trilling, daarna terug naar Vandaag met een korte bevestiging. De bevestiging na fooi of kosten noemt geen bedrag. Soort (fooi/loon, kosten/investering), watertype, bron, valuta, boot en rol onthouden de laatste waarde. Het bedragveld opent direct met het numerieke toetsenbord.
5. **Training:** drie tabbladen; opent op Planning als er een lopende of komende planning is, anders op Studenten.
   - **Planning:** lijst van planningen (lopend en komend, daarna afgelopen). Nieuwe planning in drie schermen: eerste dag, aantal dagen (1–14), titel en tocht (optioneel, automatisch de tocht waar de startdatum in valt) → groepen (naam, cursus, niveau, studenten optioneel) → concept, dan opslaan. Bewerken met tikken: blok openen, onderwerpen erbij of eraf, blok naar een andere dag of ander dagdeel, plaats en notitie; blok toevoegen per dag. "Toon aan studenten": alleen de planning volledig scherm, zonder onderbalk of andere gegevens, terug met één knop. "Delen": exporttaal los van de app-taal; tekst via `navigator.share` (WhatsApp, anders klembord) en PDF via de printfunctie met eigen printopmaak.
   - **Studenten:** per week of per cursus, met voortgangsbalk en het aantal examenkritische onderwerpen dat nog op "nieuw" staat. Checklist per student met grote vinkvakken (één tik = volgende status), examenkritische onderwerpen op "nieuw" bovenaan, voortgangsbalk per groep, "Alles geoefend/beheerst" per groep. "Groep afvinken": één onderwerp voor meerdere studenten tegelijk. Archief met terugzetten en wissen.
   - **Cursussen:** per bond, met import (JSON) en per cursus bewerken (groepen en onderwerpen toevoegen, wijzigen, verplaatsen, examenkritisch) en delen.
6. **Zeilen:** totalen bovenaan (nm per rol, per watertype, nachturen, dagen, tochten). Grafiek nm per maand (12 maanden). Daaronder tochten per maand met vaste maandkoppen, nieuwste eerst, uitklapbaar naar de dagen. Knop "Importeren" (Excel of CSV).
7. **Geld** (onder Meer): saldo, inkomsten en kosten; grafieken fooi per week (12 weken) en inkomsten/kosten per maand (12 maanden) met tabel; per bron; transacties per maand met vaste maandkoppen en verwijderen. Geen netto waarde, geen bankrekeningen (release 4).
8. **Instellingen** (onder Meer): vergrendelen, wachtzin wijzigen, herstelcode tonen (na wachtzin), vingerafdruk aan/uit, token vervangen, export (versleuteld), jaardoel, taal (Nederlands/Engels), Over (versie uit `package.json`, bouwdatum, korte commit-hash).

Bij elke fout staat een knop **Kopieer foutdetails** (`src/errors.ts`): app-versie, scherm, foutcode en geschoonde stacktrace, zonder inhoud (regel 9). Olivier plakt die in een cloud-sessie. Niet bij een verkeerd getypte wachtzin of herstelcode.

Geen onboarding, geen tutorial, geen bevestigingsdialogen behalve bij exporteren. Verwijderen gebeurt zonder bevestigingsvraag, met de melding "Verwijderd · Ongedaan maken" (5 seconden). Elke dag, tocht en transactie is aan te tikken en te bewerken in een onderblad; een tocht kan hernoemd worden en een dag kan naar een andere tocht. Alles werkt op 360 px breed, bedienbaar met één duim.

## Mapstructuur app-repo

```
logboek/
  CLAUDE.md
  README.md
  index.html
  vite.config.ts
  public/            manifest-iconen, bip39-nl/en woordenlijst
  src/
    crypto/          keys.ts, encrypt.ts, passphrase.ts, recovery.ts, webauthn.ts
    i18n/            index.ts (t, translate, taalkeuze), nl.ts (bron, getypeerde sleutels), en.ts, labels.ts
    storage/         idb.ts, outbox.ts, github.ts, sync.ts, store.ts, token.ts, fingerprint.ts
    model/           types.ts, derive.ts, money.ts, settings.ts, schema.ts, edit.ts, expiry.ts,
                     curricula.ts, seed-curricula.ts, students.ts, plans.ts
    import/          mileage-csv.ts (mijlenregels), rows.ts (formaat herkennen), csv.ts, xlsx.ts, xml.ts
    screens/         Unlock, Setup, Home, Today, Training, Planning, Students, Sailing, Money, QuickAdd, More, Settings
    components/      kleine herbruikbare onderdelen (BottomBar, BarChart, Sheet, EditSheets, CurriculumSheets, Icon, Toast, …)
    session.ts       ontgrendelen, vergrendelen, sessiesleutel (regel 10)
    errors.ts        foutdetails zonder inhoud
    app.css          ontwerpsysteem
  tests/             vitest (crypto, sync, session, derive, import, xlsx, edit, errors, i18n, curricula, students, plans)
                     + playwright (setup, unlock, sessie, import, bewerken, taal, navigatie, training, studenten,
                     planning, schermafbeeldingen 360/412 px licht/donker en Engels)
    fixtures/        alleen gegenereerde nepdata (npm run fixtures)
  .github/workflows/ deploy.yml (alleen vanaf main), test.yml (bij elke PR en push; uploadt schermafbeeldingen)
  scripts/           generate-fake-data.ts, fake-xlsx.ts, generate-icons.mjs
```

## Werkwijze

- **Branches:** `main` beschermd via een ruleset: PR verplicht, `test.yml` moet slagen, geen force push, niet verwijderen. Deploy naar Pages alleen vanuit `main` door een Action. Uitzondering: de allereerste commit (skelet) gaat direct naar `main`, omdat de repo dan nog leeg is.
- **Commits:** één commit per afgeronde stap, Nederlandse commitberichten, kort.
- **PR's:** via `gh pr create`. Beschrijving: wat, waarom, hoe getest. Mergen pas als `test.yml` groen is.
- **Testen van wijzigingen:** lokaal met `npm run dev` (localhost, eigen opslag) en in CI. Er is geen tweede Pages-site: die zou de browseropslag delen met de echte app.
- **Testfase (vóór live):** de echte app op `logboek-olivier.github.io/logboek/`, met testwachtzin. Olivier test op laptop en telefoon.
- **Live-gang (na review en handtest):** (1) repo `logboek-data` verwijderen en leeg opnieuw aanmaken; (2) nieuwe fine-grained token, oude intrekken; (3) op elk apparaat de sitegegevens van `logboek-olivier.github.io` wissen en de app opnieuw installeren; (4) nieuw logboek met de echte wachtzin, nieuwe herstelcode op papier; (5) mijlen opnieuw importeren, zeilgeld opnieuw invoeren of exporteren/importeren.
- **Cloud-sessies (vanaf de boot):** werken alleen in `logboek`, nooit in `logboek-data`. Elke taak eindigt in een PR.
- Olivier werkt alleen vanaf zijn telefoon via cloud-sessies. Elke release in losse PR's; schermafbeeldingen uit CI bekijken vóór mergen.
- **Reviews en wachten:** reviews met hoogstens één review-agent tegelijk, op de voorgrond. Bij werk zonder Olivier nooit wachten op achtergrondmeldingen; CI volgen met `gh pr checks --watch` en deploys met `gh run watch`.
- **Definition of done:** tests groen, werkt offline, werkt op 360 px breed, geen nieuwe netwerkbestemmingen, geen nieuwe afhankelijkheden zonder reden in de PR.
- **Dataformaat:** wijzigingen altijd achterwaarts compatibel. Een nieuwe `schemaVersion` alleen met migratie en een test die data van de vorige versie inleest. Ziet de app een hogere `schemaVersion` dan hij kent, dan schrijft hij niets naar GitHub en toont hij "Werk de app bij".
- **Afhankelijkheden:** toegestaan zonder overleg: `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `vite-plugin-pwa`, `idb`, `typescript`, `vitest`, `@playwright/test`, `fake-indexeddb`, eslint, `lucide-react` (iconen), `fflate` (uitpakken van .xlsx). Al het andere: eerst vragen.
- **Beveiligingsreview (verplicht vóór live):** een aparte sessie die de code niet geschreven heeft, krijgt de code en deze scenario's: gestolen ontgrendelde telefoon, gestolen vergrendelde telefoon, gelekte GitHub-token, gelekte `logboek-data`, gecompromitteerde `logboek`-repo, kwaadaardige npm-afhankelijkheid. Per scenario: wat kan een aanvaller wel, wat niet, en welke regel dat garandeert. Daarna Oliviers handtest: `logboek-data` clonen op een andere computer en proberen data te lezen zonder wachtzin.

## Releases

Elke release bestaat uit losse PR's. Wat niet in de huidige release staat, wordt niet gebouwd.

1. **Bruikbaar (gedaan).** Basis afgerond op 25 oktober 2026 (skelet en deploy, versleuteling en ontgrendelen, sync, logboek met import, zeilgeld, Vandaag, Instellingen, vingerafdruk, PWA op telefoon; in gebruik voor mijlen en zeilgeld). Daarbovenop: import van Excel en CSV ook op Android, sessie die verversen en wisselen van app overleeft, vast ontwerpsysteem met iconen en grafieken, bewerken met ongedaan maken, onderhoud vanaf de telefoon (versie, foutdetails).
2. **Instructeur (deze release).** Logboek is ook de trainingsapp als zeilinstructeur: taal (Nederlands en Engels), onderbalk met Training en Meer en Vandaag zonder geld, curricula en checklists (ASA, RYA, CWO, eigen), studenten en voortgang (regel 14), weekplanning met tonen aan studenten en delen.
3. **Kluis en volledige beveiligingsreview.** Kluis met nepdocumenten, scannen met camera, vervaldatums en de vervaldatum-Action, back-up-Action. Daarna de volledige beveiligingsreview en Oliviers handtest uit Werkwijze, dan de live-gang; pas dan echte documenten erin.
4. **Geld compleet.** Volledige geldmodule: rekeningen ASN, Revolut, BUX, DEGIRO, Excel sinds 2023, netto waarde, maanden te gaan, koersen-Action, aandelenkoersen, scenario's.
5. **Doelen en skills.** Doelen, metingen, ademtrainer, skills, voortgang Yachtmaster/ASA.
6. **Carrière.** Sollicitaties en netwerk, status andere projecten.
7. **Wow.** Zeiljaar Wrapped, weekreview, zeil-CV, routekaart (GPS-logboek), horloge (Samsung Galaxy Watch 7) en Health Connect. Een zeil-CV als publieke pagina mag niet als tweede Pages-site in organisatie `logboek-olivier` (regel 13); die komt dan buiten deze organisatie, of als export die Olivier zelf deelt.

## Schrijfstijl in de app

- Nederlands, zakelijk, kort. Geen uitroeptekens, geen "Gefeliciteerd!", geen AI-achtige volzinnen. Engels in dezelfde stijl (British English).
- Knoppen: werkwoord eerst ("Opslaan", "Importeren").
- Geen vage verwijzingen ("dit", "hier"); benoem wat bedoeld wordt.
- Getallen: Nederlandse notatie (1.240 nm, € 1.250,50); in het Engels Britse notatie (1,240 nm, €1,250.50). Zeemijlen als `nm`.
