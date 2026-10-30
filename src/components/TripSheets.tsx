import { CalendarRange, Merge, Replace, Trash2, TriangleAlert, Users } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { formatDateRange } from '../format'
import { t, useLang } from '../i18n'
import { tripRange } from '../model/calendar'
import { courseLabel, effectiveCurricula } from '../model/curricula'
import { active } from '../model/derive'
import { MAX_COUNTRY, MAX_TAG, participantName } from '../model/guests'
import { changeParticipant, deleteTripWith, hasDependents, mergeTrips, replaceTrip, tripDependents, type Overlap } from '../model/trip-ops'
import { STUDENT_LEVELS, type Participant, type StudentLevel, type Trip } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

// Vast patroon voor alles: tikken opent bewerken met alle velden; onderaan "Verwijderen", daarna 10 seconden
// "Ongedaan maken". Hier de onderdelen voor trips: verwijderen met de keuze wat er met dagen, inkomsten en deelnemers
// gebeurt, overlappende trips oplossen, en één deelnemer bewerken of verwijderen.

function list(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} ${t('common.and')} ${parts[parts.length - 1]}`
}

/** Andere trips, dichtstbij in tijd eerst (meestal is de trip ervoor of erna de bedoeling). */
function otherTrips(store: Store, trip: Trip): Trip[] {
  const legs = store.list('legs.json.enc')
  const start = tripRange(trip, legs)?.start ?? ''
  const distance = (x: Trip) => {
    const s = tripRange(x, legs)?.start
    return s && start ? Math.abs(Date.parse(s) - Date.parse(start)) : Number.MAX_SAFE_INTEGER
  }
  return active(store.get('trips.json.enc'))
    .filter((x) => x.id !== trip.id)
    .sort((a, b) => distance(a) - distance(b))
}

function tripLabel(store: Store, trip: Trip): string {
  const range = tripRange(trip, store.list('legs.json.enc'))
  return range ? `${trip.name} · ${formatDateRange(range.start, range.end)}` : trip.name
}

/**
 * Trip verwijderen. Hangt er niets aan, dan direct (met ongedaan maken); anders eerst de keuze: "Meenemen naar trip …"
 * of "Ook verwijderen".
 */
export function DeleteTrip({ store, trip, notify, onDone }: { store: Store; trip: Trip; notify: Notify; onDone: () => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const deps = tripDependents(store, trip)
  const others = otherTrips(store, trip)
  const [target, setTarget] = useState(others[0]?.id ?? '')
  const choice = useRef<HTMLDivElement>(null)
  // De keuze staat onderaan een lang blad: direct in beeld brengen.
  useEffect(() => {
    if (asking) choice.current?.scrollIntoView({ block: 'nearest' })
  }, [asking])

  async function run(moveTo: Trip | null) {
    if (busy) return
    setBusy(true)
    try {
      const undo = await deleteTripWith(store, trip, moveTo)
      onDone()
      notify(moveTo ? t('trip.deletedMoved', { name: moveTo.name }) : t('trip.deleted'), undo)
    } finally {
      setBusy(false)
    }
  }

  if (!asking) {
    return (
      <button className="btn danger" type="button" disabled={busy} onClick={() => (hasDependents(deps) ? setAsking(true) : void run(null))}>
        <Icon icon={Trash2} />
        {t('trip.delete')}
      </button>
    )
  }
  const parts = [
    deps.legs.length > 0 && t('trip.part.legs', { n: deps.legs.length }),
    deps.transactions.length > 0 && t('trip.part.transactions', { n: deps.transactions.length }),
    deps.participants.length > 0 && t('trip.part.participants', { n: deps.participants.length }),
    deps.students.length > 0 && t('trip.part.students', { n: deps.students.length }),
    deps.plans.length > 0 && t('trip.part.plans', { n: deps.plans.length }),
    deps.claims.length > 0 && t('trip.part.claims', { n: deps.claims.length }),
  ].filter((x): x is string => !!x)
  return (
    <div ref={choice} className="stack-sm delete-choice" role="group" aria-label={t('trip.delete')}>
      <p>{t('trip.deleteWhat', { parts: list(parts) })}</p>
      {others.length > 0 && (
        <>
          <label>
            {t('trip.moveTo')}
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {tripLabel(store, o)}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" type="button" disabled={busy || !target} onClick={() => void run(others.find((o) => o.id === target) ?? null)}>
            {t('trip.moveAndDelete')}
          </button>
        </>
      )}
      <button className="btn danger" type="button" disabled={busy} onClick={() => void run(null)}>
        <Icon icon={Trash2} />
        {t('trip.deleteAll')}
      </button>
      <button className="btn link" type="button" onClick={() => setAsking(false)}>
        {t('common.cancel')}
      </button>
    </div>
  )
}

/** Meldingen bij trips die op dezelfde dagen liggen, met een knop die de keuze opent. */
export function OverlapNotices({ store, overlaps, notify, onEditTrip }: { store: Store; overlaps: readonly Overlap[]; notify: Notify; onEditTrip: (trip: Trip) => void }) {
  const [open, setOpen] = useState<Overlap | null>(null)
  if (overlaps.length === 0) return null
  return (
    <>
      {overlaps.map((o) => (
        <div key={`${o.a.id}|${o.b.id}`} className="notice overlap-notice" role="alert">
          <span>
            <Icon icon={TriangleAlert} />
            {t('overlap.notice', { a: o.a.name, b: o.b.name, dates: formatDateRange(o.from, o.to) })}
          </span>
          <button type="button" className="btn small" onClick={() => setOpen(o)}>
            {t('overlap.resolve')}
          </button>
        </div>
      ))}
      {open && (
        <OverlapSheet
          store={store}
          overlap={open}
          notify={notify}
          onClose={() => setOpen(null)}
          onEditTrip={(trip) => {
            setOpen(null)
            onEditTrip(trip)
          }}
        />
      )}
    </>
  )
}

/** Samenvoegen, vervangen of de datums aanpassen; welke trip blijft, kiest Olivier (standaard die met de meeste dagen). */
export function OverlapSheet({ store, overlap, notify, onClose, onEditTrip }: { store: Store; overlap: Overlap; notify: Notify; onClose: () => void; onEditTrip: (trip: Trip) => void }) {
  const legs = store.list('legs.json.enc')
  const days = (trip: Trip) => legs.filter((l) => l.tripId === trip.id).length
  const [keepId, setKeepId] = useState(days(overlap.b) > days(overlap.a) ? overlap.b.id : overlap.a.id)
  const [busy, setBusy] = useState(false)
  const keep = keepId === overlap.a.id ? overlap.a : overlap.b
  const other = keep === overlap.a ? overlap.b : overlap.a

  async function run(kind: 'merge' | 'replace') {
    if (busy) return
    setBusy(true)
    try {
      const undo = kind === 'merge' ? await mergeTrips(store, keep, other) : await replaceTrip(store, keep, other)
      onClose()
      notify(t(kind === 'merge' ? 'overlap.merged' : 'overlap.replaced', { name: keep.name }), undo)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={t('overlap.title')} onClose={onClose}>
      <div className="stack">
        <p className="muted">{t('overlap.notice', { a: overlap.a.name, b: overlap.b.name, dates: formatDateRange(overlap.from, overlap.to) })}</p>
        <div className="stack-sm" role="radiogroup" aria-label={t('overlap.keep')}>
          <span className="small">{t('overlap.keep')}</span>
          {[overlap.a, overlap.b].map((trip) => (
            <button key={trip.id} type="button" role="radio" aria-checked={keepId === trip.id} className={`choice${keepId === trip.id ? ' active' : ''}`} onClick={() => setKeepId(trip.id)}>
              <span>{tripLabel(store, trip)}</span>
              <span className="muted small">{t('trip.part.legs', { n: days(trip) })}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void run('merge')}>
          <Icon icon={Merge} />
          {t('overlap.merge')}
        </button>
        <p className="muted small">{t('overlap.mergeHint', { keep: keep.name, other: other.name })}</p>
        <button type="button" className="btn" disabled={busy} onClick={() => void run('replace')}>
          <Icon icon={Replace} />
          {t('overlap.replace')}
        </button>
        <p className="muted small">{t('overlap.replaceHint', { keep: keep.name, other: other.name })}</p>
        <button type="button" className="btn" disabled={busy} onClick={() => onEditTrip(other)}>
          <Icon icon={CalendarRange} />
          {t('overlap.dates', { name: other.name })}
        </button>
      </div>
    </Sheet>
  )
}

/** Eén deelnemer: alle velden, en onderaan verwijderen (met ongedaan maken). Alleen voornaam, land en kort kenmerk (regel 14). */
export function ParticipantSheet({ store, trip, participant, notify, onClose }: { store: Store; trip: Trip; participant: Participant; notify: Notify; onClose: () => void }) {
  const lang = useLang()
  const curricula = effectiveCurricula(store.get('curricula.json.enc'))
  const [firstName, setFirstName] = useState(participant.firstName)
  const [country, setCountry] = useState(participant.country ?? '')
  const [tag, setTag] = useState(participant.tag ?? '')
  const [level, setLevel] = useState<StudentLevel | ''>(participant.level ?? '')
  const [course, setCourse] = useState(participant.curriculumId ?? '')
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy || !firstName.trim()) return
    setBusy(true)
    try {
      const { country: _c, tag: _t, level: _l, curriculumId: _k, guestId, ...rest } = participant
      void [_c, _t, _l, _k]
      const sameGuest = firstName.trim().toLowerCase() === participant.firstName.toLowerCase() && country.trim().toLowerCase() === (participant.country ?? '').toLowerCase()
      const next: Participant = {
        ...rest,
        firstName: firstName.trim().slice(0, 40),
        ...(country.trim() ? { country: country.trim().slice(0, MAX_COUNTRY) } : {}),
        ...(tag.trim() ? { tag: tag.trim().slice(0, MAX_TAG) } : {}),
        ...(level ? { level } : {}),
        ...(course ? { curriculumId: course } : {}),
        // Andere naam of ander land: niet meer dezelfde gast (de vraag over een terugkerende gast komt dan opnieuw).
        ...(guestId && sameGuest ? { guestId } : {}),
      }
      await changeParticipant(store, trip, participant.id, next)
      onClose()
      notify(t('toast.saved'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const undo = await changeParticipant(store, trip, participant.id, null)
    onClose()
    notify(t('participant.removed', { name: participantName(participant, trip.participants ?? []) }), undo)
  }

  return (
    <Sheet title={t('participant.edit')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void save(e)}>
        <label>
          {t('students.firstName')}
          <input type="text" autoComplete="off" autoCapitalize="words" maxLength={40} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </label>
        <div className="two">
          <label>
            {t('guest.country')}
            <input type="text" autoComplete="off" autoCapitalize="words" maxLength={MAX_COUNTRY} value={country} onChange={(e) => setCountry(e.target.value)} />
          </label>
          <label>
            {t('guest.tag')}
            <input type="text" autoComplete="off" maxLength={MAX_TAG} value={tag} onChange={(e) => setTag(e.target.value)} />
          </label>
        </div>
        <div className="two">
          <label>
            {t('students.level')}
            <select value={level} onChange={(e) => setLevel(e.target.value as StudentLevel | '')}>
              <option value="">–</option>
              {STUDENT_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(`level.${l}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('students.course')}
            <select value={course} onChange={(e) => setCourse(e.target.value)}>
              <option value="">–</option>
              {curricula.map((c) => (
                <option key={c.id} value={c.id}>
                  {courseLabel(c, lang)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={busy || !firstName.trim()}>
            {t('common.save')}
          </button>
          <button className="btn danger" type="button" onClick={() => void remove()}>
            <Icon icon={Users} />
            {t('participant.remove')}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
