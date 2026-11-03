# Handleiding Logboek

Voor een schipper die de app voor het eerst opent. Geschreven door een onafhankelijke reviewer op 3 november 2026, op
basis van de code en de draaiende app (zie `docs/screens/` voor schermafbeeldingen met verzonnen gegevens). Wat in deze
handleiding niet in twee zinnen uit te leggen was, staat als bevinding in `docs/review.md` (hoofdstuk Duidelijkheid).

## 1. Wat is Logboek?

Een app op je telefoon (of laptop) voor een zeiljaar: je mijlen per dag, je trips, je agenda, je geld (salaris, fooien,
kosten, rekeningen) en een paar extra's (doelen, documenten, sollicitaties). Alles staat versleuteld in een eigen, privé
opslag op GitHub; alleen jij hebt de sleutel. De app werkt offline op zee en synchroniseert zodra er verbinding is.

## 2. De begrippen

| Begrip | Wat het is | Hangt samen met |
|---|---|---|
| **Dag** (ook: etappe) | Eén regel in je mijlenregistratie: datum, van waar naar waar, rol (schipper, co-schipper, bemanningslid, trainee, instructeur), boot, mijlen per watertype (binnen, zee, getij), nachturen, wind, notitie. Twee etappes op één datum zijn twee dagen. | Hoort bij precies één trip. |
| **Trip** (ook: tocht, week) | Een periode op het water met een begin- en einddatum: werk (les geven, skipper charter, delivery, overig), training (je leert zelf) of plezier (zeilen met vrienden). Heeft een naam, boot, basis, gebied, organisatie, deelnemers, salaris en een terugblik. | Verzamelt dagen, deelnemers, geld, een lesplanning, declaraties. |
| **Periode** | Het overkoepelende woord: een trip (op het water) óf een periode aan land: reis, thuis of vrij. Elke dag in je agenda hoort bij hoogstens één periode. | Trips en periodes aan land mogen elkaar overlappen; de agenda toont dan de trip. |
| **Agenda** (Engels: Calendar) | Het maandraster: per dag een kleur voor de periode (water, reis, thuis, vrij) of een eigen dagtoestand (beschikbaar, optie, onbeschikbaar). Hier markeer je periodes, importeer je een planning en deel je je beschikbaarheid. | Leest trips, periodes aan land en je eigen dagtoestanden. |
| **Logboek** (Engels: Logbook) | Het archief van al je trips en dagen met totalen (mijlen per rol, per watertype, nachturen), de grafiek per maand, importeren uit Excel en de zeiltijd-export. | Trips en dagen. |
| **Deze trip** | De trip waarin vandaag valt, als één pagina: overzicht, route en dagen, mensen, planning, geld, notities. Dezelfde pagina zie je als je op een trip tikt in het Logboek, de agenda of Periodes. | Eén trip. |
| **Organisatie** | Voor wie je werkt (bijvoorbeeld een charterbedrijf). Je zet ze zelf onder Instellingen → Organisaties. Een afkorting geeft elke trip een volgnummer ("NZ #3"). Per organisatie stel je een standaardsalaris en een uitbetaalritme in. | Trips, salaris, uitbetalingen, het jaaroverzicht. |
| **Deelnemer** | Iemand aan boord, met alleen een voornaam, eventueel land en een kort kenmerk. Een deelnemer met een cursus wordt een **student** met een checklist. Geen achternamen, geen contactgegevens. | Trip (lijst), fooi per persoon, studentenarchief. |
| **Geld** | Alles wat je verdient en uitgeeft rond het zeilen. Elk bedrag hangt aan een periode (trip of thuis/reis/vrij), aan een eerder seizoen (organisatie en jaar), of aan niets. | Trips en periodes. |
| **Werkelijk** (Engels: Actual) | Wat er echt gebeurd is: ontvangen salaris, fooien, kosten, je rekeningen. | Transacties en standen tot vandaag. |
| **Verwacht** (Expected) | De toekomst: verwacht salaris van komende trips, geschatte fooien, vaste lasten en je gemiddelde kosten per dagsoort, tot het einde van je planning. | Gepland (alleen je agenda) of Scenario (plus eigen blokken daarna). |
| **Salaris** | Precies één regel "loon" per trip met een status: verwacht (de trip komt nog of loopt), te ontvangen (voorbij, nog niet binnen) of ontvangen (met de datum). Een standaardbedrag per organisatie vult het alvast in. | Trip, organisatie, Mijn positie (te ontvangen). |
| **Fooi** | Geld van gasten, met de datum van ontvangst; optioneel van wie (een of meer deelnemers, de hele groep, onbekend). | Trip, deelnemers. |
| **Kosten** (uitgave) | Een uitgave met een soort: reizen, eten en drinken, verblijf, opleiding, uitrusting, overig. Je kiest bij "Hoort bij" welke periode. Opleiding en uitrusting tellen als **investering** in je zeilcarrière. | Periode. |
| **Declaratie** | Een bonnetje (foto) met bedrag dat je bij een organisatie indient; de uitgave en de terugbetaling horen bij elkaar. | Trip, kluis. |
| **Vaste last** | Een maandelijks bedrag (huur, telefoon) dat na een tik per voorbije maand als uitgave geboekt wordt en in Verwacht doorloopt. | Maand, niet een periode. |
| **Rekening en stand** | Een bank-, spaar-, beleggings-, contant- of schuldrekening, of een bezitting (huis, boot, auto), met standen op datums. Nooit rekeningnummers of mutaties. | Mijn positie. |
| **Mijn positie / netto waarde** (Net worth) | Rekeningen en bezittingen plus wat je nog te ontvangen hebt (salaris van voorbije trips, open declaraties) min je schulden. Plus de verandering over de gekozen periode, uitgesplitst. | Rekeningen, standen, salaris, declaraties. |
| **Scenario** | Blokken voor de weken ná je planning ("20 weken × € 2.000 per week"), met aannames (groei, rente, belegd deel) en eenmalige uitgaven, voor de vooruitblik. Meerdere scenario's, één actief. | Verwacht. |
| **Termijn** | Een deadline of vervaldatum (pas, visum, token), eventueel terugkerend; staat op Vandaag en in de agenda. | Agenda, kluis (vervaldatum van een document). |
| **Nakijken** | Alleen zichtbaar als er iets ontbreekt: een trip zonder zekere soort, werk zonder organisatie, geld zonder periode. Eén tik lost het op. | Alles. |

