# Plan voor delen

Onafhankelijke review, 3 november 2026. Hoe Olivier Logboek met andere schippers kan delen, met de gevolgen voor de
gebruiker, de beveiliging, updates en het onderhoud. Alles hieronder is tegen de code gecontroleerd (verwijzingen naar
bestanden); de open punten staan in `docs/review.md`.

## 1. Wat er nu al is

De app is sinds PR #96 (30 oktober) en PR #118 (1 november) technisch klaar voor een tweede gebruiker op dezelfde site:

- Elke gebruiker kiest bij de eerste keer een eigen repository ("eigenaar/naam"); die staat versleuteld bij de token
  (`StoredToken.repo`, `src/storage/token.ts:17`) en elk verzoek gaat daarheen (`GithubClient.repo`). Zonder opgeslagen
  repo (Oliviers oude opslag) geldt `logboek-olivier/logboek-data` (`DATA_REPO`, `src/storage/github.ts:16`).
- Eigen wachtzin, hoofdsleutel en herstelcode per logboek; niets staat bij Olivier.
- Een nieuw logboek begint leeg (`startedEmpty`): geen organisaties, geen cursuspakketten; Sailing Virgins en Yacht
  Week zijn alleen een voorstel (`src/basis/organisatie.ts`).
- De app is tweetalig (Nederlands en Engels, 2.180 sleutels, type-gecontroleerd) en volgt de taal van de telefoon.
- Er is een demomodus zonder GitHub (`src/demo.ts`), zodat iemand kan kijken voordat hij iets instelt.

Wat ontbreekt staat in hoofdstuk 5.

## 2. De drie opties

### A. Eén app-URL voor iedereen, elke gebruiker een eigen private data-repo en token

Zo werkt het nu. Iedereen opent `logboek-olivier.github.io/logboek/`, maakt een GitHub-account, een lege privé
repository en een fine-grained token, en kiest een wachtzin.

| | Voordeel | Nadeel |
|---|---|---|
| Gebruiker | Niets installeren behalve de PWA; data in eigen beheer; werkt offline; gratis | Een GitHub-account, een repository en een token aanmaken is voor een niet-technische schipper 10 tot 20 minuten met drie onbekende schermen (zie `docs/screens/02-uitleg-github.png`); een fine-grained token verloopt (hoogstens een jaar) en moet dan vernieuwd worden |
| Beveiliging | Data nooit bij Olivier; per gebruiker één token met alleen `Contents` op één repo; AES-GCM onder een eigen sleutel | De code komt van Oliviers `main`: wie `main` of zijn GitHub-account overneemt, kan bij het volgende openen ieders wachtzin of data wegsturen (scenario f in de beveiligingsreview). Dat risico geldt nu voor één persoon, straks voor iedereen |
| Updates | Eén deploy, iedereen tegelijk bij; schrijfversie en schemaversie beschermen oude builds op andere apparaten | Een fout in een deploy raakt iedereen tegelijk; er is geen staging of gefaseerde uitrol; migraties die vanzelf draaien (periodemodel) draaien bij iedereen |
| Onderhoud | Eén codebasis, één CI | Olivier wordt beheerder en helpdesk: tokens, verloren wachtzinnen (niet te helpen), Excel-formaat |

### B. A plus een modus "alleen op dit apparaat" met versleutelde back-up, voor schippers zonder GitHub

De app draait met dezelfde versleuteling op IndexedDB, zonder sync; de gebruiker bewaart zelf regelmatig een
versleutelde back-up (de huidige `logboek-back-up-<datum>.txt`, `src/storage/backup.ts`) naar Drive of een laptop.
Technisch: de Store heeft al een stand zonder netwerk (de demo draait precies zo: `GithubClient` zonder fetch,
`blockNetwork`), en de back-up bevat meta plus alle records. Nodig: een derde keuze op het eerste scherm, een lokale
`meta.json.enc` zonder GitHub-controle, de syncstatus en Opslag zonder GitHub-regels, een herinnering "maak een back-up"
(bijvoorbeeld bij de weekafsluiting), en "Later alsnog aan GitHub koppelen" (de bestanden één keer uploaden). Omvang: M
tot L (twee tot vier dagen), vooral omdat `Store.runSync`, `src/session.ts` en Meer → Opslag overal uitgaan van een
repo.

