# Fundering

Waarom de app een eenvoudigere basis krijgt, hoe die eruitziet en in welke stappen. Pijnpunten: stand 31 oktober
2026, vóór de ombouw; doelontwerp: zoals gebouwd in PR 0. CLAUDE.md blijft de bron van waarheid voor gedrag; dit bestand beschrijft het ontwerp eronder.

## 1. Pijnpunten in de code

- **Schrijven gebeurt overal.** 35 modelbestanden en 6 schermen roepen zelf `store.put` of `putMany` aan (190 plekken).
  Elke functie regelt zelf het ongedaan maken (`applyChanges`, `undoableIn`, `bothUndo`, eigen sluitingen), de sync
  (102 keer `store.sync()`) en de bijwerkingen (`followTrip`, `followDays`, `setStayDays`). Vergeet één functie een
  stap, dan klopt de data maar half.
- **Niet in één keer.** Een handeling die meerdere bestanden raakt (een trip verwijderen: trip, dagen, geld, agenda,
  periodes, instellingen), schrijft bestand voor bestand. Sluit de app halverwege, dan is de handeling half opgeslagen.
- **Stille koppelingen.** Geld en dagen kunnen van periode wisselen zonder dat Olivier dat kiest:
  - "Hoort bij" valt bij een uitgave waarvan de periode weg is, terug op de periode van de datum (bijvoorbeeld Home);
    één keer opslaan verhuist het geld;
  - een gelogde dag bewerken (`placeLeg`) zet hem in de trip van zijn datum, ook als dat een andere week is;
  - "Naar de trip van die datum" in Nakijken en op de periodepagina verplaatst dagen met één tik, zonder voorbeeld van
    wat de andere periode daarna telt.
- **Verwijderen is te makkelijk en te definitief.** "Trip verwijderen" staat onderaan het bewerkscherm, naast de dagen;
  zonder afhankelijkheden is de trip met één tik weg. Ongedaan maken staat 10 seconden in beeld, daarna is er geen weg
  terug in de app. Sommige tombstones worden direct geschoond.
- **Dubbele hulpfuncties.** Maanden verschuiven staat vijf keer in de code (`shiftMonth` in calendar, position, costs,
  actual-costs, fixed-bookings), de laatste dag van een maand twee keer, `addDays` in `money.ts`, `todayIso` in
  `types.ts`. Bedragen lezen kent drie varianten (`parseAmount`, `parseStand`, `parseValue`). De organisatie van een trip
  wordt op vier plekken bepaald (`tripOrganisation`, `orgFromName`, `sourceForPeriod`, `groupOf`).
- **Uitzonderingen per scherm.** Schermen beslissen zelf over randgevallen (welke trip bij een datum hoort, wanneer
  iets mag verwijderd worden). Dezelfde regel staat daardoor soms op twee plekken net anders.

## 2. Doelontwerp

```
schermen  ──(opdrachten)──▶  src/domain  ──(één transactie)──▶  Store  ──▶  IndexedDB + outbox  ──▶  GitHub
    ▲                              │
    └──────── afgeleide data ◀── src/model (lezen en plannen, schrijft nooit zelf)
```

- **`src/domain/tx.ts` — de transactie (`Tx`).** Leest zoals de Store (`get`, `list`) en ziet daarbij zijn eigen,
  nog niet vastgelegde wijzigingen. Schrijven (`put`, `putMany`, `remove`) gaat alleen in de transactie. Modelfuncties
  die iets wijzigen, krijgen een `Tx`, nooit de Store; lezende modelfuncties een `Reader` (de Store of een `Tx`).