Hoe het samenhangt, in één zin: **je logt dagen, dagen vormen trips, trips en periodes aan land vullen de agenda, en je
geld hangt aan die periodes; Vandaag toont wat er nu speelt, Meer bevat de rest.**

## 3. Eerste keer instellen

Wat je nodig hebt (ongeveer 10 minuten, eenmalig):

1. **Een GitHub-account** (gratis, github.com/signup). GitHub is de opslagplaats; de app praat alleen met api.github.com.
2. **Een lege privé repository**, bijvoorbeeld `logboek-data` (github.com/new → Private, zonder README). Dit wordt je
   versleutelde opslag. Niemand kan erin lezen, ook GitHub niet.
3. **Een fine-grained token** (github.com/settings/personal-access-tokens/new): alleen voor die repository, rechten
   **Contents: Read and write**, vervaldatum naar keuze. Kopieer de token; je ziet hem maar één keer. De app bewaart hem
   versleuteld op je telefoon en zet hem nooit in een repository.
4. **Een wachtzin** (minstens 12 tekens) en **pen en papier** voor de herstelcode van 24 woorden.

Stappen in de app (`docs/screens/01-…` tot `07-…`):

1. Open https://logboek-olivier.github.io/logboek/ in Chrome op je telefoon en kies **Begin je eigen logboek**. Wil je
   eerst kijken, kies **Bekijk de demo** (verzonnen gegevens, niets wordt opgeslagen).
2. Lees de vier stappen, tik **Verder**.
3. Vul de **token** en de **repository** in als `eigenaar/naam` (bijvoorbeeld `jouwnaam/logboek-data`), tik
   **Controleren**. De app controleert of de token werkt en de repository leeg is, en toont de vervaldatum van de token.
   Tik **Verder**.
4. Kies een **wachtzin** en typ hem twee keer.
5. **Schrijf de 24 woorden op papier.** Dit is je herstelcode: samen met de wachtzin de enige manier om je gegevens te
   openen. Zonder beide is alles weg, voor altijd. Tik **Ik heb ze opgeschreven** en typ drie gevraagde woorden na.
6. Tik **Logboek aanmaken**. Je ziet **Vandaag**, bovenaan "Gesynct".
7. Installeer de app op je beginscherm: Chrome-menu → **App installeren** (of "Toevoegen aan startscherm").
8. Optioneel: **Meer → Instellingen → Vingerafdruk** aanzetten, zodat je ontgrendelt met je vinger in plaats van de
   wachtzin. En **Instellingen → Organisaties**: voeg toe voor wie je werkt (naam, afkorting voor de teller).

