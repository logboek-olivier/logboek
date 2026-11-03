import { CalendarPlus } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { Notify } from '../components/EditSheets'
import { Empty } from '../components/Empty'
import { PeriodPage } from '../components/PeriodPage'
import { useCollection } from '../components/useCollection'
import { WeekSheet } from '../components/WeekSheet'
import { t } from '../i18n'
import { currentSettings } from '../model/settings'
import { waterPeriod } from '../model/periods'
import { activeWeek, weekView } from '../model/weeks'
import type { Store } from '../storage/store'

// Deze trip: alleen de lopende trip, op de periodepagina (src/components/PeriodPage.tsx, overal dezelfde). Komende trips
// staan in de agenda en onder Meer → Periodes, niet hier.

export function ThisWeek({ store, notify }: { store: Store; notify: Notify }) {
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const [sheet, setSheet] = useState<'new' | 'edit' | null>(null)
  // Een open planning of student vult het hele scherm; de andere onderdelen wijken dan.
  const [planOpen, setPlanOpen] = useState(false)
  const [studentOpen, setStudentOpen] = useState(false)
  const onPlanDetail = useCallback((open: boolean) => setPlanOpen(open), [])
  const onStudentDetail = useCallback((open: boolean) => setStudentOpen(open), [])
  const week = activeWeek(trips, settings)

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
        onEdit={() => setSheet('edit')}
        planOpen={planOpen}
        studentOpen={studentOpen}
        onPlanDetail={onPlanDetail}
        onStudentDetail={onStudentDetail}
      />
      {sheet === 'edit' && <WeekSheet store={store} trip={week} notify={notify} onClose={() => setSheet(null)} />}
    </section>
  )
}
