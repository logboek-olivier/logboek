import { MapPin, Pencil, Share2 } from 'lucide-react'
import { Suspense, useState } from 'react'
import { formatDate, formatDateRangeShort, formatHours, formatNm, formatNumber } from '../format'
import { t, useLang } from '../i18n'
import { nameWithCounter, type TripCounter } from '../model/counters'
import { courseLabel, effectiveCurricula } from '../model/curricula'
import { totalNm } from '../model/derive'
import { participantName } from '../model/guests'
import { placeUses } from '../model/places'
import { routeOf } from '../model/trip-route'
import type { Leg, Participant, Trip } from '../model/types'
import { planWeek, studentWeek, tripDayCounts, weekView, type WeekView } from '../model/weeks'
import { activeStudents } from '../model/students'
import { openStudent } from '../navigation'
import { StudentRow } from '../screens/Students'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { boatLine, tripDaysText } from './boat-line'
import { Icon } from './Icon'
import { lazyComponent } from '../lazy'
import { IncompleteBadge } from './Incomplete'
import { tripIncomplete } from '../model/gaps'
import { PinSheet } from './PinSheet'
import { RouteMap } from './LazyMap'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'
import { useCounters } from './useCounters'
import { LegView, ParticipantView } from './Views'
import { organisationLabel, WeekSheet, weekTypeLabel } from './WeekSheet'
import { TripClaims } from './Claims'
import { TripMoneySection } from './TripMoney'

// Tripoverzicht (lopende trip in Deze trip, en elke eerdere trip uit het Logboek): kop "SV #3 · BVI · 8–21 nov ·
// Lagoon 42", een kaart met de hele route (lijnen tussen de stops, genummerde stops, start en eind duidelijk), plaatsen
// zonder pin met "Pin zetten", totalen, de dagen, deelnemers en planning. Alles eerst bekijken; bewerken via het potlood.

// Trip delen (afbeelding of PDF) laadt pas bij de tik.
const TripShareSheet = lazyComponent(() => import('./TripShare').then((m) => m.TripShareSheet))

/** De kop: "SV #3 · BVI · 8–21 nov · Lagoon 42". */
export function tripTitle(view: WeekView, counter: TripCounter | undefined): string {
  const range = view.startDate && view.endDate ? formatDateRangeShort(view.startDate, view.endDate) : ''
  return [nameWithCounter(view.trip, counter), range, view.trip.boatModel || view.trip.boat || view.boat].filter(Boolean).join(' · ')
}

/** `compact`: zonder de titel (in het tripoverzicht staat die al bovenaan het blad). */
export function TripHead({ view, counter, onEdit, legs, compact = false }: { view: WeekView; counter: TripCounter | undefined; onEdit?: () => void; legs: readonly Leg[]; compact?: boolean }) {
  const trip = view.trip
  return (
    <div className="card trip-head">
      <div className="trip-head-title">
        {compact ? (
          tripIncomplete(trip, legs) && <IncompleteBadge />
        ) : (
          <h2>
            {tripTitle(view, counter)} {tripIncomplete(trip, legs) && <IncompleteBadge />}
          </h2>
        )}
        {onEdit && (
          <button type="button" className="btn icon" aria-label={`${t('week.edit')}: ${trip.name}`} onClick={onEdit}>
            <Icon icon={Pencil} />
          </button>
        )}
      </div>
      <p className="muted small">{[weekTypeLabel(view.type), trip.organisation ? organisationLabel(trip.organisation) : '', trip.area].filter(Boolean).join(' · ')}</p>
      <p className="muted small trip-day-count">{tripDaysText(view)}</p>
      <p className="muted small">{boatLine(trip, legs.find((l) => l.tripId === trip.id)?.boat)}</p>
      {(trip.base || trip.charter) && <p className="muted small">{[trip.base, trip.charter].filter(Boolean).join(' · ')}</p>}
    </div>
  )
}

