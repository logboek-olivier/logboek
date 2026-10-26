import { CalendarPlus, Check, ChevronLeft, ChevronRight, MapPin, Pencil, Plus, Presentation as PresentationIcon, Printer, Share2, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Notify } from '../components/EditSheets'
import { Empty } from '../components/Empty'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { useCollection } from '../components/useCollection'
import { formatDateRange, formatWeekday } from '../format'
import { getLang, LANGS, t, translate, useLang, type Lang } from '../i18n'
import { allTopics, courseLabel, effectiveCurricula, localized } from '../model/curricula'
import { tripForDate } from '../model/derive'
import {
  activePlan,
  addBlock,
  blocksOn,
  capitalize,
  deletePlan,
  draftPlan,
  findBlock,
  groupName,
  MAX_DAYS,
  moveBlock,
  newGroup,
  noteIn,
  planEnd,
  planText,
  removeBlock,
  reschedule,
  savePlan,
  slotLabel,
  sortBlocks,
  splitPlans,
  studentsFor,
  tickForGroup,
  topicChoices,
  topicDone,
  topicIndex,
  updateBlock,
  updateGroups,
  type BlockPatch,
} from '../model/plans'
import { activeStudents, saveStudents } from '../model/students'
import { DAY_SLOTS, STUDENT_LEVELS, todayIso, type Curriculum, type DaySlot, type PlanBlock, type PlanGroup, type Student, type Trip, type WeekPlan } from '../model/types'
import type { Store } from '../storage/store'

// Weekplanning: wizard van drie schermen (dagen → groepen → concept), bewerken met tikken, tonen aan studenten
// (alleen de planning, volledig scherm), delen als tekst of als PDF via de printfunctie. Exporttaal los van de app-taal.

type View = { kind: 'list' } | { kind: 'plan'; id: string } | { kind: 'wizard' }

