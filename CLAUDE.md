# Logboek

Persoonlijke app van Olivier voor zijn zeiljaar: zeillogboek, zeilgeld, documentenkluis, later skills, doelen en overige financiën.
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
| Styling | Eén klein CSS-bestand met variabelen; geen UI-framework. Licht/donker via `prefers-color-scheme` |
| Opslag telefoon | IndexedDB via `idb` |
| Opslag bron | Private GitHub-repo `logboek-olivier/logboek-data`, via GitHub REST API (`api.github.com`) |
| Hosting | GitHub Pages vanuit publieke repo `logboek-olivier/logboek`. URL: `https://logboek-olivier.github.io/logboek/`. Vite `base: '/logboek/'`, PWA-scope en start_url `/logboek/`. Geen aparte testorganisatie |
| Crypto | WebCrypto (ingebouwd). Geen crypto-bibliotheken |
| Ontgrendelen | Wachtzin; daarna WebAuthn (vingerafdruk, Chrome op Android) |
| Automatisering | GitHub Actions: `deploy.yml`, `test.yml`. Later in `logboek-data`: koersen, vervaldatum, back-up |
| Tests | Vitest + Playwright |
| Ontwikkelomgeving | Windows, VS Code, Claude Code. Scripts moeten werken in PowerShell (geen bash-only scripts in `package.json`) |
| Taal | Nederlands in de UI. Engelse vaktermen (skipper, Yacht Week, tide) en Engelstalige reviews blijven Engels |

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
10. **Vergrendelen na 5 minuten** zonder interactie, bij verbergen van de app en bij een nieuwe browsersessie. Vergrendelen = sleutels en ontsleutelde data uit het geheugen wissen.
11. **Echte data pas na review en reset.** Tot de beveiligingsreview en de live-gang (zie Werkwijze) zijn afgerond, is dit een testfase met testwachtzin. Mijlen en zeilgeld mogen erin om de app te testen; die worden bij de live-gang opnieuw geïmporteerd.
12. **Identiteitsdocumenten (paspoort, rijbewijs, ID) alleen als het nodig is.** De categorie `identiteit` bestaat, maar blijft standaard leeg. De app vraagt er nooit om.

## Cryptografisch ontwerp

- **Hoofdsleutel (MK):** 256-bit willekeurig, `crypto.getRandomValues`. Versleutelt alle data.
- **Sleutelversleutelsleutel (KEK):** afgeleid van de wachtzin met PBKDF2-SHA256, 600.000 rondes, 16-byte willekeurige salt. KEK versleutelt alleen MK (AES-KW of AES-GCM).
- **Herstelcode:** 24 willekeurige woorden uit de BIP39-woordenlijst (meegebundeld in `public/`). Leidt een tweede KEK af, die ook MK versleutelt. Olivier schrijft de herstelcode op papier. Zonder wachtzin én zonder herstelcode is alles weg; dat is bedoeld.
- **Wachtzin wijzigen** = MK opnieuw versleutelen, geen data-herversleuteling.
- **Per object:** AES-GCM-256, 12-byte willekeurige IV, nooit hergebruikt. Formaat: `versie(1) | iv(12) | ciphertext | tag(16)`.
- **Associated data (AAD):** het objectpad, zodat een bestand niet onder een andere naam kan worden teruggezet.
- **Vingerafdruk:** WebAuthn met `prf`-extensie als beschikbaar; de PRF-uitkomst leidt een derde KEK af voor MK. Niet beschikbaar? Knop verborgen, alleen wachtzin. Nooit een zwakkere fallback.
- **In het geheugen:** MK als `CryptoKey` met `extractable: false`. Nooit als bytes in een variabele langer dan nodig.
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
  documents/index.json.enc   # volgende sessie
  documents/<uuid>.bin       # volgende sessie
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
- `amountEur`: bij EUR gelijk aan `amount`. Bij andere valuta leeg tot de koersen-Action bestaat (fase 3); het overzicht toont die bedragen dan apart per valuta, nooit omgerekend met een verzonnen koers.
- `tripId` wordt automatisch gezet als de datum binnen een tocht valt; Olivier kiest dit niet zelf.
- Later toe te voegen (fase 3): `accountId, priority, tag, counterparty, importId`, volgens Oliviers categorieën (1 loon, 2 lening, 3 gift, 4 overig; −1 verplicht, −2 normaal, −3 eigen tijd, −4 vakantie; 0 overboeking).

