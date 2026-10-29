import { CalendarPlus, ChevronRight, Eye, EyeOff, ListChecks, Pencil, Plus, Users } from 'lucide-react'
import { ChecklistSheet, NewChecklistButton } from '../components/ChecklistSheet'
import { addChecklist, checkedItems, checklistsFor, effectiveChecklists } from '../model/checklists'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { LegSheet, type Notify } from '../components/EditSheets'
import { Empty } from '../components/Empty'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { CloseWeekSheet, organisationLabel, WeekSheet, weekTypeLabel } from '../components/WeekSheet'
import { formatDate, formatDateRange, formatMoney, formatNm, formatNumber } from '../format'
import { t, useLang } from '../i18n'
import { courseLabel, effectiveCurricula, localized } from '../model/curricula'
import { totalNm } from '../model/derive'
import { totals } from '../model/money'
import { eurValue, getRates, subscribeRates } from '../model/rates'
import { currentSettings } from '../model/settings'
import { todayIso } from '../model/types'
import { daysUntil } from '../session'
import { legGaps, tripIncomplete } from '../model/gaps'
import { answerReturning, guestLabel, participantName, returningGuests } from '../model/guests'
import { IncompleteBadge } from '../components/Incomplete'
import { activeWeek, feetToMetres, missingDays, needsClosing, upcomingTrips, weekView } from '../model/weeks'
import type { Leg, Participant, Trip, WeekType } from '../model/types'
import { tripOverlaps } from '../model/trip-ops'
import { OverlapNotices, ParticipantSheet } from '../components/TripSheets'
import type { AddInit } from './QuickAdd'
import type { Store } from '../storage/store'
import { PlansView } from './Planning'
import { StudentsView } from './Students'

// Deze trip: kop met boot (tikken = bewerken), deelnemers, planning (bij training geven), checklists per deelnemer,
// gezeilde dagen met nm-totaal (elke dag te bewerken, vergeten dagen met één tik toe te voegen), inkomsten en
// uitgaven van de trip, standaard verborgen achter "Toon bedragen", en de komende trips.

/** Bootgegevens op één regel: naam · model · lengte in voet en meter. */
export function boatLine(trip: Trip, fallbackBoat = ''): string {
  const length = trip.boatLengthFt ? t('boat.feet', { ft: formatNumber(trip.boatLengthFt), m: formatNumber(feetToMetres(trip.boatLengthFt)) }) : ''
  // De boot uit de dagen alleen als de trip zelf geen naam en geen model heeft (geïmporteerd: "Naam (Model)").
  return [trip.boat || (trip.boatModel ? '' : fallbackBoat), trip.boatModel ?? '', length, trip.boatKind ? t(`boatKind.${trip.boatKind}`) : ''].filter(Boolean).join(' · ')
}