/** Kaart met de route, plaatsen zonder pin, en de totalen. */
export function TripRouteSection({ store, view, notify }: { store: Store; view: WeekView; notify: Notify }) {
  const places = useCollection(store, 'places.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const [pinning, setPinning] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const route = routeOf(view.legs, places)
  const use = pinning ? placeUses(legs, places).find((u) => u.name.toLowerCase() === pinning.toLowerCase()) ?? null : null
  return (
    <div className="section stack trip-route">
      <RouteMap route={route} />
      {route.unpinned.length > 0 && (
        <div className="stack-sm">
          <h3>{t('trip.unpinned')}</h3>
          <ul className="rows">
            {route.unpinned.map((name) => (
              <li key={name} className="row-item">
                <span className="row-main">{name}</span>
                <button type="button" className="btn small" onClick={() => setPinning(name)}>
                  <Icon icon={MapPin} />
                  {t('place.setPin')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <dl className="grid grid-3 trip-totals">
        <div className="stat">
          <dt>{t('stat.total')}</dt>
          <dd>{formatNm(route.nm)}</dd>
        </div>
        <div className="stat">
          <dt>{t('stat.days')}</dt>
          <dd>{formatNumber(tripDayCounts(view).days ?? route.days)}</dd>
        </div>
        <div className="stat">
          <dt>{t('trip.logged')}</dt>
          <dd>{formatNumber(tripDayCounts(view).logged)}</dd>
        </div>
        {route.nightHours > 0 && (
          <div className="stat">
            <dt>{t('stat.nightHours')}</dt>
            <dd>{formatHours(route.nightHours)}</dd>
          </div>
        )}
      </dl>
      {view.legs.length > 0 && (
        <button type="button" className="btn" onClick={() => setSharing(true)}>
          <Icon icon={Share2} />
          {t('tripShare.open')}
        </button>
      )}
      {use && <PinSheet store={store} use={use} notify={notify} onClose={() => setPinning(null)} />}
      {sharing && (
        <Suspense fallback={null}>
          <TripShareSheet store={store} trip={view.trip} onClose={() => setSharing(false)} />
        </Suspense>
      )}
    </div>
  )
}

/** De gezeilde dagen; tikken opent de dag (bekijken, bewerken via het potlood). */
export function TripDays({ store, legs, notify }: { store: Store; legs: readonly Leg[]; notify: Notify }) {
  const [open, setOpen] = useState<Leg | null>(null)
  if (legs.length === 0) return <p className="muted">{t('week.noDays')}</p>
  return (
    <>
      <ul className="rows">
        {legs.map((leg) => (
          <li key={leg.id}>
            <button className="row-button leg-button" onClick={() => setOpen(leg)} aria-label={t('trip.openDay', { date: formatDate(leg.date) })}>
              <span className="row-main">
                <span>{[leg.fromPlace, leg.toPlace].filter(Boolean).join(' → ') || '–'}</span>
                <span className="muted small">{formatDate(leg.date)}</span>
              </span>
              <span className="row-value">{formatNm(totalNm(leg))}</span>
            </button>
          </li>
        ))}
      </ul>
      {open && <LegView store={store} leg={open} notify={notify} onClose={() => setOpen(null)} />}
    </>
  )
}

/** Eerdere trip uit het Logboek (of een komende): het hele overzicht in een onderblad, bewerken via het potlood. */
export function TripOverviewSheet({ store, trip, notify, onClose }: { store: Store; trip: Trip; notify: Notify; onClose: () => void }) {
  const lang = useLang()
  const [editing, setEditing] = useState(false)
  const [participant, setParticipant] = useState<Participant | null>(null)
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const plans = useCollection(store, 'plans.json.enc')
  const students = useCollection(store, 'students.json.enc')
  const curricula = effectiveCurricula(useCollection(store, 'curricula.json.enc'))
  const counters = useCounters(store)
  const current = trips.find((x) => x.id === trip.id)
  if (!current || current.deletedAt !== null) return null
  if (editing) return <WeekSheet store={store} trip={current} notify={notify} onClose={onClose} />
  const view = weekView(current, legs)
  const counter = counters.get(current.id)
  const people = current.participants ?? []
  const own = plans.filter((p) => p.deletedAt === null && planWeek(p, trips, legs) === current.id)
  // Studenten van deze trip: één tik opent hun checklist.
  const tripStudents = activeStudents(students).filter((st) => studentWeek(st, trips, legs) === current.id)
  return (
    <Sheet title={tripTitle(view, counter)} onClose={onClose} onEdit={() => setEditing(true)}>
      <div className="stack-lg view trip-overview">
        <TripHead view={view} counter={counter} legs={legs} compact />
        <TripRouteSection store={store} view={view} notify={notify} />
        <div className="section">
          <h3>{t('week.sailedDays')}</h3>
          <TripDays store={store} legs={view.legs} notify={notify} />
        </div>
        <TripMoneySection store={store} trip={current} heading="h3" />
        <TripClaims store={store} trip={current} notify={notify} heading="h3" />
        {people.length > 0 && (
          <div className="section">
            <h3>{t('week.participants')}</h3>
            <ul className="participant-chips">
              {people.map((p) => {
                const course = curricula.find((c) => c.id === p.curriculumId)
                return (
                  <li key={p.id}>
                    <button type="button" className="chip-static participant-chip" onClick={() => setParticipant(p)}>
                      <span>{participantName(p, people)}</span>
                      {(p.level || course) && <span className="muted small">{[p.level ? t(`level.${p.level}`) : '', course ? courseLabel(course, lang) : ''].filter(Boolean).join(' · ')}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        {tripStudents.length > 0 && (
          <div className="section">
            <h3>{t('students.title')}</h3>
            <ul className="rows">
              {tripStudents.map((st) => (
                <StudentRow key={st.id} student={st} course={curricula.find((c) => c.id === st.curriculumId)} onOpen={() => openStudent(st.id)} />
              ))}
            </ul>
          </div>
        )}
        {own.length > 0 && (
          <div className="section">
            <h3>{t('plan.list')}</h3>
            <ul className="rows">
              {own.map((p) => (
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
        {current.note && <p className="muted">{current.note}</p>}
      </div>
      {participant && <ParticipantView store={store} trip={current} participant={participant} notify={notify} onClose={() => setParticipant(null)} onOpenStudent={openStudent} />}
    </Sheet>
  )
}

export { boatLine }
