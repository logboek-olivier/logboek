# Periodemodel

Ontwerp voor één vast model waarin elke situatie past (PR 0 t/m 6, oktober 2026). Kort: elke dag hoort bij hoogstens
één periode, alles (dagen, mensen, planning, geld) hangt aan een periode, en elke periode wordt overal op dezelfde manier
getoond en bewerkt. Wijkt de code af van dit bestand, dan is de code fout; afwijkingen van het verzoek staan onderaan
met de reden.

## 1. Model

| Soort | Subtype | Gegevens naast id, soort, naam, start, eind, notitie |
|---|---|---|
| **werk** | les geven, skipper charter, delivery, overig | boot, gebied, organisatie, teller, gelogde dagen, deelnemers; bij les geven planning en studenten; salaris |
| **training** (zelf leren) | – | boot, gebied, organisatie (optioneel), teller, gelogde dagen, deelnemers |
| **plezier** (zeilen met vrienden) | – | boot, gebied, organisatie (optioneel), teller, gelogde dagen, deelnemers |
| **reis** | – | van, naar, vervoer (vliegtuig, boot, trein, bus, auto, overig; optioneel) |
| **thuis** | – | – |
| **vrij** | – | – |

- **Op het water** (werk, training, plezier) is het bestaande `Trip`-record in `trips.json.enc`. Dezelfde id's, dus dagen
  (`Leg.tripId`), geld (`Transaction.tripId`), studenten, planningen en declaraties blijven gekoppeld. Nieuw veld
  `kind` (`werk | training | plezier`). `type` blijft het subtype en de bron voor oudere versies: werk = `training-geven`,
  `skipper-charter`, `delivery` of `overig`; training = `zelf-trainen`; plezier = `zelf-cruisen`.
- **Aan land** (reis, thuis, vrij) is een nieuw record `StayPeriod` in `periods.json.enc`:
  `id, kind (reis|thuis|vrij), name?, startDate, endDate, note?, travel? {from?, to?, by?}`. Zonder naam toont de app
  "Thuis", "Vrij" of "Reis Amsterdam → Sint Maarten".
- In de code is er één type `Period` (`src/model/periods.ts`): soort, subtype, naam, start, eind, notitie en het record
  erachter. Schermen werken alleen met `Period`; welk bestand erachter zit, doet er voor hen niet toe.
- **Dagen zonder periode** houden een dagtoestand in `calendar.json.enc`: beschikbaar, optie of onbeschikbaar. Een
  dag in het verleden zonder periode is leeg; hoogstens twee dagen tussen twee trips tonen vanzelf als vrij (zoals nu).
- **Hoogstens één periode per dag.** Water gaat voor land: een trip maken of verlengen over een thuisperiode maakt die
  korter (of splitst hem), net zoals een trip nu zelf ingestelde agendadagen laat plaatsmaken; uitgaven op die dagen
  gaan mee naar de trip, inkomsten niet (Nakijken). Twee aangrenzende periodes van dezelfde soort gaan samen: de
  langste blijft, met de notitie, naam en reis van de andere erbij. Een gelogde dag ligt
  altijd binnen de datums van zijn trip (zie PR 1). Wat toch botst, staat in Nakijken.
- **Agenda:** de dagsoort volgt uit de periode: op het water (werk, training, plezier, één kleur), reis, thuis, vrij;
  anders de dagtoestand. "Rust" heet voortaan "Vrij".
- **Geld hangt aan een periode:** `Transaction.tripId` is het periode-id (de naam blijft, oudere versies lezen hem).
  Salaris alleen bij werk. Uitgaven krijgen een soort: reizen, eten en drinken, verblijf, opleiding, uitrusting,
  overig (`category`); opleiding en uitrusting zijn `kind: investering` en tellen in de statistieken als "investering
  in mijn zeilcarrière", de rest is `kind: kosten`. Het veld `source` blijft in de data (oudere versies hebben het
  nodig), volgt voortaan uit de organisatie van de periode en staat niet meer in beeld; de knop Kosten/Investering
  vervalt.

## 2. Migratie van bestaande gegevens

Draait vanzelf na de eerste geslaagde sync van deze versie, één keer per logboek (`settings.periodsMigratedAt`, gesynct;
zonder iets om te zetten schrijft hij niets en kijkt de volgende sessie opnieuw),
alleen als `trips`, `legs`, `calendar`, `transactions`, `periods` en `settings` leesbaar zijn, en nooit in de demo.
Alles met vaste id's en `justAfter`-tijden, zodat twee apparaten hetzelfde maken en een echte wijziging op een ander
apparaat altijd wint. Niets wordt gewist: een tombstone houdt zijn inhoud, en de oude versie blijft in de geschiedenis
van `logboek-data`.

1. **Trips** (geïmporteerd, via het plusje, via Dag, gepland): niets herschreven. De soort wordt afgeleid: opgeslagen
   `kind` → `type` → organisatie (Sailing Virgins, Yacht Week = werk) → rollen in de dagen (instructeur = les geven,
   trainee = training) → naam ("Yacht week" = werk, "RYA"/"ASA"/"cursus"/"exam" = training). Is dat niet zeker (geen
   type of type overig zonder ander signaal), dan staat de trip in Nakijken met de soorten als knoppen.
2. **Agendadagen** thuis, reis en rust buiten een trip: elk aaneengesloten stuk van dezelfde soort wordt een periode
   thuis, reis of vrij (id `periode:<soort>:<start>`). Van de eerste en naar de laatste reisdag worden van en naar van
   de reis (met een vluchtnummer: vervoer vliegtuig). Dagen zonder eigen gegevens worden een tombstone; dagen met een
   notitie, plaats, reden of reisgegevens blijven staan als gegevens van die dag (de dagsoort volgt voortaan uit de
   periode). Zulke dagen binnen een trip, en werkdagen zonder trip, blijven staan en komen in Nakijken.
