# Logboek

Persoonlijke app van Olivier voor zijn zeiljaar: zeillogboek per trip, zeilgeld in euro, trainingsapp als zeilinstructeur (cursussen, deelnemers en studenten, weekplanning), later documentenkluis, skills, doelen en overige financiën.
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
| App | React 18 + Vite + TypeScript, PWA (vite-plugin-pwa, Workbox). Een nieuwe versie neemt zelf over, ruimt oude caches op en herlaadt open vensters (`public/sw-vensters.js`), zodat er nooit twee versies tegelijk draaien. De app-pagina zelf komt altijd van het netwerk (offline de index.html uit de precache, die bij de actieve versie hoort), dus herladen met verbinding geeft altijd de nieuwste versie. "Nieuwe versie beschikbaar · Herladen" staat op elk scherm; op een fout-, herstel- of sleutelscherm en op het keuzescherm van de eerste keer wordt een nieuwe versie direct actief (alleen halverwege de eerste keer, wachtzin wijzigen of herstellen wacht hij, met de balk). Noodpagina `public/reset.html` (buiten de precache en de navigatie-route): meldt de service worker af en wist de app-caches, nooit IndexedDB of andere gegevens; elk foutscherm linkt ernaar |
| Styling | Eén CSS-bestand (`src/app.css`) met het ontwerpsysteem als variabelen: kleuren (marineblauw, zeegroen accent, warm lichte achtergrond), typografie (systeemlettertype, tabular-nums voor getallen), ruimtes, hoekradius, schaduwen. Geen UI-framework. Licht/donker via `prefers-color-scheme`. Iconen: lucide-react, één lijndikte (1,75) en maat via `--icon`. Grafieken in eigen SVG (`src/components/BarChart.tsx`) |
| Kaart | Offline, in eigen SVG (`src/components/SeaMap.tsx`): alleen land uit Natural Earth (publiek domein), vooraf vereenvoudigd door `scripts/build-coast.mjs` tot `public/coast/` (grof wereldbestand plus fijne vakken van 10 × 10 graden, ca. 3,5 MB) en in de precache. Geen kaartdienst, geen tegels van buiten; GPS via `navigator.geolocation` (geen netwerk) |
| Opslag telefoon | IndexedDB via `idb` |
| Opslag bron | Private GitHub-repo `logboek-olivier/logboek-data`, via GitHub REST API (`api.github.com`) |
| Hosting | GitHub Pages vanuit publieke repo `logboek-olivier/logboek`. URL: `https://logboek-olivier.github.io/logboek/`. Vite `base: '/logboek/'`, PWA-scope en start_url `/logboek/`. Geen aparte testorganisatie |
| Crypto | WebCrypto (ingebouwd). Geen crypto-bibliotheken |
| Ontgrendelen | Wachtzin; daarna WebAuthn (vingerafdruk, Chrome op Android) |
| Automatisering | GitHub Actions: `deploy.yml` (bij elke push naar `main` en dagelijks: bouwt ook `public/rates.json` uit de ECB-koersen), `test.yml`. Later in `logboek-data`: vervaldatum, back-up |
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
14. **Studentgegevens: alleen voornaam, cursus, niveau, voortgang en examenuitslag. Geen contactgegevens, geen gezondheids- of identiteitsgegevens. Nooit in logs of foutdetails. Na 12 maanden automatisch archiveren; archief is te wissen.** Deelnemers van een trip vallen hier ook onder: alleen voornaam (met optioneel niveau en cursus).
15. **Wisselkoersen komen alleen uit public/rates.json, gebouwd door deploy.yml uit de ECB-bron; de app haalt zelf nooit externe data op.**
16. **Updates zijn in elke toestand mogelijk. Herstel raakt nooit in een lus. Een onleesbaar bestand blokkeert alleen zijn eigen onderdeel. Elke PR die een databestand toevoegt of wijzigt, heeft een upgradetest.** De upgradetest (`tests/e2e/upgrade.spec.ts`, verplicht in CI) maakt met de vorige release (`npm run upgrade:vorige`, in `.vorige/`) een logboek met een voorbeeld in elk databestand (`tests/upgrade/upgrade-samples.ts`), werkt bij in dezelfde browseropslag, synchroniseert en koppelt daarna een schoon apparaat met de wachtzin: alle bestanden moeten leesbaar zijn. De upgradetest controleert ook dat de vorige release zich vanuit elk scherm bijwerkt (eerste keer, ontgrendelen, herstellen) en dat de lus van 28 oktober 2026 (onleesbare checklists, herstelscherm) met de nieuwe versie in twee tikken weer in de app komt. De storingstests (`tests/storingen.test.ts`: twee vensters tegelijk, update tijdens herstel, verbinding weg midden in een sync, sluiten tijdens schrijven, herstel twee keer achter elkaar) en de foutmatrix (`tests/foutmatrix.test.ts`: elk databestand × elk soort defect × GitHub/apparaat/beide, plus outbox, token, meta en netwerk) eindigen elk met dezelfde controle op een schoon apparaat. Een nieuw fout- of herstelpad krijgt een regel in de foutmatrix en in de tabel "Storingen" hieronder.

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
  places.json.enc        # plaatsen met een punt op de kaart
  reminders.json.enc     # termijnen: deadlines en vervaldatums
  checklists.json.enc    # alleen eigen en bewerkte checklists; meegeleverde staan in de code
  documents/index.json.enc   # release 3
  documents/<uuid>.bin       # release 3