| | Voordeel | Nadeel |
|---|---|---|
| Gebruiker | Starten in één minuut: wachtzin kiezen, klaar; geen GitHub | Geen tweede apparaat; een kapotte of gestolen telefoon zonder recente back-up betekent dataverlies; de back-up zelf bewaren is een gewoonte die mensen niet hebben |
| Beveiliging | Geen token, geen netwerk, zelfde versleuteling | De back-up staat onversleuteld-in-naam ("logboek-back-up") op Drive: alleen te openen met de wachtzin, maar wel zichtbaar dat hij er is |
| Updates | Zelfde deploy | De upgradetest moet ook zonder GitHub draaien; "Werk de app bij" en de schrijfversie werken nu via de bestanden op GitHub |
| Onderhoud | Minder helpdesk over tokens | Meer code in de kern die het minst mag breken (storage, session); de foutmatrix (`tests/foutmatrix.test.ts`) krijgt een derde dimensie |

### C. Elke gebruiker een fork

De gebruiker forkt `logboek` naar zijn eigen GitHub, zet Pages aan en krijgt `<naam>.github.io/logboek/`. Dat staat
CLAUDE.md regel 13 toe (buiten organisatie `logboek-olivier`). Nodig: `base`, `start_url`, `scope`, de link in
`src/model/daily.ts` en de standaardrepo mogen niet meer vast staan (nu `/logboek/` en `logboek-olivier` in
`vite.config.ts` en `src/storage/github.ts`), en `deploy.yml` moet bij de forker werken (secrets: geen; Pages aanzetten
wel).

| | Voordeel | Nadeel |
|---|---|---|
| Gebruiker | Volledig onafhankelijk van Olivier; eigen URL | Het meest technische pad: fork, Pages, Actions, en bij elke update zelf "Sync fork" doen; iemand die geen token kan maken, kan dit zeker niet |
| Beveiliging | Een gecompromitteerde `main` van Olivier raakt alleen wie bewust synct; de gebruiker leest de diff (in theorie) | Niemand leest de diff; de ECB- en weerscripts draaien bij de forker met zijn eigen Actions-minuten |
| Updates | De gebruiker bepaalt wanneer | Versies lopen uit elkaar; een oude fork met een nieuw apparaat geeft precies de "Werk de app bij"-situaties die de schrijfversie moet opvangen, maar dan zonder dat Olivier het ziet |
| Onderhoud | Geen helpdesk over andermans data | Fouten in oude forks komen bij Olivier terecht zonder dat hij ze kan nabouwen |

## 3. Onderwerpen die bij elke optie spelen

**Starten zonder technische kennis.** Wat de app al doet: de uitleg in vier stappen met links, de controle van token en
lege repo met meldingen in gewone taal (`Session.checkEmptyRepo`), de vervaldatum uit de tokenheader, de demo. Wat de
gebruiker zelf moet: het GitHub-account (met tweestapsverificatie, dat vraagt GitHub tegenwoordig zelf), de repository
en de token. Wat beter kan (en voor delen moet): een stap-voor-stap pagina met schermafbeeldingen van GitHub in de taal
van de gebruiker, de repo niet voorgevuld met die van Olivier bij "Bestaand logboek koppelen" (`src/screens/Setup.tsx:121`,
`repoDefault={… : DATA_REPO}`), en een uitleg bij de token dat hij verloopt en hoe je hem vernieuwt (Instellingen → Token
vervangen bestaat al), en een harde controle dat de repository privé is: nu kijkt de app alleen of ze bestaat
(`GithubClient.checkAccess`, `src/storage/github.ts:213`), zodat een per ongeluk publieke repo al het versleutelde
materiaal openbaar zet (docs/review.md, B-4). Zie het werkpakket in `docs/review.md`.

**Updates uitrollen zonder andermans data te breken.** Het mechanisme is goed (zie `docs/app-kaart.md`, 5 en 7): elk
bestand draagt `schemaVersion` en `minWriterVersion`; een oudere build schrijft nooit over een nieuwer bestand; de
upgradetest draait vanaf vier releases; een nieuwe versie neemt op elk apparaat vanzelf over. Wat ontbreekt voor meerdere
gebruikers:
1. **Eerst bij Olivier testen** is nu hetzelfde als "live": `deploy.yml` draait bij elke push op `main`, en er mag geen
   tweede Pages-site in de organisatie (regel 13). Een staging kan alleen buiten de organisatie (een tweede account met
   een fork die van een branch deployt), of als release-tag: `deploy.yml` alleen op een tag `v*` laten draaien, en op `main`
   mergen zonder te deployen. Dan kan Olivier een week met `main` draaien via `npm run preview` of een eigen fork voordat
   hij tagt.
2. **Automatische migraties bij anderen**: de proef op een kopie (`src/domain/relaties.ts`) en "niets geschreven bij een
   fout" zijn er; wat ontbreekt is dat de gebruiker ziet wát er gaat gebeuren. Voor "Geld omzetten" is dat er (een scherm
   met aantallen); voor het periodemodel niet. Nieuwe migraties zouden het patroon van Geld omzetten moeten volgen.