export function PlansView({ store, notify, curricula }: { store: Store; notify: Notify; curricula: Curriculum[] }) {
  const plans = useCollection(store, 'plans.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const [view, setView] = useState<View>({ kind: 'list' })
  const lang = useLang()
  const today = todayIso()

  if (view.kind === 'wizard') {
    return (
      <PlanWizard
        store={store}
        curricula={curricula}
        onCancel={() => setView({ kind: 'list' })}
        onSaved={(id) => {
          notify(t('plan.saved'))
          setView({ kind: 'plan', id })
        }}
      />
    )
  }
  if (view.kind === 'plan') {
    const plan = plans.find((p) => p.id === view.id && p.deletedAt === null)
    if (plan) return <PlanView store={store} notify={notify} plan={plan} curricula={curricula} trips={trips} onBack={() => setView({ kind: 'list' })} />
  }

  const { current, past } = splitPlans(plans, today)
  const row = (p: WeekPlan) => {
    const trip = trips.find((tr) => tr.id === p.tripId && tr.deletedAt === null)
    const live = p.startDate <= today && today <= planEnd(p)
    return (
      <li key={p.id}>
        <button className="settings-row" onClick={() => setView({ kind: 'plan', id: p.id })}>
          <Icon icon={CalendarPlus} />
          <span className="row-main">
            <span>{p.title}</span>
            <span className="muted small">
              {formatDateRange(p.startDate, planEnd(p), lang)}
              {trip ? ` · ${trip.name}` : ''}
            </span>
          </span>
          {live && <span className="tag">{t('plan.now')}</span>}
          <Icon icon={ChevronRight} className="chevron" />
        </button>
      </li>
    )
  }

  return (
    <div className="stack-lg">
      <div className="row wrap">
        <button className="btn small primary" onClick={() => setView({ kind: 'wizard' })}>
          <Icon icon={Plus} />
          {t('plan.new')}
        </button>
      </div>
      {current.length === 0 && past.length === 0 && <Empty icon={CalendarPlus}>{t('plan.empty')}</Empty>}
      {current.length > 0 && <ul className="rows">{current.map(row)}</ul>}
      {past.length > 0 && (
        <div className="section">
          <h2>{t('plan.past')}</h2>
          <ul className="rows">{past.map(row)}</ul>
        </div>
      )}
    </div>
  )
}

// ---------- Wizard ----------

function PlanWizard({ store, curricula, onCancel, onSaved }: { store: Store; curricula: Curriculum[]; onCancel: () => void; onSaved: (id: string) => void }) {
  const lang = useLang()
  const trips = store.list('trips.json.enc')
  const legs = store.list('legs.json.enc')
  const students = activeStudents(store.get('students.json.enc'))
  const courses = curricula.filter((c) => allTopics(c).length > 0)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [startDate, setStartDate] = useState(todayIso())
  const [dayCount, setDayCount] = useState(5)
  const [title, setTitle] = useState('')
  const autoTrip = tripForDate(trips, legs, startDate)
  const [tripId, setTripId] = useState<string | null>(null)
  const chosenTrip = tripId === null ? (autoTrip?.id ?? '') : tripId
  const [groups, setGroups] = useState<PlanGroup[]>(() => [newGroup(groupName(0, getLang()), courses[0]?.id ?? '')])

  const days = Math.max(1, Math.min(MAX_DAYS, dayCount || 1))
  const finalTitle = title.trim() || t('plan.defaultTitle', { date: formatDateRange(startDate, planEnd({ startDate, dayCount: days }), lang) })
  const concept = useMemo(
    () => (step === 3 ? draftPlan({ title: finalTitle, startDate, dayCount: days, tripId: chosenTrip || undefined, groups }, curricula, lang) : null),
    [step, finalTitle, startDate, days, chosenTrip, groups, curricula, lang],
  )

  const setGroup = (id: string, patch: Partial<PlanGroup>) => setGroups(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)))

  const next = (e: FormEvent) => {
    e.preventDefault()
    if (step === 1 && startDate) setStep(2)
    else if (step === 2 && groups.length > 0 && groups.every((g) => g.curriculumId)) setStep(3)
  }

  const save = () => {
    if (!concept) return
    void savePlan(store, concept).then(() => onSaved(concept.id))
  }

  return (
    <div className="stack-lg">
      <button className="btn link back-link" onClick={step === 1 ? onCancel : () => setStep((step - 1) as 1 | 2)}>
        <Icon icon={ChevronLeft} />
        {step === 1 ? t('nav.training') : t('common.back')}
      </button>
      <header className="page-header">
        <h1>{t('plan.new')}</h1>
        <span className="muted small">{t('plan.step', { n: step })}</span>
      </header>

      {step === 1 && (
        <form className="stack" onSubmit={next}>
          <div className="two">
            <label>
              {t('plan.startDate')}
              <input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label>
              {t('plan.dayCount')}
              <input type="number" inputMode="numeric" min={1} max={MAX_DAYS} value={dayCount || ''} onChange={(e) => setDayCount(Number(e.target.value))} />
            </label>
          </div>
          <label>
            {t('plan.title')}
            <input type="text" autoComplete="off" maxLength={120} placeholder={finalTitle} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {trips.length > 0 && <TripSelect trips={trips} value={chosenTrip} onChange={setTripId} />}
          <button className="btn primary" type="submit">
            {t('plan.next')}
          </button>
        </form>
      )}

      {step === 2 && (
        <form className="stack" onSubmit={next}>
          {courses.length === 0 && <p className="notice">{t('plan.noCourses')}</p>}
          {groups.map((g, i) => (
            <GroupFields
              key={g.id}
              group={g}
              index={i}
              courses={courses}
              students={students}
              onChange={(patch) => setGroup(g.id, patch)}
              onRemove={groups.length > 1 ? () => setGroups(groups.filter((x) => x.id !== g.id)) : undefined}
            />
          ))}
          <button type="button" className="btn quiet" onClick={() => setGroups([...groups, newGroup(groupName(groups.length, lang), courses[0]?.id ?? '')])}>
            <Icon icon={Plus} />
            {t('plan.addGroup')}
          </button>
          <button className="btn primary" type="submit" disabled={courses.length === 0}>
            {t('plan.makeConcept')}
          </button>
        </form>
      )}

      {step === 3 && concept && (
        <>
          <p className="muted small">{t('plan.conceptHint')}</p>
          <PlanDays plan={concept} curricula={curricula} lang={lang} />
          <button className="btn primary" onClick={save}>
            {t('plan.save')}
          </button>
        </>
      )}
    </div>
  )
}

