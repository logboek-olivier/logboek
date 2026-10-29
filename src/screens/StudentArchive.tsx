import { Archive, Search, Users } from 'lucide-react'
import { useState } from 'react'
import type { Notify } from '../components/EditSheets'
import { Empty } from '../components/Empty'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { useCounters } from '../components/useCounters'
import { formatDateRangeShort } from '../format'
import { t, useLang } from '../i18n'
import { nameWithCounter } from '../model/counters'
import { courseLabel, effectiveCurricula } from '../model/curricula'
import { currentSettings } from '../model/settings'
import { NO_FILTER, RESULT_FILTERS, studentGroups, type ResultFilter, type StudentFilter } from '../model/student-groups'
import { activeStudents, archivedStudents } from '../model/students'
import { activeWeek, weekView } from '../model/weeks'
import type { Store } from '../storage/store'
import { ArchiveView, StudentDetail, StudentRow, useAutoArchive } from './Students'

// Studentenarchief (onder Meer): álle studenten, per trip, de lopende trip bovenaan, daarna de nieuwste trips;
// studenten zonder trip apart onderaan. Zoeken op voornaam, filteren op cursus en resultaat. Gearchiveerde studenten
// (na 12 maanden zonder activiteit vanzelf) staan apart en zijn te wissen (regel 14).

type View = { kind: 'list' } | { kind: 'student'; id: string } | { kind: 'archive' }

export function StudentArchive({ store, notify, openStudentId }: { store: Store; notify: Notify; openStudentId?: string }) {
  const lang = useLang()
  const curricula = effectiveCurricula(useCollection(store, 'curricula.json.enc'))
  const students = useCollection(store, 'students.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const counters = useCounters(store)
  const [view, setView] = useState<View>(openStudentId ? { kind: 'student', id: openStudentId } : { kind: 'list' })
  const [filter, setFilter] = useState<StudentFilter>(NO_FILTER)
  useAutoArchive(store, notify)

  const back = () => setView({ kind: 'list' })
  if (view.kind === 'student') {
    const student = students.find((s) => s.id === view.id && s.deletedAt === null)
    if (student) {
      return <StudentDetail store={store} notify={notify} student={student} course={curricula.find((c) => c.id === student.curriculumId)} curricula={curricula} onBack={back} />
    }
  }
  const archived = archivedStudents(students)
  if (view.kind === 'archive') return <ArchiveView store={store} notify={notify} students={archived} curricula={curricula} onBack={back} />

  const live = activeStudents(students)
  const current = activeWeek(trips, settings)
  const groups = studentGroups(students, trips, legs, current?.id ?? null, filter)
  const usedCourses = curricula.filter((c) => live.some((s) => s.curriculumId === c.id))
  const filtered = filter.query.trim() !== '' || filter.curriculumId !== '' || filter.result !== 'alle'

  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('nav.studentArchive')}</h1>
      </header>
      {live.length === 0 ? (
        <Empty icon={Users}>{t('students.noneAtAll')}</Empty>
      ) : (
        <>
          <div className="stack-sm student-filters">
            <label className="search-field">
              <Icon icon={Search} />
              <input type="search" autoComplete="off" placeholder={t('students.searchPlaceholder')} aria-label={t('students.search')} value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} />
            </label>
            <div className="two">
              <label>
                {t('students.course')}
                <select value={filter.curriculumId} onChange={(e) => setFilter({ ...filter, curriculumId: e.target.value })}>
                  <option value="">{t('students.allCourses')}</option>
                  {usedCourses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {courseLabel(c, lang)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('students.result')}
                <select value={filter.result} onChange={(e) => setFilter({ ...filter, result: e.target.value as ResultFilter })}>
                  {RESULT_FILTERS.map((r) => (
                    <option key={r} value={r}>
                      {t(`studentResult.${r}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {groups.length === 0 && filtered && <p className="muted">{t('students.noMatch')}</p>}
          {groups.map((g) => {
            const v = g.trip ? weekView(g.trip, legs) : null
            return (
              <div key={g.trip?.id ?? 'zonder-trip'} className={`group student-group${g.current ? ' current' : ''}`}>
                <h2 className="group-head plain">
                  <span className="grow">
                    {g.trip ? nameWithCounter(g.trip, counters.get(g.trip.id)) : t('students.withoutTrip')}
                    {g.current && <span className="badge current-badge">{t('students.currentTrip')}</span>}
                  </span>
                  <span className="muted small">{v?.startDate && v.endDate ? formatDateRangeShort(v.startDate, v.endDate) : t('unit.students', { n: g.students.length })}</span>
                </h2>
                <ul className="rows">
                  {g.students.map((s) => (
                    <StudentRow key={s.id} student={s} course={curricula.find((c) => c.id === s.curriculumId)} onOpen={() => setView({ kind: 'student', id: s.id })} />
                  ))}
                </ul>
              </div>
            )
          })}
        </>
      )}
      {archived.length > 0 && (
        <button className="btn link" onClick={() => setView({ kind: 'archive' })}>
          <Icon icon={Archive} />
          {t('students.archive', { n: archived.length })}
        </button>
      )}
    </section>
  )
}