- **`src/domain/commit.ts` — de enige poort naar de opslag.** `commit(store, opdracht, werk)` voert het werk uit op een
  transactie en legt het dan in één keer vast:
  1. de toestand vooraf van elk gewijzigd record vastleggen (records die niet echt veranderen, worden niet geschreven);
  2. alle bestanden en de outbox in één IndexedDB-transactie schrijven (alles of niets), daarna een sync plannen;
  3. ongedaan maken teruggeven, als eigen opdracht en **per veld**: alleen wat de opdracht veranderde, en alleen waar nog
     staat wat de opdracht schreef. Een latere wijziging (hier of op een ander apparaat) blijft staan; een nieuw record
     gaat weer weg (persoonlijke gegevens als tombstone zonder inhoud, `src/domain/tombstone.ts`).
  Opdrachten op dezelfde Store lopen na elkaar. Een opdracht begint direct (`Store.beginWrite`, alleen ontgrendeld) en
  wordt afgemaakt, ook als er intussen vergrendeld wordt (CLAUDE.md, Eén schrijver).
- **Benoemde opdrachten per gebied** (`src/domain/geld.ts`, `dagen.ts`, `agenda.ts`, `trips.ts`, `training.ts`,
  `plaatsen.ts`, `termijnen.ts`, `doelen.ts`, `kluis.ts`, `instellingen.ts`, `importeren.ts`). Elke wijziging heeft een
  naam (`periodeVerwijderen`, `dagLoggen`, `geldToevoegen`, `samenvoegen`, …). Wat in één tik meerdere stappen doet,
  is één opdracht (`dagLoggen`: trip zo nodig verlengen of maken, de dag, de datums, de laatst gebruikte keuzes), dus
  ook één keer ongedaan maken. Per gebied, zodat Vandaag bij het openen alleen laadt wat hij nodig heeft.
- **De Store schrijft geen losse records meer.** `put`, `putMany` en `remove` zijn weg; alleen een transactie krijgt
  een schrijfhandvat (`Store.beginWrite`). TypeScript dwingt dat af, en `tests/domeinlaag.test.ts` controleert dat
  alleen de domeinlaag `commit` aanroept en dat geen scherm een schrijvende modelfunctie importeert.
- **`src/basis/` — één laag voor datums, bedragen en organisaties.** `datum.ts` (vandaag, dagen en maanden tellen),
  `bedrag.ts` (één parser voor alles wat Olivier intypt, één vorm voor een voorgevuld veld), `organisatie.ts` (bij welke
  organisatie een trip hoort: de teller, de bron van geld en het jaaroverzicht gebruiken dezelfde regel). De dubbele
  varianten zijn weg.
- **Geen stille koppelingen.** Een opdracht verandert gekoppelde data alleen als dat de opdracht zelf is. Geld, dagen
  en deelnemers wisselen nooit vanzelf van periode; zonder periode staan ze op "Zonder periode" met een voorstel in
  Nakijken.

Wat hetzelfde blijft: het dataformaat (achterwaarts compatibel), de sync, de versleuteling, de sleutel-invariant en
het herstel bij onleesbare bestanden. De ombouw zit tussen de schermen en de Store.

## 3. Stappenplan

| PR | Inhoud |
|---|---|
| 0 | Fundering: `Tx`, `commit` (atomair over bestanden), opdrachten, alle schrijfacties erdoorheen, `src/basis`, dode code en omwegen weg. Gedrag gelijk, behalve waar het nu fout is |
| 1 | Prullenbak (30 dagen, met gekoppelde data), de per ongeluk verwijderde trip terug, periode verwijderen via "⋯" met bevestiging |
| 2 | Nooit stil verhuizen; geschiedenis per opdracht (`history.json.enc`) met terugzetten; de samengevoegde week terug |
| 3 | Dagen binnen een periode bekijken en bewerken; tellers met etappes; tekstfouten bij uitgaven |
| 4 | Invarianten als code, gezondheidscheck, willekeurige tests over reeksen acties |
| 5 | Organisaties instelbaar, geen persoonlijke standaarden voor een nieuwe gebruiker, eerste start met begeleiding |
| 6 | CLAUDE.md en docs bij |
