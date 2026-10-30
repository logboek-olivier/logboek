import { Eye, EyeOff, ListChecks, Pencil, Plus, Users } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { formatDate, formatDateRange, formatMoney } from '../format'
import { t, useLang } from '../i18n'
import { kindLabel } from '../i18n/labels'
import { addChecklist, checkedItems, checklistsFor, effectiveChecklists } from '../model/checklists'
import { nameWithCounter } from '../model/counters'
import { courseLabel, effectiveCurricula, localized } from '../model/curricula'
import { active, totalNm } from '../model/derive'
import { answerReturning, guestLabel, participantName, returningGuests } from '../model/guests'
import { stayName, type Period } from '../model/periods'
import { eurValue, getRates, subscribeRates } from '../model/rates'
import { fixLegOutside, legOutsideCanExtend } from '../model/review'
import { splitLegs } from '../model/leg-trip'
import { activeStudents } from '../model/students'
import { tripOverlaps } from '../model/trip-ops'
import { daysBetween } from '../model/calendar'
import { todayIso, type Leg, type Participant, type StayPeriod, type Transaction, type Trip, type WeekType } from '../model/types'
import { missingDays, needsClosing, planWeek, studentWeek, weekView } from '../model/weeks'
import { useIsDemo } from './DemoBar'
import { openStudent } from '../navigation'
import { PlansView } from '../screens/Planning'
import { StudentRow, StudentsView } from '../screens/Students'
import type { AddInit } from '../screens/QuickAdd'
import type { Store } from '../storage/store'
import { ChecklistSheet, NewChecklistButton } from './ChecklistSheet'
import { TripClaims } from './Claims'
import { LegSheet, type Notify } from './EditSheets'
import { Icon } from './Icon'
import { PeriodMoneyAddSheet, type MoneyAdd } from './PeriodMoneyAdd'
import { OverlapNotices } from './TripSheets'
import { TripHead, TripRouteSection } from './TripOverview'
import { TripMoneySection } from './TripMoney'
import { useCollection } from './useCollection'
import { useCounters } from './useCounters'
import { LegView, ParticipantView, TransactionView } from './Views'
import { CloseWeekSheet, WeekSheet } from './WeekSheet'
import { formatNm } from '../format'

// Eén periodepagina, overal hetzelfde (Deze trip, het tripoverzicht uit de agenda, het Logboek, Vandaag en de lijst met
// periodes), in een vaste volgorde: Overzicht · Route en dagen · Mensen · Planning · Geld · Notities en terugblik. Een
// onderdeel staat er alleen als het bij de soort past (docs/PERIODEMODEL.md). Bewerken via het potlood: de periode met
// zijn gelogde dagen.

export interface PeriodPageProps {
  store: Store
  period: Period
  notify: Notify
  /** 'page' = Deze trip (planning en checklists van studenten volledig); 'sheet' = in een onderblad. */
  mode: 'page' | 'sheet'
  /** Toevoegen → Dag op een datum in deze periode. */
  onAddDay?: (init: AddInit) => void
  /** Potlood in de kop (in een onderblad staat het potlood in de kop van het blad). */
  onEdit?: () => void
  /** Planning of student open (volledig scherm in Deze trip): de andere onderdelen wijken. */
  planOpen?: boolean
  studentOpen?: boolean
  onPlanDetail?: (open: boolean) => void
  onStudentDetail?: (open: boolean) => void
}

const noop = () => undefined

export function PeriodPage(props: PeriodPageProps) {
  return props.period.view ? <WaterPeriod {...props} trip={props.period.view.trip} /> : props.period.stay ? <LandPeriod {...props} stay={props.period.stay} /> : null
}

