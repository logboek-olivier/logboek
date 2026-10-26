import { BookOpen, ChevronLeft, ChevronRight, FileUp, Flag, Pencil, Plus, Share2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { CourseSheet, GroupSheet, TopicSheet } from '../components/CurriculumSheets'
import type { Notify } from '../components/EditSheets'
import { Empty } from '../components/Empty'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { recordError } from '../errors'
import { t, useLang } from '../i18n'
import {
  addGroup,
  addTopic,
  byBody,
  courseLabel,
  deleteCurriculum,
  effectiveCurricula,
  exportCurriculum,
  exportFileName,
  importCurriculum,
  localized,
  moveGroup,
  moveTopic,
  newCurriculum,
  removeGroup,
  removeTopic,
  renameCourse,
  saveCurriculum,
  topicCount,
  updateGroup,
  updateTopic,
} from '../model/curricula'
import type { Curriculum } from '../model/types'
import type { Store } from '../storage/store'
import { ErrorLine } from './Setup'
// Cursussen (onder Meer): per bond (ASA, RYA, CWO, eigen) met hun checklist van onderwerpen. Alles is te bewerken,
// te delen als JSON en te importeren.

export function Courses({ store, notify }: { store: Store; notify: Notify }) {
  const stored = useCollection(store, 'curricula.json.enc')
  const curricula = effectiveCurricula(stored)
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const lang = useLang()

  const open = curricula.find((c) => c.id === openId)
  if (open) return <CourseView store={store} course={open} notify={notify} onBack={() => setOpenId(null)} />

  async function onImport(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = ''
    if (!file) return
    setError(null)
    try {
      const course = importCurriculum(await file.text())
      await saveCurriculum(store, course)
      notify(t('curriculum.imported'))
      setOpenId(course.id)
    } catch (e) {
      recordError(e)
      setError(t('curriculum.importError'))
    }
  }

  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('curriculum.courses')}</h1>
        <button className="btn small quiet" onClick={() => setCreating(true)}>
          <Icon icon={Plus} />
          {t('curriculum.newCourse')}
        </button>
      </header>
      <ErrorLine error={error} />
      {byBody(curricula).map((group) => (
        <div key={group.body} className="section">
          <h2>{group.body === 'eigen' ? t('curriculum.ownCourses') : group.body}</h2>
          <ul className="rows">
            {group.curricula.map((c) => {
              const count = topicCount(c)
              const critical = c.groups.reduce((n, g) => n + g.topics.filter((tp) => tp.examCritical).length, 0)
              return (
                <li key={c.id}>
                  <button className="settings-row course-row" onClick={() => setOpenId(c.id)}>
                    <Icon icon={BookOpen} />
                    <span className="row-main">
                      <span>{courseLabel(c, lang)}</span>
                      <span className="muted small">
                        {count === 0 ? t('curriculum.noTopicsShort') : t('curriculum.topicCount', { n: count, critical })}
                      </span>
                    </span>
                    <Icon icon={ChevronRight} className="chevron" />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      <input ref={fileInput} type="file" hidden aria-label={t('curriculum.importFile')} onChange={(e) => void onImport(e.target.files?.[0])} />
      <button className="btn link" onClick={() => fileInput.current?.click()}>
        <Icon icon={FileUp} />
        {t('curriculum.import')}
      </button>
      {creating && (
        <CourseSheet
          course={null}
          onClose={() => setCreating(false)}
          onSave={(patch) => {
            const course = newCurriculum(patch.body, patch.courseCode, patch.name)
            void saveCurriculum(store, course).then(() => {
              setCreating(false)
              setOpenId(course.id)
            })
          }}
        />
      )}
    </section>
  )
}

type Editing =
  | { kind: 'course' }
  | { kind: 'group'; groupId: string | null }
  | { kind: 'topic'; groupId: string; topicId: string | null }
  | null

function CourseView({ store, course, notify, onBack }: { store: Store; course: Curriculum; notify: Notify; onBack: () => void }) {
  const lang = useLang()
  const [editMode, setEditMode] = useState(false)
  const [editing, setEditing] = useState<Editing>(null)
  const save = (next: Curriculum) => saveCurriculum(store, next)
  const close = () => setEditing(null)

  async function share() {
    const json = exportCurriculum(course)
    const name = exportFileName(course)
    const file = new File([json], name, { type: 'application/json' })
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: courseLabel(course, lang) })
        return
      }
    } catch (e) {
      // Afgebroken door Olivier: niets doen.
      if (e instanceof Error && e.name === 'AbortError') return
    }
    // Geen deelfunctie: als bestand downloaden.
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  const editingGroup = editing?.kind === 'group' && editing.groupId ? course.groups.find((g) => g.id === editing.groupId) : null
  const editingTopic =
    editing?.kind === 'topic' && editing.topicId ? course.groups.flatMap((g) => g.topics).find((tp) => tp.id === editing.topicId) : null

  return (
    <section className="stack-lg">
      <button className="btn link back-link" onClick={onBack} aria-label={t('curriculum.backToCourses')}>
        <Icon icon={ChevronLeft} />
        {t('curriculum.courses')}
      </button>
      <header className="page-header">
        <h1>{courseLabel(course, lang)}</h1>
      </header>
      {course.source === 'seed' && course.body === 'ASA' && <p className="notice-quiet">{t('curriculum.checkOfficial')}</p>}
      <div className="row wrap">
        <button className={`btn small${editMode ? ' primary' : ' quiet'}`} aria-pressed={editMode} onClick={() => setEditMode(!editMode)}>
          <Icon icon={Pencil} />
          {editMode ? t('curriculum.done') : t('common.edit')}
        </button>
        <button className="btn small quiet" onClick={() => void share()}>
          <Icon icon={Share2} />
          {t('curriculum.share')}
        </button>
        {editMode && (
          <button className="btn small quiet" onClick={() => setEditing({ kind: 'course' })}>
            {t('curriculum.courseDetails')}
          </button>
        )}
      </div>

      {course.groups.length === 0 && (
        <Empty
          icon={BookOpen}
          action={
            <button
              className="btn primary"
              onClick={() => {
                setEditMode(true)
                setEditing({ kind: 'group', groupId: null })
              }}
            >
              {t('curriculum.addGroup')}
            </button>
          }
        >
          {t('curriculum.empty')}
        </Empty>
      )}

      {course.groups.map((g) => (
        <div key={g.id} className="section">
          <div className="section-head">
            <h2>{localized(g.title, lang)}</h2>
            {editMode && (
              <button className="btn icon" aria-label={t('curriculum.editGroupNamed', { name: localized(g.title, lang) })} onClick={() => setEditing({ kind: 'group', groupId: g.id })}>
                <Icon icon={Pencil} />
              </button>
            )}
          </div>
          <ul className="rows">
            {g.topics.map((tp) => {
              const content = (
                <>
                  <span className="row-main">
                    <span>{localized(tp.title, lang)}</span>
                    <span className="topic-meta">
                      <span className="tag">{t(tp.kind === 'theorie' ? 'curriculum.theory' : 'curriculum.practice')}</span>
                      {tp.examCritical && (
                        <span className="tag critical">
                          <Icon icon={Flag} />
                          {t('curriculum.examCriticalShort')}
                        </span>
                      )}
                    </span>
                  </span>
                  {editMode && <Icon icon={Pencil} className="chevron" />}
                </>
              )
              return (
                <li key={tp.id} className="topic">
                  {editMode ? (
                    <button className="row-item" onClick={() => setEditing({ kind: 'topic', groupId: g.id, topicId: tp.id })}>
                      {content}
                    </button>
                  ) : (
                    <div className="row-item">{content}</div>
                  )}
                </li>
              )
            })}
            {editMode && (
              <li>
                <button className="row-item add-row" onClick={() => setEditing({ kind: 'topic', groupId: g.id, topicId: null })}>
                  <Icon icon={Plus} />
                  <span className="row-main">{t('curriculum.addTopic')}</span>
                </button>
              </li>
            )}
            {g.topics.length === 0 && !editMode && (
              <li className="row-item">
                <span className="muted">{t('curriculum.groupEmpty')}</span>
              </li>
            )}
          </ul>
        </div>
      ))}
      {editMode && course.groups.length > 0 && (
        <button className="btn quiet" onClick={() => setEditing({ kind: 'group', groupId: null })}>
          <Icon icon={Plus} />
          {t('curriculum.addGroup')}
        </button>
      )}

      {editing?.kind === 'course' && (
        <CourseSheet
          course={course}
          onClose={close}
          onSave={(patch) => void save(renameCourse(course, patch)).then(close)}
          onDelete={() =>
            void deleteCurriculum(store, course).then((undo) => {
              close()
              onBack()
              notify(t('toast.deleted'), undo)
            })
          }
        />
      )}
      {editing?.kind === 'group' && (
        <GroupSheet
          title={editingGroup?.title ?? null}
          onClose={close}
          onSave={(title) => void save(editingGroup ? updateGroup(course, editingGroup.id, title) : addGroup(course, title)).then(close)}
          onDelete={editingGroup ? () => void save(removeGroup(course, editingGroup.id)).then(close) : undefined}
          onMove={editingGroup ? (delta) => void save(moveGroup(course, editingGroup.id, delta)) : undefined}
        />
      )}
      {editing?.kind === 'topic' && (
        <TopicSheet
          topic={editingTopic ?? null}
          curriculum={course}
          groupId={editing.groupId}
          onClose={close}
          onSave={(input, groupId) =>
            void save(editingTopic ? updateTopic(course, editingTopic.id, input, groupId) : addTopic(course, groupId, input)).then(close)
          }
          onDelete={editingTopic ? () => void save(removeTopic(course, editingTopic.id)).then(close) : undefined}
          onMove={editingTopic ? (delta) => void save(moveTopic(course, editingTopic.id, delta)) : undefined}
        />
      )}
    </section>
  )
}

