// Verzonnen voorbeeldrecords per databestand voor de upgradetest (tests/e2e/upgrade.spec.ts). Dit bestand wordt ook in
// de vorige release gebruikt (scripts/build-previous.mjs kopieert het daarheen), dus het importeert niets.
// Elke PR die een databestand toevoegt of wijzigt, voegt hier een voorbeeld toe of past het aan
// (tests/upgrade-samples.test.ts controleert dat elk bestand er een heeft).

const T = '2026-10-20T10:00:00.000Z'

export const UPGRADE_SAMPLES: Record<string, Record<string, unknown>[]> = {
  'trips.json.enc': [
    // Aangemaakt via Toevoegen → Dag: de datums volgen de dagen.
    { id: 'upg-trip-dag', name: 'Nepdag upgrade', startDate: '2026-10-12', endDate: '2026-10-12', datesFromDays: true, updatedAt: T, deletedAt: null },
    // Salaris per trip (eigen bedrag, verwacht): na de einddatum vraagt Vandaag of het ontvangen is.
    { id: 'upg-trip-salaris', name: 'Nepsalaris upgrade', organisation: 'sailing-virgins', startDate: '2026-10-01', endDate: '2026-10-07', salary: { amount: 1200, currency: 'EUR', status: 'verwacht', source: 'eigen' }, updatedAt: T, deletedAt: null },
    // "Geen salaris" (status geen, bedrag 0): telt nergens mee.
    { id: 'upg-trip-geen-salaris', name: 'Nep geen salaris', organisation: 'yacht-week', startDate: '2026-08-01', endDate: '2026-08-07', salary: { amount: 0, currency: 'EUR', status: 'geen', source: 'eigen' }, updatedAt: T, deletedAt: null },
    // Periodemodel: een trip met een opgeslagen soort (plezier).
    { id: 'upg-trip-plezier', name: 'Nepplezier upgrade', kind: 'plezier', type: 'zelf-cruisen', startDate: '2026-09-10', endDate: '2026-09-12', updatedAt: T, deletedAt: null },
    // Organisaties in de instellingen (schrijfversie 4): een trip bij een eigen organisatie.
    { id: 'upg-trip-eigen-org', name: 'Nep eigen organisatie', organisation: 'org:upg-nep', startDate: '2026-07-01', endDate: '2026-07-03', updatedAt: T, deletedAt: null },
    // Gouden regel (relaties veranderen niet): twee geïmporteerde tochten met dezelfde naam, zonder datums, elk met een
    // deelnemer (en student). Na de upgrade hoort elke dag en deelnemer nog bij dezelfde tocht, en loopt geen van beide
    // over de ander heen.
    { id: 'upg-gouden-a', name: 'Nep zeilweekend', participants: [{ id: 'upg-gouden-pa', firstName: 'Nepgouda', curriculumId: 'upg-course-1', level: 'beginner' }], updatedAt: T, deletedAt: null },
    { id: 'upg-gouden-b', name: 'Nep zeilweekend', participants: [{ id: 'upg-gouden-pb', firstName: 'Nepgoudb' }], updatedAt: T, deletedAt: null },
    { id: 'upg-trip-1', name: 'Nepweek upgrade', type: 'skipper-charter', organisation: 'yacht-week', startDate: '2026-10-18', endDate: '2026-10-24', boat: 'Nepboot', boatModel: 'Nepmodel 40', boatLengthFt: 40, base: 'Nephaven', expectedTip: { amount: 400, currency: 'USD' }, messageFields: { meetingPlace: 'Nepmarina', meetingTime: '16:00' }, messages: { introductie: { status: 'verstuurd', date: '2026-10-16' } }, checks: { 'seed-paklijst': [] }, participants: [{ id: 'upg-p-1', firstName: 'Nepnick', country: 'VS', tag: 'B', guestId: 'upg-p-0' }, { id: 'upg-p-2', firstName: 'Nepanna', country: 'NL', role: 'medezeiler' }], updatedAt: T, deletedAt: null },
  ],
  'legs.json.enc': [
    { id: 'upg-leg-dag', tripId: 'upg-trip-dag', date: '2026-10-12', fromPlace: 'Nepbaai', fromCountry: 'NL', toPlace: 'Nepdorp', toCountry: 'NL', role: 'schipper', boat: 'Nepboot', nmInland: 0, nmSea: 8, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'manual', updatedAt: T, deletedAt: null },
    // Mijlenimport met vaste id's (import:<trip>:<datum>:<n>): opnieuw importeren werkt dezelfde dag bij.
    { id: 'import:upg-trip-1:2026-10-18:0', tripId: 'upg-trip-1', date: '2026-10-18', fromPlace: 'Nepdorp', fromCountry: 'NL', toPlace: 'Nephaven', toCountry: 'NL', role: 'schipper', boat: 'Nepboot', nmInland: 0, nmSea: 12, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'import', updatedAt: T, deletedAt: null },
    // Gouden regel: per tocht dagen met vaste id's, twee etappes op één dag en een geschatte datum (lege datum in Excel).
    { id: 'import:upg-gouden-a:2024-05-03:0', tripId: 'upg-gouden-a', date: '2024-05-03', fromPlace: 'Nephaven', fromCountry: 'NL', toPlace: 'Nepbaai', toCountry: 'NL', role: 'schipper', boat: 'Nepboot A (Nepmodel 33)', nmInland: 0, nmSea: 11, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'import', updatedAt: T, deletedAt: null },
    { id: 'import:upg-gouden-a:2024-05-03:1', tripId: 'upg-gouden-a', date: '2024-05-03', fromPlace: 'Nepbaai', fromCountry: 'NL', toPlace: 'Neppunt', toCountry: 'NL', role: 'schipper', boat: 'Nepboot A (Nepmodel 33)', nmInland: 0, nmSea: 4, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'import', updatedAt: T, deletedAt: null },
    { id: 'import:upg-gouden-a:2024-05-04:0', tripId: 'upg-gouden-a', date: '2024-05-04', fromPlace: 'Neppunt', fromCountry: 'NL', toPlace: 'Nephaven', toCountry: 'NL', role: 'schipper', boat: 'Nepboot A (Nepmodel 33)', nmInland: 0, nmSea: 9, nmTidal: 0, nightHours: 0, dateEstimated: true, source: 'import', updatedAt: T, deletedAt: null },
    { id: 'import:upg-gouden-b:2024-09-20:0', tripId: 'upg-gouden-b', date: '2024-09-20', fromPlace: 'Nepdorp', fromCountry: 'NL', toPlace: 'Nepzand', toCountry: 'NL', role: 'co-schipper', boat: 'Nepboot B (Nepmodel 36)', nmInland: 6, nmSea: 0, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'import', updatedAt: T, deletedAt: null },
    { id: 'import:upg-gouden-b:2024-09-21:0', tripId: 'upg-gouden-b', date: '2024-09-21', fromPlace: 'Nepzand', fromCountry: 'NL', toPlace: 'Nepdorp', toCountry: 'NL', role: 'co-schipper', boat: 'Nepboot B (Nepmodel 36)', nmInland: 7, nmSea: 0, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'import', updatedAt: T, deletedAt: null },
    { id: 'upg-leg-1', tripId: 'upg-trip-1', date: '2026-10-19', fromPlace: 'Nephaven', fromCountry: 'NL', toPlace: 'Nepdorp', toCountry: 'NL', role: 'schipper', boat: 'Nepboot', windBft: '3-4', nmInland: 0, nmSea: 21.5, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'manual', updatedAt: T, deletedAt: null },
  ],
  'transactions.json.enc': [
    { id: 'upg-tx-1', date: '2026-10-20', kind: 'fooi', amount: 50, currency: 'EUR', source: 'yacht-week', tripId: 'upg-trip-1', tipFrom: { kind: 'personen', participantIds: ['upg-p-1', 'upg-p-2'], amounts: { 'upg-p-1': 30, 'upg-p-2': 20 } }, updatedAt: T, deletedAt: null },
    { id: 'upg-tx-2', date: '2026-10-21', kind: 'fooi', amount: 40, currency: 'EUR', source: 'yacht-week', tripId: 'upg-trip-1', tipFrom: { kind: 'groep' }, updatedAt: T, deletedAt: null },
    // Geldpad (ronde 3): fooi contant (nog in Contant), contant en al gestort, op de bank, en een deel van een uitbetaling.
    { id: 'upg-tx-3', date: '2026-10-22', kind: 'fooi', amount: 30, currency: 'EUR', source: 'yacht-week', tripId: 'upg-trip-1', tipVia: 'contant', updatedAt: T, deletedAt: null },
    { id: 'upg-tx-4', date: '2026-10-22', kind: 'fooi', amount: 20, currency: 'USD', source: 'yacht-week', tripId: 'upg-trip-1', tipVia: 'contant', depositedAt: '2026-10-23', updatedAt: T, deletedAt: null },
    { id: 'upg-tx-5', date: '2026-10-24', kind: 'fooi', amount: 15, currency: 'EUR', source: 'yacht-week', tripId: 'upg-trip-1', tipVia: 'bank', updatedAt: T, deletedAt: null },
    { id: 'upg-tx-payout', date: '2026-10-25', kind: 'loon', amount: 900, currency: 'EUR', source: 'yacht-week', tripId: 'upg-trip-1', payoutId: 'upg-payout-1', updatedAt: T, deletedAt: null },
    // Periodemodel (PR 2): opleiding is een investering met een soort; verblijf hangt aan een periode aan land.
    { id: 'upg-tx-opleiding', date: '2026-12-02', kind: 'investering', amount: 450, currency: 'EUR', source: 'overig', category: 'opleiding', tripId: 'upg-stay-thuis', note: 'Nepcursus', updatedAt: T, deletedAt: null },
    { id: 'upg-tx-verblijf', date: '2026-12-06', kind: 'kosten', amount: 80, currency: 'EUR', source: 'overig', category: 'verblijf', tripId: 'upg-stay-reis', updatedAt: T, deletedAt: null },
    // Periodemodel (PR 3): een vaste last van een voorbije maand, geboekt als echte uitgave (vast id per maand).
    { id: 'vast:upg-fixed-1:2026-09', date: '2026-09-30', kind: 'kosten', amount: 20, amountEur: 20, currency: 'EUR', source: 'overig', category: 'overig', note: 'Nepabonnement', fixedCostId: 'upg-fixed-1', updatedAt: T, deletedAt: null },
    // Periodemodel: een uitgave zonder trip op een thuisdag komt aan de thuisperiode.
    { id: 'upg-tx-thuis', date: '2026-11-11', kind: 'kosten', amount: 7.5, currency: 'EUR', source: 'overig', category: 'eten', updatedAt: T, deletedAt: null },
    // Kosten (ronde 3): een losse uitgave met een soort.
    { id: 'upg-tx-kosten', date: '2026-10-19', kind: 'kosten', amount: 12.5, currency: 'EUR', source: 'overig', category: 'eten', updatedAt: T, deletedAt: null },
    // Declaraties (ronde 3): de uitgave bij een declaratie, met claimId.
    { id: 'upg-tx-claim', date: '2026-10-20', kind: 'kosten', amount: 18.4, currency: 'EUR', source: 'yacht-week', tripId: 'upg-trip-1', category: 'overig', claimId: 'upg-claim-1', updatedAt: T, deletedAt: null },
  ],
  'settings.json.enc': [
    { id: 'settings', lastBoat: 'Nepboot', lastRole: 'schipper', lastCurrency: 'EUR', lastSource: 'yacht-week', yearGoalNm: 2500, orgFirst: { 'sailing-virgins': 3 }, orgAnswered: ['upg-trip-0'], salaryDefaults: { 'sailing-virgins': { amount: 1100, currency: 'EUR' } }, tipDefaults: { 'yacht-week': { amount: 350, currency: 'USD' } }, messageDefaults: { 'yacht-week': { meetingPlace: 'Nepmarina', checkIn: '17:00', introDaysBefore: 4 } }, dailyReminder: { time: '19:30', workdaysOnly: true }, payouts: { 'yacht-week': { kind: 'maandelijks', day: 5 } }, lastTipVia: 'contant', careerStart: '2026-09-01', costDefaults: { thuis: 25, reis: 40 }, lastCostCategory: 'eten', organisations: [{ id: 'sailing-virgins', name: 'Sailing Virgins', short: 'SV' }, { id: 'yacht-week', name: 'Yacht Week', short: 'YW' }, { id: 'org:upg-nep', name: 'Nep Charters', short: 'NC' }], curriculumPacks: ['ASA', 'RYA', 'CWO'], activeScenarioId: 'upg-scenario-1', updatedAt: T, deletedAt: null },
    // Fundering: "laatst gebruikt" van een ander apparaat in een eigen record (oudere versies lezen alleen 'settings').
    // Schrijfversie 10: de laatst gebruikte valuta per soort invoer (een fooi in dollars, een uitgave in euro).
    { id: 'laatst:0a1b2c3d', lastBoat: 'Nepboot ander apparaat', lastRole: 'instructeur', lastCurrency: 'USD', lastCurrencies: { fooi: 'USD', uitgave: 'EUR' }, lastSource: 'overig', lastWater: 'getij', updatedAt: T, deletedAt: null },
  ],
  'curricula.json.enc': [
    { id: 'upg-course-1', body: 'eigen', courseCode: 'NEP 1', name: { nl: 'Nepcursus', en: 'Fake course' }, groups: [{ id: 'g1', title: { nl: 'Nepdeel', en: 'Fake part' }, topics: [{ id: 't1', title: { nl: 'Nepknoop', en: 'Fake knot' }, kind: 'praktijk', examCritical: true }] }], source: 'eigen', updatedAt: T, deletedAt: null },
  ],
  'students.json.enc': [
    { id: 'upg-gouden-pa', firstName: 'Nepgouda', curriculumId: 'upg-course-1', level: 'beginner', progress: {}, startedAt: '2024-05-03', weekId: 'upg-gouden-a', updatedAt: T, deletedAt: null },
    { id: 'upg-student-1', firstName: 'Nepanna', curriculumId: 'upg-course-1', level: 'beginner', progress: { t1: { status: 'geoefend', updatedAt: T } }, startedAt: '2026-10-18', weekId: 'upg-trip-1', updatedAt: T, deletedAt: null },
  ],
  'plans.json.enc': [
    { id: 'upg-plan-1', title: 'Nepplanning', startDate: '2026-10-18', dayCount: 2, tripId: 'upg-trip-1', groups: [{ id: 'pg1', name: 'Groep A', curriculumId: 'upg-course-1', level: 'beginner', studentIds: ['upg-student-1'] }], days: [{ date: '2026-10-18', blocks: [{ id: 'b1', slot: 'ochtend', groupIds: ['pg1'], topicIds: ['t1'], themeIds: ['g1'] }, { id: 'b2', slot: 'middag', groupIds: ['pg1'], topicIds: [], themeIds: [], ownThemes: ['Nep mooring ball oppikken'] }] }], updatedAt: T, deletedAt: null },
  ],
  'places.json.enc': [{ id: 'upg-place-1', name: 'Nephaven', lat: 52.1, lon: 4.3, country: 'NL', updatedAt: T, deletedAt: null }],
  'reminders.json.enc': [{ id: 'upg-rem-1', title: 'Nepdeadline', date: '2027-01-15', kind: 'deadline', doneAt: null, repeat: 'jaarlijks', updatedAt: T, deletedAt: null }],
  'calendar.json.enc': [
    { id: 'dag:2026-10-25', date: '2026-10-25', type: 'reis', travel: { from: 'Nepstad', to: 'Nephaven', flight: 'NP 123' }, note: 'Nepnotitie', updatedAt: T, deletedAt: null },
    { id: 'dag:2026-10-26', date: '2026-10-26', type: 'werk', boat: 'Andere nepboot', updatedAt: T, deletedAt: null },
    // Dagsoort onbeschikbaar met een reden (ronde 2): een oudere versie bewaart hem ongewijzigd.
    { id: 'dag:2026-10-27', date: '2026-10-27', type: 'onbeschikbaar', reason: 'Nepreden', updatedAt: T, deletedAt: null },
    // Periodemodel: thuis en rust zonder gegevens worden een periode thuis en vrij (de dag zelf een tombstone).
    { id: 'dag:2026-11-10', date: '2026-11-10', type: 'thuis', updatedAt: T, deletedAt: null },
    { id: 'dag:2026-11-11', date: '2026-11-11', type: 'thuis', updatedAt: T, deletedAt: null },
    { id: 'dag:2026-11-12', date: '2026-11-12', type: 'rust', updatedAt: T, deletedAt: null },
  ],
  'checklists.json.enc': [
    { id: 'upg-list-1', title: { nl: 'Neplijst', en: 'Fake list' }, items: [{ id: 'i1', text: { nl: 'Nepvink', en: 'Fake tick' } }], tripTypes: ['skipper-charter'], source: 'eigen', updatedAt: T, deletedAt: null },
  ],
  // Weekafsluiting (ronde 2): cijfer en één zin per ISO-week; het id volgt uit de week.
  'weekreviews.json.enc': [{ id: 'week:2026-W43', week: '2026-W43', start: '2026-10-19', rating: 8, lesson: 'Nepzin over de week', spent: { amount: 85, currency: 'EUR' }, updatedAt: T, deletedAt: null }],
  // Periodemodel: periodes aan land (reis, thuis, vrij); werk, training en plezier zijn trips.
  // Geschiedenis (prullenbak): één verwijderde dag, nog terug te zetten.
  'history.json.enc': [
    { id: 'upg-hist-1', at: T, command: 'dagVerwijderen', device: 'a1b2c3d4', changes: [{ path: 'legs.json.enc', id: 'upg-leg-weg', before: { deletedAt: null }, after: { deletedAt: T } }], undoneAt: null, updatedAt: T, deletedAt: null },
  ],
  'periods.json.enc': [
    { id: 'upg-stay-thuis', kind: 'thuis', startDate: '2026-12-01', endDate: '2026-12-05', note: 'Nepnotitie', updatedAt: T, deletedAt: null },
    { id: 'upg-stay-reis', kind: 'reis', name: 'Nepreis', startDate: '2026-12-06', endDate: '2026-12-06', travel: { from: 'Nepstad', to: 'Nephaven', by: 'vliegtuig' }, updatedAt: T, deletedAt: null },
  ],
  // Vaste lasten (ronde 3): een bedrag dat vanaf een maand verandert.
  'fixedcosts.json.enc': [{ id: 'upg-fixed-1', name: 'Nepabonnement', currency: 'EUR', amounts: [{ from: '2026-09', amount: 20 }, { from: '2026-11', amount: 25 }], updatedAt: T, deletedAt: null }],
  // Declaraties (ronde 3): een ingediende declaratie zonder bonnetje en een terugbetaalde.
  'claims.json.enc': [
    { id: 'upg-claim-1', date: '2026-10-20', tripId: 'upg-trip-1', note: 'Nepbonnetje', amount: 18.4, currency: 'EUR', status: 'ingediend', submittedAt: '2026-10-21', updatedAt: T, deletedAt: null },
    { id: 'upg-claim-2', date: '2026-10-19', tripId: 'upg-trip-1', amount: 9, currency: 'EUR', status: 'terugbetaald', submittedAt: '2026-10-19', repaid: { date: '2026-10-22', amount: 9, currency: 'EUR' }, updatedAt: T, deletedAt: null },
  ],
  // Doelen en skills (ronde 2): een zelfvullend doel, een meetdoel, een skill met mijlpalen en twee sessies.
  'goals.json.enc': [
    { id: 'upg-goal-nm', title: '', kind: 'auto', metric: 'trips', organisation: 'sailing-virgins', year: 2026, target: 12, doneAt: null, updatedAt: T, deletedAt: null },
    { id: 'upg-goal-kg', title: 'Nepdoel afvallen', kind: 'meting', target: 77, unit: 'kg', lower: true, doneAt: null, updatedAt: T, deletedAt: null },
  ],
  'skills.json.enc': [
    { id: 'upg-skill-1', name: 'Nepskill adem', valueUnit: 's', best: true, milestones: [{ id: 'm1', title: 'Nepmijlpaal', doneAt: '2026-10-19' }, { id: 'm2', title: 'Tweede nepmijlpaal', doneAt: null }], updatedAt: T, deletedAt: null },
  ],
  'sessions.json.enc': [
    { id: 'upg-session-1', date: '2026-10-19', skillId: 'upg-skill-1', minutes: 20, value: 95, note: 'Nepnotitie', updatedAt: T, deletedAt: null },
    { id: 'upg-session-2', date: '2026-10-20', goalId: 'upg-goal-kg', value: 81.5, updatedAt: T, deletedAt: null },
  ],
  // Kluis (ronde 2): de index met één nepdocument; het bestand zelf staat in documents/<fileId>.bin.
  'documents/index.json.enc': [
    { id: 'upg-doc-1', title: 'Nepcertificaat', category: 'certificaten', issuedAt: '2026-01-10', expiresAt: '2031-01-10', notes: 'Nepnotitie', mime: 'image/jpeg', size: 1234, offline: true, fileId: '0f8c2f4e-6c1a-4b2e-9d3a-5e7f1a2b3c4d', updatedAt: T, deletedAt: null },
  ],
  // Carrière (ronde 2): een sollicitatie, een contact en een project in één bestand.
  'career.json.enc': [
    { id: 'upg-app-1', kind: 'sollicitatie', company: 'Nepbedrijf', role: 'Nepfunctie', status: 'gesprek', nextAction: 'Nepactie', nextDate: '2027-01-20', note: 'Nepnotitie', updatedAt: T, deletedAt: null },
    { id: 'upg-contact-1', kind: 'contact', firstName: 'Nepnoor', role: 'Nepschipper', metAt: 'Nephaven', updatedAt: T, deletedAt: null },
    { id: 'upg-project-1', kind: 'project', name: 'Nepproject', status: 'bezig', nextStep: 'Nepstap', updatedAt: T, deletedAt: null },
  ],
  // Rekeningen en standen (ronde 2): een betaalrekening en een studieschuld, met een stand per maand.
  'accounts.json.enc': [
    { id: 'upg-acc-1', name: 'Nepbank', provider: 'asn', kind: 'betaal', currency: 'EUR', note: 'Nepnotitie', updatedAt: T, deletedAt: null },
    { id: 'upg-acc-2', name: 'Nepschuld', provider: 'duo', kind: 'schuld', currency: 'EUR', updatedAt: T, deletedAt: null },
    // Bezittingen (november 2026): een boot als bezitting met een geschatte waarde.
    { id: 'upg-acc-3', name: 'Nepboot bezit', provider: 'bezit', kind: 'bezit', currency: 'EUR', updatedAt: T, deletedAt: null },
  ],
  'balances.json.enc': [
    { id: 'stand:upg-acc-1:2026-09', accountId: 'upg-acc-1', date: '2026-09-30', amount: 1234.56, source: 'import', updatedAt: T, deletedAt: null },
    { id: 'stand:upg-acc-2:2026-09', accountId: 'upg-acc-2', date: '2026-09-15', amount: -9876.5, source: 'handmatig', updatedAt: T, deletedAt: null },
    // Saldo-geschiedenis (november 2026): een stand per dag (id met de datum), naast een stand van vóór de geschiedenis
    // (id per maand) in dezelfde maand. Beide blijven staan.
    { id: 'stand:upg-acc-1:2026-09-02', accountId: 'upg-acc-1', date: '2026-09-02', amount: 1000, source: 'handmatig', updatedAt: T, deletedAt: null },
    { id: 'stand:upg-acc-3:2026-10-01', accountId: 'upg-acc-3', date: '2026-10-01', amount: 20000, source: 'handmatig', updatedAt: T, deletedAt: null },
  ],
  // Scenario's (november 2026, Geld → Verwacht → Scenario): twee blokken na de planning, één met eigen kosten.
  'scenarios.json.enc': [
    { id: 'upg-scenario-1', name: 'Nepscenario', endDate: '2030-12-31', blocks: [{ id: 'upg-blok-1', weeks: 20, incomePerWeek: 2000, currency: 'EUR' }, { id: 'upg-blok-2', weeks: 10, incomePerWeek: 1000, currency: 'USD', costsPerWeek: 250 }], assumptions: { investmentGrowthPct: 6, assetGrowthPct: 2, debtInterestPct: 2.5, investPct: 20 }, oneOffs: [{ id: 'upg-eenmalig-1', name: 'Nepauto', date: '2028-05-01', amount: 15000, currency: 'EUR' }], updatedAt: T, deletedAt: null },
    // Het stappenplan (schemaversie 5): vanaf vandaag, eigen startwaarde, salaris en fooi apart per blok, een doel.
    { id: 'upg-scenario-2', name: 'Nepstappenplan', version: 2, startValue: 4000, endDate: '2028-06-30', blocks: [{ id: 'upg-blok-3', weeks: 12, incomePerWeek: 1300, salaryPerWeek: 1000, tipsPerWeek: 300, currency: 'EUR', costsPerWeek: 400 }, { id: 'upg-blok-4', weeks: 10, incomePerWeek: 1500, salaryPerWeek: 1200, tipsPerWeek: 300, trips: 10, salaryPerTrip: 1200, tipsPerTrip: 300, currency: 'EUR' }], goal: { kind: 'doel', amount: 25000, by: '2028-01-31', measure: 'verdiend' }, updatedAt: T, deletedAt: null },
  ],
  // Berichtengenerator (november 2026): een eigen sjabloon voor Yacht Week (Nederlands) en een eigen soort bericht.
  'templates.json.enc': [
    { id: 'upg-sjabloon-1', kind: 'introductie', lang: 'nl', organisation: 'yacht-week', tripType: 'skipper-charter', text: 'Hoi {guests}, we verzamelen bij {meetingPlace} om {meetingTime}.', updatedAt: T, deletedAt: null },
    { id: 'upg-sjabloon-2', kind: 'eigen:upg-soort', kindName: 'Herinnering dag voor vertrek', lang: 'en', text: 'Tomorrow at {meetingTime}, {meetingPlace}.', updatedAt: T, deletedAt: null },
  ],
}
