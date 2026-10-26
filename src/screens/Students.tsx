import { Archive, Check, CheckCheck, ChevronLeft, ChevronRight, CircleDot, Flag, ListChecks, Pencil, Plus, Trash2, Undo2, Users } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Notify } from '../components/EditSheets'
import { Empty } from '../components/Empty'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { useCollection } from '../components/useCollection'
import { useSyncStatus } from '../components/SyncStatusLine'
import { formatDate, formatDateShort, formatNumber } from '../format'
import { t, useLang } from '../i18n'
import { allTopics, courseLabel, localized } from '../model/curricula'
import {
  activeStudents,
  addStudent,
  archivedStudents,
  criticalOpen,
  deleteStudents,
  dueForArchive,
  nextStatus,
  progressFor,
  raiseStatus,
  saveStudents,
  setArchived,
  statusOf,
  updateStudent,
  weekEnd,
  weekOf,
  withStatus,
  type StudentInput,
} from '../model/students'
import { STUDENT_LEVELS, todayIso, type Curriculum, type Student, type StudentLevel, type Topic, type TopicStatus } from '../model/types'
import type { Store } from '../storage/store'

// Studenten en voortgang. Eén tik op een vinkvak = volgende status. Examenkritische onderwerpen die nog op
// "nieuw" staan, staan bovenaan. Snel afvinken voor een hele groep. Na 12 maanden automatisch archiveren.

type View = { kind: 'list' } | { kind: 'student'; id: string } | { kind: 'archive' }