function WaterPeriod({ store, notify, mode, onAddDay, onEdit, planOpen = false, studentOpen = false, onPlanDetail, onStudentDetail, trip: given }: PeriodPageProps & { trip: Trip }) {
  const detail = planOpen || studentOpen
  const lang = useLang()
  const demo = useIsDemo()
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const plans = useCollection(store, 'plans.json.enc')
  const students = useCollection(store, 'students.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const curricula = effectiveCurricula(useCollection(store, 'curricula.json.enc'))
  const counters = useCounters(store)
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [otherTrip, setOtherTrip] = useState<Trip | null>(null)
  const [closing, setClosing] = useState(false)
  const [adding, setAdding] = useState<MoneyAdd | null>(null)
  const trip = trips.find((x) => x.id === given.id) ?? given
  const live = active(legs)
  const full = weekView(trip, live)
  const { inside, outside } = splitLegs(trip, live)
  // De route en de dagen: alleen wat binnen de datums van de trip valt.
  const view = { ...full, legs: inside, days: inside.length, nm: Math.round(inside.reduce((n, l) => n + totalNm(l), 0) * 10) / 10 }
  const counter = counters.get(trip.id)
  const today = todayIso()
  const people = trip.participants ?? []
  const returning = returningGuests(trip, trips, legs)
  const missing = missingDays(view, today)
  const nextDay = missing[0] ?? (view.endDate && today > view.endDate ? view.endDate : today)
  const teaching = view.kind === 'werk' && view.type === 'training-geven'
  const tripStudents = activeStudents(students).filter((st) => studentWeek(st, trips, legs) === trip.id)
  const ownPlans = plans.filter((p) => p.deletedAt === null && planWeek(p, trips, legs) === trip.id)
  const hasCourses = people.some((p) => p.curriculumId) || teaching || tripStudents.length > 0
  const Heading = mode === 'page' ? 'h2' : 'h3'
  const hasMoney = !!trip.salary || transactions.some((tx) => tx.deletedAt === null && tx.tripId === trip.id)

  return (
    <div className="stack-lg period-page">
      {!detail && (
        <>
          {/* 1. Overzicht */}
          <TripHead view={view} counter={counter} legs={legs} compact={mode === 'sheet'} onEdit={onEdit} />
          <OverlapNotices store={store} overlaps={tripOverlaps(trips, legs).filter((o) => o.a.id === trip.id || o.b.id === trip.id)} notify={notify} onEditTrip={setOtherTrip} />
          {missing.length > 0 && onAddDay && (
            <div className="notice">
              <p className="small">{t('trip.missingDays', { n: missing.length })}</p>
              <button className="btn small primary" onClick={() => onAddDay({ date: missing[0]!, tripId: trip.id })}>
                {t('trip.logMissing', { date: formatDate(missing[0]!) })}
              </button>
            </div>
          )}

          {/* 2. Route en dagen */}
          <div className="section stack">
            <Heading>{t('period.routeAndDays')}</Heading>
            <TripRouteSection store={store} view={view} notify={notify} />
            <PeriodDays store={store} legs={inside} notify={notify} nm={view.nm} />
            {outside.length > 0 && <OutsideDays store={store} trip={trip} legs={outside} notify={notify} />}
            {onAddDay && (
              <button className="btn" onClick={() => onAddDay({ date: nextDay, tripId: trip.id })}>
                <Icon icon={Plus} />
                {t('trip.addDay')}
              </button>
            )}
          </div>

          {/* 3. Mensen */}
          {(people.length > 0 || returning.length > 0 || hasCourses) && (
            <div className="section">
              <Heading>{t('period.people')}</Heading>
              {people.length > 0 && (
                <ul className="participant-chips">
                  {people.map((p) => {
                    const course = curricula.find((c) => c.id === p.curriculumId)
                    return (
                      <li key={p.id}>
                        <button type="button" className="chip-static participant-chip" onClick={() => setParticipant(p)} aria-label={`${t('participant.open')}: ${participantName(p, people)}`}>
                          <Icon icon={Users} />
                          <span>{participantName(p, people)}</span>
                          {(p.level || course) && <span className="muted small">{[p.level ? t(`level.${p.level}`) : '', course ? courseLabel(course, lang) : ''].filter(Boolean).join(' · ')}</span>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              {returning.map((r) => {
                const name = participantName(r.participant, people)
                return (
                  <div key={r.participant.id} className="notice returning-guest">
                    <span>{t('guest.same', { name, previous: guestLabel(r.previous), trip: r.previousTrip.name })}</span>
                    <span className="notice-actions">
                      <button
                        className="btn small primary"
                        onClick={async () => {
                          await answerReturning(store, trip.id, r.participant.id, r.previous)
                          notify(t('guest.linked', { name }))
                        }}
                      >
                        {t('guest.yes')}
                      </button>
                      <button
                        className="btn small"
                        onClick={async () => {
                          await answerReturning(store, trip.id, r.participant.id, null)
                          notify(t('guest.notLinked', { name }))
                        }}
                      >
                        {t('guest.no')}
                      </button>
                    </span>
                  </div>
                )
              })}
              {mode === 'sheet' && tripStudents.length > 0 && <h4>{t('students.title')}</h4>}
              {mode === 'sheet' && tripStudents.length > 0 && (
                <ul className="rows">
                  {tripStudents.map((st) => (
                    <StudentRow key={st.id} student={st} course={curricula.find((c) => c.id === st.curriculumId)} onOpen={() => openStudent(st.id)} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
      {mode === 'page' && hasCourses && !planOpen && (
        <div className="section">
          {!detail && <Heading>{t('week.checklists')}</Heading>}
          <StudentsView store={store} notify={notify} curricula={curricula} scope={{ kind: 'week', week: trip }} onDetail={onStudentDetail ?? noop} />
        </div>
      )}

      {/* 4. Planning: lesplanning (bij les geven) en de vaste checklists bij de soort trip. */}
      {mode === 'page' && teaching && !studentOpen && (
        <div className="section">
          {!detail && <Heading>{t('plan.list')}</Heading>}
          <PlansView store={store} notify={notify} curricula={curricula} week={trip} onDetail={onPlanDetail ?? noop} />
        </div>
      )}
      {!detail && (
        <>
          {mode === 'sheet' && ownPlans.length > 0 && (
            <div className="section">
              <Heading>{t('plan.list')}</Heading>
              <ul className="rows">
                {ownPlans.map((p) => (
                  <li key={p.id} className="row-item">
                    <span className="row-main">
                      <span>{p.title}</span>
                      <span className="muted small">{t('unit.days', { n: p.dayCount })}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <TripChecklists store={store} notify={notify} trip={trip} type={view.type} heading={Heading} />

          {/* 5. Geld */}
          <div className="stack-sm period-money">
            {/* Zonder geld en zonder salaris toont het geldblok zelf niets: dan de kop met "nog niets". */}
            {!hasMoney && <Heading>{t('week.money')}</Heading>}
            {!hasMoney && <p className="muted small">{t('period.noMoney')}</p>}
            <TripMoneySection store={store} trip={trip} heading={Heading} />
            <TripClaims store={store} trip={trip} notify={notify} heading={mode === 'page' ? 'h2' : 'h3'} />
            <MoneyButtons onAdd={setAdding} claims={view.kind === 'werk' && !demo} />
          </div>

          {/* 6. Notities en terugblik */}
          <Review trip={trip} heading={Heading} />
          {needsClosing(full, today) && (
            <div className="notice">
              <p className="small">{t('week.closePrompt', { name: trip.name })}</p>
              <button className="btn small primary" onClick={() => setClosing(true)}>
                {t('week.close')}
              </button>
            </div>
          )}
        </>
      )}
      {participant && <ParticipantView store={store} trip={trip} participant={participant} notify={notify} onClose={() => setParticipant(null)} onOpenStudent={openStudent} />}
      {otherTrip && <WeekSheet key={otherTrip.id} store={store} trip={otherTrip} notify={notify} onClose={() => setOtherTrip(null)} />}
      {closing && <CloseWeekSheet store={store} trip={trip} notify={notify} onClose={() => setClosing(false)} />}
      {adding && <PeriodMoneyAddSheet store={store} what={adding} periodId={trip.id} title={nameWithCounter(trip, counter)} onClose={() => setAdding(null)} notify={notify} />}
    </div>
  )
}

function LandPeriod({ store, notify, period, stay: given }: PeriodPageProps & { stay: StayPeriod }) {
  const stays = useCollection(store, 'periods.json.enc')
  const stay = stays.find((s) => s.id === given.id) ?? given
  const [adding, setAdding] = useState<MoneyAdd | null>(null)
  const days = daysBetween(stay.startDate, stay.endDate) + 1
  const travel = stay.kind === 'reis' ? [[stay.travel?.from, stay.travel?.to].filter(Boolean).join(' → '), stay.travel?.by ? t(`travelMode.${stay.travel.by}`) : ''].filter(Boolean).join(' · ') : ''
  return (
    <div className="stack-lg period-page">
      {/* 1. Overzicht */}
      <div className="card trip-head">
        <p className="muted small">{[t(`periodKind.${stay.kind}`), formatDateRange(stay.startDate, stay.endDate)].join(' · ')}</p>
        <p className="muted small">{t('unit.days', { n: days })}</p>
        {travel && <p className="muted small">{travel}</p>}
      </div>
      {/* 5. Geld */}
      <div className="section stack-sm period-money">
        <PeriodTransactions store={store} periodId={stay.id} notify={notify} />
        <MoneyButtons onAdd={setAdding} claims={false} income={false} />
      </div>
      {/* 6. Notities */}
      {stay.note && (
        <div className="section">
          <h3>{t('field.note')}</h3>
          <p className="note-text">{stay.note}</p>
        </div>
      )}
      {adding && <PeriodMoneyAddSheet store={store} what={adding} periodId={stay.id} title={period.name || stayName(stay)} onClose={() => setAdding(null)} notify={notify} />}
    </div>
  )
}

/** "+ Uitgave", "+ Inkomsten", "+ Declaratie" direct bij de periode. */
function MoneyButtons({ onAdd, claims, income = true }: { onAdd: (what: MoneyAdd) => void; claims: boolean; income?: boolean }) {
  return (
    <div className="row wrap period-money-buttons">
      <button type="button" className="btn small" onClick={() => onAdd('uitgave')}>
        <Icon icon={Plus} />
        {t('period.addExpense')}
      </button>
      {income && (
        <button type="button" className="btn small" onClick={() => onAdd('inkomsten')}>
          <Icon icon={Plus} />
          {t('period.addIncome')}
        </button>
      )}
      {claims && (
        <button type="button" className="btn small" onClick={() => onAdd('declaratie')}>
          <Icon icon={Plus} />
          {t('period.addClaim')}
        </button>
      )}
    </div>
  )
}

/** Het geld van een periode aan land: wat eraan hangt, bedragen pas na "Toon bedragen". */
function PeriodTransactions({ store, periodId, notify }: { store: Store; periodId: string; notify: Notify }) {
  const list = useCollection(store, 'transactions.json.enc')
    .filter((tx) => tx.deletedAt === null && tx.tripId === periodId)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
  useSyncExternalStore(subscribeRates, getRates)
  const [shown, setShown] = useState(false)
  const [open, setOpen] = useState<Transaction | null>(null)
  return (
    <>
      <div className="section-head">
        <h3>{t('week.money')}</h3>
        {list.length > 0 && (
          <button className="btn link small" onClick={() => setShown(!shown)} aria-pressed={shown}>
            <Icon icon={shown ? EyeOff : Eye} />
            {t(shown ? 'week.hideAmounts' : 'week.showAmounts')}
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <p className="muted small">{t('period.noMoney')}</p>
      ) : shown ? (
        <ul className="rows">
          {list.map((tx) => {
            const eur = eurValue(tx)
            return (
              <li key={tx.id}>
                <button type="button" className="row-button" onClick={() => setOpen(tx)}>
                  <span className="row-main">
                    <span>{tx.note || kindLabel(tx.kind)}</span>
                    <span className="muted small">{[kindLabel(tx.kind), formatDate(tx.date)].join(' · ')}</span>
                  </span>
                  <span className="row-value">{eur ? formatMoney(eur.eur, 'EUR') : formatMoney(tx.amount, tx.currency)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="muted small">{t('week.amountsHidden', { n: list.length })}</p>
      )}
      {open && <TransactionView store={store} tx={open} notify={notify} onClose={() => setOpen(null)} />}
    </>
  )
}

/** De gelogde dagen: tik = bekijken, potlood = bewerken (met Verwijderen onderaan). */
export function PeriodDays({ store, legs, notify, nm }: { store: Store; legs: readonly Leg[]; notify: Notify; nm?: number }) {
  const [open, setOpen] = useState<Leg | null>(null)
  const [edit, setEdit] = useState<Leg | null>(null)
  const sorted = [...legs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.updatedAt < b.updatedAt ? -1 : 1))
  return (
    <div className="stack-sm">
      <div className="section-head">
        <h3>{t('week.sailedDays')}</h3>
        {nm !== undefined && <span className="num">{formatNm(nm)}</span>}
      </div>
      {sorted.length === 0 ? (
        <p className="muted">{t('week.noDays')}</p>
      ) : (
        <ul className="rows">
          {sorted.map((leg) => (
            <li key={leg.id} className="leg-row">
              <button className="row-button leg-button" onClick={() => setOpen(leg)} aria-label={t('trip.openDay', { date: formatDate(leg.date) })}>
                <span className="row-main">
                  <span>{[leg.fromPlace, leg.toPlace].filter(Boolean).join(' → ') || '–'}</span>
                  <span className="muted small">{formatDate(leg.date)}</span>
                </span>
                <span className="row-value">{formatNm(totalNm(leg))}</span>
              </button>
              <button type="button" className="btn icon" aria-label={t('trip.editDay', { date: formatDate(leg.date) })} onClick={() => setEdit(leg)}>
                <Icon icon={Pencil} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <LegView store={store} leg={open} notify={notify} onClose={() => setOpen(null)} />}
      {edit && <LegSheet store={store} leg={edit} notify={notify} onClose={() => setEdit(null)} />}
    </div>
  )
}

/** Dagen van deze trip die buiten zijn datums vallen: met één tik naar de trip van die datum (of de trip verlengen). */
function OutsideDays({ store, trip, legs, notify }: { store: Store; trip: Trip; legs: readonly Leg[]; notify: Notify }) {
  const trips = useCollection(store, 'trips.json.enc')
  const all = useCollection(store, 'legs.json.enc')
  const [edit, setEdit] = useState<Leg | null>(null)
  return (
    <div className="notice outside-days" role="alert">
      <p className="small">{t('period.outsideDays', { n: legs.length, range: trip.startDate && trip.endDate ? formatDateRange(trip.startDate, trip.endDate) : '' })}</p>
      <ul className="plain-list">
        {legs.map((leg) => {
          const target = active(trips).find((x) => x.id !== trip.id && weekView(x, all).startDate <= leg.date && leg.date <= weekView(x, all).endDate) ?? null
          const canExtend = legOutsideCanExtend(leg, trip)
          return (
            <li key={leg.id} className="row wrap">
              <span className="grow small">
                {formatDate(leg.date)} · {[leg.fromPlace, leg.toPlace].filter(Boolean).join(' → ') || '–'}
              </span>
              {target || canExtend ? (
                <button
                  type="button"
                  className="btn small primary"
                  onClick={async () => notify(t('review.fixed'), await fixLegOutside(store, leg, trip, target))}
                >
                  {target ? t('review.moveTo', { name: target.name }) : t('review.extendTo', { name: trip.name, date: formatDate(leg.date) })}
                </button>
              ) : null}
              <button type="button" className="btn small" onClick={() => setEdit(leg)}>
                {t('review.editDay')}
              </button>
            </li>
          )
        })}
      </ul>
      {edit && <LegSheet store={store} leg={edit} notify={notify} onClose={() => setEdit(null)} />}
    </div>
  )
}

/** Vaste checklists bij deze soort trip (safety briefing, check-in en check-out, paklijst), met voortgang. */
function TripChecklists({ store, notify, trip, type, heading: Heading }: { store: Store; notify: Notify; trip: Trip; type: WeekType; heading: 'h2' | 'h3' }) {
  const lang = useLang()
  const lists = checklistsFor(effectiveChecklists(useCollection(store, 'checklists.json.enc')), type)
  const [openId, setOpenId] = useState<string | null>(null)
  const open = lists.find((l) => l.id === openId)
  return (
    <div className="section">
      <Heading>{t('checklist.section')}</Heading>
      <ul className="rows">
        {lists.map((list) => {
          const done = checkedItems(trip, list).size
          return (
            <li key={list.id}>
              <button className="row-button" onClick={() => setOpenId(list.id)}>
                <Icon icon={ListChecks} />
                <span className="row-main">
                  <span>{localized(list.title, lang)}</span>
                </span>
                <span className={`row-value small${done === list.items.length && done > 0 ? ' positive' : ''}`}>{t('checklist.count', { done, n: list.items.length })}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <NewChecklistButton onAdd={() => void addChecklist(store, t('checklist.newTitle'), type).then((list) => setOpenId(list.id))} />
      {open && <ChecklistSheet store={store} trip={trip} list={open} notify={notify} onClose={() => setOpenId(null)} />}
    </div>
  )
}

/** Notities en terugblik: de notitie, en na afronden het cijfer, de zin en de review van gasten. */
function Review({ trip, heading: Heading }: { trip: Trip; heading: 'h2' | 'h3' }) {
  const review = trip.review
  if (!trip.note && !review) return null
  return (
    <div className="section stack-sm">
      <Heading>{t('period.notes')}</Heading>
      {trip.note && <p className="note-text">{trip.note}</p>}
      {review?.rating !== undefined && <p>{t('period.rating', { n: review.rating })}</p>}
      {review?.lesson && <p className="muted">{review.lesson}</p>}
      {review?.score !== undefined && <p className="muted small">{t('period.score', { score: review.score })}</p>}
      {(review?.quotes ?? []).map((q, i) => (
        <blockquote key={i} className="muted small">
          {q}
        </blockquote>
      ))}
    </div>
  )
}
