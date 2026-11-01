import { CalendarPlus, ChevronDown } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { formatDateRange } from '../format'
import { getLang, t } from '../i18n'
import { newTripName } from '../model/counters'
import { currentSettings } from '../model/settings'
import { tripOverlaps, type Overlap } from '../model/trip-ops'
import { ORGANISATIONS, WEEK_TYPES, type Organisation, type Trip, type WeekType } from '../model/types'
import { latestTripBefore, MAX_WEEK_DAYS, nextFreeDay, suggestTripName } from '../model/weeks'
import { periodeMaken } from '../domain/trips'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { OverlapSheet } from './TripSheets'
import { useCollection } from './useCollection'
import { organisationLabel, WeekSheet, weekTypeLabel } from './WeekSheet'
import { addDays, daysBetween, todayIso } from '../basis/datum'

// Toevoegen → Trip: snel een trip in de planning zetten. Alleen startdatum en einddatum zijn nodig, dan Opslaan.
// Naam en type krijgen een voorstel uit de vorige trip; organisatie, boot, gebied en deelnemers zijn optioneel en later
// aan te vullen (Deze trip, Logboek of de agenda). Overlapt de nieuwe trip een bestaande, dan dezelfde keuze als bij
// overlappende trips: samenvoegen, vervangen of de datums aanpassen.

export function TripForm({ store, onDone, notify }: { store: Store; onDone: (message: string) => void; notify: Notify }) {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const today = todayIso()
  const [start, setStart] = useState(() => nextFreeDay(trips, legs, today))
  const [end, setEnd] = useState(() => addDays(nextFreeDay(trips, legs, today), 6))
  const [endTouched, setEndTouched] = useState(false)
  const previous = latestTripBefore(trips, legs, addDays(start, -1))
  const [typeChoice, setType] = useState<WeekType | null>(null)
  const type = typeChoice ?? previous?.type ?? 'training-geven'
  const [name, setName] = useState('')
  const [more, setMore] = useState(false)
  // Organisatie en gebied volgen de vorige trip zolang Olivier niets anders kiest (zichtbaar onder Meer).
  const [orgChoice, setOrganisation] = useState<Organisation | '' | null>(null)
  const organisation = orgChoice ?? previous?.organisation ?? ''
  const [boat, setBoat] = useState('')
  const [areaChoice, setArea] = useState<string | null>(null)
  const area = areaChoice ?? previous?.area ?? ''
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  // Voorstel: "SV #4 · BVI" bij een getelde organisatie, anders uit de naam van de vorige trip.
  const suggestion = newTripName(trips, legs, settings, organisation, start, area, suggestTripName(previous, start, getLang()))
  const [people, setPeople] = useState('')
  const [busy, setBusy] = useState(false)
  const [overlap, setOverlap] = useState<Overlap | null>(null)
  const [editing, setEditing] = useState<Trip | null>(null)
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && end >= start && daysBetween(start, end) < MAX_WEEK_DAYS

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    try {
      const { result: trip } = await periodeMaken(
        store,
        {
          name: name.trim() || suggestion,
          type,
          startDate: start,
          dayCount: daysBetween(start, end) + 1,
          boat,
          boatModel: '',
          boatLengthFt: null,
          base: '',
          charter: '',
          area,
          ...(organisation ? { organisation } : {}),
          // Alleen voornamen, één per regel (regel 14); land of kenmerk kan later bij de deelnemer.
          participants: people.split(/[\n,]/).map((firstName) => ({ firstName })),
          note: '',
        },
        getLang(),
      )
      const found = tripOverlaps(store.list('trips.json.enc'), store.list('legs.json.enc')).find((o) => o.a.id === trip.id || o.b.id === trip.id)
      if (found) setOverlap(found)
      else onDone(t('week.started'))
    } finally {
      setBusy(false)
    }
  }

  if (editing) return <WeekSheet store={store} trip={editing} notify={notify} onClose={() => onDone(t('week.started'))} />
  if (overlap) {
    return (
      <OverlapSheet
        store={store}
        overlap={overlap}
        notify={notify}
        onClose={() => onDone(t('week.started'))}
        onEditTrip={(trip) => {
          setOverlap(null)
          setEditing(trip)
        }}
      />
    )
  }

  return (
    <form className="stack quick-trip" onSubmit={(e) => void save(e)}>
      <div className="two">
        <label>
          {t('trip.start')}
          <input
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value)
              // Zolang Olivier de einddatum niet zelf koos, blijft de trip even lang.
              if (!endTouched && /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setEnd(addDays(e.target.value, daysBetween(start, end)))
            }}
          />
        </label>
        <label>
          {t('trip.end')}
          <input
            type="date"
            value={end}
            min={start}
            onChange={(e) => {
              setEnd(e.target.value)
              setEndTouched(true)
            }}
          />
        </label>
      </div>
      {valid && <p className="muted small">{`${formatDateRange(start, end)} · ${t('unit.days', { n: daysBetween(start, end) + 1 })}`}</p>}
      <label>
        {t('field.name')}
        <input type="text" autoComplete="off" maxLength={120} value={name} placeholder={suggestion} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="type-buttons" role="radiogroup" aria-label={t('week.type')}>
        {WEEK_TYPES.map((w) => (
          <button key={w} type="button" role="radio" aria-checked={type === w} className={`chip${type === w ? ' active' : ''}`} onClick={() => setType(w)}>
            {weekTypeLabel(w)}
          </button>
        ))}
      </div>
      <button type="button" className="btn link more-fields" aria-expanded={more} onClick={() => setMore(!more)}>
        <Icon icon={ChevronDown} className="chevron" />
        {t('common.more')}
      </button>
      {more && (
        <div className="stack">
          <label>
            {t('week.organisation')}
            <select value={organisation} onChange={(e) => setOrganisation(e.target.value as Organisation | '')}>
              <option value="">{t('week.noOrganisation')}</option>
              {ORGANISATIONS.map((o) => (
                <option key={o} value={o}>
                  {organisationLabel(o)}
                </option>
              ))}
            </select>
          </label>
          <div className="two">
            <label>
              {t('boat.name')}
              <input type="text" autoComplete="off" maxLength={120} value={boat} onChange={(e) => setBoat(e.target.value)} />
            </label>
            <label>
              {t('week.area')}
              <input type="text" autoComplete="off" maxLength={120} value={area} onChange={(e) => setArea(e.target.value)} />
            </label>
          </div>
          <label>
            {t('quick.tripPeople')}
            <textarea rows={3} autoComplete="off" autoCapitalize="words" value={people} onChange={(e) => setPeople(e.target.value)} />
            <span className="muted small">{t('quick.tripPeopleHint')}</span>
          </label>
        </div>
      )}
      <p className="muted small">{t('quick.tripLater')}</p>
      <button className="btn primary" type="submit" disabled={!valid || busy}>
        <Icon icon={CalendarPlus} />
        {t('common.save')}
      </button>
    </form>
  )
}
