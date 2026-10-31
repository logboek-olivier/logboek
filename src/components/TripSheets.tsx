import { CalendarRange, Merge, Replace, TriangleAlert, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { formatDateRange } from '../format'
import { t, useLang } from '../i18n'
import { tripRange } from '../model/calendar'
import { courseLabel, effectiveCurricula } from '../model/curricula'
import { MAX_COUNTRY, MAX_TAG, participantName } from '../model/guests'
import { tripDependents, type Overlap } from '../model/trip-ops'
import { STUDENT_LEVELS, type Participant, type StudentLevel, type Trip } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { deelnemerVerwijderen, deelnemerWijzigen, periodeVervangen, samenvoegen } from '../domain/trips'

// Onderdelen voor trips: overlappende trips oplossen, en één deelnemer bewerken of verwijderen. Een periode verwijderen
// staat onder "⋯" op de periodepagina (src/components/PeriodMenu.tsx).

function tripLabel(store: Store, trip: Trip): string {
  const range = tripRange(trip, store.list('legs.json.enc'))
  return range ? `${trip.name} · ${formatDateRange(range.start, range.end)}` : trip.name
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
  // Vooraf zichtbaar wat er verhuist (nooit dagen of geld van een andere periode opslokken zonder dat te zien).
  const deps = tripDependents(store, other)
  const moving = [
    deps.legs.length > 0 && t('trip.part.legs', { n: deps.legs.length }),
    deps.transactions.length > 0 && t('trip.part.transactions', { n: deps.transactions.length }),
    deps.participants.length > 0 && t('trip.part.participants', { n: deps.participants.length }),
  ].filter((x): x is string => !!x)
  const keepRange = tripRange(keep, legs)
  const otherRange = tripRange(other, legs)
  const merged = keepRange && otherRange ? { start: keepRange.start < otherRange.start ? keepRange.start : otherRange.start, end: keepRange.end > otherRange.end ? keepRange.end : otherRange.end } : (keepRange ?? otherRange)
  const outside = keepRange ? deps.legs.filter((l) => l.date < keepRange.start || l.date > keepRange.end).length : 0

  async function run(kind: 'merge' | 'replace') {
    if (busy) return
    setBusy(true)
    try {
      const undo = kind === 'merge' ? await samenvoegen(store, keep, other) : await periodeVervangen(store, keep, other)
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
        <p className="small overlap-preview">
          {moving.length > 0 ? t('overlap.moves', { parts: moving.join(', '), other: other.name, keep: keep.name }) : t('overlap.movesNothing', { other: other.name })}
          {merged ? ` ${t('overlap.mergedRange', { keep: keep.name, range: formatDateRange(merged.start, merged.end) })}` : ''}
        </p>
        <button type="button" className="btn" disabled={busy} onClick={() => void run('replace')}>
          <Icon icon={Replace} />
          {t('overlap.replace')}
        </button>
        <p className="muted small">{t('overlap.replaceHint', { keep: keep.name, other: other.name })}</p>
        {outside > 0 && <p className="small overlap-preview">{t('overlap.outside', { n: outside, keep: keep.name })}</p>}
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
      await deelnemerWijzigen(store, trip, participant.id, next)
      onClose()
      notify(t('toast.saved'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const undo = await deelnemerVerwijderen(store, trip, participant.id)
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
