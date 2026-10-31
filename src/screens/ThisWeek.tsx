import { CalendarPlus } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { Notify } from '../components/EditSheets'
import { Empty } from '../components/Empty'
import { PeriodPage } from '../components/PeriodPage'
import { useCollection } from '../components/useCollection'
import { WeekSheet } from '../components/WeekSheet'
import { formatDateRange } from '../format'
import { t } from '../i18n'
import { currentSettings } from '../model/settings'
import { todayIso, type Trip } from '../model/types'
import { daysUntil } from '../session'
import { tripIncomplete } from '../model/gaps'
import { IncompleteBadge } from '../components/Incomplete'
import { waterPeriod } from '../model/periods'
import { activeWeek, upcomingTrips, weekView } from '../model/weeks'
import { nameWithCounter, type TripCounter } from '../model/counters'
import { useCounters } from '../components/useCounters'
import { boatLine, TripOverviewSheet } from '../components/TripOverview'
import type { AddInit } from './QuickAdd'
import type { Store } from '../storage/store'

// Deze trip: de lopende trip op de periodepagina (src/components/PeriodPage.tsx, overal dezelfde), met daaronder de
// komende trips.

export function ThisWeek({ store, notify, onAddDay }: { store: Store; notify: Notify; onAddDay: (init: AddInit) => void }) {
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const counters = useCounters(store)
  const [sheet, setSheet] = useState<'new' | 'edit' | null>(null)
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
      <UpcomingTrips trips={upcoming} counters={counters} onOpen={setEditTrip} />
      {editTrip && <TripOverviewSheet store={store} trip={editTrip} notify={notify} onClose={() => setEditTrip(null)} />}
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

  const detail = planOpen || studentOpen

  return (
    <section className="stack-lg this-week">
      {!detail && (
        <header className="page-header">
          <h1>{t('nav.week')}</h1>
        </header>
      )}
      <PeriodPage
        store={store}
        period={waterPeriod(weekView(week, legs))}
        notify={notify}
        mode="page"
        onAddDay={onAddDay}
        onEdit={() => setSheet('edit')}
        planOpen={planOpen}
        studentOpen={studentOpen}
        onPlanDetail={onPlanDetail}
        onStudentDetail={onStudentDetail}
      />
      {!detail && upcomingSection}
      {sheet === 'edit' && <WeekSheet store={store} trip={week} notify={notify} onClose={() => setSheet(null)} />}
    </section>
  )
}

/** Komende trips met het aantal dagen tot de start; tikken = bewerken. */
function UpcomingTrips({ trips, counters, onOpen }: { trips: Trip[]; counters: ReadonlyMap<string, TripCounter>; onOpen: (trip: Trip) => void }) {
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
              <button className="row-button" onClick={() => onOpen(trip)} aria-label={t('trip.open', { name: trip.name })}>
                <span className="row-main">
                  <span>
                    {nameWithCounter(trip, counters.get(trip.id))} {tripIncomplete(trip, []) && <IncompleteBadge />}
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