3. **Een versienummer dat iets zegt**: `package.json` staat op `1.0.0` sinds 26 oktober; Over toont alleen de commit.
   Zonder releasenummers kan niemand melden "sinds versie X klopt Y niet".
4. **Terugdraaien**: kan door een oudere commit te deployen, maar de schrijfversie mag nooit omlaag; een teruggedraaide
   build die een lagere `WRITER_VERSION` heeft, leest de bestanden van iedereen als "van een nieuwere versie" en blokkeert.
   Terugdraaien betekent dus altijd: vooruit met een fix.

**Als `logboek` of Oliviers account gecompromitteerd raakt.** Dat raakt iedereen die de app daarna opent, niet de data
op GitHub zelf (die blijft versleuteld). Wat helpt en al bestaat: ruleset op `main`, `deploy.yml` met `contents: read`,
geen secrets, CSP met alleen `api.github.com`. Wat erbij moet voor een gedeelde app: tweestapsverificatie met
hardwaresleutel op Oliviers account, de Actions op een commit-hash in plaats van `@v5` (bevinding 8 van de
beveiligingsreview, nog open), `kaart.yml` zonder `contents: write` op dezelfde repo of in een aparte repo, een vaste
afspraak dat elke PR in `src/crypto`, `src/storage`, `index.html`, `.github/workflows` en `package-lock.json` door Olivier
zelf gelezen wordt (staat in het rapport van PR #76 als voornemen), en een manier om gebruikers te bereiken (zie
Feedback). Overweeg Subresource Integrity niet: de pagina komt van dezelfde origin als de scripts, dus SRI beschermt hier
niet tegen een overgenomen repo.

