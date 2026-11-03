# Review: kaart, handleiding en werking vóór het delen

Onafhankelijke review van Logboek, 3 november 2026, commit `158102b` (na PR #132). De reviewer schreef niets van deze
code. Uitgangspunt: er zitten fouten in die eerdere sessies niet zagen. Elke bevinding heeft bewijs (bestand:regel,
testuitvoer of schermafbeelding in `docs/screens/`); zonder bewijs staat er "vermoeden".

Bijbehorende documenten: `docs/app-kaart.md` (hoe de app in elkaar zit), `docs/handleiding.md` (voor een nieuwe
schipper), `docs/functiecheck.md` (wat werkt, met tests), `docs/delen.md` (hoe delen moet werken). Nieuwe tests:
`tests/review-sommen.test.ts` en `tests/e2e/review-kernstromen.spec.ts`.

**Methode.** CLAUDE.md gelezen als bedoeling, alles in de code gecontroleerd; typecheck, lint, de volledige Vitest-suite
(1.305 tests) en de Playwright-suite (153 tests) gedraaid; de kernstromen zelf doorlopen op 360 px met nepdata en een
nagebootste GitHub; de sommen met een eigen test op 500 willekeurige logboeken; één review-agent per rol
("delen en beveiliging", "nieuwe schipper"), waarvan de bevindingen alleen zijn overgenomen als ze zelf te bevestigen
waren. `logboek-data` is nooit aangeraakt.

## 1. Bevindingen, gerangschikt

Ernst: **blokkeert delen** (een vreemde loopt vast, of er lekt iets), **belangrijk** (voor de eerste weken na het delen),
**later**. Omvang: S (uren), M (een dag), L (meer dan een dag).

### Blokkeert delen

**B-1 · De verplichte beveiligingsreview is verouderd en door een agent gedaan; Oliviers handtest ontbreekt.**
Categorie beveiliging. Bewijs: het rapport staat in GitHub PR #76 ("Ronde 2 · PR 13", 29 oktober, één review-agent); sindsdien
56 PR's, waaronder de hele domeinlaag (#113), het periodemodel (#104-#110), het nieuwe geldmodel (#126-#128), scenario's
(#130-#132) en de tweede gebruiker met eigen repo (#96, #118). `VAULT_REVIEWED = false` (`src/model/documents.ts:18`). Open punten
uit dat rapport staan nog open: Actions op tags (`.github/workflows/*.yml`: `actions/checkout@v5` enzovoort), `kaart.yml`
met `contents: write`. CLAUDE.md regel 11 verwijst naar "PR 13", wat GitHub-PR #13 ("Onderhoud: Over met versie…") is;
het bedoelde nummer is #76. Gevolg: wie de app deelt, deelt code die na de review sterk veranderde, zonder dat iemand
de scenario's uit Werkwijze opnieuw naliep; het rapport van de agent uit deze sessie (hoofdstuk 5) is een begin, geen
vervanging van de review met handtest die CLAUDE.md eist. Voorstel: werkpakket V-3. Omvang M.

**D-2 · De allereerste trip van een nieuwe gebruiker heet "Werk · Training geven" en staat meteen in Nakijken.**
Categorie duidelijkheid. Bewijs: `src/components/QuickTrip.tsx:30` (`type = typeChoice ?? previous?.type ?? 'training-geven'`) en `src/components/WeekSheet.tsx:63` (zelfde standaard in het volledige blad Nieuwe trip);
`src/model/review.ts:63` (werk zonder organisatie = Nakijken-punt); `docs/screens/21b-vandaag-nakijken-na-eerste-trip.png`
en `21c-nakijken.png` (nieuwe gebruiker zonder organisaties maakt via + een trip met alleen datums: Vandaag toont "Eén ding
nakijken"); `43-nakijken-na-twee-trips.png` (ook via Logboek → Nieuwe trip). Gevolg: de eerste handeling van elke nieuwe gebruiker levert een onbegrijpelijke vraag op ("werk zonder
organisatie", terwijl er geen organisaties zijn) en een verkeerd label. Voorstel: standaardsoort zonder vorige trip =
`overig` of vragen (drie knoppen: werk, training, plezier) en Nakijken vraagt pas naar een organisatie als er minstens één
is ingesteld. Omvang S.

**D-4 · "Bestaand logboek koppelen" vult de repository van Olivier in.** Categorie delen. Bewijs:
`src/screens/Setup.tsx:121` (`repoDefault={step.mode === 'new' ? '' : DATA_REPO}`), `docs/screens/10-koppelen-voorgevuld.png`.
Gevolg: een andere gebruiker die zijn tweede apparaat koppelt, ziet `logboek-olivier/logboek-data`, tikt "Controleren"
en krijgt "niet gevonden" of, erger, koppelt per ongeluk aan de verkeerde repo als hij ooit toegang zou hebben; het lekt
bovendien de naam van Oliviers privérepo aan iedereen. Voorstel: leeg veld, met de laatst gebruikte repo van dít
apparaat als voorstel (staat al in `localStorage`-vrije vorm bij de token na ontgrendelen; vóór ontgrendelen is er niets,
dus leeg). Omvang S.

**S-1 · Elke push op `main` is meteen live voor iedereen; er is geen versienummer en geen proefperiode.** Categorie delen.
Bewijs: `deploy.yml` (`on: push: branches: [main]`), `package.json` versie `1.0.0` sinds PR #13 (26 oktober), 132 PR's
daarna zonder nummer. Gevolg: een vergissing in een merge staat binnen minuten op de telefoon van elke schipper, en
niemand kan melden "sinds welke versie". Voorstel: werkpakket V-2 (deploy op een tag `v*`, versie in `package.json` bij
elke tag, Over toont hem al). Omvang S.

**D-1 · De instap vraagt drie GitHub-handelingen zonder begeleiding met beeld.** Categorie duidelijkheid. Bewijs:
`docs/screens/02-uitleg-github.png` (vier regels tekst met links), `03-token-en-repo.png`; de token-pagina van GitHub
heeft twaalf velden waarvan er drie goed moeten staan (repository access, Contents, vervaldatum). Gevolg: een
niet-technische schipper haakt af of maakt een token met te veel rechten. Voorstel: een instapgids als eigen pagina in
`docs/` én in de app (één scherm per stap, met een schermafbeelding van GitHub en de precieze waarden), plus een
controle in de app dat de token niet méér kan dan Contents op één repo (de `X-OAuth-Scopes`/fine-grained header geeft
dat niet; wel te testen: een GET op `/user/repos` moet 403 geven, dat kost één verzoek). Omvang M.

**B-4 · De app controleert nooit of de data-repo privé is.** Categorie beveiliging, **blokkeert delen**. Gevonden door de
agent "delen en beveiliging", zelf bevestigd: `GithubClient.checkAccess` (`src/storage/github.ts:213-216`) kijkt alleen
naar `response.ok`; `Session.checkEmptyRepo`, `link` en `checkToken` doen niets extra's; het woord `private` komt in
`github.ts`, `session.ts` en `Setup.tsx` alleen in commentaar voor. Gevolg: een nieuwe gebruiker die per ongeluk een
publieke repository aanmaakt (de uitleg zegt wel "Private"), zet al zijn ciphertext, bestandsgroottes, tijden en
apparaat-id's openbaar, met offline brute force op zijn wachtzin als gevolg. Voorstel: `GET /repos/{repo}` geeft
`private`; weiger bij `private === false` met een eigen melding in `checkAccess`, en herhaal de controle één keer per
sessie in de sync. Omvang S. Opgenomen in werkpakket V-1.

### Belangrijk

**D-3 · Het Logboek toont alleen trips met gelogde dagen; een geplande trip is er onvindbaar.** Categorie
duidelijkheid. Bewijs: `src/model/derive.ts:87` (`if (tripLegs.length === 0) continue`), eerste run van
`review-kernstromen` test 2 en 6 (een trip zonder dagen ontbreekt in het Logboek; wel onder Meer → Periodes). CLAUDE.md
zegt "trips per maand … als kaartjes" zonder die voorwaarde. Gevolg: "waar is mijn trip?" Voorstel: in het Logboek de
trips zonder dagen onder een eigen kop "Zonder gelogde dagen" tonen, of het Logboek hernoemen tot "Mijlen" en Periodes
tot "Trips". Omvang S.

**D-5 · Begrippen overlappen: dag/etappe/leg, trip/tocht/week/periode, Deze trip/Agenda/Logboek/Periodes, Geld/Rekeningen/Mijn positie.**
Categorie duidelijkheid. Bewijs: `src/i18n/nl.ts` gebruikt `week.*`, `trip.*`, `period.*`, `periods.*` en `tripMoney.*`
voor hetzelfde object; de kop in Deze trip zegt "7 dagen · 2 gelogd · 3 etappes" (`tripDayCounts`); Rekeningen staat
onder Meer én als Mijn positie in Geld (`src/screens/Accounts.tsx`, `src/components/Position.tsx`, beide met netto
waarde). Zie hoofdstuk 2 voor het voorstel. Omvang M (teksten) tot L (schermen samenvoegen).

**D-6 · Meer heeft 16 tot 19 ingangen en Geld 15 secties op één scherm.** Categorie duidelijkheid. Bewijs:
`src/screens/More.tsx:15-32` (16 vaste items plus Nakijken, Prullenbak, Geschiedenis); `src/screens/Money.tsx` en zijn
componenten: Te controleren, Mijn positie, kosten per maand, Zeilgeld: resultaat, Uitbetalingen, Declaraties, fooi per week,
per maand, per werkdag, fooi per gast, per organisatie, jaaroverzicht, transacties, plus onder Verwacht: Gepland/Scenario,
vooruitblik, verwacht salaris, Kosten (`docs/screens/55-geld-werkelijk.png`). Gevolg: de 2-minuten-per-dag-belofte van
CLAUDE.md geldt voor Vandaag, niet voor de rest. Voorstel: hoofdstuk 2. Omvang M.

**D-7 · De valuta van een nieuwe uitgave en van "Eerder seizoen" volgt stil de laatst gebruikte valuta.** Categorie
duidelijkheid. Bewijs: `settings.lastCurrency` (CLAUDE.md: "valuta = laatst gebruikte waarde"); eerste run van
`review-kernstromen` test 6: na één fooi in dollars werden een uitgave van 42,80 en een eerder seizoen van 3.000 en 400 als
dollars geboekt (`docs/screens/55-geld-werkelijk.png` uit die run toonde "−€ 34,24 42,80" en "€ 2.400,00 3.000,00"). Gevolg:
een gebruiker die meestal in euro werkt en één keer een dollarfooi logt, boekt daarna per ongeluk in dollars; de
valutakeuze staat onder het bedrag en valt niet op. Voorstel: de laatst gebruikte valuta per soort onthouden (fooi apart
van uitgave en seizoen) en bij "Eerder seizoen" standaard de valuta van het standaardsalaris van die organisatie; de
valuta direct achter het bedragveld tonen. Omvang S.

**W-3 · Een trip van een eigen organisatie is nooit "zeker" werk; die van Sailing Virgins wel.** Categorie werking.
Bewijs: `src/model/trip-kind.ts:45` toetst letterlijk op `'sailing-virgins' || 'yacht-week'`; `WORK_NAME` op regel 32
kent alleen die namen; `tests/review-sommen.test.ts` (overgeslagen test, één keer gedraaid: `sure:false`). Gevolg: elke
trip zonder vastgelegd type van een nieuwe gebruiker komt in Nakijken, van Olivier niet. Voorstel: `organisations()`
gebruiken: een trip bij een organisatie uit de instellingen is werk, en de naam-regex opbouwen uit `namePatterns`.
Omvang S.

**B-2 · Een gecompromitteerde `logboek`-repo of Oliviers account raakt straks alle gebruikers; de bescherming is deels
op papier.** Categorie beveiliging. Bewijs: Actions op tags (`@v5`, `@v6`) in alle drie de workflows; `kaart.yml` heeft
`contents: write` op dezelfde repo en wordt door een push op een branch gestart; de ruleset op `main` staat buiten de repo
en is hier niet te controleren; geen vast leesmoment voor diffs in `src/crypto`, `src/storage`, `index.html`,
`.github/workflows`, `package-lock.json` (het rapport van #76 noemt het als voornemen). Voorstel: werkpakket V-3.
Omvang S.

**B-3 · Geen sleutelwissel; wie de wachtzin kent, kan ook de herstelcode tonen.** Categorie beveiliging. Bewijs:
`src/crypto/keys.ts:38-50` (meta: `recoveryCode` ingepakt onder de wachtzin-KEK; wachtzin wijzigen pakt dezelfde MK
opnieuw in); `docs/screens/09b-herstelcode-tonen.png`. Gevolg: een gelekte wachtzin lekt de herstelcode, en de enige
weg naar een nieuwe sleutel is een nieuw logboek; CLAUDE.md noemt dit "bekend en geaccepteerd" voor één gebruiker, maar
een nieuwe gebruiker weet dat niet. Voorstel: in de handleiding en bij "Herstelcode tonen" vermelden; sleutelwissel als
later werkpakket (nieuwe MK, alle bestanden herschrijven, oude versies blijven in de git-geschiedenis). Omvang S (tekst),
L (wissel).

**W-1 · De e2e-tests draaien op 412 px (Pixel 7), CLAUDE.md belooft 360 px; CI maskeert flaky tests.** Categorie
werking. **Opgelost in #134** (hoofdproject op 360 × 740 met touch, Pixel 7 alleen voor schermafbeeldingen en
kaartgebaren; `scripts/playwright-retries.mjs` print retries en faalt bij meer dan twee; alle tests slaagden op 360 px
zonder wijziging aan de app). Bewijs: `playwright.config.ts` (`devices['Pixel 7']`, `retries: process.env.CI ? 1 : 0`); 10 van 87 specs zetten
zelf 360 px. Gevolg: een overloop op 360 px valt alleen op in de schermafbeeldingen, die niemand verplicht bekijkt; een
test die één op de twee keer faalt is in CI groen. Voorstel: project `mobiel` op 360 × 740 zetten (Pixel 7 als tweede
project voor de schermafbeeldingen) en `retries: 0` met een `--repeat-each` nachtelijke run, of minstens de retries
rapporteren (`reporter: [['list'], ['json']]` en een stap die retried tests print). Omvang S.

**W-5 · Gezondheid belooft "een fix van één tik waar dat kan", en kan dat voor 2 van de 9 regels.** Categorie werking.
Bewijs: `src/domain/gezondheid.ts:10` (`canFix`: alleen `lopende-trip-weg` en `trip-datums`); CLAUDE.md, Invarianten.
Gevolg: `dag-zonder-trip`, `geld-zonder-periode` en `student-zonder-trip` staan in Gezondheid zonder knop, terwijl Nakijken
dezelfde drie wél met één tik oplost. Voorstel: Gezondheid naar Nakijken laten verwijzen voor die drie, en
`salaris-zonder-bedrag`/`meerdere-salarissen` naar Te controleren. Omvang S.

**C-2 · Documentatie en code lopen uiteen op punten die een nieuwe ontwikkelaar op het verkeerde been zetten.**
Categorie codegezondheid. Bewijs: `docs/ARCHITECTUUR.md` zegt schemaversie 1 en schrijfversie 3, de code staat op 3 en 9
(`src/model/schema.ts:11,36`); CLAUDE.md zegt dat `meta.json.enc` de vingerafdruk-KEK bevat, de code bewaart die alleen
lokaal (`src/crypto/keys.ts:38`, `src/storage/fingerprint.ts`); CLAUDE.md "AES-KW of AES-GCM" tegenover alleen AES-GCM;
CLAUDE.md "PR 13" voor de beveiligingsreview tegenover GitHub #76; `docs/FUNDERING.md` tekent model onder domein, terwijl
`src/model` 16 keer code uit `src/domain` importeert. Voorstel: ARCHITECTUUR.md vervangen door een verwijzing naar
`docs/app-kaart.md` en de drie CLAUDE.md-zinnen corrigeren. Omvang S.

**S-2 · Geen feedbackkanaal, en de handleiding bestaat alleen in het Nederlands.** Categorie delen. Bewijs: geen
`mailto:`, issue-link of feedbackknop in `src/` (grep); `docs/` alleen Nederlands; `index.html:2` en `vite.config.ts:46`
zetten `lang="nl"` en een Nederlandse beschrijving in de manifest, ook voor een Engelse telefoon. Voorstel: werkpakket
V-4. Omvang S.
**G-1 · "Zeilresultaat in de periode" onder Mijn positie en "Zeilgeld: resultaat" in Geld tellen de begindag verschillend.**
Categorie werking, belangrijk. Gevonden door de agent "geld en data", zelf bevestigd: `src/model/position.ts:294`
(`transactionList(…, { from: addDays(from, 1), to })`) tegenover de transactielijst in Geld vanaf `from` zelf. CLAUDE.md
zegt "wat op de begindag zelf binnenkwam, zit al in de netto waarde van die dag", maar dat klopt alleen als er een stand
precies op de begindag staat; met een bankstand van 31 december en een begindag 1 januari valt geld van 1 januari in
"overig" (voorbeeld van de agent: 2.826 tegenover 3.826 voor dezelfde periode). De som sluit, de toewijzing niet.
Voorstel: de begindag meetellen als de nieuwste stand vóór `from` ouder is dan `from`, of de regel "Zeilresultaat ná
<datum>" noemen en in de doorklik tonen. Omvang S.

**G-2 · Geld van een verwijderde tocht met een eigen organisatie telt in per organisatie, het jaaroverzicht en de
statistieken als "overig".** Categorie werking, belangrijk. Agentbevinding, zelf bevestigd: `perOrganisation` en
`yearOverview` geven `groupOf` alleen levende trips (`src/domain/geldrapport.ts`, `active(trips)`), en de terugval
`source` is voor een eigen organisatie altijd `overig` (`src/basis/organisatie.ts:113`). Na "Geld en dagen behouden"
verliest het geld zijn organisatie in het belastingoverzicht; bij Sailing Virgins en Yacht Week niet (die staan in
`source`). Voorstel: `groupOf` ook de tombstone van de trip laten lezen (`tripResult` en de prullenbak doen dat al).
Omvang S.

**G-3 · Te ontvangen salaris wordt in Mijn positie anders gewaardeerd dan op de tripkaart en in de vooruitblik.**
Categorie werking, belangrijk. Agentbevinding, zelf bevestigd: `src/model/position.ts:213` waardeert het verwachte
salaris met de koers van de kijkdag en negeert `receivedEur`/`amountEur`, elders geldt `eurValue` (koers van de
transactiedatum, of het werkelijk ontvangen bedrag). Voorbeelden van de agent: 800 tegenover 999 met `receivedEur`;
een sprong van 400 in de netto waarde als de koers wisselt. De sommen sluiten (overig vangt het op), de getallen spreken
elkaar tegen. Voorstel: te ontvangen via `eurValue` waarderen en de koersdatumkeuze in CLAUDE.md benoemen. Omvang S.

De agent bevestigde met een eigen tijdelijke test (12 controles, beide profielen, vier periodes, drie jaren, vier
positiedatums, vooruitblik met en zonder scenario) dat alle zes somcontroles in centen sluiten: resultaat = inkomsten +
terugbetaald − kosten; per organisatie = jaaroverzicht = transactielijst; elk doorklikscherm telt op; tochtresultaat =
som van de transacties; netto waarde = bank + contant + te ontvangen + beleggingen + bezit − schuld en de verandering =
zeilresultaat + te ontvangen + waarde + schulden + overig; vooruitblik start + salaris + fooi + scenario + kosten +
eenmalig + groei = einde, ook met een rekening die in de periode is opgeheven, een scenario in het verleden en een
periode die vandaag eindigt.

**B-5 · Het herstelscherm stuurt een ongevalideerde repo-naam door; een typefout valt stil terug op Oliviers repo.**
Categorie beveiliging/delen, belangrijk. Agentbevinding, zelf bevestigd: `src/screens/KeyProblem.tsx:104,218` geven `repo`
door zonder `isRepoName`; `src/storage/token.ts:44-46` (`repoOf`) valt bij een ongeldige opgeslagen naam terug op
`DATA_REPO`. Gevolg: padinjectie in de API-URL met de eigen token (alleen schade aan zichzelf), en een apparaat dat na een
typefout stil tegen `logboek-olivier/logboek-data` synct ("repository niet gevonden" zonder uitleg). Voorstel: `isRepoName`
afdwingen in `Session.repair`/`restoreRemoteMeta` en in `storeToken`; bij een onleesbare repo-naam niet terugvallen op
Oliviers repo maar om de naam vragen. Omvang S. Opgenomen in V-1.

**B-8 · `main` is te mergen zonder goedkeuring; de deploy vertrouwt daarop voor alle gebruikers.** Categorie beveiliging,
belangrijk. Agentbevinding via de GitHub-API (`required_approving_review_count: 0`, alleen status check `test`); door mij
niet herhaald, dus **vermoeden** voor wat de ruleset betreft; dat elke push op `main` deployt staat vast
(`deploy.yml`). Voorstel: een `github-pages`-environment met Olivier als verplichte reviewer, of de tag-deploy uit V-2;
tweestapsverificatie met passkey. Omvang S (instellingen) en opgenomen in V-2/V-3.

### Later

**G-4 · Eén rekening zonder koers laat de hele verandering en vooruitblik verdwijnen.** Categorie werking, later.
Agentbevinding, zelf bevestigd: `src/model/position.ts:291` (`state: 'geen-koers'` zodra `other` niet leeg is), terwijl
CLAUDE.md "zonder koers apart per valuta" belooft en Mijn positie zelf dat wel doet. Omvang S.

**G-5 · Verwijzingen die niemand controleert.** Categorie werking, later. Agentbevinding, steekproefsgewijs bevestigd:
`deleteFixedCost` (`src/model/costs.ts:71`) laat de geboekte maanden staan als uitgaven met `fixedCostId` naar een
tombstone (ze tellen nog als "vast" in kosten per maand); een cursus verwijderen laat `curriculumId` bij studenten en
deelnemers staan; `WeekPlan.tripId` en `Claim.tripId` blijven na "Geld en dagen behouden" wijzen zonder Nakijken-punt
(een terugbetaalde declaratie van een verwijderde trip is dan nergens zichtbaar, `src/model/claims.ts:197`);
`activeScenarioId` en `season.org` worden nooit gecontroleerd. Voorstel: drie nakijk-invarianten erbij
(planning-zonder-trip, declaratie-zonder-trip, student-zonder-cursus) en bij een vaste last verwijderen dezelfde keuze
als bij een periode (boekingen behouden of mee verwijderen). Omvang M.

**G-6 · Vier plekken bepalen de organisatie van geld, met een andere uitkomst bij "eigen" en delivery.** Categorie
codegezondheid, later. Agentbevinding (`groupOf` in `tax-year.ts`, `sourceForPeriod` in `organisatie.ts`, `tipsPerTrip` in
`guests.ts`, `stats.ts:200`): gelijk bij een organisatie uit de instellingen, verschillend bij `eigen`/`delivery`
(`eigen`, `delivery`, `null`, `eigen`). Plus `eurValue` tegenover `toEur` bij een opgeslagen koers (76,92 tegenover 81),
`costs.ts eur` zonder de markering "voorlopig", en zeven eigen datumhelpers naast `src/basis/datum.ts`. Hoort bij C-4.
Omvang S.

**C-1 · Te grote, te verweven bestanden.** Categorie codegezondheid. Bewijs: `src/storage/store.ts` 1.677 regels en
ruim 60 methoden; `src/session.ts` 1.163; `src/screens/Planning.tsx` 1.126; `src/screens/QuickAdd.tsx` 705 regels met 38
imports; `src/app.css` 4.897 regels; `src/components` importeert 9 keer uit `src/screens` (`DaySheet` → `Deadlines`,
`History`, `QuickAdd`; `PeriodPage` → `Planning`, `Students`; `MileageImport`/`ExportSection` → `Setup`). Gevolg: elke
storingsregel loopt door één bestand, en lui laden werkt niet voor `More`, `History`, `Deadlines`, `Trash` en
`domain/prullenbak` (`npx vite build`: `INEFFECTIVE_DYNAMIC_IMPORT`). Voorstel: `Store` splitsen in opslag, sync en herstel
(drie bestanden achter dezelfde klasse), `Screen`/`ErrorLine` uit `Setup.tsx` naar `components/`, `HistoryButton` naar
`components/`. Omvang L.

**C-3 · Dode of alleen door tests gebruikte exports.** Bewijs: nergens in `src/` gebruikt: `dagsoortZetten`, `daysRange`,
`doelOpslaan`, `openStorage`, `scenarioEindeAanpassen`, `studentToevoegen`, `uitgaveperiodeKiezen`; alleen in tests:
`dagsoortAutomatisch`, `dagsoortenZetten`, `deelnemerToevoegen`, `periodeHernoemen`, `weekAfsluiten`, `geldstapOpslaan`,
`scenarioBeginAanpassen`, `sumPerCurrency`, `putSessionKey`, `saveOutbox`, `parseMileageCsv`, `reviewInput` (script in
deze sessie, zie `docs/app-kaart.md` 2). Voorstel: verwijderen of in de test vervangen door het echte pad. Omvang S.

**C-4 · Dubbele logica in geld en datums.** Bewijs: euro-omrekening op drie plekken (`src/model/rates.ts:99 eurValue`,
`src/model/accounts.ts:72 toEur`, `src/model/costs.ts:25 eur`); `monthsBetween` twee keer met verschillende betekenis
(`src/model/position.ts:413` geeft een getal, `src/model/stats.ts:78` een lijst); `monthLast` in `position.ts:419` naast
`src/basis/datum.ts`; `firstOfMonth` in `money-path.ts:43`. De organisatie van geld staat op twee plekken
(`src/basis/organisatie.ts` en `src/model/tax-year.ts:61 groupOf`, met een eigen terugval op `source`). Voorstel: één
`toEur(amount, currency, date)` in `rates.ts`, de maandhulpjes naar `src/basis/datum.ts`. Omvang S.

**C-5 · `TransactionSource` en de demo dragen Oliviers organisaties in het dataformaat.** Bewijs: `src/model/types.ts:248`,
`src/demo/data.ts:101-271`, `src/model/tax-year.ts:68`. Gevolg: geen fout, wel een blijvende uitzondering in elke
nieuwe functie ("een eigen organisatie is `overig`"). Voorstel: pas bij een volgende schrijfversie `source` vervangen door
de organisatie-id en het veld alleen nog lezen. Omvang M.

**D-8 · Het vakje "Op het water" onder de agenda is op 360 px afgekapt tot "Op het w…".** Categorie duidelijkheid, later.
Bewijs: `docs/screens/40-agenda-overlap.png` en `07c-agenda-leeg.png` (onderaan: "Op het w… 11 · Vrij 0 · Reis 0 · Thuis 0 ·
nm 0"); gezien door de rol "nieuwe schipper" en zelf bevestigd. De overloopcontrole in de tests meet alleen horizontaal
scrollen, geen afgekapte tekst. Voorstel: "Water" als korte vorm, of twee regels. Omvang S.

**W-4 · De bundel voor het eerste scherm bevat schermen die lui zouden moeten laden.** Bewijs: `npx vite build`
meldt `INEFFECTIVE_DYNAMIC_IMPORT` voor `More`, `History`, `Deadlines`, `Trash`, `domain/prullenbak`. De test "opent
binnen 2 seconden" slaagt (`tests/e2e/vandaag.spec.ts`), dus het is geen fout, maar het doel van `src/lazy.ts` wordt
deels gemist. Omvang S (statische imports in `DaySheet`, `Today`, `Agenda` vervangen door lazy).

**S-3 · Valuta's, rekeningaanbieders, weerpunten en kaartgebieden zijn vast.** Bewijs: `src/model/types.ts:249,674`,
`src/model/weather.ts`, `src/model/offline-maps.ts`. Voor een Nederlandse schipper in de Cariben en Europa klopt het;
buiten die wereld ontbreken valuta's (AUD, CAD, NZD, ZAR) en kaarten. Voorstel: valuta's uitbreiden met alles wat de
ECB publiceert (de koersen zijn er al); kaartgebieden en weerpunten documenteren als "wat er is", niet als fout. Omvang S.

**S-4 · Het importformaat is Oliviers Excel, zonder voorbeeldbestand in de app.** Bewijs: `src/import/mileage-csv.ts`
(kopregel met Nederlandse namen verplicht), `docs/handleiding.md` 6. Voorstel: een downloadbaar leeg sjabloon
(`public/sjabloon-mijlen.csv`) en de Engelse kopnamen ook herkennen. Omvang S.

**B-6 · Een oude, legitieme `meta.json.enc` uit de git-geschiedenis wordt overgenomen (rollback van de wachtzin).**
Categorie beveiliging, later. Agentbevinding, zelf bevestigd in `src/crypto/keys.ts:125-146`: `safeToAdopt` staat een
andere `wrappedKey` toe, en `verifyMetaCheck` slaagt voor elke meta die ooit onder dezelfde hoofdsleutel is gesealed.
Wie de token heeft en een oude wachtzin kent, zet zo alle apparaten terug op die oude wachtzin. Geen extra
ontsleutelmacht, wel uitsluiting. Voorstel: een teller of `changedAt` in het check-payload en alleen een hogere waarde
overnemen. Omvang S.

**B-7 · `sanitize` in foutdetails is een zwakke filter.** Categorie beveiliging, later. Agentbevinding, zelf bevestigd:
`src/errors.ts:59-66` haalt alleen tekst tussen aanhalingstekens en decimale getallen weg; een toekomstige
`new Error(\`… ${naam}\`)` lekt direct. Nu bevat geen enkele foutmelding inhoud (grep op `new Error(` met interpolatie:
alleen een statuscode in `offline-maps.ts`). Voorstel: een test die `new Error(` met interpolatie buiten een allowlist
verbiedt. Omvang S.

**S-5 · Koppelen wist de lokale gegevens zonder te kijken of er nog een outbox wacht.** Categorie werking, later.
Agentbevinding, zelf bevestigd: `src/session.ts:425-427` (`clearAll(db)` direct na `unlock`). Alleen bereikbaar na
"wissen en opnieuw koppelen"; geen lek, wel mogelijk verlies van niet-gesyncte wijzigingen. Voorstel: "N wijzigingen
wachten nog" tonen vóór het wissen. Omvang S.

**S-6 · Sporen van een vorige gebruiker in `localStorage` en een hergebruikt apparaat-id.** Categorie delen, later.
Agentbevinding: `src/storage/storage-log.ts`, `src/storage/device.ts` (het apparaat-id blijft staan na opnieuw koppelen).
Geen inhoud. Voorstel: bij `link`/`relink` het opslaglogboek, de herstelpogingen en het apparaat-id vernieuwen. Omvang S.

Het volledige agentrapport (scenario's a–g met regelnummers, "gecontroleerd en in orde") staat samengevat in hoofdstuk 5;
de punten die ik niet kon bevestigen staan daar als vermoeden.

## 2. Duidelijkheid en uiterlijk

**Waar raakt een nieuwe gebruiker de weg kwijt** (uit de eigen doorloop, `docs/screens/`, en de rol "nieuwe schipper",
een agent die alleen de schermafbeeldingen en de demo zag; zijn punten zijn hieronder alleen overgenomen waar de
schermafbeelding ze laat zien):

1. Bij de instap: drie GitHub-schermen zonder beeld (D-1), en bij koppelen een vreemde repo (D-4).
2. Direct na de eerste trip: "Werk · Training geven" en "Eén ding nakijken" (D-2), en de trip is niet te vinden in het
   Logboek (D-3).
3. Bij de woorden: een "dag" is een regel met mijlen, maar de agenda heeft ook "dagen"; een "trip" heet in de code en in
   sommige teksten "week" of "tocht"; "periode" is soms een trip en soms een thuisperiode en soms de datumkeuze in Geld
   ("Periode: sinds de start van je zeilcarrière"); "Logboek" is de app én een scherm onder Meer.
4. In Geld: Werkelijk tegenover Verwacht is helder, maar Mijn positie (netto waarde) staat in Geld én onder Meer →
   Rekeningen, en "Zeilgeld: resultaat" naast "netto waarde" naast "resultaat van de trip" zijn drie verschillende sommen
   met één woord.
5. Onder Meer: zestien ingangen in één lijst zonder groepering; Opslag, Kaarten, Cursussen en Studentenarchief staan
   tussen Geld en Instellingen.
6. Woorden zonder uitleg op het moment dat ze verschijnen (nieuwe schipper, met schermafbeelding): "Beschikbaar" als
   eerste kaart op een leeg Vandaag ("beschikbaar waarvoor?", `07-vandaag-leeg.png`); "Termijnen" (`07`); "Bij welke
   organisatie hoorde …? Eigen / Overig / Klopt zo" vóórdat de gebruiker ooit een organisatie zag (`21c-nakijken.png`; de
   uitleg "voor wie je werkt" staat pas in `50-organisaties-leeg.png`); "Volgt uit de trip" en "Geschiedenis (1)" op de
   dagkaart (`41-dagkaart.png`); "zonder periode" in het verwijdermenu van een trip (`24-periode-verwijderen.png`);
   "Blok", "Aannames", "Waardegroei" in het scenario (`65-verwacht-scenario.png`); de 24 herstelwoorden zijn Engels in een
   Nederlandse app (`05-herstelcode.png`; BIP39 heeft ook een Nederlandse lijst niet, dus dat is te verklaren, maar het
   verdient één zin uitleg).
7. De app begint meteen te corrigeren: "Onvolledig" op elke geïmporteerde trip (`33-logboek-na-import.png`), "Eén ding
   nakijken" na de eerste trip (`21b`), "Verandering onbekend" direct na de eerste stand (`61-mijn-positie.png`), "3 dagen
   in deze trip nog niet gelogd" (`21b`). Elk op zich klopt; samen voelt het voor een beginner als huiswerk op dag één.
8. Twee indelingen van de soort trip boven elkaar in Trip bewerken (Werk/Training/Plezier én Training geven/Skipper
   charter/Delivery/Overig, `23-trip-bewerken.png`); in Toevoegen → Trip alleen de tweede (`21-toevoegen-trip.png`).
9. Op het tweede apparaat zegt het koppelscherm niet of je dezelfde token mag gebruiken of een nieuwe moet maken
   (`10-koppelen-voorgevuld.png`), en na de sync met conflict is nergens te zien dat er iets samengevoegd is (`13`).
10. "Werk de app bij" (`72-oud-venster-werk-de-app-bij.png`) heeft geen zichtbare knop; de rode pil bovenaan is tikbaar,
    maar dat weet een nieuwe gebruiker niet.

Niet overgenomen uit het verslag van de nieuwe schipper: datums als "11/03/2026" in de invoervelden. Dat is de
weergave van een `<input type="date">` in de Engelstalige headless Chromium van de test; op een Nederlandse telefoon toont
de browser dd-mm-jjjj. Wel een aandachtspunt voor K-2: de schermafbeeldingen in CI hebben hetzelfde artefact.

**Welke schermen zijn te vol:** Geld (15 secties; `55-geld-werkelijk.png` is 10.000 px hoog op 360 px breed), Verwacht
(drie schakelaars boven elkaar: Werkelijk/Verwacht, Gepland/Scenario, Periode; `64`, `65`), Instellingen (14 rijen
inclusief Over), Meer (16-19), de periodepagina van een werktrip (`22-deze-trip.png`: "Mensen" en "Checklists" als lege
koppen direct onder elkaar, "Plaatsen zonder pin" drie keer, vier vaste checklists), Bootgegevens controleren direct na de
import (`32`), Opslag (per bestand een regel plus zes knoppen).

**Voorstel voor een eenvoudiger begrippenmodel** (namen, één zin, voor Olivier om te kiezen):

| Begrip | Eén zin | Nu |
|---|---|---|
| **Mijl** of **Etappe** | Eén gevaren stuk op één datum: van, naar, mijlen. | "Dag" (botst met agenda-dag) |
| **Trip** | Een aaneengesloten tijd aan boord met een naam, een boot en een soort (werk, training, plezier). | Trip/tocht/week/periode op het water |
| **Aan land** | Reis, thuis of vrij tussen twee trips. | Periode aan land |
| **Agenda** | Alle trips en tijd aan land op een kalender, plus of je beschikbaar bent. | Agenda |
| **Mijlen** (scherm) | Totalen en de lijst van etappes, importeren en exporteren. | Logboek (onder Meer) |
| **Trips** (scherm) | Alle trips en tijd aan land, nu, komend, afgelopen. | Periodes |
| **Geld** | Wat je verdiende en uitgaf, per trip en per organisatie. | Geld → Werkelijk (zonder Mijn positie) |
| **Vermogen** | Rekeningen, standen, netto waarde en de verwachting. | Rekeningen + Mijn positie + Verwacht |
| **Mensen** | Deelnemers en studenten. | Deelnemers (in trip) + Studentenarchief |

**Navigatie-voorstel:** onderbalk **Vandaag · Trip · + · Agenda · Meer** blijft; Meer in vier groepen met een kop:
*Zeilen* (Trips, Mijlen, Boten, Plaatsen, Kaarten), *Geld* (Geld, Vermogen), *Mensen en leren* (Mensen, Cursussen,
Doelen, Carrière), *App* (Termijnen, Kluis, Opslag, Instellingen). Nakijken, Prullenbak en Geschiedenis blijven bovenaan
als er iets is.

**Wat weg of samen kan zonder functie te verliezen** (voorstellen; Olivier beslist):
- Meer → Rekeningen samenvoegen met Geld → Mijn positie (zelfde gegevens, twee ingangen).
- Instellingen → "Teller per organisatie" en "Salaris en uitbetaling per organisatie" in Organisaties zelf (één blad per
  organisatie: naam, afkorting, beginnummer, standaardsalaris, uitbetaling).
- De knop Kosten/Investering is al weg; "Investering in mijn zeilcarrière" als aparte regel in Geld kan in de doorklik
  van Kosten.
- Studentenarchief in de periodepagina onder Mensen, en als filter in Trips.
- Op Vandaag: de Termijnen-lijst alleen tonen als er iets binnen 30 dagen is.
- Geld → "Per werkdag" en "Fooi per week" zijn statistieken; verplaatsen naar Statistieken → Geld.

**Onboarding.** CLAUDE.md zegt "geen onboarding, geen tutorial". Voor één gebruiker die de app zelf bedacht klopt dat.
Voor delen is een minimale eerste uitleg nodig, en die kan binnen de regel "geen lege of binnenkort-schermen": (1) de
instapgids met beeld bij GitHub (D-1), (2) na het aanmaken één scherm met drie zinnen en drie knoppen ("Log je eerste
dag", "Maak een trip", "Importeer je Excel"), (3) op een leeg scherm één zin die zegt wat er komt te staan en waar het
vandaan komt (de `Empty`-component bestaat al, `src/components/Empty.tsx`). **Voorstel voor Olivier:** deze drie toestaan
als uitzondering op "geen onboarding", en de tutorial-vorm (overlays, pijlen) blijven weigeren.

## 3. Werking

Samenvatting van `docs/functiecheck.md`: typecheck, lint, 1.305 unit-tests en 153 e2e-tests groen; geen flaky test in
één run; de kernstromen (nieuw logboek, vergrendelen, herstelcode, tweede apparaat met conflict, dag en trip, bewerken en
prullenbak, Excel twee keer importeren zonder dubbelingen, agenda met overlap en dezelfde deelnemer, geld met eigen
organisatie, salaris, fooi in dollars, eerder seizoen, jaaroverzicht, doorklikken, rekening en saldo, beginsaldo,
verandering, Gepland en Scenario, offline en weer online, een ouder venster na een nieuwere build) werken op 360 px met
nepdata. De sommen sluiten voor beide nepprofielen en voor 500 willekeurige logboeken (`tests/review-sommen.test.ts`) en in de
onafhankelijke controle van de agent "geld en data" (G-findings: de sommen kloppen, de toewijzing aan periode,
organisatie en koersdatum niet overal).
Wat niet werkt zoals bedoeld staat als W-1, W-3, W-4, W-5 en D-2 hierboven. De eigen doorloop (acht tests, `docs/functiecheck.md` hoofdstuk 3) slaagde volledig; zes van de acht faalden eerst
op aannames van de reviewer die een nieuwe gebruiker ook zou maken (zie D-2, D-3, D-7).

## 4. Codegezondheid

Zie C-1 tot en met C-5. Samengevat: de architectuur (domeinlaag met `commit`, invarianten, proef op koppelingen,
tombstones, schrijfversie) is sterk en goed getest; de pijn zit in de omvang van `store.ts` en `session.ts`, de lagen die
door elkaar lopen (componenten die uit schermen importeren, model dat uit domein importeert), dubbele hulpjes voor euro
en maanden, een stuk of twintig dode exports, en documentatie die achterloopt op de code. Ontbrekende tests op kernpaden:
geen e2e-test op 360 px voor de meeste schermen (W-1); geen test dat `en.ts` Engels is (alleen dat de sleutels bestaan);
geen test voor de soort van een trip bij een eigen organisatie (nu als overgeslagen test toegevoegd); geen test voor de
CSP buiten het eerste scherm; de integratietest draait alleen in CI.

## 5. Beveiliging

**Status van de verplichte review uit CLAUDE.md.** Gedaan op 29 oktober door één review-agent in PR #76, met negen
bevindingen waarvan zes opgelost, twee "later" (Actions op hashes, `kaart.yml`) en één geaccepteerd (vingerafdruk =
pincode). Oliviers handtest (`logboek-data` clonen en proberen te lezen) en zijn akkoord (`VAULT_REVIEWED`) zijn niet
in de repo terug te vinden. Sinds die review veranderde de kern (B-1). De zes scenario's, kort nagelopen op de huidige
code (details in het agentrapport, hoofdstuk 5a):

| Scenario | Wat kan een aanvaller | Wat niet | Regel in de code |
|---|---|---|---|
| a. Gestolen ontgrendelde telefoon | Alles zien en delen binnen 5 minuten na de laatste tik; de sessie rekken door te tikken | De sleutel als bytes meenemen; de herstelcode zien zonder wachtzin | `extractable: false` (`src/crypto/keys.ts`), `LOCK_AFTER_MS` (`src/session.ts:45`), herstelcode onder de wachtzin-KEK |
| b. Gestolen vergrendelde telefoon | Met de pincode van de telefoon vaak ook de vingerafdruk-ontgrendeling (geaccepteerd in #76); offline brute force op de wachtzin | Zonder wachtzin, herstelcode of vingerafdruk iets lezen | PBKDF2 600.000, WebAuthn `userVerification: 'required'` |
| c. Gelekte token | Alle ciphertext en de geschiedenis downloaden; bestanden wissen of terugzetten; metadata zien (aantal, grootte, tijd, apparaat-id) | Inhoud lezen; een bestand onder een ander pad terugzetten (AAD); de app onder een andere sleutel laten schrijven (meta-controle, `safeToAdopt`) | `src/crypto/encrypt.ts`, `Store.checkMeta`, `src/crypto/keys.ts safeToAdopt` |
| d. Gelekte data-repo met geschiedenis | Offline aanval op elke wachtzin die ooit gold (geen sleutelwissel, B-3) | Zonder geheim iets lezen | — |
| e. Gelekte back-up | Met de wachtzin of herstelcode van toen alles van toen lezen, ook na een latere wachtzinwijziging | Documentbestanden (niet in de back-up) | `src/storage/backup.ts` |
| f. Gecompromitteerde `logboek`-repo of account | Alles, bij iedereen, bij het volgende openen (B-2) | De data op GitHub lezen zonder een ontgrendeld apparaat | ruleset (buiten de repo), `contents: read` in `deploy.yml`, CSP |
| g. Kwaadaardige npm-afhankelijkheid | Als f; 505 pakketten in de lockfile, 7 in de bundel | — | `npm ci`, `npm audit` 0 kwetsbaarheden op 3 november |

**Nieuwe risico's bij meerdere mensen:** iedereen draait dezelfde code van één account (f wordt een massa-incident);
een gebruiker kan op het koppelscherm per ongeluk Oliviers repo proberen (D-4); twee gebruikers op één browserprofiel
kan niet (één IndexedDB `logboek`; de tweede moet de eerste wissen, en dat staat nergens in de app); per gebruiker één
token met een vervaldatum die de app wel meldt (`today.tokenExpires`) maar waarvoor de vernieuwing drie GitHub-schermen
kost; het apparaat-id in commitberichten is per browser willekeurig en zegt niets over de persoon (goed), maar blijft
staan na opnieuw koppelen (S-6); de export en de back-up heten `logboek-…` en verraden dus wat het is (klein); de app
controleert niet of de repo privé is (B-4); het herstelscherm valideert de repo-naam niet (B-5).

**Door de agent gecontroleerd en in orde, door mij steekproefsgewijs bevestigd:** geen `console.`-aanroep in `src/`;
`localStorage` bevat alleen taal, keuzes, tijden, paden, aantallen en sha's; `fetch` alleen naar de eigen origin en
`api.github.com`; de CSP in `index.html`, `dist/index.html` en `reset.html` is letterlijk regel 2, zonder inline script of
style; de hoofdsleutel is overal `extractable: false` behalve kortstondig bij aanmaken en opnieuw inpakken; PBKDF2-rondes
komen uit de meta maar `parseMeta` eist minstens 600.000 (`src/crypto/keys.ts:303`); de 5-minutenlogica vangt een klok
die terugspringt en een bevroren tabblad op; de token staat na ontgrendelen alleen versleuteld in IndexedDB; de demo
blokkeert elk netwerkverzoek. Vermoedens van de agent: geen verplichte reviewers op het Pages-environment; de integratie-
job met `contents: write` is alleen gevaarlijk bij een kwaadaardige dependency tijdens de test.

**Welke code sinds de review van 29 oktober veranderde in de kern** (git-log van de agent): declaraties en kluis-upload,
`safeToAdopt` en frame-busting (#94), eigen data-repo bij de token (#96), schrijfversie (#111), de fundering (#113),
het sync-vangnet, de proef op koppelingen (#120). De open punten uit het rapport van toen (Actions op tags, `kaart.yml`,
geen sleutelwissel, metadata van documenten zichtbaar) staan nog allemaal open.

## 6. Wat goed is (laat dit heel bij het opschonen)

1. **Eén poort naar de opslag met invarianten en een proef op koppelingen.** `src/domain/commit.ts:60-116`,
   `invariants.ts`, `relaties.ts`; bewaakt door `tests/domeinlaag.test.ts` en duizenden willekeurige reeksen in
   `tests/eigenschappen.test.ts`. Dit is waarom "niets verhuist stil" en "ongedaan maken per veld" echt kloppen.
2. **De sync is paranoïde op de goede manier.** Leespas vóór schrijven, `sealForUpload` (versleutelen en direct weer
   ontsleutelen), sha-controle van elk antwoord (`src/storage/integrity.ts`), schrijfversie per bestand, één schrijver
   over vensters en versies heen. `tests/foutmatrix.test.ts`, `storingen`, `github-gedrag`, en de integratietest tegen de
   echte API in een tijdelijke branch.
3. **De upgradetest vanaf vier releases** (`tests/e2e/upgrade.spec.ts`, `scripts/build-previous.mjs`, job
   `upgrade-ouder`): bijwerken in dezelfde browseropslag, dan een schoon apparaat koppelen. Weinig apps van deze grootte
   hebben dit.
4. **De geldsommen sluiten.** Eén set rapportfuncties (`src/domain/geldrapport.ts`, `doorklik.ts`), in centen; bewezen
   voor twee profielen en 500 willekeurige logboeken (`tests/review-sommen.test.ts`), met de hand uitgerekende
   voorbeelden in `tests/doorklik.test.ts`.
5. **Tweetaligheid is afgedwongen door het type-systeem** (`src/i18n/nl.ts` als bron, `en.ts` moet elke sleutel hebben;
   0 hardgecodeerde UI-teksten gevonden) en privacy van deelnemers zit in de data zelf (`firstNameOnly`, geschoonde
   tombstones, geen namen in export, Vandaag zonder bedragen; `tests/privacy.test.ts`).

## 7. Weg naar delen

Elk werkpakket is één PR, met een kant-en-klare prompt voor een volgende Claude Code-sessie.

### Moet vóór delen (samen ongeveer 3 dagen)

**V-1 · De instap klopt voor een vreemde** (D-1, D-2, D-3, D-4, W-3, S-2 deels; omvang M, ongeveer 1 dag)

> Je werkt in de repo `logboek` (lees CLAUDE.md, docs/review.md bevindingen D-1 t/m D-4, W-3 en docs/delen.md). Doel: een
> schipper die Olivier niet kent, kan de app in tien minuten instellen en maakt zijn eerste trip zonder in Nakijken te
> belanden. Wat: (1) `src/screens/Setup.tsx`: bij "Bestaand logboek koppelen" het repo-veld leeg laten (geen `DATA_REPO`
> als standaard); Oliviers oude opslag zonder opgeslagen repo blijft werken (`repoOf`). (2) De instapgids in de app:
> per GitHub-stap één scherm met de precieze velden en waarden (repository: Private, geen README; token: "Only select
> repositories", alleen die repo, Contents: Read and write, vervaldatum) en een link; in nl en en. (3)
> `src/components/QuickTrip.tsx`: zonder vorige trip geen standaardsoort `training-geven` maar de soortknoppen zichtbaar
> met `overig` voorgekozen; `src/model/review.ts`: het punt "werk zonder organisatie" alleen als er minstens één
> organisatie in de instellingen staat. (4) `src/model/trip-kind.ts`: een trip bij een organisatie uit
> `organisations()` is zeker werk, net als Sailing Virgins; de naam-herkenning gebruikt `namePatterns` uit
> `src/basis/organisatie.ts`. Haal de `it.skip` in `tests/review-sommen.test.ts` weg (hij moet nu slagen). (5)
> `src/screens/Sailing.tsx`: trips zonder gelogde dagen onder een eigen kop, of een regel "N trips zonder dagen staan
> onder Periodes". (6) `index.html` en `vite.config.ts`: `lang` en de manifest-beschrijving volgen de taal (en als
> terugval `en`). (7) `GithubClient.checkAccess` weigert een repository die niet privé is (`private === false` in het
> antwoord van `GET /repos/{repo}`) met een eigen melding in nl en en, en de sync herhaalt die controle één keer per
> sessie (B-4). (8) `isRepoName` ook afdwingen in het herstelscherm en `Session.repair`/`restoreRemoteMeta`; `repoOf` valt
> bij een ongeldige opgeslagen naam niet stil terug op Oliviers repo maar het herstelscherm vraagt de naam (B-5).
> Acceptatie: `tests/e2e/review-kernstromen.spec.ts` test 1-3 slagen zonder de regel over Nakijken (pas
> die test aan: na de eerste trip géén Nakijken), `tests/e2e/nieuwe-gebruiker.spec.ts` en `setup-unlock.spec.ts` groen,
> schermafbeeldingen op 360 px nl en en bekeken. Niet aanraken: `src/crypto`, `src/storage`, het dataformaat, de
> schrijfversie. Eén PR, Nederlandse commitberichten, test.yml groen vóór mergen.

**V-2 · Releases met een nummer, deploy op een tag** (S-1; omvang S, een halve dag)

> Repo `logboek`, lees CLAUDE.md (Stack, Werkwijze) en docs/review.md S-1. Doel: Olivier kan een week met `main`
> proefdraaien voordat iedereen de versie krijgt, en elke melding kan een versienummer noemen. Wat: (1) `deploy.yml`
> draait niet meer op elke push naar `main` maar op `push: tags: ['v*']` en op de bestaande cron (die bouwt de laatste
> tag, niet `main`: checkout met `ref` van de nieuwste `v*`-tag) en `workflow_dispatch`. (2) Een script
> `npm run release -- 1.1.0` dat `package.json` verhoogt, een commit en een tag maakt (PowerShell-proof, geen bash-only).
> (3) Instellingen → Over toont versie en tag; de upgradetest gebruikt de laatste tag op main als "vorige release" in
> plaats van de vorige commit (`scripts/build-previous.mjs`), met `voorvorige` = de tag daarvoor. (4) README en CLAUDE.md
> (Werkwijze → Releases): hoe een release gaat, hoe terugdraaien gaat (nooit een lagere schrijfversie). Acceptatie:
> een push naar `main` deployt niet; een tag deployt; `npm run upgrade:vorige` werkt lokaal en in CI; test.yml groen. Niet
> aanraken: de app-code buiten Over.

**V-3 · Beveiliging opnieuw nagelopen en de open punten dicht** (B-1, B-2, B-3 tekst; omvang M, ongeveer 1 dag)

> Repo `logboek`. Je bent een aparte sessie die de code niet schreef. Lees CLAUDE.md (Harde beveiligingsregels,
> Cryptografisch ontwerp, Werkwijze → Beveiligingsreview), docs/app-kaart.md 4 en 5, docs/review.md hoofdstuk 5 en het
> rapport in GitHub PR #76. Doel: de verplichte beveiligingsreview geldt voor de code van nu en voor meerdere gebruikers.
> Wat: (1) Loop de zeven scenario's uit Werkwijze na op de huidige code en schrijf het rapport als `docs/beveiliging.md`
> (per scenario wel/niet/regel, bevindingen met bestand:regel), inclusief de nieuwe risico's bij meerdere gebruikers uit
> docs/delen.md. (2) Zet alle `uses:` in `.github/workflows/*.yml` op een commit-hash met de tag als commentaar; haal
> `contents: write` uit `kaart.yml` door de kaartdata via een PR-artifact of een aparte repo te laten lopen, of
> documenteer waarom het blijft; voeg `.github/dependabot.yml` toe (actions en npm, wekelijks gegroepeerd) en overweeg
> `ignore-scripts=true` in een `.npmrc` voor CI (controleer dat de build en `npx playwright install` dan nog werken).
> Beschrijf in het rapport wat Olivier zelf buiten de repo moet zetten: een `github-pages`-environment met hemzelf als
> verplichte reviewer (of de tag-deploy uit V-2), minstens één verplichte goedkeuring op `main`, tweestapsverificatie met
> passkey. Neem B-6 (rollback van een oude meta) op als ontwerpbeslissing: een teller in het check-payload, of nooit
> vanzelf overnemen. (3) Voeg bij "Herstelcode tonen" en in de handleiding de zin toe dat de herstelcode
> nooit verandert en dat wachtzin én herstelcode kwijt onherstelbaar is. (4) Schrijf in CLAUDE.md regel 11 de juiste
> PR-nummers (#76 en de nieuwe) en wat Olivier zelf nog moet doen (handtest: `logboek-data` clonen op een andere
> computer en niets kunnen lezen; `VAULT_REVIEWED` pas daarna). (5) Voeg een test toe die de CSP in `dist/index.html`
> letterlijk vergelijkt met regel 2 en die controleert dat de bundel geen andere host dan `api.github.com` bevat.
> Acceptatie: test.yml groen; het rapport noemt bij elke bevinding of hij in deze PR is opgelost. Niet aanraken:
> functionaliteit; geen nieuwe afhankelijkheden.

**V-4 · Handleiding en feedback** (S-2, D-5 tekst; omvang S, een halve dag)

> Repo `logboek`. Lees docs/handleiding.md en docs/review.md hoofdstuk 2 en S-2. Doel: een nieuwe gebruiker vindt een
> handleiding in zijn taal en kan iets melden zonder dat de app iets verstuurt. Wat: (1) `docs/handleiding.md` nalopen
> op de wijzigingen uit V-1 en vertalen naar `docs/manual.md` (British English, zelfde stijl als `src/i18n/en.ts`). (2)
> Onder Instellingen → Over een rij "Handleiding" (link naar de pagina op GitHub in de taal van de app) en een rij
> "Feedback" die een e-mail (`mailto:` met onderwerp "Logboek <versie>") of een nieuw GitHub-issue opent; de app
> verstuurt zelf niets en vult geen inhoud in. (3) CLAUDE.md: de kop en "Eén gebruiker" vervangen door "Eén gebruiker per
> logboek; meerdere gebruikers op dezelfde site", de Olivier-specifieke standaarden in Zeilgeld en Import benoemen als
> "voorbeeld van Olivier", en regel 6 uitbreiden met "nooit de data-repo van een andere gebruiker". Acceptatie: de
> i18n-test groen (nieuwe sleutels in nl en en), schermafbeelding van Over in beide talen. Niet aanraken: code buiten
> `Settings.tsx` en `src/i18n`.

### Kort daarna

**K-1 · Begrippen en Meer opruimen** (D-5, D-6; omvang M). Prompt: "Lees docs/review.md hoofdstuk 2. Voer het
begrippenmodel in dat Olivier koos (hij vult de tabel aan): hernoem alleen teksten in `src/i18n/nl.ts` en `en.ts` en de
labels in `labels.ts`, niets in het dataformaat; groepeer Meer in vier koppen (`src/screens/More.tsx`); voeg Rekeningen
samen met Mijn positie (één scherm, twee ingangen mogen blijven als knop); verplaats Teller en Salaris per organisatie
naar het blad van de organisatie (`OrganisationSheet.tsx`). Acceptatie: alle e2e-specs groen na het bijwerken van de
teksten in de tests, schermafbeeldingen bekeken. Niet aanraken: `src/domain`, `src/storage`, `src/model/types.ts`."

**K-2 · Tests op 360 px en zichtbare retries** (W-1; omvang S). Prompt: "In `playwright.config.ts` het project `mobiel`
op 360 × 740 met `isMobile` en `hasTouch`; een tweede project `pixel7` alleen voor `screenshots.spec.ts` en
`kaart-gebaren.spec.ts`. In test.yml de JSON-reporter toevoegen en een stap die tests met een retry print en de job laat
falen als er meer dan twee zijn. Acceptatie: alles groen op 360 px; de overloopcontrole (`expectNoHorizontalOverflow`)
blijft overal staan."

**K-0 · Toewijzing in geld gelijkgetrokken** (G-1, G-2, G-3, G-4; omvang S). Prompt: "Lees docs/review.md G-1 t/m G-4.
In `src/model/position.ts`: tel de begindag mee in het zeilresultaat als de nieuwste stand vóór `from` ouder is dan
`from` (of toon 'ná <datum>' in de regel en de doorklik); waardeer te ontvangen salaris via `eurValue` in plaats van
`toEur` met de kijkdag; bij een valuta zonder koers de euro-delen tonen en die valuta apart (geen `geen-koers` voor het
geheel). In `src/domain/geldrapport.ts` en `src/model/tax-year.ts`: `groupOf` leest ook de tombstone van een trip. Tests:
breid `tests/doorklik.test.ts` uit met geld op de begindag, een verwijderde tocht met een eigen organisatie, `receivedEur`
op een verwacht salaris en een rekening in GBP; CLAUDE.md (Mijn positie) bijwerken."

**K-3 · Gezondheid verwijst naar de fix** (W-5; omvang S). Prompt: "In `src/domain/gezondheid.ts` en
`src/screens/Storage.tsx`: de regels `dag-zonder-trip`, `geld-zonder-periode`, `student-zonder-trip` krijgen een knop
'Naar Nakijken' (openen via `src/navigation.ts`), `salaris-zonder-bedrag` en `meerdere-salarissen` een knop 'Naar Te
controleren' (Geld). CLAUDE.md Invarianten bijwerken. Test in `tests/diagnose.test.ts` of een nieuwe e2e."

**K-4 · Documentatie gelijk aan de code** (C-2; omvang S). Prompt: "Vervang `docs/ARCHITECTUUR.md` door een korte
verwijzing naar `docs/app-kaart.md` en verplaats wat daar nog niet staat (sectie 10, wat in de browser staat). Corrigeer in
CLAUDE.md: de meta bevat geen vingerafdruk-KEK (die staat lokaal), alleen AES-GCM, de PR-nummers van de reviews, en de
Logboek-regel 'alleen trips met gelogde dagen'. Voeg aan `tests/` een test toe die `SCHEMA_VERSION` en `WRITER_VERSION`
in docs/app-kaart.md vergelijkt met `src/model/schema.ts`."

**K-5 · Valuta's en importsjabloon** (S-3, S-4; omvang S). Prompt: "Breid `Currency` uit met alle valuta's in
`public/rates.json` (lees de lijst uit `scripts/build-rates.mjs`), met een upgradevoorbeeld en zonder schrijfversie-verhoging
(oudere builds lezen een onbekende valuta als tekst; controleer `formatMoney`). Voeg `public/sjabloon-mijlen.csv` toe
met de kopregel in het Nederlands en herken in `src/import/mileage-csv.ts` ook Engelse kopnamen (Date, From, To, Role,
Vessel, …), met een test op de nepfixture in beide talen. Een knop 'Sjabloon downloaden' bij Importeren."

### Later

**L-1 · Store en Session splitsen** (C-1; omvang L). Prompt: "Splits `src/storage/store.ts` in `store.ts` (geheugen,
opslaan, status), `store-sync.ts` (runSync, syncPath, documenten) en `store-repair.ts` (check, repair, evidence), met
dezelfde publieke klasse; idem `src/session.ts` in sessie, eerste keer en herstel. Gedrag gelijk; alle tests groen zonder
wijziging; `tests/domeinlaag.test.ts` blijft de poort bewaken."

**L-2 · Lagen schoon en dode code weg** (C-1 lagen, C-3, C-4, W-4; omvang M). Prompt: "Verplaats `Screen` en `ErrorLine`
uit `Setup.tsx` naar `src/components`, `HistoryButton` uit `History.tsx` en `useDueItems` uit `Deadlines.tsx` naar
`src/components`; maak de lazy imports in `Home.tsx` effectief (`npx vite build` zonder `INEFFECTIVE_DYNAMIC_IMPORT`);
verwijder de exports uit docs/review.md C-3 of gebruik ze; één `toEur` in `rates.ts`; maandhulpjes naar
`src/basis/datum.ts`. Voeg een test toe die verbiedt dat `src/components` uit `src/screens` importeert."

**L-3 · Alleen-op-dit-apparaat-modus met back-up** (docs/delen.md optie B; omvang L). Prompt: zie docs/delen.md 2.B
voor de omvang; vereist eerst V-1 t/m V-3 en een eigen foutmatrix.

**L-4 · Sleutelwissel** (B-3; omvang L). Prompt: "Ontwerp eerst (docs): een nieuwe hoofdsleutel na 'Wachtzin wijzigen
met nieuwe sleutel' of na een gelekte token: alle bestanden opnieuw versleutelen en wegschrijven onder één sync, nieuwe
herstelcode, oude versies blijven in de git-geschiedenis (benoem dat), twee apparaten midden in de wissel. Pas daarna
code."

**L-5 · Organisaties in het dataformaat** (C-5; omvang M). Prompt: "Bij de volgende schrijfversie: `source` alleen nog
lezen, de organisatie-id van de periode is de waarheid; migratie met voorbeeld in de upgradetest; demo zonder Sailing
Virgins en Yacht Week."