### Kluis (volgende sessie)

**Document**
`id, title, category (identiteit|certificaten|verzekering|reis-visa|werk-contracten|financieel|overig), issuedAt?, expiresAt?, notes?, mime, size, offline, updatedAt, deletedAt`
Foto's schalen tot max 1600 px lange zijde, JPEG 0,8. PDF ongewijzigd. Max 20 MB. `identiteit` en `certificaten` standaard offline beschikbaar.

### Instellingen

`settings.json.enc`: laatst gebruikte boot, rol, valuta, bron; afstudeerdatum (later); vingerafdruk aan/uit (alleen lokaal relevant, niet gesynct).

## Import mijlenregistratie

Bron: Oliviers Excel, door hem opgeslagen als **CSV UTF-8**. De importer leest CSV zonder externe bibliotheek en moet zowel `;` als `,` als scheidingsteken aankunnen, en datums als `dd-mm-jjjj` en `jjjj-mm-dd`.

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

Testfixture `tests/fixtures/mijlen-nep.csv`: gegenereerd, zelfde opbouw (samenvattingsregels, kopregel, lege rijen tussen tochten, lege datums, `;` als scheidingsteken), verzonnen plaatsen en getallen.

## Schermen

Onderste balk vandaag: **Vandaag · Zeilen · + · Geld**. Kluis komt erbij zodra die gebouwd is.

1. **Ontgrendelen:** wachtzin of vingerafdruk. Niets anders zichtbaar.
2. **Eerste keer:** zie "Eerste keer op een apparaat".
3. **Vandaag:** sync-status bovenaan. Kaarten: nm dit jaar, nm totaal, fooi afgelopen 30 dagen (EUR, plus andere valuta apart), laatste tocht (naam, datum, nm). Later meer kaarten (vervaldatum, skills, maanden te gaan); die komen pas als de data bestaat.
4. **Snel toevoegen (+):** tabs **Fooi · Kosten · Dag**.
   - Fooi: bedrag (groot numeriek toetsenbord), bron, valuta. Datum vandaag, aanpasbaar via een klein datumveld.
   - Kosten: bedrag, omschrijving, soort (kosten/investering). Bron en valuta laatst gebruikt.
   - Dag: naar (plaats), nm, watertype (zee/getij/binnen). Van = vorige "naar", boot/rol/tocht = laatst gebruikt, datum vandaag. "Meer" klapt de overige velden open (nachturen, wind, nieuwe tocht).
   - Opslaan = één tik, daarna terug naar Vandaag met een korte bevestiging.
5. **Zeilen:** totalen bovenaan (nm per rol, per watertype, nachturen, dagen, tochten). Daaronder tochten, nieuwste eerst, uitklapbaar naar de dagen. Knop "Importeren" (CSV).
6. **Geld:** zeilgeld per maand (inkomsten, kosten, saldo), per bron, fooi per week voor de laatste 12 weken, lijst transacties met verwijderen. Geen netto waarde, geen bankrekeningen (fase 3).
7. **Instellingen** (tandwiel rechtsboven op Vandaag): vergrendelen, wachtzin wijzigen, herstelcode tonen (na wachtzin), vingerafdruk aan/uit, token vervangen, export (versleuteld).

Geen onboarding, geen tutorial, geen bevestigingsdialogen behalve bij verwijderen en exporteren. Alles werkt op 360 px breed, bedienbaar met één duim.

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
    storage/         idb.ts, outbox.ts, github.ts, sync.ts
    model/           types.ts, derive.ts
    import/          mileage-csv.ts
    screens/         Unlock, Setup, Today, Sailing, Money, QuickAdd, Settings
    components/      kleine herbruikbare onderdelen
    app.css
  tests/             vitest (crypto, sync, derive, import) + playwright (setup, unlock, quickadd)
    fixtures/        alleen gegenereerde nepdata
  .github/workflows/ deploy.yml (alleen vanaf main), test.yml (bij elke PR en push)
  scripts/           generate-fake-data.ts
