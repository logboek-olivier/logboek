import { Plus, Trash2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { formatDate, formatDateRange, formatNm, formatNumber } from '../format'
import { getLang, t, useLang } from '../i18n'
import { courseLabel, effectiveCurricula } from '../model/curricula'
import { deleteTrip } from '../model/edit'
import { addDays, parseAmount } from '../model/money'
import { currentSettings } from '../model/settings'
import { ORGANISATIONS, STUDENT_LEVELS, todayIso, WEEK_TYPES, type Organisation, type StudentLevel, type Trip, type WeekType } from '../model/types'
import {
  closeWeek,
  dayCountOf,
  DEFAULT_WEEK_DAYS,
  defaultWeekName,
  MAX_WEEK_DAYS,
  startWeek,
  suggestions,
  updateWeek,
  weekView,
  type ParticipantInput,
} from '../model/weeks'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

// Nieuwe week starten (één scherm) en een week bewerken. Week afronden: samenvatting en review.

export function weekTypeLabel(type: WeekType): string {
  return t(`weekType.${type}`)
}

export function organisationLabel(org: Organisation): string {
  return t(`organisation.${org}`)
}

export function WeekSheet({ store, trip, notify, onClose }: { store: Store; trip: Trip | null; notify: Notify; onClose: () => void }) {
  const lang = useLang()
  const legs = store.get('legs.json.enc')
  const view = trip ? weekView(trip, legs) : null
  const curricula = effectiveCurricula(store.get('curricula.json.enc'))
  const { boats, areas } = suggestions(store.get('trips.json.enc'), legs)
  const [name, setName] = useState(trip?.name ?? '')
  const [type, setType] = useState<WeekType>(view?.type ?? 'training-geven')
  const [startDate, setStartDate] = useState(view?.startDate || todayIso())
  const [dayCount, setDayCount] = useState(String(view ? dayCountOf(view) : DEFAULT_WEEK_DAYS))
  const [boat, setBoat] = useState(view?.boat ?? '')
  const [area, setArea] = useState(trip?.area ?? '')
  const [organisation, setOrganisation] = useState<Organisation | ''>(trip?.organisation ?? '')
  const [rows, setRows] = useState<ParticipantInput[]>(() => [...(trip?.participants ?? []), { firstName: '' }])
  const [note, setNote] = useState(trip?.note ?? '')
  const [busy, setBusy] = useState(false)
  const days = Math.round(parseAmount(dayCount) ?? 0)
  const ok = !!startDate && days >= 1 && days <= MAX_WEEK_DAYS

  const setRow = (i: number, patch: Partial<ParticipantInput>) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r))
    // Altijd één lege regel onderaan: deelnemers één per regel invoeren.
    if (next.at(-1)?.firstName.trim()) next.push({ firstName: '' })
    setRows(next)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok || busy) return
    setBusy(true)
    const input = { name, type, startDate, dayCount: days, boat, area, organisation: organisation || undefined, participants: rows, note }
    try {
      if (trip) {
        await updateWeek(store, trip, input, getLang())
        notify(t('toast.saved'))
      } else {
        await startWeek(store, input, getLang())
        notify(t('week.started'))
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!trip) return
    const undo = await deleteTrip(store, trip)
    onClose()
    notify(t('toast.deleted'), undo)
  }

  return (
    <Sheet title={trip ? t('week.edit') : t('week.new')} onClose={onClose}>
      <form className="stack week-form" onSubmit={(e) => void submit(e)}>
        <label>
          {t('field.name')}
          <input type="text" autoComplete="off" maxLength={120} placeholder={defaultWeekName(startDate || todayIso(), lang)} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="type-buttons" role="radiogroup" aria-label={t('week.type')}>
          {WEEK_TYPES.map((wt) => (
            <button key={wt} type="button" role="radio" aria-checked={type === wt} className={`chip${type === wt ? ' active' : ''}`} onClick={() => setType(wt)}>
              {weekTypeLabel(wt)}
            </button>
          ))}
        </div>
        {view?.typeSuggested && <p className="muted small">{t('week.typeSuggested')}</p>}
        <div className="two">
          <label>
            {t('week.startDate')}
            <input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>
            {t('week.dayCount')}
            <input inputMode="numeric" autoComplete="off" value={dayCount} onChange={(e) => setDayCount(e.target.value)} />
          </label>
        </div>
        {ok && <p className="muted small">{t('week.until', { date: formatDate(addDays(startDate, days - 1)) })}</p>}
        <div className="two">
          <label>
            {t('field.boat')}
            <input type="text" autoComplete="off" list="week-boats" value={boat} onChange={(e) => setBoat(e.target.value)} />
            <datalist id="week-boats">
              {boats.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>
          <label>
            {t('week.area')}
            <input type="text" autoComplete="off" list="week-areas" value={area} onChange={(e) => setArea(e.target.value)} />
            <datalist id="week-areas">
              {areas.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </label>
        </div>
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
        <fieldset className="participants">
          <legend>{t('week.participants')}</legend>
          <p className="muted small">{t('week.participantsHint')}</p>
          {rows.map((r, i) => (
            <div key={r.id ?? `nieuw-${i}`} className="participant-row">
              <input
                type="text"
                autoComplete="off"
                autoCapitalize="words"
                maxLength={40}
                aria-label={t('week.participantName', { n: i + 1 })}
                placeholder={t('students.firstName')}
                value={r.firstName}
                onChange={(e) => setRow(i, { firstName: e.target.value })}
              />
              <select aria-label={t('week.participantLevel', { n: i + 1 })} value={r.level ?? ''} onChange={(e) => setRow(i, { level: (e.target.value || undefined) as StudentLevel | undefined })}>
                <option value="">{t('students.level')}</option>
                {STUDENT_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {t(`level.${l}`)}
                  </option>
                ))}
              </select>
              <select aria-label={t('week.participantCourse', { n: i + 1 })} value={r.curriculumId ?? ''} onChange={(e) => setRow(i, { curriculumId: e.target.value || undefined })}>
                <option value="">{t('students.course')}</option>
                {curricula.map((c) => (
                  <option key={c.id} value={c.id}>
                    {courseLabel(c, lang)}
                  </option>
                ))}
              </select>
              {r.firstName.trim() !== '' && (
                <button type="button" className="btn icon" aria-label={t('week.removeParticipant', { name: r.firstName })} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <Icon icon={X} />
                </button>
              )}
            </div>
          ))}
        </fieldset>
        <label>
          {t('field.note')}
          <input type="text" autoComplete="off" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!ok || busy}>
            {trip ? (
              t('common.save')
            ) : (
              <>
                <Icon icon={Plus} />
                {t('week.start')}
              </>
            )}
          </button>
          {trip && (
            <button className="btn danger" type="button" onClick={() => void remove()}>
              <Icon icon={Trash2} />
              {t('trip.deleteWithDays')}
            </button>
          )}
        </div>
      </form>
    </Sheet>
  )
}

