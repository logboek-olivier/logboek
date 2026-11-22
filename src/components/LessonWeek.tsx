import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { t, useLang } from '../i18n'
import { participantName } from '../model/guests'
import {
  activeLabels,
  BLOCK_SECTIONS,
  blocksForWeek,
  coursesOf,
  doneFor,
  elementsFor,
  LESSON_COURSES,
  LESSON_TRACKS,
  openPerCourse,
  studentsFor,
  type LessonBlock,
  type LessonCourse,
  type LessonStudent,
} from '../model/lesweek'
import { localized } from '../model/curricula'
import type { Participant, Trip } from '../model/types'
import { participantRole } from '../model/weeks'
import type { Store } from '../storage/store'
import { lesblokAfvinken, lesblokStudentWisselen, lescursussenZetten } from '../domain/training'
import { Icon } from './Icon'
import { LessonPlanner } from './LessonPlanner'
import type { Notify } from './EditSheets'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'

// Lesweek (src/model/lesweek.ts): afvinken per blok, los van een planning. Bovenaan de studenten met hun cursussen en
// per cursus wat nog openstaat; daaronder de blokken per soort. Eén tik op het vak = gedaan voor de hele groep; bij een
// studentblok staan daarna de namen eronder: een naam aantikken = die student nog niet.

/** De studenten van de trip voor de lesweek: deelnemers met de rol student (of zonder rol in een lestrip). */
export function lessonStudents(trip: Trip, studentIds: ReadonlySet<string>): { participant: Participant; student: LessonStudent }[] {
  const people = trip.participants ?? []
  return people
    .filter((p) => participantRole(p, trip, studentIds.has(p.id)) === 'student')
    .map((p) => ({ participant: p, student: { id: p.id, name: participantName(p, people), courses: coursesOf(p, trip) } }))
}