```

- **Bron van waarheid:** `logboek-data` op GitHub. Elk apparaat heeft een versleutelde kopie in IndexedDB plus een outbox.
- **Elk record** heeft `id` (UUIDv4), `updatedAt` (ISO), `deletedAt` (ISO of null). Verwijderen is een tombstone.
- **Sync:** (1) haal huidige SHA en inhoud op, (2) ontsleutel, (3) voeg samen per `id`, laatste `updatedAt` wint, (4) versleutel, (5) schrijf met de oude SHA als voorwaarde. Conflict (409/422)? Opnieuw vanaf stap 1. Maximaal 3 pogingen, daarna melding.
- **Offline:** lezen altijd; schrijven naar outbox; sync bij ontgrendelen en bij handmatig verversen als er verbinding is. Geen achtergrondsync. Sync-status altijd zichtbaar bovenaan elk scherm: "gesynct", "3 wijzigingen wachten" of "geen verbinding".
- **Onleesbaar bestand:** één bestand dat niet te ontsleutelen of te lezen is, houdt de andere niet tegen en blokkeert alleen zijn eigen onderdeel; de rest van de app werkt gewoon. Syncstatus en foutdetails noemen het pad (nooit inhoud). Is `meta.json.enc` via het check-veld aan deze sleutel gebonden, dan: meegeleverde bestanden (cursussen, checklists) zet de app vanzelf terug met de leesbare kopie van het apparaat (anders leeg, dus opnieuw de meegeleverde inhoud); bij de andere staat een melding met één knop die de lokale kopie opnieuw opslaat. Is herstel voor hetzelfde bestand al twee keer geschreven (binnen een dag) en is het weer onleesbaar, dan stopt de app met proberen en toont hij één knop "Dit bestand op GitHub leegmaken en opnieuw beginnen": een lege versie op GitHub, de oude blijft in de geschiedenis, en wat het apparaat leesbaar heeft blijft staan. De app maakt nooit vanzelf iets leesbaars leeg. Een versie die het apparaat zelf al verving en die GitHub vlak na het schrijven nog even teruggeeft, telt niet als nieuw probleem. GitHub-verzoeken komen nooit uit de browsercache (`cache: 'no-store'`). Een bestand dat wel ontsleutelt maar geen geldig logboekbestand is, wordt nooit vanzelf overschreven (behalve cursussen en checklists), wel na een tik. De melding met de knop staat alleen op de schermen van dat onderdeel (`src/screen-files.ts`); de syncstatus bovenaan noemt het pad overal.
- **Andere sleutel:** vóór elke sync controleert de app `meta.json.enc` op GitHub. Hoort het check-veld bij een andere hoofdsleutel, of ontbreekt `meta.json.enc` terwijl het apparaat een logboek heeft, dan schrijft het apparaat niets. Ontbreekt `meta.json.enc` of is hij kapot (geen JSON met `format: logboek-meta`, dus geen ander logboek), dan toont de app "Logboek terugzetten op GitHub": na een tik plus wachtzin of herstelcode (en een token als die op het apparaat onleesbaar is) zet het apparaat zijn eigen meta terug en zet de sync de ontbrekende bestanden terug. Voorwaarden: de lokale meta hoort via het check-veld bij de sleutel (vlak voor het schrijven opnieuw gecontroleerd), elk databestand dat al op GitHub staat is met de sleutel te ontsleutelen, en de SHA is de voorwaarde. Een meta van een ander logboek, een oude zonder check-veld, of een die deze app niet kan lezen, wordt nooit overschreven; dan alleen "Gegevens op dit apparaat wissen en opnieuw koppelen" (bij terugzetten ingeklapt als tweede keus). "Nieuw logboek" weigert een repo met losse databestanden zonder meta.
- **Storingen: wat de app doet** (elke regel getest in `tests/foutmatrix.test.ts`, voor elk databestand; nooit een lus, de rest van de app werkt door, hoogstens één tik per bestand):

  | Storing | Wat de app doet |
  |---|---|
  | Bestand op GitHub niet te ontsleutelen, afgekapt of ongeldig | Melding met één knop op de schermen van dat onderdeel (`src/screen-files.ts`): lokale kopie terugzetten, of na twee keer leegmaken. Cursussen en checklists vanzelf |
  | Bestand op GitHub van een nieuwere schemaversie of objectformaat | Niets naar GitHub schrijven, "Werk de app bij" (tik = herladen = nieuwste versie) |
  | Lokaal bestand onder een andere sleutel of afgekapt | "Logboek herstellen" (één tik plus wachtzin) |
  | Lokaal bestand ongeldig (wel ontsleuteld) | Apart bewaard in IndexedDB (`apart/<pad>/<tijd>`, nooit weggegooid); de versie van GitHub komt in de plaats. Nooit bron voor herstel |
  | Lokaal bestand van een nieuwere versie | Byte voor byte bewaard, wijzigen van dat onderdeel geweigerd, melding met "Herladen" bij dat onderdeel; de rest werkt |
  | Record zonder `deletedAt` | Gewoon niet verwijderd (`null`); het bestand blijft geldig |
  | Outbox ongeldig | Leeg beginnen; de gegevens zelf staan in de bestanden |
  | Token onleesbaar of ongeldig | "Logboek herstellen" vraagt een nieuwe token (alleen Olivier kan die geven) |
  | `meta.json.enc` op GitHub weg of kapot (geen meta-JSON) | "Logboek terugzetten op GitHub" (wachtzin, zo nodig een token), alleen als elk databestand op GitHub met de sleutel te ontsleutelen is; wissen en opnieuw koppelen ingeklapt als tweede keus (live-gang) |
  | `meta.json.enc` op GitHub van een ander logboek, zonder check-veld, of niet te lezen voor deze app | "Sleutel past niet", niets geschreven; alleen wissen en opnieuw koppelen |
  | `meta.json.enc` op dit apparaat kapot | "Eerste keer" → koppelen haalt alles van GitHub |
  | Geen verbinding, 401, 403, 5xx | App open met de lokale kopie, melding in de syncstatus, daarna gewoon verder |
  | GitHub geeft vlak na schrijven nog de oude versie | Geen nieuw probleem: overgeslagen tot GitHub bij is |

- **Sleutel-invariant:** een hoofdsleutel (wachtzin, herstelcode, vingerafdruk of opgeslagen sessiesleutel) wordt alleen gebruikt als hij via het check-veld bij de lokale `meta.json.enc` hoort. Vóór elke schrijfactie naar IndexedDB moet die meta nog dezelfde zijn, vóór elke schrijfactie naar GitHub moet `meta.json.enc` daar bij de sleutel horen. Klopt dat niet: niets schrijven, sessiesleutel wissen, scherm "Sleutel past niet bij je logboek" met "Kopieer foutdetails". Nieuw logboek of koppelen vergrendelt de andere tabbladen. Hoort `meta.json.enc` op GitHub wel bij de sleutel, maar zijn lokale gegevens, de outbox of de token op het apparaat niet met die sleutel te lezen, dan toont de app één scherm "Logboek herstellen" (`src/repair.ts`); een bestand dat alleen op GitHub onleesbaar is, krijgt nooit dit scherm (zie Onleesbaar bestand): in gewone taal wat er verloren gaat, dan één tik op "Herstellen" plus wachtzin of herstelcode. Herstellen wist lokaal alleen wat niet te ontsleutelen is, en vervangt op GitHub alleen bestanden die niet te ontsleutelen zijn (met de oude SHA als voorwaarde) door de leesbare lokale kopie of een lege versie; de oude versie blijft in de geschiedenis. Wat met de sleutel leesbaar is, of wel ontsleutelt maar ongeldig is, blijft altijd staan. Blijkt bij de tik meer verloren te gaan dan getoond, dan eerst opnieuw tonen. Een token vraagt het scherm alleen als de token op het apparaat onleesbaar is. Het verslag (alleen paden) staat in `localStorage`, zodat het scherm bij het volgende openen al vóór de wachtzin toont wat er verloren gaat.

## Datamodel

Alle typen in `src/model/types.ts`. Geen `any`.

### Zeilen

De opbouw volgt Oliviers bestaande mijlenregistratie. Eén rij = één dag(tocht), een tocht is een reeks dagen.

**Trip** (bijv. "Yacht week 7", "RYA Offshore exam"; van elke lengte, 1 tot 120 dagen; `src/model/weeks.ts`, in de code nog "week")
`id, name, type? (training-geven|skipper-charter|zelf-cruisen|zelf-trainen|delivery|overig), startDate?, endDate?, boat? (naam), boatModel?, boatLengthFt?, boatKind? (catamaran|eenromp|motor|overig), base?, charter?, area?, organisation? (sailing-virgins|yacht-week|eigen|overig), participants?: [{id, firstName, level?, curriculumId?}], note?, review?: {score?, quotes, rating?, lesson?}, closedAt?, route?: [{day, from, to, nm?}], checks?: {[checklistId]: itemId[]}, updatedAt, deletedAt`
- Alle tripvelden zijn optioneel in de data. Een oudere of geïmporteerde trip heeft alleen een naam: type, datums en boot worden dan afgeleid zonder op te slaan. Het type is een voorstel uit de naam ("Yacht week" → skipper-charter, "RYA" → zelf-trainen, anders overig); datums en boot komen uit de dagen.
- Bootgegevens: bootnaam, model, lengte (voet; de app toont ook meters), basis, soort boot en charterbedrijf of eigenaar. Een bekende bootnaam vult model, lengte, soort, basis en charterbedrijf van de vorige trip met die boot in.
- **Niets is verplicht** (`src/model/gaps.ts`): een trip of dag wordt altijd opgeslagen, ook zonder boot, datum of plaats (lege datum = vandaag, lege mijlen = 0). Ontbreekt bootnaam, model, lengte, basis of (zonder dagen) de startdatum van een trip, of de van- of naar-plaats van een dag, dan staat er de badge "Onvolledig". Op zondag toont Vandaag "N dingen aanvullen": de lege velden één voor één, met een voorstel uit de dagen (boot, basis = eerste vertrekplaats, plaats van de buurdag); model en lengte één keer per boot voor alle trips met die boot. Overslaan mag.
- Nieuwe trip: naam standaard "\<basis\> \<maand jaar\>", einddatum standaard start + 6 dagen. Eerdere en komende trips zijn gewoon in te voeren. Lopend is de trip die Olivier als lopend startte (`settings.activeWeekId`), anders de trip waarin vandaag valt; opslaan maakt een trip alleen lopend als vandaag erin valt. Afronden zet `closedAt` en de review, en maakt de trip weer inactief. **Trip afsluiten in een minuut:** automatische samenvatting (dagen, nm, inkomsten in euro, studenten met resultaat), een cijfer 1–10 (`review.rating`) en één zin "wat leerde ik" (`review.lesson`); de review van gasten (score en citaten) staat ingeklapt eronder.
- De rol op een dag volgt uit het type: training-geven → instructeur; skipper-charter, zelf-cruisen en delivery → schipper; zelf-trainen → trainee; overig → laatst gebruikt.
- **Route-sjablonen** (`src/model/routes.ts`): trips die grotendeels dezelfde etappes varen (minstens de helft gedeeld, in beide richtingen) vormen een sjabloon; de nieuwste trip is het voorbeeld. Nieuwe trip biedt onder "Snel starten" "Herhaal vorige trip" en de sjablonen ("A → B (3×)"): boot, type, basis, charter, gebied, organisatie, aantal dagen en de geplande etappes (`route`, dag 0 = startdatum) komen mee; "Planning wissen" haalt de etappes weg. Op Vandaag staat bij een geplande etappe die nog niet gelogd is "Zoals gepland" (logt van, naar en nm uit het afstandsvoorstel, anders de afstand uit het sjabloon, met boot en rol uit de trip) naast "Aanpassen" (Toevoegen → Dag met van en naar voorgevuld). Toevoegen → Dag vult de geplande etappe van die datum ook voor.
- Een nieuwe import houdt het id van een bestaande tocht met dezelfde naam en eerste dag, en ruimt vastgelegde weken (met type of datums) nooit op.

**Leg** (één dag op het water)
`id, tripId, date, fromPlace, fromCountry, toPlace, toCountry, role (schipper|co-schipper|bemanningslid|trainee|instructeur), boat, skipperName?, coSkipperName?, windBft? (tekst, bijv. "2-3"), nmInland, nmSea, nmTidal, nightHours, notes?, dateEstimated (boolean), source (import|manual), updatedAt, deletedAt`
- Totaal nm = `nmInland + nmSea + nmTidal`, altijd berekend.
- Rollen tonen zoals Olivier ze schrijft: Schipper, Co-schipper, Bemanningslid, Trainee, Instructeur.

**Place** (`places.json.enc`, `src/model/places.ts`)
`id, name, lat, lon, country?, updatedAt, deletedAt`
- Een plaats krijgt een punt door op de kaart te tikken of "Huidige locatie" te kiezen, plus een naam; dezelfde naam (zonder hoofdletters, accenten, spaties en leestekens: "Tiha bay" = "Tihabay") is dezelfde plaats. Plaatsen uit de import zonder punt zet Olivier onder Meer → Plaatsen met één tik op de kaart vast (met ongedaan maken). Dagen verwijzen via de naam naar een plaats; plaatsen zonder punt (bijvoorbeeld uit de import) blijven gewoon namen.
- **Afstandsvoorstel:** het gemiddelde van de laatste 5 dagen met dezelfde route (van en naar, in beide richtingen, ook geïmporteerde dagen), wat Olivier echt gevaren heeft. Een kleine spelvariant van een lange naam (één letter verschil vanaf 8 letters: "Palmizana" / "Palimizana") telt als dezelfde plaats. Twijfel (één letter verschil vanaf 5 letters, twee vanaf 10) wordt een voorstel "Samenvoegen" in Toevoegen → Dag en onder Meer → Plaatsen: alle dagen krijgen de meest gebruikte schrijfwijze, met ongedaan maken. Een nieuwe naam die op een bekende lijkt, krijgt "Bedoel je …?". Het vult het nm-veld voor zolang Olivier niets typt. Zonder eerdere keren alleen een hint "Hemelsbreed …" (grootcirkel), nooit als voorstel.

**Reminder** = termijn (`reminders.json.enc`, `src/model/reminders.ts`)
`id, title, date, kind (deadline|vervalt), doneAt (jjjj-mm-dd of null), note?, repeat? (maandelijks|jaarlijks), updatedAt, deletedAt`
- Deadlines ("Vliegticket boeken, uiterlijk over 3 weken") en vervaldatums ("Pinpas verloopt over een jaar") staan samen in één lijst, met de vervaldatum van de token en de start van de volgende trip erbij. Toevoegen: wat, soort en wanneer (snelle keuzes over 1 week, 3 weken, 1 maand, 3 maanden, 1 jaar, of een datum). Afronden en verwijderen met ongedaan maken; een terugkerende termijn (maandelijks of jaarlijks) blijft open en schuift bij afronden naar de volgende keer. "Zet in agenda" maakt lokaal een `.ics`-bestand (`src/model/ics.ts`: hele dag, herinnering standaard een week vooraf om 9:00, aan te passen en onthouden in `settings.reminderAlarmDays`, herhalen als RRULE) en opent dat via delen of downloaden (`src/share.ts`); de app verstuurt niets. De kluis voegt later documenten met een vervaldatum toe.

**Afgeleiden** (`src/model/derive.ts`, met tests): totaal nm, nm per rol, nm per watertype (binnenwater / zee / getijdenwater), nachturen, aantal dagen, aantal tochten, nm dit kalenderjaar, laatste tocht.

**Checklist** (`checklists.json.enc`, `src/model/checklists.ts`)
`id, title {nl,en}, items: [{id, text {nl,en}}], tripTypes? (soorten trip; leeg = elke trip), source (seed|eigen), updatedAt, deletedAt`
- Meegeleverd in `src/model/seed-checklists.ts` met vaste id's: safety briefing gasten (training geven, skipper charter), check-in en check-out charterboot (training geven, skipper charter, zelf cruisen) en een paklijst per soort trip. Een meegeleverde lijst wordt pas opgeslagen als Olivier hem bewerkt (zelfde id); een tombstone verbergt hem.
- Deze trip toont de lijsten bij het type van de trip met voortgang ("2/11"); afvinken staat op de trip (`checks`), het sjabloon bewerken (punten wijzigen, toevoegen, weghalen) geldt voor alle trips. Een gewijzigd punt krijgt de tekst in de huidige taal; een nieuw punt in beide talen.

**Zeiltijd exporteren** (`src/model/sailtime.ts`, Logboek → Zeiltijd exporteren): per dag of per trip met boot, model en lengte (uit de trip, anders naam en model uit de kolom Schip), rol, route, nm, getijdenwater en nachturen, plus totalen per rol. Filter op periode en rol. Afdrukken of PDF via de printfunctie (alleen de tabellen, zwart op wit, RYA/ASA-stijl); er gaat niets naar buiten.

### Zeilgeld

Vandaag alleen geld dat met zeilen te maken heeft. Opgeslagen als `Transaction` in `transactions.json.enc`, zodat de latere volledige geldmodule (rekeningen, bankimports, netto waarde) zonder migratie kan aansluiten.

**Transaction** (velden voor vandaag)
`id, date, kind (fooi|loon|bonus|terugbetaling|overig-inkomen|kosten|investering), amount (positief getal), currency (EUR|USD|GBP|CHF|SEK|DKK|NOK|XCD|HRK), amountEur?, rate?, rateDate?, receivedEur?, source (yacht-week|sailing-virgins|delivery|overig), tripId?, note?, updatedAt, deletedAt`
- `fooi`, `loon` (of dagtarief), `bonus` (of provisie), `terugbetaling` (van voorgeschoten onkosten) en `overig-inkomen` zijn inkomsten; `kosten` en `investering` uitgaven. Richting volgt uit `kind`, niet uit het teken. Een terugbetaling telt niet als verdiend (apart als "Terugbetaald"), wel in het saldo.
- `investering` = uitgaven die het zeiljaar mogelijk maken (cursussen, examens, uitrusting).
- Alles wordt in euro getoond (`src/model/rates.ts`). Volgorde: `receivedEur` (werkelijk ontvangen, optioneel), dan de opgeslagen koers (`amountEur = amount / rate`, `rate` = valuta per 1 EUR, `rateDate`), dan de ECB-koers uit `public/rates.json` van de transactiedatum of de laatste werkdag daarvoor.
- Een koers wordt opgeslagen zodra hij definitief is: bij nieuwe transacties direct, bij bestaande één keer per sessie na een geslaagde sync. Is de datum nieuwer dan het koersbestand (of is de app offline), dan geldt tijdelijk de laatst bekende koers, gemarkeerd als "voorlopig"; die wordt nooit opgeslagen. Zonder koersbestand staat een bedrag apart per valuta, nooit omgerekend met een verzonnen koers.
- `public/rates.json` (`{format: 'logboek-rates', source, dates[], rates: {USD: [...], …}}`) bouwt `scripts/build-rates.mjs` in `deploy.yml` uit de ECB-referentiekoersen (volledige historie); XCD = USD × 2,70. Het bestand staat in `.gitignore` en wordt door de service worker "eerst netwerk, offline uit de cache" geladen, niet geprecachet. De bouwdatum is de commitdatum, zodat de dagelijkse build geen update meldt.
- Inkomsten horen bij een trip: Toevoegen → Inkomsten kiest standaard de trip waarin de datum valt (anders de lopende trip) en volgt de datum zolang Olivier niets anders kiest; alleen zonder enige trip mag het leeg blijven. Bij uitgaven volgt de trip uit de datum (te wijzigen onder "Meer velden"). In het bewerkblad is de trip te kiezen.
- Later toe te voegen (release 4): `accountId, priority, tag, counterparty, importId`, volgens Oliviers categorieën (1 loon, 2 lening, 3 gift, 4 overig; −1 verplicht, −2 normaal, −3 eigen tijd, −4 vakantie; 0 overboeking).

### Training

**Curriculum** (`curricula.json.enc`, met `schemaVersion` zoals elk bestand)
`id, body (ASA|RYA|CWO|eigen), courseCode, name {nl,en}, groups: [{id, title {nl,en}, topics: [{id, title {nl,en}, kind (theorie|praktijk), examCritical}]}], source (seed|eigen), updatedAt, deletedAt`
- Meegeleverd in `src/model/seed-curricula.ts` met vaste id's (`seed-asa-101` …): ASA 101, 103, 104 en 114 met onderwerpen in eigen woorden (nl+en, geen officiële teksten) en de notitie "Controleer tegen de officiële ASA-standaard"; RYA (Competent Crew, Day Skipper, Coastal Skipper, Yachtmaster Offshore) en CWO (Kajuitzeilen I–III) alleen als lege structuur.
- Een meegeleverde cursus wordt pas opgeslagen als Olivier hem bewerkt (zelfde id, `source: seed`); een tombstone verbergt hem. Alles is bewerkbaar.
- Import en export als JSON (`format: logboek-curriculum`, delen via `navigator.share` of download). Een export bevat alleen de cursusopbouw, geen studenten; een import krijgt altijd nieuwe id's.

**Student** (`students.json.enc`, regel 14)
`id, firstName, curriculumId, level (beginner|gemiddeld|gevorderd), progress: {[topicId]: {status (nieuw|geoefend|beheerst), updatedAt}}, exam?: {date, passed, note?}, note?, startedAt?, archivedAt?, updatedAt, deletedAt`
- `weekId?` koppelt de student aan een trip. Ontbreekt het (oudere studenten), dan hoort de student bij de trip waarin `startedAt` valt; anders staat hij in het Studentenarchief onder "Zonder trip". `startedAt` telt ook mee als activiteit.
- Een deelnemer met cursus krijgt automatisch een student met hetzelfde id; naam, niveau en cursus volgen de trip, en de voortgang blijft. Een student die in Deze trip wordt toegevoegd, komt bij de deelnemers.
- Na 12 maanden zonder activiteit (begin, examen, voortgang of wijziging) automatisch gearchiveerd, pas na een geslaagde sync. Het archief is te wissen.
- Wissen maakt een tombstone met alleen `id` en tijden. Oudere versies blijven versleuteld in de git-geschiedenis van `logboek-data` tot die repo opnieuw wordt aangemaakt.
- Groepsafvinken verlaagt nooit een status.

**WeekPlan** (`plans.json.enc`)
`id, title, startDate, dayCount, tripId?, groups: [{id, name, curriculumId, level, studentIds}], days: [{date, blocks: [{id, slot (ochtend|middag|avond), groupIds, topicIds, themeIds?, location?, note?}]}], updatedAt, deletedAt`
- Grote thema's in plaats van losse onderwerpen: een thema is een onderdeel (groep) van de cursus; `themeIds` zijn die onderdelen en `topicIds` hun onderwerpen. Oudere planningen zonder `themeIds` tonen gewoon hun onderwerpen.
- Concept (`src/model/plans.ts`, zonder netwerk): per dagdeel een of twee thema's; theorie-thema's 's ochtends, praktijk-thema's 's middags, thema's met examenkritische onderwerpen eerst, elk thema één keer over de lesdagen verdeeld (meer dagen dan thema's laat dagdelen vrij om te oefenen), laatste dag herhaling (de examenkritische onderwerpen) en examen.
- Snel veranderen tijdens de trip: een blok met één tik een dag eerder of later (met ongedaan maken), thema's aan of uit met een tik in het blokblad; een thema afvinken = al zijn onderwerpen geoefend voor de hele groep (verlaagt nooit).
- Groepen verwijzen naar studenten via id; gedeelde tekst, printweergave en "Toon aan studenten" tonen groepsnamen, nooit studentnamen of voortgang.
- Een planning hoort bij een trip via `tripId`; zonder `tripId` (oudere planningen) bij de trip waarin `startDate` valt. Een nieuwe planning vanuit Deze trip krijgt de trip, de startdatum, het aantal dagen en groepen per cursus van de deelnemers mee.

### Kluis (release 3)

**Document**
`id, title, category (identiteit|certificaten|verzekering|reis-visa|werk-contracten|financieel|overig), issuedAt?, expiresAt?, notes?, mime, size, offline, updatedAt, deletedAt`
Foto's schalen tot max 1600 px lange zijde, JPEG 0,8. PDF ongewijzigd. Max 20 MB. `identiteit` en `certificaten` standaard offline beschikbaar.

### Instellingen

`settings.json.enc`: laatst gebruikte boot, rol, valuta, bron, soort, watertype en trip; de lopende trip (`activeWeekId`); bevestigde of overgeslagen boten (`boatsChecked`, naam|model); herinnering in agenda-bestanden (`reminderAlarmDays`); jaardoel in nm; afstudeerdatum (later). Alleen lokaal, niet gesynct: vingerafdruk aan/uit en de taal (`localStorage` `logboek-taal`).

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

**Boten uit de kolom Schip** (`src/model/boats.ts`): meestal "Naam (Model)", soms alleen een model (tekst met een getal) of alleen een naam (zonder getal), soms met een lengte in het model ("38ft"). De import zet naam en model op de trip. De bootlijst is afgeleid uit de trips (opgeslagen bootgegevens, anders de boot uit de dagen), dus ook eerder geïmporteerde data werkt zonder opnieuw te importeren. Lengte (getal met ft of m, of een modelnummer: "4.2" = 42 ft, "42" = 42 ft, "519" = 52 ft, vanaf 600 centimeters) en catamaran (bekende merken) zijn alleen een voorstel: zichtbaar ingevuld en gemarkeerd in het scherm "Bootgegevens controleren", nooit stil opgeslagen. Dat scherm komt direct na een import, en via een melding in het Logboek voor boten met ontbrekende gegevens: per boot naam, model, soort (eenromp/catamaran) en lengte, "Alles bevestigen" schrijft alles naar de trips van die boot; overslaan mag. Onder Meer → Boten staat dezelfde lijst.

Testfixtures `tests/fixtures/mijlen-nep.xlsx` (gegenereerd met `npm run fixtures`, zelfde opbouw als het origineel: Sheet1 met samenvattingsformules in J1:O4 en kopregel op rij 6, Blad1 met de rollenlijst, data-validatie-extensie) , `tests/fixtures/boten-nep.csv` (gegenereerd door `scripts/fake-boats-csv.ts`: CSV-export met komma's, datums als d/m/jj en dezelfde soorten waarden in Schip, met verzonnen bootnamen en modellen) en `tests/fixtures/mijlen-nep.csv`: gegenereerd, zelfde opbouw (samenvattingsregels, kopregel, lege rijen tussen tochten, lege datums, `;` als scheidingsteken), verzonnen plaatsen en getallen.

## Schermen

Onderste balk: **Vandaag · Deze trip · + · Logboek · Meer**, vijf gelijke vakken met het + in het midden als ronde knop. Onder **Meer**: Geld, Termijnen, Boten, Plaatsen, Cursussen, Studentenarchief en Instellingen (met een terugknop naar Meer). Kluis komt erbij zodra die gebouwd is.

1. **Ontgrendelen:** wachtzin of vingerafdruk. Niets anders zichtbaar. Binnen 5 minuten na het laatste gebruik hervat de app zonder dit scherm (regel 10).
2. **Eerste keer:** zie "Eerste keer op een apparaat".
3. **Vandaag:** sync-status bovenaan (tikken of omlaag trekken synchroniseert). Geen bedragen en geen geldkaarten: Vandaag staat ook open als studenten meekijken. Onderdelen:
   - de planning van vandaag uit de lopende planning (alleen als er vandaag iets gepland is; tik op een thema = al zijn onderwerpen geoefend voor de hele groep);
   - bij een geplande etappe (route-sjabloon) "Zoals gepland" en "Aanpassen";
   - de knop "Dag van vandaag loggen" (opent Toevoegen → Dag, voorgevuld);
   - op zondag "N dingen aanvullen" (alleen als er lege velden zijn; zie Niets is verplicht);
   - nm dit jaar met voortgang naar een instelbaar jaardoel (standaard 2.500 nm, in `settings.json.enc`);
   - Termijnen: de eerstvolgende drie (eigen deadlines en vervaldatums, de token, de start van de volgende trip; te laat of verlopen bovenaan), "Termijn toevoegen" en "Alle" (Meer → Termijnen).
4. **Deze trip:** de lopende trip; zonder lopende trip "Nieuwe trip". Onderaan de komende trips met het aantal dagen tot de start (tikken = bewerken).
   - Kop met naam, type, datums, boot (naam · model · lengte in ft en m · soort), basis, gebied, charterbedrijf en organisatie (tikken = bewerken). Ontbrekende gegevens: badge "Onvolledig".
   - Vergeten dagen (binnen de trip, tot en met vandaag, zonder gelogde dag): melding met één knop die Toevoegen → Dag op die datum opent.
   - Na de einddatum "Trip afronden": samenvatting (dagen, nm, inkomsten in euro, deelnemers met resultaat), cijfer en één zin "wat leerde ik"; reviewscore met citaten van gasten ingeklapt (Engelstalige citaten blijven Engels).
   - Vaste checklists bij het type van de trip (safety briefing, check-in en check-out, paklijst), af te vinken per trip en als sjabloon te bewerken.
   - Deelnemers.
   - Planning (bij training geven): wizard in drie schermen (dagen, groepen, concept) met grote thema's per dagdeel, blok met één tik een dag eerder of later, bewerken met tikken, "Toon aan studenten" (alleen de planning volledig scherm, zonder onderbalk of andere gegevens, terug met één knop), delen als tekst via `navigator.share` of als PDF via de printfunctie, in een exporttaal los van de app-taal.
   - Checklists per deelnemer: grote vinkvakken (één tik = volgende status), examenkritische onderwerpen op "nieuw" bovenaan, voortgangsbalk per groep, "Alles geoefend/beheerst" per groep, "Groep afvinken" voor één onderwerp voor meerdere studenten.
   - Gezeilde dagen met nm-totaal; elke dag is aan te tikken en te bewerken; "Dag toevoegen" opent Dag op de eerstvolgende vergeten dag. De eerste dag van een trip begint op de basis.
   - Inkomsten en uitgaven van de trip in euro, standaard verborgen achter "Toon bedragen".
   
   Een open planning of student vult het hele scherm.
   
   **Nieuwe trip** (één scherm, ook bewerken):
   - "Snel starten": Herhaal vorige trip en route-sjablonen uit de historie;
   - naam, type als knoppen, startdatum (vandaag), aantal dagen (7, tot 120);
   - boot: naam, model, lengte, basis, soort en charterbedrijf, met suggesties uit eerdere trips; gebied, organisatie (niets verplicht);
   - deelnemers één per regel met optioneel niveau en cursus.
5. **Toevoegen (+):** tabs **Dag · Inkomsten · Uitgave**, opent op Dag. Snelkoppelingen op het app-icoon (manifest `shortcuts`: Dag loggen, Inkomsten, Uitgave) openen `?toevoegen=dag|inkomsten|uitgave`: na ontgrendelen (of binnen de 5 minuten van de sessie) direct Toevoegen op dat tabblad; de parameter verdwijnt meteen uit de adresbalk.
   - Dag: alle velden direct in beeld, compact: datum (vandaag), van (vorige bestemming), naar (beide met suggesties uit eerdere plaatsen en een kaartknop: offline kaart, bekende plaatsen als stip, tik = nieuw punt met naam, "Huidige locatie"), nm (voorgevuld met het afstandsvoorstel), watertype, nachturen, wind, boot, rol, week, notitie. Boot, rol en trip komen uit de lopende trip; ontbreekt er iets, dan een voorgevuld veld en nooit een blokkerende melding. Niets is verplicht.
   - Inkomsten: bedrag (groot numeriek toetsenbord), soort (fooi, loon of dagtarief, bonus of provisie, terugbetaling onkosten, overig), trip, bron, valuta, datum, notitie.
   - Uitgave: bedrag, omschrijving, soort (kosten/investering); bron, valuta, datum en trip onder "Meer velden".
   - Opslaan = één tik met een korte trilling, daarna terug naar Vandaag met een korte bevestiging zonder bedrag. Laatst gebruikte waarden worden onthouden.
6. **Logboek:** totalen bovenaan (nm per rol, per watertype, nachturen, dagen, trips). Grafiek nm per maand (12 maanden). "Nieuwe trip" en "Zeiltijd exporteren". Daaronder trips per maand met vaste maandkoppen, nieuwste eerst, uitklapbaar naar de dagen; "Trip bewerken" opent het tripscherm. Knop "Importeren" (Excel of CSV).
7. **Geld** (onder Meer): alles in euro, het originele bedrag klein eronder ("voorlopig" bij een voorlopige koers). Saldo, inkomsten en kosten; grafieken fooi per week (12 weken) en inkomsten/kosten per maand (12 maanden) met tabel; per bron; transacties per maand met bewerken (ook het werkelijk ontvangen eurobedrag) en verwijderen. Geen netto waarde, geen bankrekeningen (release 4).
8. **Termijnen** (onder Meer): alle openstaande termijnen, eerstvolgende eerst, toevoegen, en de afgeronde.
8. **Cursussen** (onder Meer): per bond, met import (JSON), per cursus bewerken (groepen en onderwerpen toevoegen, wijzigen, verplaatsen, examenkritisch) en delen.
8. **Boten** (onder Meer): alle boten uit de trips met naam, model, soort en lengte, in één keer te bewerken (zie Boten uit de kolom Schip).
8. **Plaatsen** (onder Meer): alle plaatsen uit de dagen, meest gebruikt eerst, met of zonder punt; tik = op de kaart zetten (één tik op de kaart); voorstellen om spelvarianten samen te voegen bovenaan.
9. **Studentenarchief** (onder Meer): studenten zonder trip en gearchiveerde studenten; terugzetten en wissen.
10. **Instellingen** (onder Meer): vergrendelen, wachtzin wijzigen, herstelcode tonen (na wachtzin), vingerafdruk aan/uit, token vervangen, export (versleuteld), jaardoel, taal (Nederlands/Engels), Over (versie uit `package.json`, bouwdatum = commitdatum, korte commit-hash).

Bij elke fout staat een knop **Kopieer foutdetails** (`src/errors.ts`): app-versie, scherm, foutcode en geschoonde stacktrace, zonder inhoud (regel 9). Olivier plakt die in een cloud-sessie. Niet bij een verkeerd getypte wachtzin of herstelcode.

Geen onboarding, geen tutorial, geen bevestigingsdialogen behalve bij exporteren. Verwijderen gebeurt zonder bevestigingsvraag, met de melding "Verwijderd · Ongedaan maken" (5 seconden). Elke dag, tocht en transactie is aan te tikken en te bewerken in een onderblad; een tocht kan hernoemd worden en een dag kan naar een andere tocht. Alles werkt op 360 px breed, bedienbaar met één duim.

## Mapstructuur app-repo

```
logboek/
  CLAUDE.md
  README.md
  index.html
  vite.config.ts
  public/            manifest-iconen, bip39-nl/en woordenlijst, coast/ (offline kaart), sw-vensters.js, reset.html + reset.js (noodpagina)
  src/
    crypto/          keys.ts, encrypt.ts, passphrase.ts, recovery.ts, webauthn.ts
    i18n/            index.ts (t, translate, taalkeuze), nl.ts (bron, getypeerde sleutels), en.ts, labels.ts
    storage/         idb.ts, outbox.ts, github.ts, sync.ts, store.ts, token.ts, fingerprint.ts
    model/           types.ts, derive.ts, money.ts, rates.ts, settings.ts, schema.ts, edit.ts, reminders.ts,
                     weeks.ts, curricula.ts, seed-curricula.ts, students.ts, plans.ts, places.ts, gaps.ts, boats.ts, routes.ts, ics.ts,
                     checklists.ts, seed-checklists.ts, sailtime.ts
    import/          mileage-csv.ts (mijlenregels), rows.ts (formaat herkennen), csv.ts, xlsx.ts, xml.ts
    screens/         Unlock, Setup, Home, Today, ThisWeek, Planning, Students, StudentArchive, Courses, Sailing (Logboek), SailingExport, Deadlines, Boats, Places,
                     Money, QuickAdd, More, Settings
    components/      kleine herbruikbare onderdelen (BottomBar, BarChart, SeaMap, MapSheet, Sheet, EditSheets, WeekSheet, CurriculumSheets,
                     SyncStatusLine, Icon, Toast, …)
    session.ts       ontgrendelen, vergrendelen, sessiesleutel (regel 10), meta terugzetten op GitHub
    screen-files.ts  welke databestanden bij welk scherm horen (melding bij een onleesbaar bestand)
    repair.ts        Logboek herstellen: diagnose en herstel van onleesbare bestanden
    errors.ts        foutdetails zonder inhoud
    share.ts         lokaal gemaakt bestand delen of downloaden
    app.css          ontwerpsysteem
  tests/             vitest (crypto, sync, unreadable, session, derive, import, xlsx, edit, errors, i18n, curricula,
                     students, plans, weeks, week-links, rates, gaps, boats, places, routes, checklists, repair-loop, storingen,
                     foutmatrix, screen-files, upgrade-samples) + playwright (upgrade, updates, setup, unlock, sessie, import, boten, plaatsen, sjablonen, afsluiten, bewerken, aanvullen,
                     taal, navigatie, toevoegen, weken, cursussen, studenten, planning, koersen, onleesbaar bestand,
                     schermafbeeldingen 360/412 px licht/donker, Nederlands en Engels)
    fixtures/        alleen gegenereerde nepdata (npm run fixtures)
    upgrade/         voorbeeld per databestand en de generator die in de vorige release draait
  .github/workflows/ deploy.yml (alleen vanaf main, plus dagelijks voor de koersen), test.yml (bij elke PR en push;
                     uploadt schermafbeeldingen)
  scripts/           build-previous.mjs (vorige release voor de upgradetest), generate-fake-data.ts, fake-xlsx.ts, fake-boats-csv.ts, generate-icons.mjs, build-rates.mjs (ECB → public/rates.json),
                     build-coast.mjs (Natural Earth → public/coast/)
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
- Olivier doet geen handwerk buiten de app. Herstel, migraties en opruimen gebeuren in de app zelf, met hoogstens een paar tikken. Alleen wat echt alleen hij kan (wachtzin, bestand kiezen, GitHub-rechten) vraagt de app aan hem.
- **Reviews en wachten:** reviews met hoogstens één review-agent tegelijk, op de voorgrond. Bij werk zonder Olivier nooit wachten op achtergrondmeldingen; CI volgen met `gh pr checks --watch` en deploys met `gh run watch`.
- **Definition of done:** tests groen (ook de upgradetest), werkt offline, werkt op 360 px breed, geen nieuwe netwerkbestemmingen, geen nieuwe afhankelijkheden zonder reden in de PR.
- **Dataformaat:** wijzigingen altijd achterwaarts compatibel. Een nieuw of gewijzigd databestand krijgt een voorbeeld in `tests/upgrade/upgrade-samples.ts` (regel 16). Een nieuwe `schemaVersion` alleen met migratie en een test die data van de vorige versie inleest. Ziet de app een hogere `schemaVersion` dan hij kent, dan schrijft hij niets naar GitHub en toont hij "Werk de app bij".
- **Afhankelijkheden:** toegestaan zonder overleg: `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `vite-plugin-pwa`, `idb`, `typescript`, `vitest`, `@playwright/test`, `fake-indexeddb`, eslint, `lucide-react` (iconen), `fflate` (uitpakken van .xlsx). Al het andere: eerst vragen.
- **Beveiligingsreview (verplicht vóór live):** een aparte sessie die de code niet geschreven heeft, krijgt de code en deze scenario's: gestolen ontgrendelde telefoon, gestolen vergrendelde telefoon, gelekte GitHub-token, gelekte `logboek-data`, gecompromitteerde `logboek`-repo, kwaadaardige npm-afhankelijkheid. Per scenario: wat kan een aanvaller wel, wat niet, en welke regel dat garandeert. Daarna Oliviers handtest: `logboek-data` clonen op een andere computer en proberen data te lezen zonder wachtzin.

## Releases

Elke release bestaat uit losse PR's. Wat niet in de huidige release staat, wordt niet gebouwd.

1. **Bruikbaar (gedaan).** Basis afgerond op 25 oktober 2026 (skelet en deploy, versleuteling en ontgrendelen, sync, logboek met import, zeilgeld, Vandaag, Instellingen, vingerafdruk, PWA op telefoon; in gebruik voor mijlen en zeilgeld). Daarbovenop: import van Excel en CSV ook op Android, sessie die verversen en wisselen van app overleeft, vast ontwerpsysteem met iconen en grafieken, bewerken met ongedaan maken, onderhoud vanaf de telefoon (versie, foutdetails).
2. **Instructeur (deze release).** Logboek is ook de trainingsapp als zeilinstructeur: taal (Nederlands en Engels), Vandaag zonder geld, curricula en checklists (ASA, RYA, CWO, eigen), studenten en voortgang (regel 14), weekplanning met tonen aan studenten en delen. Daarna: herstel bij een onleesbaar bestand op GitHub, Toevoegen met Dag eerst, weken (type, deelnemers, afronden met review), onderbalk Vandaag · Deze trip · + · Logboek · Meer, en geld in euro met ECB-koersen. Daarna gebruiksvriendelijk: Deze trip (trips van elke lengte, bootgegevens, eerdere en komende trips, vergeten dagen), Toevoegen met Dag · Inkomsten · Uitgave, offline kaart met afstandsvoorstel uit eerdere routes, termijnen (deadlines en vervaldatums samen) en planning met grote thema's.
3. **Kluis en volledige beveiligingsreview.** Kluis met nepdocumenten, scannen met camera, vervaldatums en de vervaldatum-Action, back-up-Action. Daarna de volledige beveiligingsreview en Oliviers handtest uit Werkwijze, dan de live-gang; pas dan echte documenten erin.
4. **Geld compleet.** Volledige geldmodule: rekeningen ASN, Revolut, BUX, DEGIRO, Excel sinds 2023, netto waarde, maanden te gaan, aandelenkoersen, scenario's.
5. **Doelen en skills.** Doelen, metingen, ademtrainer, skills, voortgang Yachtmaster/ASA.
6. **Carrière.** Sollicitaties en netwerk, status andere projecten.
7. **Wow.** Zeiljaar Wrapped, weekreview, zeil-CV, routekaart (GPS-logboek), horloge (Samsung Galaxy Watch 7) en Health Connect. Een zeil-CV als publieke pagina mag niet als tweede Pages-site in organisatie `logboek-olivier` (regel 13); die komt dan buiten deze organisatie, of als export die Olivier zelf deelt.

## Schrijfstijl in de app

- Nederlands, zakelijk, kort. Geen uitroeptekens, geen "Gefeliciteerd!", geen AI-achtige volzinnen. Engels in dezelfde stijl (British English).
- Knoppen: werkwoord eerst ("Opslaan", "Importeren").
- Geen vage verwijzingen ("dit", "hier"); benoem wat bedoeld wordt.
- Getallen: Nederlandse notatie (1.240 nm, € 1.250,50); in het Engels Britse notatie (1,240 nm, €1,250.50). Zeemijlen als `nm`.