3. **Uitgaven** zonder trip op een dag aan land: gekoppeld aan die periode. Wat al aan een trip hing, blijft daar.
   Op een tripdatum, en bij inkomsten, koppelt de app niets vanzelf: een inkomen of uitgave aan een trip hangen
   verandert het resultaat van die trip (en bij loon: salaris ontvangen). Die staan in Nakijken, met de periode van hun
   datum als voorstel. Declaraties en hun uitgave volgen hun declaratie, uitbetalingen hun trip.
4. **Source**: blijft staan. Hangt een inkomen met source Sailing Virgins of Yacht Week aan een trip zonder organisatie,
   dan stelt Nakijken die organisatie voor.

Schrijfversie 2 (`WRITER_VERSION` in `src/model/schema.ts`): na de eerste volledige sync draagt elk bestand op GitHub
schrijfversie 2. Een build zonder het periodemodel (schrijfversie 1) schrijft dan nergens meer overheen en toont "Werk de
app bij"; wat hij opsloeg, gaat mee na bijwerken.

Getest met een migratietest die eerst rood was (`tests/periodes.test.ts`), de upgradetest vanaf de vorige release en
vanaf de twee vaste oudere releases, en koppelen op een schoon tweede apparaat (`tests/e2e/upgrade.spec.ts`).

## 3. Nakijken (Meer → Nakijken)

Alleen zichtbaar als er iets is; Vandaag toont dan één regel "N dingen nakijken" (zonder bedragen). Elk punt heeft één
knop die het oplost (met ongedaan maken) en "Klopt zo" (onthouden in `settings.reviewDismissed`).

| Punt | Fix van één tik |
|---|---|
| Trip zonder zekere soort | Soort kiezen (les geven, skipper charter, delivery, werk overig, training, plezier); bij meer dan één ook "Alle voorstellen overnemen" |
| Werk zonder organisatie | Organisatie kiezen; voorstel uit de source van zijn inkomsten |
| Twee periodes op dezelfde dag | Samenvoegen, of de andere korter maken (bestaande keuze voor trips) |
| Gelogde dag buiten de datums van zijn trip | Naar de trip van die datum, of (hoogstens 3 dagen ernaast) de trip verlengen; verder weg "Dag bewerken" |
| Agendadag (thuis, reis, rust, dagtoestand) binnen een trip | Dag hoort bij de trip |
| Dagtoestand (onbeschikbaar, optie, beschikbaar) of andere soort binnen een periode aan land | De dag uit de periode halen |
| Werkdag in de agenda zonder trip | Trip maken over die dagen |
| Inkomen of uitgave zonder periode | Koppelen aan de periode van de datum; zonder periode een thuisperiode maken (of de aangrenzende verlengen) |
| Plaatsen die dubbel lijken: een spelvariant | Overal samenvoegen (met het aantal dagen) |
| Een dag begint ergens anders dan waar de dag ervoor eindigde, één van beide zonder pin ("Sint Barths" na "Gustavia") | Alleen deze dag laten beginnen waar de vorige eindigde; of overal samenvoegen (met het aantal dagen); "Niet dezelfde" |

## 4. Gevolgen per scherm

| Scherm | Wat verandert | PR |
|---|---|---|
| Agenda | Dagsoort uit de periode; reis, thuis en vrij via het dagblad of Periode markeren maken of verlengen een periode | 0 |
| Meer → Nakijken | Nieuw | 0 |
| Periodepagina | Eén pagina in vaste volgorde: Overzicht · Route en dagen · Mensen · Planning · Geld · Notities en terugblik; dezelfde vanuit agenda, lijst, Vandaag en Deze trip; bewerken toont de dagen | 1 |
| Toevoegen → Dag | Een dag komt altijd in de periode van zijn datum; een oude "lopende trip" wint niet meer van de trip van vandaag | 1 |
| Toevoegen → Uitgave, periodepagina | Bedrag, soort, omschrijving, datum, "Hoort bij"; geen Source en geen knop Kosten/Investering | 2 |
| Geld | Werkelijk en Verwacht; vaste lasten per voorbije maand geboekt | 3 |
| Meer → Periodes | Lijst Nu · Komend · Afgelopen, filters en zoeken | 4 |
| Dagkaart, Boten, Trip bewerken | Losse fouten uit de schermafbeeldingen | 5 |
| CLAUDE.md, ARCHITECTUUR.md | Bijgewerkt | 6 |

## 5. Afwijkingen van het verzoek

- **Twee bestanden voor periodes** (`trips.json.enc` voor water, `periods.json.enc` voor land), één model in de code.
  Reden: een oudere versie op een ander apparaat leest `trips.json.enc` als trips; een thuisperiode daarin zou daar
  verschijnen als trip met werkdagen, teller, salarisvraag en vergeten dagen. Zo blijven ook alle bestaande koppelingen
  (dagen, geld, studenten, planningen, declaraties) ongewijzigd.
- **Vaste lasten hangen aan de maand, niet aan een periode.** Huur of een abonnement hoort niet in het resultaat van
  een trip; ze staan in Geld als eigen regel per maand (PR 3).
- **Rust wordt vrij** in de app; in de data blijft de oude waarde `rust` bestaan voor oudere versies.
- **Source wordt niet gewist** maar volgt uit de periode; oudere versies hebben het veld nodig.
