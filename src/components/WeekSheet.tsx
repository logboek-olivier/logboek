import { Plus, Repeat, Route, Trash2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { formatDate, formatDateRange, formatMoney, formatNm, formatNumber } from '../format'
import { getLang, t, useLang } from '../i18n'
import { courseLabel, effectiveCurricula } from '../model/curricula'
import { deleteTrip } from '../model/edit'
import { addDays, parseAmount, totals } from '../model/money'
import { currentSettings } from '../model/settings'
import { previousTrip, routeDays, routeLine, routeTemplates, tripRoute } from '../model/routes'
import { BOAT_KINDS, ORGANISATIONS, STUDENT_LEVELS, todayIso, WEEK_TYPES, type BoatKind, type Organisation, type PlannedLeg, type StudentLevel, type Trip, type WeekType } from '../model/types'
import {
  boatProfile,
  closeWeek,
  feetToMetres,
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
import { IncompleteLine } from './Incomplete'
import { Sheet } from './Sheet'

// Nieuwe week starten (één scherm) en een week bewerken. Week afronden: samenvatting en review.

export function weekTypeLabel(type: WeekType): string {
  return t(`weekType.${type}`)
}

export function organisationLabel(org: Organisation): string {
  return t(`organisation.${org}`)
}

/**
 * `initial`: datums van een nieuwe trip (periode markeren in de agenda). Snel starten neemt dan alles over behalve de
 * datums.
 */
export function WeekSheet({ store, trip, notify, onClose, initial }: { store: Store; trip: Trip | null; notify: Notify; onClose: () => void; initial?: { startDate: string; dayCount: number } }) {
  const lang = useLang()
  const legs = store.get('legs.json.enc')
  const view = trip ? weekView(trip, legs) : null
  const curricula = effectiveCurricula(store.get('curricula.json.enc'))
  const trips = store.get('trips.json.enc')
  const { boats, areas, bases, charters } = suggestions(trips, legs)
  const [name, setName] = useState(trip?.name ?? '')
  const [type, setType] = useState<WeekType>(view?.type ?? 'training-geven')
  const [startDate, setStartDate] = useState(view?.startDate || initial?.startDate || todayIso())
  const [dayCount, setDayCount] = useState(String(view ? dayCountOf(view) : (initial?.dayCount ?? DEFAULT_WEEK_DAYS)))
  const [boat, setBoat] = useState(view?.boat ?? '')
  const [boatModel, setBoatModel] = useState(trip?.boatModel ?? '')
  const [boatLength, setBoatLength] = useState(trip?.boatLengthFt ? formatNumber(trip.boatLengthFt) : '')
  const [boatKind, setBoatKind] = useState<BoatKind | undefined>(trip?.boatKind)
  const [base, setBase] = useState(trip?.base ?? '')
  const [charter, setCharter] = useState(trip?.charter ?? '')
  const [filledFrom, setFilledFrom] = useState(false)
  const [area, setArea] = useState(trip?.area ?? '')
  const [organisation, setOrganisation] = useState<Organisation | ''>(trip?.organisation ?? '')
  const [rows, setRows] = useState<ParticipantInput[]>(() => [...(trip?.participants ?? []), { firstName: '' }])
  const [note, setNote] = useState(trip?.note ?? '')
  // Geplande etappes: undefined = ongewijzigd (bij bewerken blijft de bestaande planning staan).
  const [route, setRoute] = useState<PlannedLeg[] | undefined>(undefined)
  const [startedFrom, setStartedFrom] = useState<string | null>(null)
  const shownRoute = route ?? trip?.route ?? []
  const templates = trip ? [] : routeTemplates(trips, legs)
  // Bij een gemarkeerde periode: de trip vóór die periode (ook als die nog moet komen).
  const previous = trip ? null : previousTrip(trips, legs, initial ? addDays(initial.startDate, -1) : todayIso())
  const [busy, setBusy] = useState(false)
  // Niets is verplicht: een leeg of ongeldig aantal dagen wordt de standaard, ontbrekende bootgegevens geven "Onvolledig".
  const typedDays = Math.round(parseAmount(dayCount) ?? 0)
  const days = typedDays >= 1 ? Math.min(MAX_WEEK_DAYS, typedDays) : DEFAULT_WEEK_DAYS
  const lengthFt = parseAmount(boatLength)
  const missing = [
    !boat.trim() && t('boat.name'),
    !boatModel.trim() && t('boat.model'),
    !(lengthFt !== null && lengthFt > 0) && t('boat.lengthShort'),
    !base.trim() && t('boat.base'),
  ].filter((x): x is string => !!x)

  /** Bekende boot gekozen: model, lengte, soort, basis en charterbedrijf van de vorige trip met deze boot invullen. */
  function chooseBoat(value: string) {
    setBoat(value)
    const profile = boatProfile(trips, value, trip?.id)
    if (!profile) return
    const fill = (empty: boolean, value: string | undefined, set: (v: string) => void) => {
      if (!empty || !value) return false
      set(value)
      return true
    }
    const filled = [
      fill(!boatModel.trim(), profile.boatModel, setBoatModel),
      fill(!boatLength.trim(), profile.boatLengthFt ? formatNumber(profile.boatLengthFt) : undefined, setBoatLength),
      fill(!boatKind, profile.boatKind, (v) => setBoatKind(v as BoatKind)),
      fill(!base.trim(), profile.base, setBase),
      fill(!charter.trim(), profile.charter, setCharter),
    ].some(Boolean)
    setFilledFrom(filled)
  }

  /** Herhaal vorige trip of start vanuit een sjabloon: boot, gebied, organisatie, type en de geplande etappes. */
  function startFrom(source: Trip, plan: PlannedLeg[], label: string) {
    setStartedFrom(label)
    setRoute(plan)
    if (source.type) setType(source.type)
    setBoat(source.boat ?? '')
    setBoatModel(source.boatModel ?? '')
    setBoatLength(source.boatLengthFt ? formatNumber(source.boatLengthFt) : '')
    setBoatKind(source.boatKind)
    setBase(source.base ?? plan[0]?.from ?? '')
    setCharter(source.charter ?? '')
    setArea(source.area ?? '')
    setOrganisation(source.organisation ?? '')
    const planDays = routeDays(plan)
    if (planDays > 0 && !initial) setDayCount(String(planDays))
  }

  const setRow = (i: number, patch: Partial<ParticipantInput>) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r))
    // Altijd één lege regel onderaan: deelnemers één per regel invoeren.
    if (next.at(-1)?.firstName.trim()) next.push({ firstName: '' })
    setRows(next)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    const input = { name, type, startDate, dayCount: days, boat, boatModel, boatLengthFt: lengthFt, boatKind, base, charter, area, organisation: organisation || undefined, participants: rows, note, route }
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
        {(previous || templates.length > 0) && (
          <div className="stack-sm">
            <span className="label">{t('route.quickStart')}</span>
            <div className="type-buttons" role="group" aria-label={t('route.quickStart')}>
              {previous && (
                <button type="button" className={`chip${startedFrom === 'vorige' ? ' active' : ''}`} onClick={() => startFrom(previous, tripRoute(previous, legs), 'vorige')}>
                  <Icon icon={Repeat} />
                  {t('route.repeat')}
                </button>
              )}
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  className={`chip${startedFrom === tpl.id ? ' active' : ''}`}
                  onClick={() => startFrom(tpl.source, tpl.route, tpl.id)}
                >
                  <Icon icon={Route} />
                  {t('route.template', { label: tpl.label, n: tpl.times })}
                </button>
              ))}
            </div>
          </div>
        )}
        <label>
          {t('field.name')}
          <input type="text" autoComplete="off" maxLength={120} placeholder={defaultWeekName(startDate || todayIso(), lang, base)} value={name} onChange={(e) => setName(e.target.value)} />
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
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>
            {t('week.dayCount')}
            <input inputMode="numeric" autoComplete="off" value={dayCount} onChange={(e) => setDayCount(e.target.value)} />
          </label>
        </div>
        {startDate && <p className="muted small">{t('week.until', { date: formatDate(addDays(startDate, days - 1)) })}</p>}
        <fieldset className="boat-fields">
          <legend>{t('boat.title')}</legend>
          <div className="two">
            <label>
              {t('boat.name')}
              <input type="text" autoComplete="off" list="week-boats" maxLength={120} value={boat} onChange={(e) => chooseBoat(e.target.value)} />
              <datalist id="week-boats">
                {boats.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </label>
            <label>
              {t('boat.model')}
              <input type="text" autoComplete="off" maxLength={120} placeholder={t('boat.modelPlaceholder')} value={boatModel} onChange={(e) => setBoatModel(e.target.value)} />
            </label>
          </div>
          {filledFrom && <p className="muted small">{t('boat.fromEarlier')}</p>}
          <div className="two">
            <div className="stack-sm">
              <label>
                {t('boat.length')}
                <input inputMode="decimal" autoComplete="off" placeholder="42" value={boatLength} onChange={(e) => setBoatLength(e.target.value)} />
              </label>
              {lengthFt !== null && lengthFt > 0 && <span className="muted small">{t('boat.metres', { m: formatNumber(feetToMetres(lengthFt)) })}</span>}
            </div>
            <label>
              {t('boat.base')}
              <input type="text" autoComplete="off" list="week-bases" maxLength={120} placeholder={t('boat.basePlaceholder')} value={base} onChange={(e) => setBase(e.target.value)} />
              <datalist id="week-bases">
                {bases.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </label>
          </div>
          <div className="type-buttons" role="radiogroup" aria-label={t('boat.kind')}>
            {BOAT_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={boatKind === k} className={`chip${boatKind === k ? ' active' : ''}`} onClick={() => setBoatKind(boatKind === k ? undefined : k)}>
                {t(`boatKind.${k}`)}
              </button>
            ))}
          </div>
          <div className="two">
            <label>
              {t('boat.charter')}
              <input type="text" autoComplete="off" list="week-charters" maxLength={120} value={charter} onChange={(e) => setCharter(e.target.value)} />
              <datalist id="week-charters">
                {charters.map((c) => (
                  <option key={c} value={c} />
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
          {missing.length > 0 && <IncompleteLine missing={missing} />}
        </fieldset>
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
        {shownRoute.length > 0 && (
          <div className="notice-quiet route-plan">
            <span className="small">
              {t('route.planned', { n: shownRoute.length })}: {routeLine(shownRoute)}
            </span>
            <button type="button" className="btn link small" onClick={() => setRoute([])}>
              {t('route.clear')}
            </button>
          </div>
        )}
        <label>
          {t('field.note')}
          <input type="text" autoComplete="off" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={busy}>
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

/**
 * Trip afsluiten in een minuut: automatische samenvatting (dagen, nm, inkomsten in euro, studenten met resultaat), een
 * cijfer en één zin "wat leerde ik". De review van gasten (score en citaten) staat eronder, ingeklapt.
 */
export function CloseWeekSheet({ store, trip, notify, onClose }: { store: Store; trip: Trip; notify: Notify; onClose: () => void }) {
  const view = weekView(trip, store.get('legs.json.enc'))
  const students = store.get('students.json.enc')
  const curricula = effectiveCurricula(store.get('curricula.json.enc'))
  const transactions = store.get('transactions.json.enc').filter((tx) => tx.deletedAt === null && tx.tripId === trip.id)
  const money = totals(transactions)
  const lang = useLang()
  const [rating, setRating] = useState<number | undefined>(trip.review?.rating)
  const [lesson, setLesson] = useState(trip.review?.lesson ?? '')
  const [score, setScore] = useState(trip.review?.score !== undefined ? formatNumber(trip.review.score) : '')
  const [quotes, setQuotes] = useState((trip.review?.quotes ?? []).join('\n'))
  const [guests, setGuests] = useState(trip.review?.score !== undefined || (trip.review?.quotes ?? []).length > 0)
  const parsedScore = score.trim() === '' ? undefined : parseAmount(score)
  const ok = parsedScore !== null
  // Studenten van de trip: deelnemers met cursus en studenten die bij de trip horen.
  const participants = trip.participants ?? []
  const extra = students.filter((s) => s.deletedAt === null && s.weekId === trip.id && !participants.some((p) => p.id === s.id))
  const people = [...participants.map((p) => ({ id: p.id, firstName: p.firstName, level: p.level, curriculumId: p.curriculumId })), ...extra.map((s) => ({ id: s.id, firstName: s.firstName, level: s.level, curriculumId: s.curriculumId }))]

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok) return
    const settings = currentSettings(store.get('settings.json.enc'))
    const undo = await closeWeek(store, trip, { score: parsedScore ?? undefined, quotes: quotes.split('\n'), rating, lesson }, todayIso(), settings)
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
          {transactions.length > 0 && (
            <div className="stat">
              <dt>{t('week.income')}</dt>
              <dd className="stat-value">{formatMoney(money.incomeEur, 'EUR')}</dd>
            </div>
          )}
        </dl>
        {people.length > 0 && (
          <div className="stack-sm">
            <span className="label">{t('week.participants')}</span>
            <ul className="rows">
              {people.map((p) => {
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
        <div className="stack-sm">
          <span className="label">{t('close.rating')}</span>
          <div className="rating-buttons" role="radiogroup" aria-label={t('close.rating')}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rating === n} className={`chip${rating === n ? ' active' : ''}`} onClick={() => setRating(rating === n ? undefined : n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <label>
          {t('close.lesson')}
          <input type="text" autoComplete="off" maxLength={300} placeholder={t('close.lessonPlaceholder')} value={lesson} onChange={(e) => setLesson(e.target.value)} />
        </label>
        {guests ? (
          <>
            <label>
              {t('week.reviewScore')}
              <input inputMode="decimal" autoComplete="off" placeholder="9,4" value={score} onChange={(e) => setScore(e.target.value)} />
            </label>
            <label>
              {t('week.quotes')}
              <textarea rows={4} value={quotes} onChange={(e) => setQuotes(e.target.value)} />
            </label>
            <p className="muted small">{t('week.quotesHint')}</p>
          </>
        ) : (
          <button type="button" className="btn link" onClick={() => setGuests(true)}>
            {t('close.guestReview')}
          </button>
        )}
        <button className="btn primary" type="submit" disabled={!ok}>
          {t('week.closeSave')}
        </button>
      </form>
    </Sheet>
  )
}