/** Week afronden: dagen, nm, deelnemers met resultaat, en de review (score en citaten). */
export function CloseWeekSheet({ store, trip, notify, onClose }: { store: Store; trip: Trip; notify: Notify; onClose: () => void }) {
  const view = weekView(trip, store.get('legs.json.enc'))
  const students = store.get('students.json.enc')
  const curricula = effectiveCurricula(store.get('curricula.json.enc'))
  const lang = useLang()
  const [score, setScore] = useState(trip.review?.score !== undefined ? formatNumber(trip.review.score) : '')
  const [quotes, setQuotes] = useState((trip.review?.quotes ?? []).join('\n'))
  const parsedScore = score.trim() === '' ? undefined : parseAmount(score)
  const ok = parsedScore !== null

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok) return
    const settings = currentSettings(store.get('settings.json.enc'))
    const undo = await closeWeek(store, trip, { score: parsedScore ?? undefined, quotes: quotes.split('\n') }, todayIso(), settings)
    onClose()
    notify(t('week.closed'), undo)
  }

  return (
    <Sheet title={t('week.close')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <p>
          <strong>{trip.name}</strong>
          <br />
          <span className="muted small">
            {view.startDate ? formatDateRange(view.startDate, view.endDate) : ''} · {weekTypeLabel(view.type)}
          </span>
        </p>
        <dl className="grid close-summary">
          <div className="stat">
            <dt>{t('week.sailedDays')}</dt>
            <dd className="stat-value">{formatNumber(view.days)}</dd>
          </div>
          <div className="stat">
            <dt>{t('week.nm')}</dt>
            <dd className="stat-value">{formatNm(view.nm)}</dd>
          </div>
        </dl>
        {(trip.participants ?? []).length > 0 && (
          <div className="stack-sm">
            <span className="label">{t('week.participants')}</span>
            <ul className="rows">
              {(trip.participants ?? []).map((p) => {
                const student = students.find((s) => s.id === p.id && s.deletedAt === null)
                const course = curricula.find((c) => c.id === (student?.curriculumId ?? p.curriculumId))
                const result = student?.exam ? t(student.exam.passed ? 'week.passed' : 'week.notPassed') : p.level ? t(`level.${p.level}`) : ''
                return (
                  <li key={p.id} className="row-item">
                    <span className="row-main">
                      <span>{p.firstName}</span>
                      <span className="muted small">{[course ? courseLabel(course, lang) : '', result].filter(Boolean).join(' · ')}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        <label>
          {t('week.reviewScore')}
          <input inputMode="decimal" autoComplete="off" placeholder="9,4" value={score} onChange={(e) => setScore(e.target.value)} />
        </label>
        <label>
          {t('week.quotes')}
          <textarea rows={4} value={quotes} onChange={(e) => setQuotes(e.target.value)} />
        </label>
        <p className="muted small">{t('week.quotesHint')}</p>
        <button className="btn primary" type="submit" disabled={!ok}>
          {t('week.closeSave')}
        </button>
      </form>
    </Sheet>
  )
}