export function LessonWeek({ store, trip, notify, heading: Heading }: { store: Store; trip: Trip; notify: Notify; heading: 'h2' | 'h3' }) {
  const lang = useLang()
  const studentRecords = useCollection(store, 'students.json.enc')
  const ids = new Set(studentRecords.filter((s) => s.deletedAt === null).map((s) => s.id))
  const list = lessonStudents(trip, ids)
  const students = list.map((x) => x.student)
  const blocks = blocksForWeek(students, trip)
  const labels = activeLabels(students, trip)
  const overview = openPerCourse(trip, students)
  const [openBlock, setOpenBlock] = useState<string | null>(null)
  const [choosing, setChoosing] = useState<Participant | null>(null)
  const [view, setView] = useState<'afvinken' | 'planning'>(trip.lessonPlan ? 'planning' : 'afvinken')
  const without = list.filter((x) => x.student.courses.length === 0)

  function tick(block: LessonBlock) {
    const wasDone = !!trip.lessonChecks?.[block.id]
    void lesblokAfvinken(store, trip.id, block.id)
    // Na afvinken van een studentblok de namen tonen, zodat "nog niet" één tik is.
    if (!wasDone && block.kind === 'student' && studentsFor(block, students).length > 1) setOpenBlock(block.id)
  }

  return (
    <div className="section stack-sm lesson-week">
      <Heading>{t('lesson.title')}</Heading>
      {list.length > 0 && (
        <div className="lesson-names lesson-students">
          {list.map(({ participant, student }) => (
            <button key={student.id} type="button" className="chip lesson-name" onClick={() => setChoosing(participant)} aria-label={`${t('lesson.chooseCourses')}: ${student.name}`}>
              {student.name}
              <span className="muted">{student.courses.length > 0 ? student.courses.map((c) => t(`lesson.course.${c}`)).join(' · ') : t('lesson.noCourses')}</span>
            </button>
          ))}
        </div>
      )}
      {without.length > 0 && <p className="muted small">{t('lesson.chooseHint')}</p>}

      {trip.startDate && (
        <div className="segments small" role="radiogroup" aria-label={t('lesson.title')}>
          {(['afvinken', 'planning'] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} className={`segment${view === v ? ' active' : ''}`} onClick={() => setView(v)}>
              {t(`lesson.view.${v}`)}
            </button>
          ))}
        </div>
      )}
      {view === 'planning' && trip.startDate && <LessonPlanner store={store} trip={trip} students={students} labels={labels} notify={notify} />}

      {(view === 'afvinken' || !trip.startDate) && (
        <>
      {overview.length > 0 && (
        <ul className="lesson-overview">
          {overview.map((o) => (
            <li key={o.course}>
              {o.open.length === 0 ? (
                <p className="small positive">{t('lesson.courseDone', { course: o.course })}</p>
              ) : (
                <details>
                  <summary className="small">{t('lesson.courseOpen', { course: o.course, n: o.open.length, total: o.total })}</summary>
                  <p className="small muted">{o.open.map((x) => (x.names.length > 0 ? `${localized(x.block.title, lang)} (${x.names.join(', ')})` : localized(x.block.title, lang))).join(' · ')}</p>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      {BLOCK_SECTIONS.map((section) => {
        const inSection = blocks.filter((x) => x.section === section)
        if (inSection.length === 0) return null
        return (
          <div key={section} className="stack-sm">
            <h4 className="small muted">{t(`lesson.section.${section}`)}</h4>
            <ul className="check-items lesson-blocks">
              {inSection.map((block) => (
                <BlockRow key={block.id} store={store} trip={trip} block={block} students={studentsFor(block, students)} labels={labels} expanded={openBlock === block.id} onExpand={() => setOpenBlock(openBlock === block.id ? null : block.id)} onTick={() => tick(block)} />
              ))}
            </ul>
          </div>
        )
      })}
        </>
      )}
      {choosing && <CoursesSheet store={store} trip={trip} participant={choosing} onClose={() => setChoosing(null)} />}
    </div>
  )
}

function BlockRow({ store, trip, block, students, labels, expanded, onExpand, onTick }: { store: Store; trip: Trip; block: LessonBlock; students: LessonStudent[]; labels: ReturnType<typeof activeLabels>; expanded: boolean; onExpand: () => void; onTick: () => void }) {
  const lang = useLang()
  const on = !!trip.lessonChecks?.[block.id]
  const notYet = block.kind === 'student' ? students.filter((s) => !doneFor(trip, block.id, s.id)) : []
  const elements = elementsFor(block, labels)
  const title = localized(block.title, lang)
  return (
    <li className={`lesson-block${on ? ' on' : ''}`}>
      <div className="lesson-row">
        <button type="button" role="checkbox" aria-checked={on} aria-label={title} className="lesson-check" onClick={onTick}>
          <span className="check-box">{on && <Icon icon={Check} />}</span>
        </button>
        <button type="button" className="lesson-title" aria-expanded={expanded} onClick={onExpand}>
          <span className="row-main">
            <span>
              <span className="lesson-code">{block.section === 'examen' ? '' : `${block.id} `}</span>
              {title}
            </span>
            {on && notYet.length > 0 && <span className="small negative">{t('lesson.notYetNames', { names: notYet.map((s) => s.name).join(', ') })}</span>}
          </span>
          <Icon icon={expanded ? ChevronUp : ChevronDown} />
        </button>
      </div>
      {expanded && (
        <div className="lesson-detail stack-sm">
          {elements.length > 0 && (
            <ul className="lesson-elements small">
              {elements.map((e, i) => (
                <li key={i}>
                  {localized(e.text, lang)}
                  {e.label && e.label !== 'mono' && <span className="lesson-label">{e.label === 'star' ? '★' : e.label}</span>}
                </li>
              ))}
            </ul>
          )}
          {block.kind === 'student' && students.length > 0 && (
            <div className="lesson-names">
              {students.map((s) => {
                const ok = on && doneFor(trip, block.id, s.id)
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`chip lesson-name${ok ? ' ok' : on ? ' not-yet' : ''}`}
                    aria-pressed={ok}
                    aria-label={`${s.name}: ${ok ? t('lesson.ok') : t('lesson.notYet')}`}
                    onClick={() => void lesblokStudentWisselen(store, trip.id, block.id, s.id)}
                  >
                    {ok && <Icon icon={Check} />}
                    {s.name}
                  </button>
                )
              })}
            </div>
          )}
          {block.asa && <p className="muted small">ASA {block.asa}</p>}
        </div>
      )}
    </li>
  )
}

/** De cursussen van een student kiezen: een spoor met één tik, of per cursus aan en uit. Direct opgeslagen. */
function CoursesSheet({ store, trip, participant, onClose }: { store: Store; trip: Trip; participant: Participant; onClose: () => void }) {
  const live = (store.list('trips.json.enc').find((x) => x.id === trip.id) ?? trip).participants?.find((p) => p.id === participant.id) ?? participant
  const [courses, setCourses] = useState<LessonCourse[]>(live.courses ?? [])
  const name = participantName(participant, trip.participants ?? [])
  const mono = trip.boatKind === 'eenromp'

  function save(next: LessonCourse[]) {
    setCourses(next)
    void lescursussenZetten(store, trip.id, participant.id, next)
  }

  return (
    <Sheet title={name} onClose={onClose}>
      <div className="stack">
        <div className="stack-sm">
          <p className="small muted">{t('lesson.tracks')}</p>
          <div className="type-buttons">
            {LESSON_TRACKS.map((track) => {
              const same = track.courses.length === courses.length && track.courses.every((c) => courses.includes(c))
              return (
                <button key={track.id} type="button" className={`chip${same ? ' active' : ''}`} aria-pressed={same} onClick={() => save(track.courses)}>
                  {t(`lesson.track.${track.id}`)}
                </button>
              )
            })}
          </div>
        </div>
        <div className="stack-sm">
          <p className="small muted">{t('lesson.courses')}</p>
          <div className="type-buttons">
            {LESSON_COURSES.map((c) => {
              const on = courses.includes(c)
              return (
                <button key={c} type="button" className={`chip${on ? ' active' : ''}`} aria-pressed={on} onClick={() => save(on ? courses.filter((x) => x !== c) : [...courses, c])}>
                  {t(`lesson.course.${c}`)}
                </button>
              )
            })}
          </div>
          {mono && courses.includes('114') && <p className="small muted">{t('lesson.mono114')}</p>}
        </div>
        <button type="button" className="btn primary" onClick={onClose}>
          {t('lesson.done')}
        </button>
      </div>
    </Sheet>
  )
}