**Herstel als iemand wachtzin én herstelcode kwijt is.** Niet mogelijk, en dat is het ontwerp: `meta.json.enc` bevat de
hoofdsleutel alleen ingepakt onder de wachtzin en de herstelcode (`src/crypto/keys.ts:38`). Olivier kan niets. Dat moet
op drie plekken expliciet staan: in de app bij de herstelcode (staat er: "Zonder wachtzin én zonder herstelcode is
alles weg"), in de handleiding, en in wat Olivier zegt als hij de app aan iemand geeft. Wat wél kan, en nu niet bestaat:
een "proefontgrendeling" na een week ("Weet je je wachtzin nog?"), en een herinnering om de herstelcode te controleren
(drie woorden typen, zoals bij het aanmaken). Een derde weg (bijvoorbeeld een herstelsleutel bij een vertrouwd persoon)
is een bewuste ontwerpkeuze die Olivier moet nemen; technisch is het een derde verpakking in de meta.

**Feedback zonder analytics.** Er is geen enkel kanaal; CLAUDE.md verbiedt analytics, terecht. Wat past: "Kopieer
foutdetails" bestaat al en bevat geen inhoud (`src/errors.ts`); een knop "Feedback" onder Instellingen → Over die een
e-mail of een GitHub-issue opent met de app-versie, het scherm en een leeg tekstveld (de gebruiker typt zelf; niets gaat
vanzelf). Voor wie geen GitHub-issue wil: een `mailto:` met voorgevulde onderwerpregel. Meer niet.

**Privacy van deelnemers (regel 14).** De regel is in de code afgedwongen (`firstNameOnly`, tombstones zonder inhoud,
geen namen in de export, geen namen op Vandaag). Bij meerdere gebruikers komt er één ding bij: de gebruiker is nu een
instructeur of skipper die namen van gasten vastlegt onder zijn eigen verantwoordelijkheid. De handleiding moet dat
zeggen ("alleen voornamen, en vraag je gasten niets wat je niet nodig hebt"). Niets in de app deelt deelnemers tussen
gebruikers; er is geen gezamenlijke opslag.

**Taal.** De UI is compleet in Nederlands en Engels. Niet vertaald: de handleiding en alle docs (Nederlands), de
manifest-beschrijving en `lang="nl"` in `index.html` (`vite.config.ts:46`), de meegeleverde checklists en cursussen
(wel tweetalig, nl/en), de foutdetails (Nederlandse labels), het Excel-formaat (Nederlandse kopregel verplicht). Voor
Engelstalige schippers is de app bruikbaar; voor Duitse, Franse of Spaanse niet zonder een derde taal, en die kost een
vertaling van 2.180 sleutels.

**Olivier-specifieke onderdelen die voor anderen zinloos of verwarrend zijn** (gemeten in de code):
- `WORK_NAME`/`subFromName` in `src/model/trip-kind.ts:30-35` herkennen alleen "Yacht Week", "Sailing Virgins", "SV",
  "YW"; een trip van een eigen organisatie zonder type is nooit "zeker" (`tests/review-sommen.test.ts`, overgeslagen test).
- De standaardsoort van een snelle trip is `training-geven` (`src/components/QuickTrip.tsx:30`): een instructeursdefault.
- `TransactionSource` kent vier waarden met twee van Oliviers organisaties (`src/model/types.ts:248`); het jaaroverzicht
  valt daarop terug (`src/model/tax-year.ts:68`).
- Rekeningaanbieders ASN, Revolut, BUX, DEGIRO, DUO (`src/model/types.ts:674`) en de importvoorinstellingen.
- Vaste weerpunten (BVI tot Waddenzee) en vier kaartgebieden; voor een schipper in de Middellandse Zee buiten Griekenland
  en Kroatië is er geen weer en geen detailkaart.
- De dagelijkse herinnering valt terug op `logboek-olivier.github.io` (`src/model/daily.ts:12`).
- De demo-data gebruiken Sailing Virgins en Yacht Week.
- Het importformaat is Oliviers Excel, met Nederlandse kolomnamen, en dat staat nergens in de app uitgelegd (wel in
  CLAUDE.md).

**CLAUDE.md-regels die moeten veranderen bij delen:**
- De kop ("Persoonlijke app van Olivier", "Eén gebruiker") en de secties Gebruiksdoel en Twee gebruikers: de maatstaf
  "kost dit Olivier per week meer dan 30 seconden" wordt "kost dit een gebruiker…".
- Regel 6 en 7 (Claude raakt `logboek-data` en Oliviers importbestanden nooit aan) blijven; erbij: nooit andermans repo.
- Regel 11 (status van de beveiligingsreview) en Releases punt 3: de kluis is niet vrijgegeven en de review van PR #76 is
  van vóór de domeinlaag, het periodemodel, het geldmodel, scenario's en de tweede gebruiker.
- Opslag en synchronisatie: "`logboek-data`" wordt "de data-repo van de gebruiker"; `DATA_REPO` is alleen nog Oliviers
  terugval.
- Zeilgeld: `source` met de vaste organisaties, "Yacht Week en Sailing Virgins naast elkaar" bij fooi per gast, en de
  teller-voorbeelden.
- Import mijlenregistratie: het formaat moet óf gedocumenteerd worden als "het Logboek-importformaat" met een
  voorbeeldbestand om te downloaden, óf flexibeler worden (kolommen koppelen zoals bij bankstanden).
- Werkwijze: "Olivier werkt alleen vanaf zijn telefoon", "Live-gang" (die is per gebruiker) en de verplichte
  beveiligingsreview "vóór live" worden "vóór delen".

## 4. Aanbeveling

**Optie A, met vier voorwaarden, en B als tweede stap als er vraag naar is.**

Reden: A bestaat al en is getest (`tests/tweede-gebruiker.test.ts`, `tests/e2e/nieuwe-gebruiker.spec.ts`,
`docs/screens/01-…` tot `07-…`), de data blijft bij de gebruiker, en Olivier houdt één codebasis. C verplaatst het
probleem naar mensen die het minst kunnen oplossen en maakt updates onbeheersbaar. B is een goede tweede stap voor de
schipper die geen GitHub wil, maar raakt de kern van de opslagcode en verdient een eigen ronde met foutmatrix en
upgradetest; nu bouwen vertraagt delen met weken.

De vier voorwaarden vóór delen (uitgewerkt als werkpakketten in `docs/review.md`, hoofdstuk Weg naar delen):
1. De instap klopt voor een vreemde: repo niet voorgevuld met die van Olivier, een instapgids met schermafbeeldingen,
   standaardsoort en Nakijken zonder instructeursaannames, Engels als taal van de site-metadata.
2. Releases met een nummer en een deploy op een tag, niet op elke push, zodat Olivier een week vooruit draait.
3. De beveiligingsreview opnieuw op de huidige code (de vorige is van 29 oktober, 56 PR's geleden) en de open punten
   daaruit (Actions op een hash, `kaart.yml`), plus het sleutel-ontwerp voor "wachtzin en herstelcode kwijt" bewust
   vastleggen.
4. Een feedbackkanaal zonder analytics en een handleiding in de taal van de gebruiker.

Wat Olivier er zelf bij moet zeggen aan elke schipper: "Je gegevens staan bij jou. Ik kan ze niet lezen en niet
terughalen. Schrijf de 24 woorden op."