```

## Werkwijze

- **Branches:** `main` beschermd via een ruleset: PR verplicht, `test.yml` moet slagen, geen force push, niet verwijderen. Deploy naar Pages alleen vanuit `main` door een Action. Uitzondering: de allereerste commit (skelet) gaat direct naar `main`, omdat de repo dan nog leeg is.
- **Commits:** één commit per afgeronde stap, Nederlandse commitberichten, kort.
- **PR's:** via `gh pr create`. Beschrijving: wat, waarom, hoe getest. Mergen pas als `test.yml` groen is.
- **Testen van wijzigingen:** lokaal met `npm run dev` (localhost, eigen opslag) en in CI. Er is geen tweede Pages-site: die zou de browseropslag delen met de echte app.
- **Testfase (vóór live):** de echte app op `logboek-olivier.github.io/logboek/`, met testwachtzin. Olivier test op laptop en telefoon.
- **Live-gang (na review en handtest):** (1) repo `logboek-data` verwijderen en leeg opnieuw aanmaken; (2) nieuwe fine-grained token, oude intrekken; (3) op elk apparaat de sitegegevens van `logboek-olivier.github.io` wissen en de app opnieuw installeren; (4) nieuw logboek met de echte wachtzin, nieuwe herstelcode op papier; (5) mijlen opnieuw importeren, zeilgeld opnieuw invoeren of exporteren/importeren.
- **Cloud-sessies (vanaf de boot):** werken alleen in `logboek`, nooit in `logboek-data`. Elke taak eindigt in een PR.
- **Definition of done:** tests groen, werkt offline, werkt op 360 px breed, geen nieuwe netwerkbestemmingen, geen nieuwe afhankelijkheden zonder reden in de PR.
- **Afhankelijkheden:** toegestaan zonder overleg: `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `vite-plugin-pwa`, `idb`, `typescript`, `vitest`, `@playwright/test`, `fake-indexeddb`, eslint. Al het andere: eerst vragen.
- **Beveiligingsreview (verplicht vóór live):** een aparte sessie die de code niet geschreven heeft, krijgt de code en deze scenario's: gestolen ontgrendelde telefoon, gestolen vergrendelde telefoon, gelekte GitHub-token, gelekte `logboek-data`, gecompromitteerde `logboek`-repo, kwaadaardige npm-afhankelijkheid. Per scenario: wat kan een aanvaller wel, wat niet, en welke regel dat garandeert. Daarna Oliviers handtest: `logboek-data` clonen op een andere computer en proberen data te lezen zonder wachtzin.

## Fasen

1. **Vandaag (dag 1):** skelet en deploy, versleuteling en ontgrendelen, sync, logboek met import, zeilgeld, Vandaag-scherm, PWA op telefoon.
2. **Volgende sessie:** kluis met nepdocumenten, scannen met camera, vervaldatums. Daarna beveiligingsreview, handtest, live-gang.
3. **Daarna (week 1–2):** volledige geldmodule (rekeningen ASN, Revolut, BUX, DEGIRO, Excel sinds 2023, netto waarde, maanden te gaan), skills, koersen-Action, vervaldatum-Action, back-up-Action.
4. **Week 3–4:** doelen, metingen, ademtrainer, sollicitaties en netwerk, status andere projecten, voortgang Yachtmaster/ASA.
5. **Later:** aandelenkoersen, scenario's, weekreview, Health Connect, Samsung Galaxy Watch 7, GPS-logboek, zeil-CV, Zeiljaar Wrapped.

Niet bouwen wat niet in de huidige fase staat.

## Schrijfstijl in de app

- Nederlands, zakelijk, kort. Geen uitroeptekens, geen "Gefeliciteerd!", geen AI-achtige volzinnen.
- Knoppen: werkwoord eerst ("Opslaan", "Importeren").
- Geen vage verwijzingen ("dit", "hier"); benoem wat bedoeld wordt.
- Getallen: Nederlandse notatie (1.240 nm, € 1.250,50). Zeemijlen als `nm`.