**Ontgrendelen en vergrendelen.** Na 5 minuten zonder tikken vergrendelt de app; je opent hem weer met wachtzin of
vingerafdruk. Binnen die 5 minuten mag je van app wisselen of verversen zonder opnieuw te ontgrendelen. Handmatig
vergrendelen: Meer → Instellingen → Vergrendelen.

## 4. De onderbalk

**Vandaag · Deze trip · + · Agenda · Meer.**

### Vandaag
Bovenaan de syncstatus ("Gesynct", "1 wijziging wacht", "Geen verbinding"); tik erop of trek omlaag om te synchroniseren.
Daaronder je lopende trip groot (dag x van y, boot, mijlen tot nu toe, route op de kaart), of één regel met de dagsoort.
Dan: de knop **Dag van vandaag loggen**, open vragen (een vergeten dag, "Salaris van … ontvangen?", op zondag de
weekafsluiting en "N dingen aanvullen"), wind en weer bij je trip, je mijlen dit jaar met de voortgang naar je jaardoel en
de drie eerstvolgende termijnen. **Op Vandaag staan nooit bedragen**: je kunt het scherm laten zien aan gasten of studenten.

### Deze trip
De pagina van de trip waarin vandaag valt: overzicht (naam, soort, "7 dagen · 4 gelogd", boot, gebied, organisatie,
volgnummer), route en dagen op de kaart (elke dag te bekijken en te bewerken met het potlood, "Dag toevoegen"),
mensen (deelnemers; bij een cursus hun checklist), planning (lesplanning bij les geven, vaste checklists zoals een
safety briefing), geld (achter **Toon bedragen**: salaris, fooien, kosten en het resultaat van de trip; + Uitgave,
+ Inkomsten, + Declaratie) en notities en terugblik. Bewerken via het **potlood** rechtsboven; verwijderen alleen via
**⋯ → Periode verwijderen**. Zonder lopende trip zie je **Nieuwe trip** en onderaan je komende trips.

### + (Toevoegen)
Een laag over het scherm waar je was; na Opslaan ben je daar weer. Tabs:
- **Trip**: alleen een startdatum en einddatum zijn nodig; naam, soort, organisatie, boot en deelnemers kun je later
  aanvullen.
- **Dag** (standaard): datum (vandaag), van en naar (met suggesties en een kaartknop), mijlen (voorgevuld uit eerdere
  keren dezelfde route of de route over water), watertype, nachturen, wind, boot, rol, trip, notitie. Niets is verplicht.
- **Inkomsten**: bedrag, soort (fooi, loon of dagtarief, bonus, terugbetaling onkosten, overig), de tocht (de kiezer
  toont alle tochten, ook een eerder seizoen), bij een fooi van wie, valuta, datum, notitie.
- **Uitgave**: bedrag met valuta, soort, omschrijving, datum en **Hoort bij** (de periode rond die datum).
- **Declaratie**: foto van het bonnetje, notitie, bedrag, datum en trip.
- **Skill**: minuten of een waarde voor een skill of een zelf gemeten doel.
Lang drukken op het app-icoon opent deze tabs direct.

### Agenda
Maandraster met een kleur per dagsoort, de naam van elke trip als balk, mijlen klein in het vakje, een stip voor
termijnen en een rondje op een afgesloten zondag. Tik op een dag voor de **dagkaart** (wat er die dag was, met de trip
of periode, het geld van die dag achter Toon bedragen, de termijnen); het potlood opent het **dagblad** (dagsoort kiezen,
reis van/naar, notitie). **Periode markeren**: tik een begin- en einddag en kies een soort; werk opent Nieuwe trip.
Onderaan: de dagen op het water, vrij, reis, thuis en onbeschikbaar van de maand, **Planning importeren**, **Seizoen**
(één regel per week) en **Delen** (PDF met alleen je beschikbaarheid, of de volledige planning zonder namen en bedragen).

### Meer
Periodes · Logboek · Statistieken · Doelen · Carrière · Geld · Rekeningen · Termijnen · Kluis · Boten · Plaatsen ·
Kaarten · Cursussen · Studentenarchief · Opslag · Instellingen. Bovenaan verschijnen **Nakijken** (als er iets is) en
**Prullenbak** en **Geschiedenis** (als er iets in staat).