export function StudentsView({ store, notify, curricula }: { store: Store; notify: Notify; curricula: Curriculum[] }) {
  const all = useCollection(store, 'students.json.enc')
  const [view, setView] = useState<View>({ kind: 'list' })
  const [grouping, setGrouping] = useState<'week' | 'course'>('week')
  const [adding, setAdding] = useState(false)
  const [ticking, setTicking] = useState(false)
  const lang = useLang()
  const archivedOnce = useRef(false)
  const students = activeStudents(all)
  const archived = archivedStudents(all)
  const courseOf = (s: Student) => curricula.find((c) => c.id === s.curriculumId)

  // Automatisch archiveren na 12 maanden zonder activiteit (één keer per opening van Training), pas na een
  // geslaagde sync: anders kan een lang offline apparaat voortgang van een ander apparaat overschrijven.
  const status = useSyncStatus(store)
  useEffect(() => {
    if (archivedOnce.current || !store.hasSynced()) return
    archivedOnce.current = true
    const today = todayIso()
    const due = dueForArchive(store.get('students.json.enc'), today)
    if (due.length > 0) {
      void setArchived(store, due, today).then(() => notify(t('students.autoArchived', { n: due.length })))
    }
  }, [store, notify, status])

  if (view.kind === 'student') {
    const student = all.find((s) => s.id === view.id && s.deletedAt === null)
    const course = student ? courseOf(student) : undefined
    if (student) {
      return <StudentDetail store={store} notify={notify} student={student} course={course} curricula={curricula} onBack={() => setView({ kind: 'list' })} />
    }
  }
  if (view.kind === 'archive') {
    return <ArchiveView store={store} notify={notify} students={archived} curricula={curricula} onBack={() => setView({ kind: 'list' })} />
  }

  // Groeperen per week (maandag) of per cursus.
  const groups: { key: string; title: string; students: Student[] }[] = []
  const sorted = [...students].sort((a, b) => (weekOf(b) !== weekOf(a) ? (weekOf(b) < weekOf(a) ? -1 : 1) : a.firstName.localeCompare(b.firstName)))
  for (const s of sorted) {
    const key = grouping === 'week' ? weekOf(s) : s.curriculumId
    let group = groups.find((g) => g.key === key)
    if (!group) {
      const course = courseOf(s)
      const title =
        grouping === 'week'
          ? t('students.week', { from: formatDateShort(key), to: formatDateShort(weekEnd(key)) })
          : course
            ? courseLabel(course, lang)
            : t('students.unknownCourse')
      group = { key, title, students: [] }
      groups.push(group)
    }
    group.students.push(s)
  }

  return (
    <div className="stack-lg">
      <div className="row wrap">
        <button className="btn small primary" onClick={() => setAdding(true)}>
          <Icon icon={Plus} />
          {t('students.add')}
        </button>
        {students.length > 0 && (
          <button className="btn small quiet" onClick={() => setTicking(true)}>
            <Icon icon={ListChecks} />
            {t('students.groupTick')}
          </button>
        )}
      </div>
      {students.length === 0 ? (
        <Empty icon={Users}>{t('students.empty')}</Empty>
      ) : (
        <>
          <div className="segments small" role="radiogroup" aria-label={t('students.groupBy')}>
            {(['week', 'course'] as const).map((g) => (
              <button key={g} role="radio" aria-checked={grouping === g} className={`segment${grouping === g ? ' active' : ''}`} onClick={() => setGrouping(g)}>
                {t(g === 'week' ? 'students.byWeek' : 'students.byCourse')}
              </button>
            ))}
          </div>
          {groups.map((g) => (
            <div key={g.key} className="group">
              <h3 className="group-head plain">
                <span>{g.title}</span>
                <span className="num">{formatNumber(g.students.length)}</span>
              </h3>
              <ul className="rows">
                {g.students.map((s) => {
                  const course = courseOf(s)
                  const p = course ? progressFor(s, allTopics(course)) : null
                  const open = course ? criticalOpen(s, course).length : 0
                  return (
                    <li key={s.id} className="student">
                      <button className="settings-row" onClick={() => setView({ kind: 'student', id: s.id })}>
                        <span className="avatar" aria-hidden="true">
                          {s.firstName.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="row-main">
                          <span>{s.firstName}</span>
                          <span className="muted small">
                            {course ? courseLabel(course, lang) : t('students.unknownCourse')} · {t(`level.${s.level}`)}
                          </span>
                          {p && <ProgressBar progress={p} label={t('students.progressOf', { name: s.firstName })} />}
                        </span>
                        {open > 0 && (
                          <span className="tag critical" title={t('students.criticalOpen')}>
                            <Icon icon={Flag} />
                            {open}
                          </span>
                        )}
                        <Icon icon={ChevronRight} className="chevron" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </>
      )}
      {archived.length > 0 && (
        <button className="btn link" onClick={() => setView({ kind: 'archive' })}>
          <Icon icon={Archive} />
          {t('students.archive', { n: archived.length })}
        </button>
      )}
      {adding && (
        <StudentSheet
          student={null}
          curricula={curricula}
          onClose={() => setAdding(false)}
          onSave={(input) =>
            void addStudent(store, input).then(() => {
              setAdding(false)
              notify(t('students.added'))
            })
          }
        />
      )}
      {ticking && <GroupTickSheet store={store} notify={notify} students={students} curricula={curricula} onClose={() => setTicking(false)} />}
    </div>
  )
}

export function ProgressBar({ progress, label }: { progress: { total: number; practised: number; mastered: number }; label: string }) {
  const { total, practised, mastered } = progress
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10)
  return (
    <span className="progress dual" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={mastered}>
      <span className="progress-fill" ref={(el) => setWidth(el, pct(mastered))} />
      <span className="progress-fill soft" ref={(el) => setWidth(el, pct(practised))} />
    </span>
  )
}

/** Breedte via CSSOM (de CSP staat geen inline style-attributen toe). */
function setWidth(el: HTMLElement | null, pct: number) {
  if (el) el.style.width = `${pct}%`
}

const STATUS_ICON = { nieuw: null, geoefend: CircleDot, beheerst: Check } as const

function StudentDetail({
  store,
  notify,
  student,
  course,
  curricula,
  onBack,
}: {
  store: Store
  notify: Notify
  student: Student
  /** Ontbreekt als de cursus verwijderd is: dan alleen naam en bewerken (verwijderen blijft mogelijk). */
  course: Curriculum | undefined
  curricula: Curriculum[]
  onBack: () => void
}) {
  const lang = useLang()
  const [editing, setEditing] = useState(false)
  const critical = course ? criticalOpen(student, course) : []
  const total = progressFor(student, course ? allTopics(course) : [])
  // Altijd de nieuwste versie uit de Store: twee snelle tikken mogen elkaar niet overschrijven.
  const current = () => store.get('students.json.enc').find((s) => s.id === student.id) ?? student

  const tick = (topicId: string) => {
    const latest = current()
    const next = nextStatus(statusOf(latest, topicId))
    void saveStudents(store, [withStatus(latest, topicId, next, new Date().toISOString())])
  }

  /** Hele onderwerpgroep in één tik: alles naar minstens geoefend, en als dat al zo is naar beheerst. */
  const tickGroup = (topics: readonly Topic[], status: TopicStatus) => {
    const now = new Date().toISOString()
    const before = current()
    const next = topics.reduce((s, tp) => raiseStatus(s, tp.id, status, now), before)
    void saveStudents(store, [next]).then(() => notify(t('students.groupDone', { status: t(`status.${status}`) }), () => saveStudents(store, [before])))
  }

  const box = (topicId: string, title: string) => {
    const status = statusOf(student, topicId)
    const StatusIcon = STATUS_ICON[status]
    return (
      <li key={topicId}>
        <button className={`check-row status-${status}`} onClick={() => tick(topicId)} aria-label={t('students.tickAria', { topic: title, status: t(`status.${status}`) })}>
          <span className="check-box" aria-hidden="true">
            {StatusIcon && <Icon icon={StatusIcon} />}
          </span>
          <span className="row-main">
            <span>{title}</span>
            <span className="muted small">{t(`status.${status}`)}</span>
          </span>
        </button>
      </li>
    )
  }

  return (
    <div className="stack-lg">
      <button className="btn link back-link" onClick={onBack} aria-label={t('students.backToList')}>
        <Icon icon={ChevronLeft} />
        {t('students.title')}
      </button>
      <header className="page-header">
        <h1>{student.firstName}</h1>
        <button className="btn icon" aria-label={t('students.edit')} onClick={() => setEditing(true)}>
          <Icon icon={Pencil} />
        </button>
      </header>
      <p className="muted">
        {course ? courseLabel(course, lang) : t('students.unknownCourse')} · {t(`level.${student.level}`)}
        {student.exam ? ` · ${t(student.exam.passed ? 'students.examPassed' : 'students.examFailed', { date: formatDate(student.exam.date) })}` : ''}
      </p>
      {course && (
        <div className="stat">
          <span className="stat-label">{t('students.overall')}</span>
          <span className="small">{t('students.counts', { mastered: total.mastered, practised: total.practised, total: total.total })}</span>
          <ProgressBar progress={total} label={t('students.overall')} />
        </div>
      )}
      {critical.length > 0 && (
        <div className="section">
          <h2 className="critical-head">
            <Icon icon={Flag} />
            {t('students.criticalOpen')}
          </h2>
          <ul className="rows">{critical.map((tp) => box(tp.id, localized(tp.title, lang)))}</ul>
        </div>
      )}
      {course?.groups.map((g) => {
        const p = progressFor(student, g.topics)
        return (
          <div key={g.id} className="section">
            <div className="section-head">
              <h2>{localized(g.title, lang)}</h2>
              <span className="muted small">{t('students.groupCount', { done: p.mastered, total: p.total })}</span>
            </div>
            <ProgressBar progress={p} label={t('students.progressGroup', { group: localized(g.title, lang) })} />
            <ul className="rows">{g.topics.map((tp) => box(tp.id, localized(tp.title, lang)))}</ul>
            {p.mastered < p.total && (
              <button className="btn link group-all" onClick={() => tickGroup(g.topics, p.practised + p.mastered < p.total ? 'geoefend' : 'beheerst')}>
                <Icon icon={CheckCheck} />
                {t(p.practised + p.mastered < p.total ? 'students.allPractised' : 'students.allMastered')}
              </button>
            )}
          </div>
        )
      })}
      {student.note && <p className="muted">{student.note}</p>}
      {editing && (
        <StudentSheet
          student={student}
          curricula={curricula}
          onClose={() => setEditing(false)}
          onSave={(input) => void updateStudent(store, student, input).then(() => setEditing(false))}
          onArchive={() =>
            void setArchived(store, [student], todayIso()).then(() => {
              setEditing(false)
              onBack()
              notify(t('students.archived'))
            })
          }
          onDelete={() =>
            void deleteStudents(store, [student]).then((undo) => {
              setEditing(false)
              onBack()
              notify(t('toast.deleted'), undo)
            })
          }
        />
      )}
    </div>
  )
}

function ArchiveView({
  store,
  notify,
  students,
  curricula,
  onBack,
}: {
  store: Store
  notify: Notify
  students: Student[]
  curricula: Curriculum[]
  onBack: () => void
}) {
  const lang = useLang()
  return (
    <div className="stack-lg">
      <button className="btn link back-link" onClick={onBack} aria-label={t('students.backToList')}>
        <Icon icon={ChevronLeft} />
        {t('students.title')}
      </button>
      <header className="page-header">
        <h1>{t('students.archiveTitle')}</h1>
      </header>
      <p className="muted">{t('students.archiveHint')}</p>
      {students.length === 0 ? (
        <Empty icon={Archive}>{t('students.archiveEmpty')}</Empty>
      ) : (
        <>
          <ul className="rows">
            {students.map((s) => {
              const course = curricula.find((c) => c.id === s.curriculumId)
              return (
                <li key={s.id} className="row-item">
                  <span className="row-main">
                    <span>{s.firstName}</span>
                    <span className="muted small">
                      {course ? courseLabel(course, lang) : t('students.unknownCourse')}
                      {s.archivedAt ? ` · ${t('students.archivedOn', { date: formatDate(s.archivedAt) })}` : ''}
                    </span>
                  </span>
                  <button className="btn icon" aria-label={t('students.restore', { name: s.firstName })} onClick={() => void setArchived(store, [s], null)}>
                    <Icon icon={Undo2} />
                  </button>
                </li>
              )
            })}
          </ul>
          <button
            className="btn danger"
            onClick={() =>
              void deleteStudents(store, students).then((undo) => {
                onBack()
                notify(t('students.archiveCleared'), undo)
              })
            }
          >
            <Icon icon={Trash2} />
            {t('students.clearArchive')}
          </button>
        </>
      )}
    </div>
  )
}

function StudentSheet({
  student,
  curricula,
  onSave,
  onArchive,
  onDelete,
  onClose,
}: {
  student: Student | null
  curricula: Curriculum[]
  onSave: (input: StudentInput) => void
  onArchive?: () => void
  onDelete?: () => void
  onClose: () => void
}) {
  const lang = useLang()
  const withTopics = curricula.filter((c) => allTopics(c).length > 0)
  const options = withTopics.length > 0 ? withTopics : curricula
  const [firstName, setFirstName] = useState(student?.firstName ?? '')
  const [curriculumId, setCurriculumId] = useState(student?.curriculumId ?? options[0]?.id ?? '')
  const [level, setLevel] = useState<StudentLevel>(student?.level ?? 'beginner')
  const [startedAt, setStartedAt] = useState(student?.startedAt ?? todayIso())
  const [note, setNote] = useState(student?.note ?? '')
  const [examDate, setExamDate] = useState(student?.exam?.date ?? '')
  const [passed, setPassed] = useState(student?.exam?.passed ?? true)
  const [examNote, setExamNote] = useState(student?.exam?.note ?? '')
  const ok = firstName.trim() !== '' && curriculumId !== '' && !!startedAt

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!ok) return
    onSave({ firstName, curriculumId, level, startedAt, note, exam: examDate ? { date: examDate, passed, note: examNote } : undefined })
  }

  return (
    <Sheet title={student ? t('students.edit') : t('students.add')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">{t('students.privacyHint')}</p>
        <label>
          {t('students.firstName')}
          <input type="text" autoComplete="off" autoCapitalize="words" maxLength={40} autoFocus={!student} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </label>
        <label>
          {t('students.course')}
          <select value={curriculumId} onChange={(e) => setCurriculumId(e.target.value)}>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {courseLabel(c, lang)}
              </option>
            ))}
          </select>
        </label>
        <div className="segments small" role="radiogroup" aria-label={t('students.level')}>
          {STUDENT_LEVELS.map((l) => (
            <button key={l} type="button" role="radio" aria-checked={level === l} className={`segment${level === l ? ' active' : ''}`} onClick={() => setLevel(l)}>
              {t(`level.${l}`)}
            </button>
          ))}
        </div>
        <label>
          {t('students.startedAt')}
          <input type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
        </label>
        {student && (
          <>
            <label>
              {t('students.examDate')}
              <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
            </label>
            {examDate && (
              <>
                <label className="check">
                  <input type="checkbox" checked={passed} onChange={(e) => setPassed(e.target.checked)} />
                  {t('students.passed')}
                </label>
                <label>
                  {t('students.examNote')}
                  <input type="text" autoComplete="off" maxLength={500} value={examNote} onChange={(e) => setExamNote(e.target.value)} />
                </label>
              </>
            )}
          </>
        )}
        <label>
          {t('students.note')}
          <input type="text" autoComplete="off" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!ok}>
            {t('common.save')}
          </button>
          {onArchive && (
            <button className="btn" type="button" onClick={onArchive}>
              <Icon icon={Archive} />
              {t('students.archiveOne')}
            </button>
          )}
          {onDelete && (
            <button className="btn danger" type="button" onClick={onDelete}>
              <Icon icon={Trash2} />
              {t('common.delete')}
            </button>
          )}
        </div>
      </form>
    </Sheet>
  )
}

/** Eén onderwerp voor een groep studenten tegelijk, bijvoorbeeld "vandaag iedereen MOB geoefend". */
function GroupTickSheet({
  store,
  notify,
  students,
  curricula,
  onClose,
}: {
  store: Store
  notify: Notify
  students: Student[]
  curricula: Curriculum[]
  onClose: () => void
}) {
  const lang = useLang()
  const courses = curricula.filter((c) => students.some((s) => s.curriculumId === c.id) && allTopics(c).length > 0)
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '')
  const course = courses.find((c) => c.id === courseId)
  const topics = course ? allTopics(course) : []
  const [topicId, setTopicId] = useState(topics[0]?.id ?? '')
  const inCourse = students.filter((s) => s.curriculumId === courseId)
  const [selected, setSelected] = useState<Set<string>>(new Set(inCourse.map((s) => s.id)))
  const [status, setStatus] = useState<TopicStatus>('geoefend')

  const chooseCourse = (id: string) => {
    setCourseId(id)
    const c = courses.find((x) => x.id === id)
    setTopicId(c ? (allTopics(c)[0]?.id ?? '') : '')
    setSelected(new Set(students.filter((s) => s.curriculumId === id).map((s) => s.id)))
  }

  const apply = (e: FormEvent) => {
    e.preventDefault()
    const now = new Date().toISOString()
    const latest = store.get('students.json.enc')
    const changed = inCourse
      .filter((s) => selected.has(s.id))
      .map((s) => latest.find((l) => l.id === s.id) ?? s)
      .flatMap((s) => {
        const raised = raiseStatus(s, topicId, status, now)
        return raised === s ? [] : [raised]
      })
    void saveStudents(store, changed).then(() => {
      onClose()
      notify(changed.length === 0 ? t('students.alreadyTicked') : t('students.groupTicked', { n: changed.length }))
    })
  }

  return (
    <Sheet title={t('students.groupTick')} onClose={onClose}>
      <form className="stack" onSubmit={apply}>
        {courses.length > 1 && (
          <label>
            {t('students.course')}
            <select value={courseId} onChange={(e) => chooseCourse(e.target.value)}>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {courseLabel(c, lang)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {t('curriculum.topicTitle')}
          <select value={topicId} onChange={(e) => setTopicId(e.target.value)}>
            {topics.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {localized(tp.title, lang)}
              </option>
            ))}
          </select>
        </label>
        <div className="segments small" role="radiogroup" aria-label={t('students.status')}>
          {(['geoefend', 'beheerst'] as const).map((st) => (
            <button key={st} type="button" role="radio" aria-checked={status === st} className={`segment${status === st ? ' active' : ''}`} onClick={() => setStatus(st)}>
              {t(`status.${st}`)}
            </button>
          ))}
        </div>
        <fieldset className="checklist">
          <legend className="muted small">{t('students.who')}</legend>
          {inCourse.map((s) => (
            <label key={s.id} className="check">
              <input
                type="checkbox"
                checked={selected.has(s.id)}
                onChange={(e) => {
                  const next = new Set(selected)
                  if (e.target.checked) next.add(s.id)
                  else next.delete(s.id)
                  setSelected(next)
                }}
              />
              {s.firstName}
            </label>
          ))}
        </fieldset>
        <p className="muted small">{t('students.neverLower')}</p>
        <button className="btn primary" type="submit" disabled={!topicId || selected.size === 0}>
          {t('students.applyTick', { n: inCourse.filter((s) => selected.has(s.id)).length })}
        </button>
      </form>
    </Sheet>
  )
}
