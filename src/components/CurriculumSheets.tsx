import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { getLang, t } from '../i18n'
import { localized, type TopicInput } from '../model/curricula'
import { CURRICULUM_BODIES, type Curriculum, type CurriculumBody, type LocalizedText, type Topic, type TopicKind } from '../model/types'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

// Onderbladen om een cursus, groep of onderwerp te bewerken. Titels in beide talen; één taal invullen is genoeg,
// de andere valt dan terug op de ingevulde.

function TextPair({ label, value, onChange, autoFocus = false }: { label: string; value: LocalizedText; onChange: (v: LocalizedText) => void; autoFocus?: boolean }) {
  const first = getLang()
  const second = first === 'nl' ? 'en' : 'nl'
  return (
    <>
      <label>
        {label} ({t(first === 'nl' ? 'lang.nl' : 'lang.en')})
        <input type="text" autoComplete="off" autoFocus={autoFocus} value={value[first]} onChange={(e) => onChange({ ...value, [first]: e.target.value })} />
      </label>
      <label>
        {label} ({t(second === 'nl' ? 'lang.nl' : 'lang.en')}, {t('curriculum.optional')})
        <input type="text" autoComplete="off" value={value[second]} onChange={(e) => onChange({ ...value, [second]: e.target.value })} />
      </label>
    </>
  )
}

const filled = (v: LocalizedText) => v.nl.trim() !== '' || v.en.trim() !== ''

export function bodyLabel(body: CurriculumBody): string {
  return body === 'eigen' ? t('curriculum.ownBody') : body
}

export function CourseSheet({
  course,
  onSave,
  onDelete,
  onClose,
}: {
  course: Curriculum | null
  onSave: (patch: { body: CurriculumBody; courseCode: string; name: LocalizedText }) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [body, setBody] = useState<CurriculumBody>(course?.body ?? 'eigen')
  const [code, setCode] = useState(course?.courseCode ?? '')
  const [name, setName] = useState<LocalizedText>(course?.name ?? { nl: '', en: '' })
  const ok = filled(name)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (ok) onSave({ body, courseCode: code, name })
  }
  return (
    <Sheet title={course ? t('curriculum.editCourse') : t('curriculum.newCourse')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="two">
          <label>
            {t('curriculum.body')}
            <select value={body} onChange={(e) => setBody(e.target.value as CurriculumBody)}>
              {CURRICULUM_BODIES.map((b) => (
                <option key={b} value={b}>
                  {bodyLabel(b)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('curriculum.code')}
            <input type="text" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
        </div>
        <TextPair label={t('field.name')} value={name} onChange={setName} autoFocus={!course} />
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!ok}>
            {t('common.save')}
          </button>
          {onDelete && (
            <button className="btn danger" type="button" onClick={onDelete}>
              <Icon icon={Trash2} />
              {t('curriculum.deleteCourse')}
            </button>
          )}
        </div>
      </form>
    </Sheet>
  )
}

export function GroupSheet({
  title: initial,
  onSave,
  onDelete,
  onMove,
  onClose,
}: {
  title: LocalizedText | null
  onSave: (title: LocalizedText) => void
  onDelete?: () => void
  onMove?: (delta: -1 | 1) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState<LocalizedText>(initial ?? { nl: '', en: '' })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (filled(title)) onSave(title)
  }
  return (
    <Sheet title={initial ? t('curriculum.editGroup') : t('curriculum.newGroup')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <TextPair label={t('curriculum.groupTitle')} value={title} onChange={setTitle} autoFocus={!initial} />
        {onMove && <MoveButtons onMove={onMove} />}
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!filled(title)}>
            {t('common.save')}
          </button>
          {onDelete && (
            <button className="btn danger" type="button" onClick={onDelete}>
              <Icon icon={Trash2} />
              {t('curriculum.deleteGroup')}
            </button>
          )}
        </div>
      </form>
    </Sheet>
  )
}

export function TopicSheet({
  topic,
  curriculum,
  groupId,
  onSave,
  onDelete,
  onMove,
  onClose,
}: {
  topic: Topic | null
  curriculum: Curriculum
  groupId: string
  onSave: (input: TopicInput, groupId: string) => void
  onDelete?: () => void
  onMove?: (delta: -1 | 1) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState<LocalizedText>(topic?.title ?? { nl: '', en: '' })
  const [kind, setKind] = useState<TopicKind>(topic?.kind ?? 'praktijk')
  const [critical, setCritical] = useState(topic?.examCritical ?? false)
  const [group, setGroup] = useState(groupId)
  const lang = getLang()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (filled(title)) onSave({ title, kind, examCritical: critical }, group)
  }
  return (
    <Sheet title={topic ? t('curriculum.editTopic') : t('curriculum.newTopic')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <TextPair label={t('curriculum.topicTitle')} value={title} onChange={setTitle} autoFocus={!topic} />
        <div className="segments small" role="radiogroup" aria-label={t('curriculum.kind')}>
          {(['theorie', 'praktijk'] as TopicKind[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={`segment${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>
              {t(k === 'theorie' ? 'curriculum.theory' : 'curriculum.practice')}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} />
          {t('curriculum.examCritical')}
        </label>
        {topic && curriculum.groups.length > 1 && (
          <label>
            {t('curriculum.group')}
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              {curriculum.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {localized(g.title, lang)}
                </option>
              ))}
            </select>
          </label>
        )}
        {onMove && <MoveButtons onMove={onMove} />}
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!filled(title)}>
            {t('common.save')}
          </button>
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

function MoveButtons({ onMove }: { onMove: (delta: -1 | 1) => void }) {
  return (
    <div className="two">
      <button type="button" className="btn quiet" onClick={() => onMove(-1)}>
        <Icon icon={ArrowUp} />
        {t('curriculum.moveUp')}
      </button>
      <button type="button" className="btn quiet" onClick={() => onMove(1)}>
        <Icon icon={ArrowDown} />
        {t('curriculum.moveDown')}
      </button>
    </div>
  )
}