export function ThisWeek({ store, notify, onAddDay }: { store: Store; notify: Notify; onAddDay: (init: AddInit) => void }) {
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const stored = useCollection(store, 'curricula.json.enc')
  const curricula = effectiveCurricula(stored)
  const lang = useLang()
  const [sheet, setSheet] = useState<'new' | 'edit' | 'close' | null>(null)
  const [otherTrip, setOtherTrip] = useState<Trip | null>(null)
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [editTrip, setEditTrip] = useState<Trip | null>(null)
  // Een open planning of student vult het hele scherm; de andere onderdelen wijken dan.
  const [planOpen, setPlanOpen] = useState(false)
  const [studentOpen, setStudentOpen] = useState(false)
  const onPlanDetail = useCallback((open: boolean) => setPlanOpen(open), [])
  const onStudentDetail = useCallback((open: boolean) => setStudentOpen(open), [])
  const week = activeWeek(trips, settings)
  const upcoming = upcomingTrips(trips).filter((u) => u.id !== week?.id)
  const upcomingSection = (
    <>
      <UpcomingTrips trips={upcoming} onOpen={setEditTrip} />
      {editTrip && <WeekSheet store={store} trip={editTrip} notify={notify} onClose={() => setEditTrip(null)} />}
    </>
  )

  if (!week) {
    return (
      <section className="stack-lg">
        <header className="page-header">
          <h1>{t('nav.week')}</h1>
        </header>
        <Empty
          icon={CalendarPlus}
          action={
            <button className="btn primary" onClick={() => setSheet('new')}>
              {t('week.new')}
            </button>
          }
        >
          {t('week.noActive')}
        </Empty>
        {upcomingSection}
        {sheet === 'new' && <WeekSheet store={store} trip={null} notify={notify} onClose={() => setSheet(null)} />}
      </section>
    )
  }

  const view = weekView(week, legs)
  const detail = planOpen || studentOpen
  const participants = week.participants ?? []
  // Terugkerende gasten: zelfde voornaam en land als in een eerdere trip; pas koppelen na "ja".
  const returning = returningGuests(week, trips, legs)
  const missing = missingDays(view, todayIso())
  const nextDay = missing[0] ?? (view.endDate && todayIso() > view.endDate ? view.endDate : todayIso())

  return (
    <section className="stack-lg this-week">
      {!detail && (
        <>
          <header className="page-header">
            <h1>{t('nav.week')}</h1>
          </header>
          <button className="card week-head" onClick={() => setSheet('edit')} aria-label={`${t('week.edit')}: ${week.name}`}>
            <span className="week-head-title">
              <span>
                {week.name} {tripIncomplete(week, legs) && <IncompleteBadge />}
              </span>
              <Icon icon={Pencil} />
            </span>
            <span className="muted small">
              {[weekTypeLabel(view.type), view.startDate ? formatDateRange(view.startDate, view.endDate) : ''].filter(Boolean).join(' · ')}
            </span>
            <span className="muted small">{boatLine(week, view.boat)}</span>
            <span className="muted small">{[week.base, week.area, week.charter, week.organisation ? organisationLabel(week.organisation) : ''].filter(Boolean).join(' · ')}</span>
          </button>
          <OverlapNotices store={store} overlaps={tripOverlaps(trips, legs).filter((o) => o.a.id === week.id || o.b.id === week.id)} notify={notify} onEditTrip={setOtherTrip} />
          {missing.length > 0 && (
            <div className="notice">
              <p className="small">{t('trip.missingDays', { n: missing.length })}</p>
              <button className="btn small primary" onClick={() => onAddDay({ date: missing[0]!, tripId: week.id })}>
                {t('trip.logMissing', { date: formatDate(missing[0]!) })}
              </button>
            </div>
          )}
          {needsClosing(view, todayIso()) && (
            <div className="notice">
              <p className="small">{t('week.closePrompt', { name: week.name })}</p>
              <button className="btn small primary" onClick={() => setSheet('close')}>
                {t('week.close')}
              </button>
            </div>
          )}
          <div className="section">
            <h2>{t('week.participants')}</h2>
            {participants.length === 0 ? (
              <p className="muted">
                {t('week.noParticipants')}{' '}
                <button className="btn link inline" onClick={() => setSheet('edit')}>
                  {t('week.addParticipants')}
                </button>
              </p>
            ) : (
              <ul className="participant-chips">
                {participants.map((p) => {
                  const course = curricula.find((c) => c.id === p.curriculumId)
                  return (
                    <li key={p.id}>
                      <button type="button" className="chip-static participant-chip" onClick={() => setParticipant(p)} aria-label={`${t('participant.edit')}: ${participantName(p, participants)}`}>
                        <Icon icon={Users} />
                        <span>{participantName(p, participants)}</span>
                        {(p.level || course) && (
                          <span className="muted small">{[p.level ? t(`level.${p.level}`) : '', course ? courseLabel(course, lang) : ''].filter(Boolean).join(' · ')}</span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {returning.map((r) => {
              const name = participantName(r.participant, participants)
              return (
                <div key={r.participant.id} className="notice returning-guest">
                  <span>{t('guest.same', { name, previous: guestLabel(r.previous), trip: r.previousTrip.name })}</span>
                  <span className="notice-actions">
                    <button
                      className="btn small primary"
                      onClick={async () => {
                        await answerReturning(store, week.id, r.participant.id, r.previous)
                        notify(t('guest.linked', { name }))
                      }}
                    >
                      {t('guest.yes')}
                    </button>
                    <button
                      className="btn small"
                      onClick={async () => {
                        await answerReturning(store, week.id, r.participant.id, null)
                        notify(t('guest.notLinked', { name }))
                      }}
                    >
                      {t('guest.no')}
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
      {view.type === 'training-geven' && !studentOpen && (
        <div className="section">
          {!planOpen && <h2>{t('plan.list')}</h2>}
          <PlansView store={store} notify={notify} curricula={curricula} week={week} onDetail={onPlanDetail} />
        </div>
      )}
      {!planOpen && (participants.some((p) => p.curriculumId) || view.type === 'training-geven') && (
        <div className="section">
          {!studentOpen && <h2>{t('week.checklists')}</h2>}
          <StudentsView store={store} notify={notify} curricula={curricula} scope={{ kind: 'week', week }} onDetail={onStudentDetail} />
        </div>
      )}
      {!detail && (
        <>
          <TripChecklists store={store} notify={notify} trip={week} type={view.type} />
          <SailedDays store={store} notify={notify} legs={view.legs} nm={view.nm} onAdd={() => onAddDay({ date: nextDay, tripId: week.id })} />
          <WeekMoney store={store} weekId={week.id} />
          {upcomingSection}
        </>
      )}
      {sheet === 'edit' && <WeekSheet store={store} trip={week} notify={notify} onClose={() => setSheet(null)} />}
      {otherTrip && <WeekSheet key={otherTrip.id} store={store} trip={otherTrip} notify={notify} onClose={() => setOtherTrip(null)} />}
      {participant && <ParticipantSheet store={store} trip={week} participant={participant} notify={notify} onClose={() => setParticipant(null)} />}
      {sheet === 'close' && <CloseWeekSheet store={store} trip={week} notify={notify} onClose={() => setSheet(null)} />}
    </section>
  )
}

/** Vaste checklists bij deze soort trip (safety briefing, check-in en check-out, paklijst), met voortgang. */
function TripChecklists({ store, notify, trip, type }: { store: Store; notify: Notify; trip: Trip; type: WeekType }) {
  const lang = useLang()
  const lists = checklistsFor(effectiveChecklists(useCollection(store, 'checklists.json.enc')), type)
  const [openId, setOpenId] = useState<string | null>(null)
  const open = lists.find((l) => l.id === openId)
  return (
    <div className="section">
      <h2>{t('checklist.section')}</h2>
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
                <span className={`row-value small${done === list.items.length && done > 0 ? ' positive' : ''}`}>
                  {t('checklist.count', { done, n: list.items.length })}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <NewChecklistButton
        onAdd={() =>
          void addChecklist(store, t('checklist.newTitle'), type).then((list) => setOpenId(list.id))
        }
      />
      {open && <ChecklistSheet store={store} trip={trip} list={open} notify={notify} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function SailedDays({ store, notify, legs, nm, onAdd }: { store: Store; notify: Notify; legs: Leg[]; nm: number; onAdd: () => void }) {
  const [editing, setEditing] = useState<Leg | null>(null)
  return (
    <div className="section">
      <div className="section-head">
        <h2>{t('week.sailedDays')}</h2>
        <span className="num">{formatNm(nm)}</span>
      </div>
      {legs.length === 0 ? (
        <p className="muted">{t('week.noDays')}</p>
      ) : (
        <ul className="rows">
          {legs.map((leg) => (
            <li key={leg.id}>
              <button className="row-button" onClick={() => setEditing(leg)} aria-label={t('trip.editDay', { date: formatDate(leg.date) })}>
                <span className="row-main">
                  <span>
                    {[leg.fromPlace, leg.toPlace].filter(Boolean).join(' → ')} {legGaps(leg).length > 0 && <IncompleteBadge />}
                  </span>
                  <span className="muted small">{formatDate(leg.date)}</span>
                </span>
                <span className="row-value">{formatNm(totalNm(leg))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="btn" onClick={onAdd}>
        <Icon icon={Plus} />
        {t('trip.addDay')}
      </button>
      {editing && <LegSheet store={store} leg={editing} notify={notify} onClose={() => setEditing(null)} />}
    </div>
  )
}

/** Komende trips met het aantal dagen tot de start; tikken = bewerken. */
function UpcomingTrips({ trips, onOpen }: { trips: Trip[]; onOpen: (trip: Trip) => void }) {
  if (trips.length === 0) return null
  const today = todayIso()
  return (
    <div className="section">
      <h2>{t('trip.upcoming')}</h2>
      <ul className="rows">
        {trips.map((trip) => {
          const n = daysUntil(trip.startDate ?? null, today) ?? 0
          return (
            <li key={trip.id}>
              <button className="row-button" onClick={() => onOpen(trip)} aria-label={`${t('week.edit')}: ${trip.name}`}>
                <span className="row-main">
                  <span>
                    {trip.name} {tripIncomplete(trip, []) && <IncompleteBadge />}
                  </span>
                  <span className="muted small">{[trip.startDate ? formatDateRange(trip.startDate, trip.endDate ?? trip.startDate) : '', boatLine(trip)].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="row-value small">{t('trip.inDays', { n })}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Fooien en kosten van de week in euro, verborgen tot Olivier op "Toon bedragen" tikt (studenten kijken mee). */
function WeekMoney({ store, weekId }: { store: Store; weekId: string }) {
  const transactions = useCollection(store, 'transactions.json.enc').filter((tx) => tx.deletedAt === null && tx.tripId === weekId)
  useSyncExternalStore(subscribeRates, getRates)
  const [shown, setShown] = useState(false)
  if (transactions.length === 0) return null
  const sum = totals(transactions)
  const provisional = transactions.some((tx) => eurValue(tx)?.provisional)
  return (
    <div className="section">
      <div className="section-head">
        <h2>{t('week.money')}</h2>
        <button className="btn link small" onClick={() => setShown(!shown)} aria-pressed={shown}>
          <Icon icon={shown ? EyeOff : Eye} />
          {t(shown ? 'week.hideAmounts' : 'week.showAmounts')}
        </button>
      </div>
      {shown ? (
        <>
          <dl className="grid">
            <div className="stat">
              <dt>{t('week.income')}</dt>
              <dd>{formatMoney(sum.incomeEur, 'EUR')}</dd>
            </div>
            <div className="stat">
              <dt>{t('week.costs')}</dt>
              <dd>{formatMoney(sum.costsEur, 'EUR')}</dd>
            </div>
          </dl>
          {Object.entries(sum.other).map(([c, v]) => (
            <p key={c} className="muted small">
              {t('money.noRateFor', { currency: c })}: +{formatMoney(v.income, c)} −{formatMoney(v.costs, c)}
            </p>
          ))}
          {provisional && <p className="muted small">{t('money.provisionalHint')}</p>}
        </>
      ) : (
        <p className="muted small">
          <Icon icon={ChevronRight} />
          {t('week.amountsHidden', { n: transactions.length })}
        </p>
      )}
    </div>
  )
}