## 5. Elk scherm onder Meer

- **Periodes**: alle trips en periodes aan land in Nu · Komend · Afgelopen, met filters (werk, training, plezier, reis en
  thuis) en zoeken. Tik = de periodepagina.
- **Logboek**: totalen, grafiek per maand, **Nieuwe trip**, **Zeiltijd exporteren** (tabel per dag of per trip, als PDF
  via afdrukken), de trips per maand als kaartjes, en **Importeren** (Excel of CSV, zie 6). Let op: het Logboek toont
  alleen trips met gelogde dagen; een geplande of lege trip vind je onder Deze trip (komende trips) of Periodes.
- **Statistieken**: zeilen (mijlen per maand, rol, watertype, boot, gebied, langste dagtocht, meest bezochte plaatsen),
  de RYA Yachtmaster-checklist, werk per maand, geld achter Toon bedragen, instructeur, en "Waar ik gevaren heb".
  Filters: dit jaar, dit seizoen, alles, eigen periode.
- **Doelen**: jaardoelen die zichzelf vullen (mijlen, trips bij een organisatie, Yachtmaster, inkomsten) en zelf gemeten
  doelen ("5 kilo afvallen"), plus skills met sessies, trend en mijlpalen.
- **Carrière**: sollicitaties met status en volgende actie, netwerk (alleen voornamen), projecten.
- **Geld**: zie 7.
- **Rekeningen**: netto waarde, tempo ("nog N maanden tot positief"), per maand, de rekeningen met hun laatste stand;
  per rekening **Stand opslaan**, een export importeren (ASN, Revolut, BUX, DEGIRO of zelf koppelen) en de standen.
- **Termijnen**: alle open deadlines en vervaldatums, toevoegen (met snelle keuzes: over 1 week, 3 weken, …), **Zet in
  agenda** (maakt een agenda-bestand), de afgeronde.
- **Kluis**: documenten (foto of PDF) versleuteld opgeslagen met categorie, uitgifte- en vervaldatum, en offline
  beschikbaar. **Let op: de kluis staat in de testfase** ("zet hier alleen nepdocumenten en bonnetjes in"); zie
  `docs/review.md`, Beveiliging.
- **Boten**: alle boten uit je trips met model, soort en lengte; samenvoegen of verwijderen.
- **Plaatsen**: alle plaatsen uit je dagen; een pin op de kaart zetten (met een voorstel van de kaart), hernoemen,
  samenvoegen.
- **Kaarten**: vier vaargebieden (Bovenwindse Eilanden en BVI, Dalmatië, Saronische Golf en Cycladen, Nederland)
  met gedetailleerde kustlijnen offline beschikbaar maken. De wereldkaart (alleen land) is er altijd.
- **Cursussen**: cursuspakketten toevoegen (ASA, RYA, CWO), eigen cursussen, bewerken, delen en importeren als JSON.
- **Studentenarchief**: alle studenten per trip, zoeken en filteren, gearchiveerde studenten terugzetten of wissen.
- **Opslag**: per bestand de stand op je telefoon en op GitHub, **Controleer nu**, Gezondheid (regels over je data met
  een fix), **Back-up downloaden**, **Back-up terugzetten**, **Excel opnieuw importeren**, **Exporteren** (CSV).
- **Instellingen**: vergrendelen, wachtzin wijzigen, herstelcode tonen (na je wachtzin), vingerafdruk, token vervangen,
  jaardoel, organisaties, teller per organisatie (beginnummers), salaris en uitbetaling per organisatie, start
  zeilcarrière, dagelijkse herinnering, taal, demomodus, Over.

## 6. Importeren

**Mijlenregistratie uit Excel of CSV** (Logboek → Importeren, of Meer → Opslag → Excel opnieuw importeren). Het bestand
moet de opbouw van Oliviers registratie hebben: een kopregel die begint met `Datum`, daarna kolommen Van (plaats), Van
(land), Naar (plaats), Naar (land), Rol, Schip, Schipper/trainer, Co-schipper, Wind (bft), Binnenwater, Zee, Zee
(getijnavigatie), Totaal, Nacht-uren, Bijzonderheden; één rij per dag; **een lege rij scheidt trips**; de tekst in
Bijzonderheden op de eerste rij is de naam van de trip. Je ziet eerst een controlescherm (aantal dagen, trips, mijlen,
waarschuwingen per rij), dan pas **Importeren**. Opnieuw importeren vervangt alleen wat uit een eerdere import kwam; wat je
in de app maakte, blijft. Daarna vraagt de app de bootgegevens te controleren (overslaan mag).