function TripSelect({ trips, value, onChange }: { trips: Trip[]; value: string; onChange: (id: string) => void }) {
  return (
    <label>
      {t('plan.trip')}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('plan.noTrip')}</option>
        {trips.map((tr) => (
          <option key={tr.id} value={tr.id}>
            {tr.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function GroupFields({
  group,
  index,
  courses,
  students,
  onChange,
  onRemove,
}: {
  group: PlanGroup
  index: number
  courses: Curriculum[]
  students: readonly Student[]
  onChange: (patch: Partial<PlanGroup>) => void
  onRemove?: () => void
}) {
  const lang = useLang()
  const inCourse = students.filter((s) => s.curriculumId === group.curriculumId)
  return (
    <fieldset className="card stack plan-group">
      <legend className="sr-only">{group.name || groupName(index, lang)}</legend>
      <div className="row">
        <label className="grow">
          {t('plan.groupNameLabel')}
          <input type="text" autoComplete="off" maxLength={40} value={group.name} onChange={(e) => onChange({ name: e.target.value })} />
        </label>
        {onRemove && (
          <button type="button" className="btn icon" aria-label={t('plan.removeGroup', { name: group.name })} onClick={onRemove}>
            <Icon icon={Trash2} />
          </button>
        )}
      </div>
      <label>
        {t('students.course')}
        <select value={group.curriculumId} onChange={(e) => onChange({ curriculumId: e.target.value, studentIds: [] })}>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {courseLabel(c, lang)}
            </option>
          ))}
        </select>
      </label>
      <div className="segments small" role="radiogroup" aria-label={t('students.level')}>
        {STUDENT_LEVELS.map((l) => (
          <button key={l} type="button" role="radio" aria-checked={group.level === l} className={`segment${group.level === l ? ' active' : ''}`} onClick={() => onChange({ level: l })}>
            {t(`level.${l}`)}
          </button>
        ))}
      </div>
      {inCourse.length > 0 && (
        <div className="checklist">
          <span className="muted small">{t('plan.studentsOptional')}</span>
          {inCourse.map((s) => (
            <label key={s.id} className="check">
              <input
                type="checkbox"
                checked={group.studentIds.includes(s.id)}
                onChange={(e) => onChange({ studentIds: e.target.checked ? [...group.studentIds, s.id] : group.studentIds.filter((id) => id !== s.id) })}
              />
              {s.firstName}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}

// ---------- Planning bekijken en bewerken ----------

function PlanView({
  store,
  notify,
  plan,
  curricula,
  trips,
  onBack,
}: {
  store: Store
  notify: Notify
  plan: WeekPlan
  curricula: Curriculum[]
  trips: readonly Trip[]
  onBack: () => void
}) {
  const lang = useLang()
  const students = useCollection(store, 'students.json.enc')
  const [editingBlock, setEditingBlock] = useState<string | null>(null)
  const [editingPlan, setEditingPlan] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [presenting, setPresenting] = useState<Lang | null>(null)
  const [printLang, setPrintLang] = useState<Lang | null>(null)
  const [printRequest, setPrintRequest] = useState(0)
  const trip = trips.find((tr) => tr.id === plan.tripId && tr.deletedAt === null)

  useEffect(() => {
    if (printRequest > 0) window.print()
  }, [printRequest])

  if (presenting) return <Presentation plan={plan} curricula={curricula} lang={presenting} onClose={() => setPresenting(null)} />

  const block = editingBlock ? findBlock(plan, editingBlock) : null

  return (
    <div className="stack-lg">
      <button className="btn link back-link" onClick={onBack} aria-label={t('plan.backToList')}>
        <Icon icon={ChevronLeft} />
        {t('plan.list')}
      </button>
      <header className="page-header">
        <h1>{plan.title}</h1>
        <button className="btn icon" aria-label={t('plan.edit')} onClick={() => setEditingPlan(true)}>
          <Icon icon={Pencil} />
        </button>
      </header>
      <p className="muted">
        {formatDateRange(plan.startDate, planEnd(plan), lang)}
        {trip ? ` · ${trip.name}` : ''}
        {plan.groups.length > 0 ? ` · ${plan.groups.map((g) => g.name).join(', ')}` : ''}
      </p>
      <div className="row wrap">
        <button className="btn small primary" onClick={() => setPresenting(lang)}>
          <Icon icon={PresentationIcon} />
          {t('plan.present')}
        </button>
        <button className="btn small quiet" onClick={() => setSharing(true)}>
          <Icon icon={Share2} />
          {t('plan.share')}
        </button>
      </div>
      <PlanDays
        plan={plan}
        curricula={curricula}
        lang={lang}
        renderTopic={(b, topicId, title) => <TopicTick store={store} notify={notify} plan={plan} block={b} topicId={topicId} title={title} curricula={curricula} students={students} />}
        onEditBlock={(id) => setEditingBlock(id)}
        onAddBlock={(date) => {
          const { plan: next, blockId } = addBlock(plan, date, 'ochtend', plan.groups.length === 1 ? [plan.groups[0]!.id] : [])
          void savePlan(store, next).then(() => setEditingBlock(blockId))
        }}
      />
      {block && (
        <BlockSheet
          plan={plan}
          block={block.block}
          date={block.date}
          curricula={curricula}
          onClose={() => setEditingBlock(null)}
          onSave={(patch, date, slot) => {
            let next = updateBlock(plan, block.block.id, patch)
            if (date !== block.date || slot !== block.block.slot) next = moveBlock(next, block.block.id, date, slot)
            void savePlan(store, next).then(() => setEditingBlock(null))
          }}
          onDelete={() => {
            const before = plan
            void savePlan(store, removeBlock(plan, block.block.id)).then(() => {
              setEditingBlock(null)
              notify(t('plan.blockDeleted'), () => savePlan(store, before))
            })
          }}
        />
      )}
      {editingPlan && (
        <PlanSheet
          store={store}
          plan={plan}
          trips={trips}
          onClose={() => setEditingPlan(false)}
          onSave={(next) => void savePlan(store, next).then(() => setEditingPlan(false))}
          onDelete={() =>
            void deletePlan(store, plan).then((undo) => {
              setEditingPlan(false)
              onBack()
              notify(t('toast.deleted'), undo)
            })
          }
        />
      )}
      {sharing && (
        <ShareSheet
          plan={plan}
          curricula={curricula}
          notify={notify}
          onClose={() => setSharing(false)}
          onPresent={(l) => {
            setSharing(false)
            setPresenting(l)
          }}
          onPrint={(l) => {
            setSharing(false)
            setPrintLang(l)
            setPrintRequest((n) => n + 1)
          }}
        />
      )}
      {printLang && createPortal(<PlanPrint plan={plan} curricula={curricula} lang={printLang} trip={trip} />, document.body)}
    </div>
  )
}

/** Dagen met hun blokken. Zonder renderTopic alleen lezen (concept, tonen, printen). */
function PlanDays({
  plan,
  curricula,
  lang,
  renderTopic,
  onEditBlock,
  onAddBlock,
}: {
  plan: WeekPlan
  curricula: readonly Curriculum[]
  lang: Lang
  renderTopic?: (block: PlanBlock, topicId: string, title: string) => ReactNode
  onEditBlock?: (blockId: string) => void
  onAddBlock?: (date: string) => void
}) {
  const topics = topicIndex(curricula)
  return (
    <div className="plan-days">
      {plan.days.map((day) => {
        const blocks = sortBlocks(day.blocks)
        if (blocks.length === 0 && !onAddBlock) return null
        return (
          <section key={day.date} className="section plan-day">
            <h2>{capitalize(formatWeekday(day.date, lang))}</h2>
            {blocks.map((b) => (
              <article key={b.id} className={`card plan-block slot-${b.slot}`}>
                <header className="plan-block-head">
                  <span className="plan-slot">{slotLabel(b.slot, lang)}</span>
                  <span className="muted small grow">
                    {plan.groups
                      .filter((g) => b.groupIds.includes(g.id))
                      .map((g) => g.name)
                      .join(', ')}
                  </span>
                  {onEditBlock && (
                    <button className="btn icon" aria-label={translate(lang, 'plan.editBlock', { slot: slotLabel(b.slot, lang), day: formatWeekday(day.date, lang) })} onClick={() => onEditBlock(b.id)}>
                      <Icon icon={Pencil} />
                    </button>
                  )}
                </header>
                {b.location && (
                  <p className="muted small plan-location">
                    <Icon icon={MapPin} />
                    {b.location}
                  </p>
                )}
                {b.topicIds.length > 0 && (
                  <ul className="plan-topics">
                    {b.topicIds.map((id) => {
                      const found = topics.get(id)
                      if (!found) return null
                      const title = localized(found.topic.title, lang)
                      return <li key={id}>{renderTopic ? renderTopic(b, id, title) : <span className="plan-topic">{title}</span>}</li>
                    })}
                  </ul>
                )}
                {b.note && <p className="small plan-note">{noteIn(b.note, lang)}</p>}
              </article>
            ))}
            {onAddBlock && (
              <button className="btn link" onClick={() => onAddBlock(day.date)}>
                <Icon icon={Plus} />
                {t('plan.addBlock')}
              </button>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** Tik op een onderwerp = geoefend voor de hele groep (verlaagt nooit), met ongedaan maken. */
function TopicTick({
  store,
  notify,
  plan,
  block,
  topicId,
  title,
  curricula,
  students,
}: {
  store: Store
  notify: Notify
  plan: WeekPlan
  block: PlanBlock
  topicId: string
  title: string
  curricula: readonly Curriculum[]
  students: readonly Student[]
}) {
  const found = topicIndex(curricula).get(topicId)
  const group = found ? studentsFor(plan, block, found.course.id, students) : []
  const done = topicDone(group, topicId)
  if (done === null) return <span className="plan-topic">{title}</span>
  const tick = () => {
    const latest = found ? studentsFor(plan, block, found.course.id, store.get('students.json.enc')) : []
    const changed = tickForGroup(latest, topicId, new Date().toISOString())
    if (changed.length === 0) {
      notify(t('plan.alreadyDone'))
      return
    }
    const before = latest.filter((s) => changed.some((c) => c.id === s.id))
    void saveStudents(store, changed).then(() => notify(t('plan.ticked', { n: changed.length }), () => saveStudents(store, before)))
  }
  return (
    <button className={`plan-topic tick${done ? ' done' : ''}`} onClick={tick} aria-pressed={done} aria-label={t(done ? 'plan.topicDone' : 'plan.topicOpen', { topic: title })}>
      <span className="check-box small" aria-hidden="true">
        {done && <Icon icon={Check} />}
      </span>
      <span>{title}</span>
    </button>
  )
}

function BlockSheet({
  plan,
  block,
  date: initialDate,
  curricula,
  onSave,
  onDelete,
  onClose,
}: {
  plan: WeekPlan
  block: PlanBlock
  date: string
  curricula: readonly Curriculum[]
  onSave: (patch: BlockPatch, date: string, slot: DaySlot) => void
  onDelete: () => void
  onClose: () => void
}) {
  const lang = useLang()
  const [groupIds, setGroupIds] = useState(block.groupIds)
  const [topicIds, setTopicIds] = useState(block.topicIds)
  const [location, setLocation] = useState(block.location ?? '')
  const [note, setNote] = useState(block.note ? noteIn(block.note, lang) : '')
  const [date, setDate] = useState(initialDate)
  const [slot, setSlot] = useState<DaySlot>(block.slot)
  const index = topicIndex(curricula)
  const choices = topicChoices(plan, groupIds, curricula).filter((tp) => !topicIds.includes(tp.id))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave({ groupIds, topicIds, location, note }, date, slot)
  }

  return (
    <Sheet title={t('plan.blockTitle')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="stack">
          <label>
            {t('plan.day')}
            <select value={date} onChange={(e) => setDate(e.target.value)}>
              {plan.days.map((d) => (
                <option key={d.date} value={d.date}>
                  {capitalize(formatWeekday(d.date, lang))}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('plan.slot')}
            <select value={slot} onChange={(e) => setSlot(e.target.value as DaySlot)}>
              {DAY_SLOTS.map((s) => (
                <option key={s} value={s}>
                  {slotLabel(s, lang)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {plan.groups.length > 1 && (
          <fieldset className="checklist">
            <legend className="muted small">{t('plan.groups')}</legend>
            {plan.groups.map((g) => (
              <label key={g.id} className="check">
                <input type="checkbox" checked={groupIds.includes(g.id)} onChange={(e) => setGroupIds(e.target.checked ? [...groupIds, g.id] : groupIds.filter((id) => id !== g.id))} />
                {g.name}
              </label>
            ))}
          </fieldset>
        )}
        <div className="stack-sm">
          <span className="label">{t('plan.topics')}</span>
          {topicIds.length === 0 && <span className="muted small">{t('plan.noTopics')}</span>}
          <ul className="rows plan-edit-topics">
            {topicIds.map((id) => {
              const found = index.get(id)
              const title = found ? localized(found.topic.title, lang) : t('plan.unknownTopic')
              return (
                <li key={id} className="row-item">
                  <span className="row-main">{title}</span>
                  <button type="button" className="btn icon" aria-label={t('plan.removeTopic', { topic: title })} onClick={() => setTopicIds(topicIds.filter((x) => x !== id))}>
                    <Icon icon={X} />
                  </button>
                </li>
              )
            })}
          </ul>
          {choices.length > 0 && (
            <label>
              {t('plan.addTopic')}
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) setTopicIds([...topicIds, e.target.value])
                }}
              >
                <option value="">{t('plan.chooseTopic')}</option>
                {choices.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {localized(tp.title, lang)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <label>
          {t('plan.location')}
          <input type="text" autoComplete="off" maxLength={120} value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label>
          {t('plan.note')}
          <input type="text" autoComplete="off" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="sheet-actions">
          <button className="btn primary" type="submit">
            {t('common.save')}
          </button>
          <button className="btn danger" type="button" onClick={onDelete}>
            <Icon icon={Trash2} />
            {t('plan.deleteBlock')}
          </button>
        </div>
      </form>
    </Sheet>
  )
}

function PlanSheet({
  store,
  plan,
  trips,
  onSave,
  onDelete,
  onClose,
}: {
  store: Store
  plan: WeekPlan
  trips: readonly Trip[]
  onSave: (plan: WeekPlan) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(plan.title)
  const [startDate, setStartDate] = useState(plan.startDate)
  const [dayCount, setDayCount] = useState(plan.dayCount)
  const [tripId, setTripId] = useState(plan.tripId ?? '')
  const [groups, setGroups] = useState(plan.groups)
  const students = activeStudents(store.get('students.json.enc'))
  const liveTrips = trips.filter((tr) => tr.deletedAt === null)
  const ok = title.trim() !== '' && !!startDate && dayCount >= 1

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!ok) return
    onSave(updateGroups(reschedule(plan, { title, startDate, dayCount, tripId: tripId || undefined }), groups))
  }

  return (
    <Sheet title={t('plan.edit')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label>
          {t('plan.title')}
          <input type="text" autoComplete="off" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="two">
          <label>
            {t('plan.startDate')}
            <input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>
            {t('plan.dayCount')}
            <input type="number" inputMode="numeric" min={1} max={MAX_DAYS} value={dayCount || ''} onChange={(e) => setDayCount(Math.min(MAX_DAYS, Number(e.target.value)))} />
          </label>
        </div>
        {dayCount < plan.dayCount && <p className="muted small">{t('plan.fewerDays')}</p>}
        {liveTrips.length > 0 && <TripSelect trips={liveTrips} value={tripId} onChange={setTripId} />}
        {groups.map((g) => {
          const inCourse = students.filter((s) => s.curriculumId === g.curriculumId)
          return (
            <fieldset key={g.id} className="checklist">
              <legend className="muted small">{g.name}</legend>
              <label>
                {t('plan.groupNameLabel')}
                <input type="text" autoComplete="off" maxLength={40} value={g.name} onChange={(e) => setGroups(groups.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)))} />
              </label>
              {inCourse.map((s) => (
                <label key={s.id} className="check">
                  <input
                    type="checkbox"
                    checked={g.studentIds.includes(s.id)}
                    onChange={(e) =>
                      setGroups(groups.map((x) => (x.id === g.id ? { ...x, studentIds: e.target.checked ? [...x.studentIds, s.id] : x.studentIds.filter((id) => id !== s.id) } : x)))
                    }
                  />
                  {s.firstName}
                </label>
              ))}
            </fieldset>
          )
        })}
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!ok}>
            {t('common.save')}
          </button>
          <button className="btn danger" type="button" onClick={onDelete}>
            <Icon icon={Trash2} />
            {t('plan.delete')}
          </button>
        </div>
      </form>
    </Sheet>
  )
}

// ---------- Delen, tonen, printen ----------

function ShareSheet({
  plan,
  curricula,
  notify,
  onPresent,
  onPrint,
  onClose,
}: {
  plan: WeekPlan
  curricula: readonly Curriculum[]
  notify: Notify
  onPresent: (lang: Lang) => void
  onPrint: (lang: Lang) => void
  onClose: () => void
}) {
  const [lang, setLang] = useState<Lang>(getLang())

  const shareText = async () => {
    const text = planText(plan, curricula, lang)
    try {
      if (navigator.share) {
        await navigator.share({ title: plan.title, text })
        onClose()
        return
      }
      await navigator.clipboard.writeText(text)
      onClose()
      notify(t('plan.copied'))
    } catch (e) {
      // Delen geannuleerd: niets doen.
      if (e instanceof DOMException && e.name === 'AbortError') return
      notify(t('plan.shareFailed'))
    }
  }

  return (
    <Sheet title={t('plan.share')} onClose={onClose}>
      <div className="stack">
        <div className="segments small" role="radiogroup" aria-label={t('plan.exportLang')}>
          {LANGS.map((l) => (
            <button key={l} type="button" role="radio" aria-checked={lang === l} className={`segment${lang === l ? ' active' : ''}`} onClick={() => setLang(l)}>
              {t(l === 'nl' ? 'lang.nl' : 'lang.en')}
            </button>
          ))}
        </div>
        <p className="muted small">{t('plan.shareHint')}</p>
        <button className="btn primary" onClick={() => void shareText()}>
          <Icon icon={Share2} />
          {t('plan.shareText')}
        </button>
        <button className="btn" onClick={() => onPrint(lang)}>
          <Icon icon={Printer} />
          {t('plan.print')}
        </button>
        <button className="btn" onClick={() => onPresent(lang)}>
          <Icon icon={PresentationIcon} />
          {t('plan.present')}
        </button>
      </div>
    </Sheet>
  )
}

/** Volledig scherm met alleen de planning: geen onderbalk, geen sync-status, geen andere gegevens. */
function Presentation({ plan, curricula, lang, onClose }: { plan: WeekPlan; curricula: readonly Curriculum[]; lang: Lang; onClose: () => void }) {
  useEffect(() => {
    document.body.classList.add('presenting')
    window.scrollTo(0, 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.classList.remove('presenting')
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div className="presentation" role="dialog" aria-modal="true" aria-label={plan.title}>
      <button className="btn presentation-close" onClick={onClose}>
        <Icon icon={X} />
        {t('plan.stopPresenting')}
      </button>
      <h1>{plan.title}</h1>
      <p className="muted">{formatDateRange(plan.startDate, planEnd(plan), lang)}</p>
      <PlanDays plan={plan} curricula={curricula} lang={lang} />
    </div>
  )
}

/** Alleen zichtbaar bij afdrukken (PDF opslaan); in de gekozen exporttaal. */
function PlanPrint({ plan, curricula, lang, trip }: { plan: WeekPlan; curricula: readonly Curriculum[]; lang: Lang; trip?: Trip }) {
  return (
    <div className="print-root" lang={lang}>
      <h1>{plan.title}</h1>
      <p>
        {formatDateRange(plan.startDate, planEnd(plan), lang)}
        {trip ? ` · ${trip.name}` : ''}
      </p>
      <PlanDays plan={plan} curricula={curricula} lang={lang} />
    </div>
  )
}

// ---------- Vandaag ----------

/** Kaart "Planning vandaag" op Vandaag: blokken van vandaag uit de lopende planning. Tik = afvinken voor de groep. */
export function TodayPlan({ store, notify }: { store: Store; notify: Notify }) {
  const plans = useCollection(store, 'plans.json.enc')
  const stored = useCollection(store, 'curricula.json.enc')
  const students = useCollection(store, 'students.json.enc')
  const lang = useLang()
  const today = todayIso()
  const plan = activePlan(plans, today)
  if (!plan) return null
  const blocks = blocksOn(plan, today)
  if (blocks.length === 0) return null
  const curricula = effectiveCurricula(stored)
  const topics = topicIndex(curricula)
  return (
    <section className="stat wide today-plan" aria-label={t('plan.today')}>
      <span className="stat-label">
        <Icon icon={CalendarPlus} />
        {t('plan.today')} · {plan.title}
      </span>
      {blocks.map((b) => (
        <div key={b.id} className="today-block">
          <span className="plan-slot small">
            {slotLabel(b.slot, lang)}
            {b.groupIds.length > 0 && ` · ${plan.groups.filter((g) => b.groupIds.includes(g.id)).map((g) => g.name).join(', ')}`}
            {b.location && ` · ${b.location}`}
          </span>
          {b.topicIds.length > 0 && (
            <ul className="plan-topics">
              {b.topicIds.map((id) => {
                const found = topics.get(id)
                if (!found) return null
                return (
                  <li key={id}>
                    <TopicTick store={store} notify={notify} plan={plan} block={b} topicId={id} title={localized(found.topic.title, lang)} curricula={curricula} students={students} />
                  </li>
                )
              })}
            </ul>
          )}
          {b.note && <span className="small muted">{noteIn(b.note, lang)}</span>}
        </div>
      ))}
    </section>
  )
}
