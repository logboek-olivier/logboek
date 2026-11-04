import { Archive, ChevronRight, Plus, Search, Users } from 'lucide-react'
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
import { activeWeek, isTeachingTrip, participantsWithoutStudent, weekView } from '../model/weeks'
import { guestLabel } from '../model/guests'
import { PersonSheet, type PersonForm } from '../components/PersonSheet'
import { active } from '../model/derive'
import { persoonBewerken, persoonToevoegen, studentInTripToevoegen, studentVanDeelnemer } from '../domain/training'
import { PERSON_ROLES, type Participant, type PersonRole, type Trip } from '../model/types'
import { todayIso } from '../basis/datum'
import type { Store } from '../storage/store'
import { ArchiveView, StudentDetail, StudentRow, useAutoArchive } from './Students'
import { useBack } from '../back'

// Personen (onder Meer, eerder Studentenarchief): álle studenten en de andere mensen van elke trip (gast, crew,
// medezeiler, schipper, overig; alleen voornaam, land en kenmerk, regel 14), per trip, de lopende trip bovenaan, daarna
// de nieuwste trips; studenten zonder trip apart onderaan. Een persoon toevoegen aan een trip, de rol wijzigen. Ook elke deelnemer van een trip waarin Olivier les geeft, met of zonder cursus
// en ook als de trip al is afgerond: heeft die nog geen student, dan maakt een tik hem. Zelf een student toevoegen en
// aan een trip koppelen; notities per persoon. Zoeken op voornaam, filteren op cursus en resultaat. Gearchiveerde
// studenten (na 12 maanden zonder activiteit vanzelf) staan apart en zijn te wissen (regel 14).

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
  const [adding, setAdding] = useState(false)
  const [person, setPerson] = useState<{ participant: Participant; role: PersonRole; trip: Trip } | null>(null)
  useAutoArchive(store, notify)

  /** Persoon toevoegen: een student via het studentenblok van vroeger (cursus later te kiezen), anders als deelnemer. */
  async function addPersonFromForm(form: PersonForm) {
    if (form.role === 'student') {
      const { result } = await studentInTripToevoegen(store, { firstName: form.firstName, curriculumId: '', level: 'beginner', startedAt: trips.find((x) => x.id === form.tripId)?.startDate ?? todayIso() }, form.tripId || null)
      setAdding(false)
      notify(t('people.added'))
      setView({ kind: 'student', id: result.id })
      return
    }
    await persoonToevoegen(store, form.tripId, { firstName: form.firstName, role: form.role, country: form.country, tag: form.tag })
    setAdding(false)
    notify(t('people.added'))
  }

  async function editPersonFromForm(form: PersonForm) {
    if (!person) return
    const undo = await persoonBewerken(store, person.trip.id, person.participant.id, { firstName: form.firstName, role: form.role, country: form.country, tag: form.tag })
    setPerson(null)
    notify(t('people.saved'), undo)
    if (form.role === 'student') setView({ kind: 'student', id: person.participant.id })
  }

  /** Een deelnemer zonder student: de student maken (zelfde id) en meteen openen. */
  async function openParticipant(trip: Trip, participant: Participant) {
    await studentVanDeelnemer(store, trip, participant)
    setView({ kind: 'student', id: participant.id })
  }

  const back = () => setView({ kind: 'list' })
  useBack(view.kind !== 'list', back)
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
  const pending = participantsWithoutStudent(trips, students)
  const groups = studentGroups(students, trips, legs, current?.id ?? null, filter, pending)
  // Te kiezen bij "Persoon toevoegen": de lopende trip eerst, dan de nieuwste.
  const tripChoices = active(trips).sort((a, b) => Number(b.id === current?.id) - Number(a.id === current?.id) || (weekView(b, legs).startDate ?? '').localeCompare(weekView(a, legs).startDate ?? ''))
  const tripLabel = (trip: Trip) => {
    const v = weekView(trip, legs)
    return [nameWithCounter(trip, counters.get(trip.id)), v.startDate && v.endDate ? formatDateRangeShort(v.startDate, v.endDate) : ''].filter(Boolean).join(' · ')
  }
  const hasPeople = live.length > 0 || pending.length > 0 || active(trips).some((trip) => (trip.participants ?? []).length > 0)
  const usedCourses = curricula.filter((c) => live.some((s) => s.curriculumId === c.id))
  const filtered = filter.query.trim() !== '' || filter.curriculumId !== '' || filter.result !== 'alle'

  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('nav.studentArchive')}</h1>
        <button className="btn small" onClick={() => setAdding(true)}>
          <Icon icon={Plus} />
          {t('people.add')}
        </button>
      </header>
      {!hasPeople ? (
        <Empty icon={Users}>{t('students.noneAtAll')}</Empty>
      ) : (
        <>
          <div className="stack-sm student-filters">
            <div className="type-buttons" role="radiogroup" aria-label={t('people.role')}>
              {(['alle', ...PERSON_ROLES] as const).map((r) => (
                <button key={r} type="button" role="radio" aria-checked={filter.role === r} className={`chip${filter.role === r ? ' active' : ''}`} onClick={() => setFilter({ ...filter, role: r })}>
                  {r === 'alle' ? t('people.everyone') : t(`personRole.${r}`)}
                </button>
              ))}
            </div>
            <label className="search-field">
              <Icon icon={Search} />
              <input type="search" autoComplete="off" placeholder={t('students.searchPlaceholder')} aria-label={t('students.search')} value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} />
            </label>
            {(filter.role === 'alle' || filter.role === 'student') && (
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
            )}
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
                  {g.trip &&
                    g.pending.map((p) => {
                      const course = curricula.find((c) => c.id === p.curriculumId)
                      return (
                        <li key={p.id} className="student">
                          <button className="settings-row" onClick={() => void openParticipant(g.trip!, p)}>
                            <span className="avatar" aria-hidden="true">
                              {p.firstName.slice(0, 1).toUpperCase()}
                            </span>
                            <span className="row-main">
                              <span>{p.firstName}</span>
                              <span className="muted small">{[course ? courseLabel(course, lang) : t('students.noCourse'), p.level ? t(`level.${p.level}`) : ''].filter(Boolean).join(' · ')}</span>
                            </span>
                            <Icon icon={ChevronRight} className="chevron" />
                          </button>
                        </li>
                      )
                    })}
                  {g.trip &&
                    g.people.map(({ participant: p, role }) => (
                      <li key={p.id} className="student person">
                        <button className="settings-row" onClick={() => setPerson({ participant: p, role, trip: g.trip! })}>
                          <span className="avatar" aria-hidden="true">
                            {p.firstName.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="row-main">
                            <span>{guestLabel(p)}</span>
                            <span className="muted small">{t(`personRole.${role}`)}</span>
                          </span>
                          <Icon icon={ChevronRight} className="chevron" />
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            )
          })}
        </>
      )}
      {adding && (
        <PersonSheet
          person={null}
          trips={tripChoices}
          tripLabel={tripLabel}
          defaultTripId={current?.id ?? null}
          defaultRole={current && isTeachingTrip(current) ? 'student' : 'medezeiler'}
          onClose={() => setAdding(false)}
          onSave={(form) => void addPersonFromForm(form)}
        />
      )}
      {person && (
        <PersonSheet person={person} trips={tripChoices} tripLabel={tripLabel} defaultTripId={null} defaultRole={person.role} onClose={() => setPerson(null)} onSave={(form) => void editPersonFromForm(form)} />
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