**Planning** (Agenda → Planning importeren): CSV of Excel met kolommen start, eind, soort (werk, rust, reis, thuis,
onbeschikbaar, optie), naam, type, organisatie, boot, gebied, notitie.

**Bankstanden** (Rekeningen → een rekening → Export importeren): een export van je bank; de app herkent ASN, Revolut, BUX
en DEGIRO of laat je zelf de kolommen kiezen. Alleen standen worden bewaard, geen mutaties.

**Cursussen**: JSON uit een andere Logboek.

## 7. Geld in het kort

Bovenaan **Werkelijk | Verwacht** en de **periode** (sinds de start van je zeilcarrière, dit jaar, tot einde planning,
alles, of zelf). Elk bedrag is te tikken en toont de posten eronder.

Werkelijk: **Mijn positie** (rekeningen, te ontvangen, beleggingen, bezittingen, schulden, netto waarde vandaag en de
verandering in de periode; staat de verandering op "onbekend", voer dan een **Beginsaldo** in), **Te controleren**
(alleen als iets niet klopt), kosten per maand, **Zeilgeld: resultaat** met inkomsten, kosten, terugbetaald en
investering, uitbetalingen, declaraties, grafieken (fooi per week, inkomsten en kosten per maand), per werkdag, fooi per
gast, per organisatie, het **jaaroverzicht voor de belasting** (per organisatie in euro, als PDF) en de transacties.
**Eerder seizoen**: voor geld waarvan je de tocht niet meer weet (organisatie, jaar, drie bedragen).

Verwacht: **Gepland | Scenario**, de vooruitblik als sluitende som (netto waarde vandaag + salaris + geschatte fooien +
scenario-inkomen − kosten − eenmalige uitgaven + waardegroei = netto waarde op de einddatum) met een grafiek, het
verwachte salaris per maand, en **Kosten** (vaste lasten en je gemiddelde losse kosten per dagsoort).

Alles staat in euro met de koers van de dag (ECB, elke werkdag bijgewerkt); het originele bedrag staat er klein onder.

## 8. Back-up, export en een nieuw apparaat

- **Back-up** (Meer → Opslag → Back-up downloaden): één tekstbestand met al je gegevens, versleuteld; alleen te openen
  met de wachtzin of herstelcode van dat moment. Deel het naar Drive of bewaar het op je laptop. **Terugzetten** zet
  alleen terug wat nu helemaal ontbreekt.
- **Exporteren** (Meer → Opslag → Exporteren): CSV-bestanden in een zip voor Excel, **onversleuteld** (eerst een
  waarschuwing). Zonder deelnemers, studenten, rekeningen en declaraties.
- **Nieuw of tweede apparaat**: open de app, kies **Bestaand logboek koppelen**, vul je token en repository in en typ je
  wachtzin (of herstelcode). Alles wordt opgehaald. Beide apparaten blijven daarna gelijk via GitHub.
- **Wachtzin vergeten**: ontgrendel met de **herstelcode** (24 woorden) en kies daarna een nieuwe wachtzin onder
  Instellingen. **Wachtzin én herstelcode kwijt: je gegevens zijn niet meer te openen**, ook niet door Olivier of
  GitHub. Dat is bewust zo.
- **Token verlopen of ingetrokken**: Vandaag meldt het; maak een nieuwe token op GitHub en vul hem in onder
  Instellingen → Token vervangen. Je wijzigingen blijven intussen op je telefoon bewaard.
- **Telefoon kwijt**: trek de token in op GitHub (Settings → Developer settings → tokens). Zonder je wachtzin of
  vingerafdruk kan niemand de app openen; na 5 minuten is de sleutel op de telefoon toch al gewist.
- **De app doet raar**: Meer → Opslag → Controleer nu, of de noodpagina `…/logboek/reset.html` (wist alleen de
  app-cache, nooit je gegevens). Bij elke fout staat **Kopieer foutdetails**; die bevatten geen inhoud.

## 9. Wat de app nooit doet

Niets wijzigen zonder jouw tik (behalve synchroniseren), bedragen tonen op Vandaag, achternamen of contactgegevens van
gasten opslaan, met een andere server dan api.github.com praten, een verwijderde trip meteen weggooien (30 dagen
prullenbak), en jouw wachtzin of herstelcode ergens anders bewaren dan in jouw hoofd en op jouw papier.
