// De gouden dataset: een verzonnen mijlenregistratie met dezelfde opbouw als die van Olivier (samenvattingsregels, een
// kopregel, lege rijen tussen tochten, lege datums, meerdere etappes op één dag, tochten met dezelfde naam), ongeveer
// 157 dagen in 33 tochten. Alles is verzonnen en vast (geen toeval), zodat elke test dezelfde gegevens ziet.

export interface GoldenTrip {
  name: string
  start: string
  boat: string
  /** Etappes per dag: [van, naar, nm, rol][] per dag. */
  days: Array<Array<[string, string, number, string]>>
  /** Lege datum (geschat) op deze dagnummers (vanaf de tweede dag). */
  blankDates?: number[]
}

const PLACES = ['Nephaven', 'Nepbaai', 'Neppunt', 'Nepdorp', 'Nepeiland', 'Nepkaap', 'Nepmonde', 'Nepkreek', 'Nepsteiger', 'Nepzand']
const NAMES = [
  'Amorgos trainingsweek',
  'Zeilvakantie fam',
  'Joepie zeilweekend',
  'Digni zeilweekend',
  'Yacht week nep 1',
  'Yacht week nep 2',
  'Nep overtocht',
  'Clubweekend',
  'Joepie zeilweekend',
  'Nep cursusweek',
  'Clubweekend',
]

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 33 tochten tussen april 2023 en december 2025, elk 2 tot 9 dagen, samen ongeveer 157 dagen. */
export function goldenTrips(): GoldenTrip[] {
  const trips: GoldenTrip[] = []
  let start = '2023-04-08'
  for (let i = 0; i < 33; i++) {
    const length = 2 + ((i * 7) % 8) // 2..9
    const days: GoldenTrip['days'] = []
    for (let d = 0; d < length; d++) {
      const from = PLACES[(i + d) % PLACES.length]!
      const to = PLACES[(i + d + 1) % PLACES.length]!
      const role = i % 5 === 0 ? 'Trainee' : i % 3 === 0 ? 'Co-schipper' : 'Schipper'
      const legs: Array<[string, string, number, string]> = [[from, to, 8 + ((i + d) % 13), role]]
      // Soms twee etappes op één dag.
      if ((i + d) % 6 === 0) legs.push([to, PLACES[(i + d + 3) % PLACES.length]!, 4 + (d % 5), role])
      days.push(legs)
    }
    trips.push({
      name: `${NAMES[i % NAMES.length]!}${i >= NAMES.length * 2 ? ` ${Math.floor(i / NAMES.length)}` : ''}`,
      start,
      boat: `Nepboot ${String.fromCharCode(65 + (i % 9))} (Nepmodel ${30 + (i % 15)})`,
      days,
      blankDates: i % 4 === 1 && length > 2 ? [1] : [],
    })
    // Tussen de tochten 6 tot 40 dagen.
    start = addDays(start, length + 6 + ((i * 11) % 35))
  }
  return trips
}

/** Datum van dag `d` van een tocht. */
export function goldenDate(trip: GoldenTrip, d: number): string {
  return addDays(trip.start, d)
}

/** De CSV zoals Olivier hem uit Excel opslaat (`;`, d-m-jjjj, lege rijen tussen tochten). */
export function goldenCsv(): string {
  const header = 'Datum;Van (plaats);Van (land);Naar (plaats);Naar (land);Rol;Schip;Schipper/trainer;Co-schipper (flot.leider);Wind (bft);Binnenwater;Zee;Zee (getijnavigatie);Totaal;Nacht-uren;Bijzonderheden'
  const lines = [';;;;;;;;;Schipper;100;;;;;', ';;;;;;;;;Co-schipper;50;;;;;', ';;;;;;;;;Trainee;20;;;;;', ';;;;;;;;;Totaal;170;;;;;', '', header]
  const dmy = (iso: string) => `${Number(iso.slice(8, 10))}-${Number(iso.slice(5, 7))}-${iso.slice(0, 4)}`
  for (const trip of goldenTrips()) {
    trip.days.forEach((legs, d) => {
      legs.forEach((leg, n) => {
        const [from, to, nm, role] = leg
        const blank = n > 0 || (trip.blankDates ?? []).includes(d)
        const date = blank ? '' : dmy(goldenDate(trip, d))
        const notes = d === 0 && n === 0 ? trip.name : ''
        lines.push([date, from, 'NL', to, 'NL', role, trip.boat, '', '', '3-4', '', String(nm), '', String(nm), '0', notes].join(';'))
      })
    })
    lines.push('')
  }
  return lines.join('\r\n')
}

/** Aantal dagen (datums) en etappes in de dataset. */
export function goldenCounts(): { trips: number; legs: number } {
  const trips = goldenTrips()
  return { trips: trips.length, legs: trips.reduce((s, t) => s + t.days.reduce((x, d) => x + d.length, 0), 0) }
}
