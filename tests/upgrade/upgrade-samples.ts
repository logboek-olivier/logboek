// Verzonnen voorbeeldrecords per databestand voor de upgradetest (tests/e2e/upgrade.spec.ts). Dit bestand wordt ook in
// de vorige release gebruikt (scripts/build-previous.mjs kopieert het daarheen), dus het importeert niets.
// Elke PR die een databestand toevoegt of wijzigt, voegt hier een voorbeeld toe of past het aan
// (tests/upgrade-samples.test.ts controleert dat elk bestand er een heeft).

const T = '2026-10-20T10:00:00.000Z'

export const UPGRADE_SAMPLES: Record<string, Record<string, unknown>[]> = {
  'trips.json.enc': [
    { id: 'upg-trip-1', name: 'Nepweek upgrade', type: 'skipper-charter', organisation: 'yacht-week', startDate: '2026-10-18', endDate: '2026-10-24', boat: 'Nepboot', boatModel: 'Nepmodel 40', boatLengthFt: 40, base: 'Nephaven', checks: { 'seed-paklijst': [] }, participants: [{ id: 'upg-p-1', firstName: 'Nepnick', country: 'VS', tag: 'B', guestId: 'upg-p-0' }, { id: 'upg-p-2', firstName: 'Nepanna', country: 'NL' }], updatedAt: T, deletedAt: null },
  ],
  'legs.json.enc': [
    { id: 'upg-leg-1', tripId: 'upg-trip-1', date: '2026-10-19', fromPlace: 'Nephaven', fromCountry: 'NL', toPlace: 'Nepdorp', toCountry: 'NL', role: 'schipper', boat: 'Nepboot', windBft: '3-4', nmInland: 0, nmSea: 21.5, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'manual', updatedAt: T, deletedAt: null },
  ],
  'transactions.json.enc': [
    { id: 'upg-tx-1', date: '2026-10-20', kind: 'fooi', amount: 50, currency: 'EUR', source: 'yacht-week', tripId: 'upg-trip-1', tipFrom: { kind: 'personen', participantIds: ['upg-p-1', 'upg-p-2'], amounts: { 'upg-p-1': 30, 'upg-p-2': 20 } }, updatedAt: T, deletedAt: null },
    { id: 'upg-tx-2', date: '2026-10-21', kind: 'fooi', amount: 40, currency: 'EUR', source: 'yacht-week', tripId: 'upg-trip-1', tipFrom: { kind: 'groep' }, updatedAt: T, deletedAt: null },
  ],
  'settings.json.enc': [
    { id: 'settings', lastBoat: 'Nepboot', lastRole: 'schipper', lastCurrency: 'EUR', lastSource: 'yacht-week', yearGoalNm: 2500, orgFirst: { 'sailing-virgins': 3 }, orgAnswered: ['upg-trip-0'], updatedAt: T, deletedAt: null },
  ],
  'curricula.json.enc': [
    { id: 'upg-course-1', body: 'eigen', courseCode: 'NEP 1', name: { nl: 'Nepcursus', en: 'Fake course' }, groups: [{ id: 'g1', title: { nl: 'Nepdeel', en: 'Fake part' }, topics: [{ id: 't1', title: { nl: 'Nepknoop', en: 'Fake knot' }, kind: 'praktijk', examCritical: true }] }], source: 'eigen', updatedAt: T, deletedAt: null },
  ],
  'students.json.enc': [
    { id: 'upg-student-1', firstName: 'Nepanna', curriculumId: 'upg-course-1', level: 'beginner', progress: { t1: { status: 'geoefend', updatedAt: T } }, startedAt: '2026-10-18', weekId: 'upg-trip-1', updatedAt: T, deletedAt: null },
  ],
  'plans.json.enc': [
    { id: 'upg-plan-1', title: 'Nepplanning', startDate: '2026-10-18', dayCount: 2, tripId: 'upg-trip-1', groups: [{ id: 'pg1', name: 'Groep A', curriculumId: 'upg-course-1', level: 'beginner', studentIds: ['upg-student-1'] }], days: [{ date: '2026-10-18', blocks: [{ id: 'b1', slot: 'ochtend', groupIds: ['pg1'], topicIds: ['t1'], themeIds: ['g1'] }] }], updatedAt: T, deletedAt: null },
  ],
  'places.json.enc': [{ id: 'upg-place-1', name: 'Nephaven', lat: 52.1, lon: 4.3, country: 'NL', updatedAt: T, deletedAt: null }],
  'reminders.json.enc': [{ id: 'upg-rem-1', title: 'Nepdeadline', date: '2027-01-15', kind: 'deadline', doneAt: null, repeat: 'jaarlijks', updatedAt: T, deletedAt: null }],
  'calendar.json.enc': [
    { id: 'dag:2026-10-25', date: '2026-10-25', type: 'reis', travel: { from: 'Nepstad', to: 'Nephaven', flight: 'NP 123' }, note: 'Nepnotitie', updatedAt: T, deletedAt: null },
    { id: 'dag:2026-10-26', date: '2026-10-26', type: 'werk', boat: 'Andere nepboot', updatedAt: T, deletedAt: null },
  ],
  'checklists.json.enc': [
    { id: 'upg-list-1', title: { nl: 'Neplijst', en: 'Fake list' }, items: [{ id: 'i1', text: { nl: 'Nepvink', en: 'Fake tick' } }], tripTypes: ['skipper-charter'], source: 'eigen', updatedAt: T, deletedAt: null },
  ],
}
