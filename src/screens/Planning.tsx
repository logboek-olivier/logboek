import { CalendarPlus, Check, ChevronLeft, ChevronRight, MapPin, Pencil, Plus, Presentation as PresentationIcon, Printer, Share2, Trash2, X } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Notify } from '../components/EditSheets'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { useCollection } from '../components/useCollection'
import { formatDateRange, formatWeekday } from '../format'
import { getLang, LANGS, t, translate, useLang, type Lang } from '../i18n'
import { allTopics, courseLabel, effectiveCurricula, localized } from '../model/curricula'
import {
  activePlan,
  addBlock,
  applyBlockEdit,
  blocksOn,
  capitalize,
  deletePlan,
  draftPlan,
  findBlock,
  groupName,
  MAX_DAYS,
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
  shiftBlock,
  studentsFor,
  themeChoices,
  tickItemForGroup,
  itemDone,
  blockItems,
  topicChoices,
  topicIndex,
  updateGroups,
  type BlockPatch,
  type PlanItem,
} from '../model/plans'
import { activeStudents, saveStudents } from '../model/students'
import { dayCountOf, planWeek, weekView } from '../model/weeks'
import { DAY_SLOTS, STUDENT_LEVELS, todayIso, type Curriculum, type DaySlot, type PlanBlock, type PlanGroup, type Student, type Trip, type WeekPlan } from '../model/types'
import type { Store } from '../storage/store'
import { useBack } from '../back'

// Weekplanning: wizard van drie schermen (dagen → groepen → concept), bewerken met tikken, tonen aan studenten
// (alleen de planning, volledig scherm), delen als tekst of als PDF via de printfunctie. Exporttaal los van de app-taal.

type View = { kind: 'list' } | { kind: 'plan'; id: string } | { kind: 'wizard' }

/** Planningen van één week (Deze week). `onDetail` meldt dat de wizard of een planning open staat. */
export function PlansView({
  store,
  notify,
  curricula,
  week,
  onDetail,
}: {
  store: Store
  notify: Notify
  curricula: Curriculum[]
  week: Trip
  onDetail?: (open: boolean) => void
}) {
  const allPlans = useCollection(store, 'plans.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const plans = allPlans.filter((p) => planWeek(p, trips, legs) === week.id)
  const [view, setView] = useState<View>({ kind: 'list' })
  const lang = useLang()
  const today = todayIso()

  useEffect(() => {
    onDetail?.(view.kind !== 'list')
  }, [view.kind, onDetail])
  useBack(view.kind !== 'list', () => setView({ kind: 'list' }))

  if (view.kind === 'wizard') {
    return (
      <PlanWizard
        store={store}
        curricula={curricula}
        week={week}
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
      {current.length === 0 && past.length === 0 && <p className="muted">{t('plan.emptyWeek')}</p>}
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

/** Eén groep per cursus van de deelnemers (met hun studenten); zonder deelnemers met cursus één lege groep. */
function groupsFromParticipants(week: Trip, courses: Curriculum[], lang: Lang): PlanGroup[] {
  const byCourse = new Map<string, string[]>()
  for (const p of week.participants ?? []) {
    if (p.curriculumId && courses.some((c) => c.id === p.curriculumId)) byCourse.set(p.curriculumId, [...(byCourse.get(p.curriculumId) ?? []), p.id])
  }
  if (byCourse.size === 0) return [newGroup(groupName(0, lang), courses[0]?.id ?? '')]
  return [...byCourse.entries()].map(([courseId, ids], i) => ({ ...newGroup(groupName(i, lang), courseId), studentIds: ids }))
}

/** Wizard vanuit Deze week: startdatum, aantal dagen en de week staan vast voorgevuld; groepen uit de deelnemers. */
function PlanWizard({
  store,
  curricula,
  week,
  onCancel,
  onSaved,
}: {
  store: Store
  curricula: Curriculum[]
  week: Trip
  onCancel: () => void
  onSaved: (id: string) => void
}) {
  const lang = useLang()
  const legs = store.list('legs.json.enc')
  const view = weekView(week, legs)
  const students = activeStudents(store.get('students.json.enc'))
  const courses = curricula.filter((c) => allTopics(c).length > 0)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [startDate, setStartDate] = useState(view.startDate || todayIso())
  const [dayCount, setDayCount] = useState(view.startDate ? Math.min(MAX_DAYS, dayCountOf(view)) : 5)
  const [title, setTitle] = useState('')
  const chosenTrip = week.id
  const [groups, setGroups] = useState<PlanGroup[]>(() => groupsFromParticipants(week, courses, getLang()))

  const days = Math.max(1, Math.min(MAX_DAYS, dayCount || 1))
  const finalTitle = title.trim() || t('plan.defaultTitle', { date: formatDateRange(startDate, planEnd({ startDate, dayCount: days }), lang) })
  // Het concept staat in stap 3 al open voor bewerken (blok aantikken), vóór het opslaan.
  const [concept, setConcept] = useState<WeekPlan | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const editingBlock = concept && editing ? findBlock(concept, editing) : null

  const setGroup = (id: string, patch: Partial<PlanGroup>) => setGroups(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)))

  const next = (e: FormEvent) => {
    e.preventDefault()
    if (step === 1 && startDate) setStep(2)
    else if (step === 2 && groups.length > 0 && groups.every((g) => g.curriculumId)) {
      setConcept(draftPlan({ title: finalTitle, startDate, dayCount: days, tripId: chosenTrip || undefined, groups }, curricula, lang))
      setStep(3)
    }
  }

  const save = () => {
    if (!concept) return
    void savePlan(store, concept).then(() => onSaved(concept.id))
  }

  return (
    <div className="stack-lg">
      <button className="btn link back-link" onClick={step === 1 ? onCancel : () => setStep((step - 1) as 1 | 2)}>
        <Icon icon={ChevronLeft} />
        {step === 1 ? t('nav.week') : t('common.back')}
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
          <PlanDays
            plan={concept}
            curricula={curricula}
            lang={lang}
            onEditBlock={setEditing}
            onShiftBlock={(id, delta) => setConcept(shiftBlock(concept, id, delta))}
            onAddBlock={(date, slot) => {
              const { plan: next, blockId } = addBlock(concept, date, slot, concept.groups.map((g) => g.id))
              setConcept(next)
              setEditing(blockId)
            }}
          />
          <button className="btn primary" onClick={save}>
            {t('plan.save')}
          </button>
          {editingBlock && (
            <BlockSheet
              plan={concept}
              block={editingBlock.block}
              date={editingBlock.date}
              curricula={curricula}
              onClose={() => setEditing(null)}
              onSave={(patch, date, slot, perGroup) => {
                setConcept(applyBlockEdit(concept, editingBlock.block.id, patch, date, slot, perGroup))
                setEditing(null)
              }}
              onDelete={() => {
                setConcept(removeBlock(concept, editingBlock.block.id))
                setEditing(null)
              }}
            />
          )}
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

  useBack(presenting !== null, () => setPresenting(null))
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
        renderItem={(b, item) => <TopicTick store={store} notify={notify} plan={plan} block={b} item={item} curricula={curricula} students={students} />}
        onEditBlock={(id) => setEditingBlock(id)}
        onShiftBlock={(id, delta) => {
          const before = plan
          void savePlan(store, shiftBlock(plan, id, delta)).then(() => notify(t('plan.moved'), () => savePlan(store, before)))
        }}
        onAddBlock={(date, slot) => {
          // Een nieuw blok geldt standaard voor alle groepen samen.
          const { plan: next, blockId } = addBlock(plan, date, slot, plan.groups.map((g) => g.id))
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
          onSave={(patch, date, slot, perGroup) => {
            void savePlan(store, applyBlockEdit(plan, block.block.id, patch, date, slot, perGroup)).then(() => setEditingBlock(null))
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

/**
 * Dagen als raster: elke dag een ochtend en een middag (en een avond als daar iets staat). Een leeg dagdeel is met één
 * tik te vullen; een blok aantikken opent het om te bewerken. Zonder handlers alleen lezen (tonen, printen).
 */
function PlanDays({
  plan,
  curricula,
  lang,
  renderItem,
  onEditBlock,
  onShiftBlock,
  onAddBlock,
}: {
  plan: WeekPlan
  curricula: readonly Curriculum[]
  lang: Lang
  renderItem?: (block: PlanBlock, item: PlanItem) => ReactNode
  onEditBlock?: (blockId: string) => void
  onShiftBlock?: (blockId: string, delta: -1 | 1) => void
  onAddBlock?: (date: string, slot: DaySlot) => void
}) {
  const groupsText = (b: PlanBlock) =>
    plan.groups.length > 1 && plan.groups.every((g) => b.groupIds.includes(g.id))
      ? translate(lang, 'plan.allGroups')
      : plan.groups
          .filter((g) => b.groupIds.includes(g.id))
          .map((g) => g.name)
          .join(', ')
  return (
    <div className="plan-days">
      {plan.days.map((day, index) => {
        const blocks = sortBlocks(day.blocks)
        if (blocks.length === 0 && !onAddBlock) return null
        const slots = DAY_SLOTS.filter((s) => s !== 'avond' || blocks.some((b) => b.slot === 'avond'))
        return (
          <section key={day.date} className="section plan-day">
            <h2>{capitalize(formatWeekday(day.date, lang))}</h2>
            {slots.map((slot) => {
              const inSlot = blocks.filter((b) => b.slot === slot)
              if (inSlot.length === 0) {
                return onAddBlock ? (
                  <button key={slot} type="button" className={`card plan-block plan-empty slot-${slot}`} onClick={() => onAddBlock(day.date, slot)}>
                    <span className="plan-slot">{slotLabel(slot, lang)}</span>
                    <span className="muted small">
                      <Icon icon={Plus} />
                      {translate(lang, 'plan.emptySlot')}
                    </span>
                  </button>
                ) : null
              }
              return inSlot.map((b) => {
                const where = { slot: slotLabel(b.slot, lang), day: formatWeekday(day.date, lang) }
                return (
                  <article key={b.id} className={`card plan-block slot-${b.slot}`}>
                    <header className="plan-block-head">
                      {onEditBlock ? (
                        <button type="button" className="plan-block-open grow" onClick={() => onEditBlock(b.id)}>
                          <span className="plan-slot">{slotLabel(b.slot, lang)}</span>
                          <span className="muted small">{groupsText(b)}</span>
                        </button>
                      ) : (
                        <>
                          <span className="plan-slot">{slotLabel(b.slot, lang)}</span>
                          <span className="muted small grow">{groupsText(b)}</span>
                        </>
                      )}
                      {onShiftBlock && index > 0 && (
                        <button className="btn icon" aria-label={translate(lang, 'plan.earlier', where)} onClick={() => onShiftBlock(b.id, -1)}>
                          <Icon icon={ChevronLeft} />
                        </button>
                      )}
                      {onShiftBlock && index < plan.days.length - 1 && (
                        <button className="btn icon" aria-label={translate(lang, 'plan.later', where)} onClick={() => onShiftBlock(b.id, 1)}>
                          <Icon icon={ChevronRight} />
                        </button>
                      )}
                      {onEditBlock && (
                        <button className="btn icon" aria-label={translate(lang, 'plan.editBlock', where)} onClick={() => onEditBlock(b.id)}>
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
                    <PlanItems block={b} curricula={curricula} lang={lang} renderItem={renderItem} />
                    {blockItems(b, curricula, lang).length === 0 && !b.note && onEditBlock && <p className="muted small">{translate(lang, 'plan.emptyBlock')}</p>}
                    {b.note && <p className="small plan-note">{noteIn(b.note, lang)}</p>}
                  </article>
                )
              })
            })}
            {onAddBlock && (
              <button className="btn link" onClick={() => onAddBlock(day.date, 'avond')}>
                <Icon icon={Plus} />
                {t('plan.addEvening')}
              </button>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** De thema's (of losse onderwerpen) van een blok. Zonder renderItem alleen lezen (tonen, printen). */
function PlanItems({ block, curricula, lang, renderItem }: { block: PlanBlock; curricula: readonly Curriculum[]; lang: Lang; renderItem?: (block: PlanBlock, item: PlanItem) => ReactNode }) {
  const items = blockItems(block, curricula, lang)
  if (items.length === 0) return null
  const themes = items[0]!.theme
  return (
    <ul className={themes ? 'plan-themes' : 'plan-topics'}>
      {items.map((item) => (
        <li key={item.id}>{renderItem ? renderItem(block, item) : <span className={themes ? 'plan-theme' : 'plan-topic'}>{item.title}</span>}</li>
      ))}
    </ul>
  )
}

/** Tik op een thema of onderwerp = geoefend voor de hele groep (verlaagt nooit), met ongedaan maken. */
function TopicTick({
  store,
  notify,
  plan,
  block,
  item,
  curricula,
  students,
}: {
  store: Store
  notify: Notify
  plan: WeekPlan
  block: PlanBlock
  item: PlanItem
  curricula: readonly Curriculum[]
  students: readonly Student[]
}) {
  const title = item.title
  const found = topicIndex(curricula).get(item.topicIds[0] ?? '')
  const group = found ? studentsFor(plan, block, found.course.id, students) : []
  const done = itemDone(group, item.topicIds)
  if (done === null) return <span className={item.theme ? 'plan-theme' : 'plan-topic'}>{title}</span>
  const tick = () => {
    const latest = found ? studentsFor(plan, block, found.course.id, store.get('students.json.enc')) : []
    const changed = tickItemForGroup(latest, item.topicIds, new Date().toISOString())
    if (changed.length === 0) {
      notify(t('plan.alreadyDone'))
      return
    }
    const before = latest.filter((s) => changed.some((c) => c.id === s.id))
    void saveStudents(store, changed).then(() => notify(t('plan.ticked', { n: changed.length }), () => saveStudents(store, before)))
  }
  return (
    <button className={`${item.theme ? 'plan-theme' : 'plan-topic'} tick${done ? ' done' : ''}`} onClick={tick} aria-pressed={done} aria-label={item.theme ? t(done ? 'plan.themeDone' : 'plan.themeOpen', { theme: title }) : t(done ? 'plan.topicDone' : 'plan.topicOpen', { topic: title })}>
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
  onSave: (patch: BlockPatch, date: string, slot: DaySlot, perGroup: boolean) => void
  onDelete: () => void
  onClose: () => void
}) {
  const lang = useLang()
  const allIds = plan.groups.map((g) => g.id)
  // Samen (alle groepen, standaard) of per groep (dan één blok per gekozen groep).
  const [together, setTogether] = useState(plan.groups.length <= 1 || allIds.every((id) => block.groupIds.includes(id)))
  const [groupIds, setGroupIds] = useState(block.groupIds)
  const [ownThemes, setOwnThemes] = useState<string[]>(block.ownThemes ?? [])
  const [ownText, setOwnText] = useState('')
  const [topicIds, setTopicIds] = useState(block.topicIds)
  const themeMode = block.themeIds !== undefined
  const [themeIds, setThemeIds] = useState(block.themeIds ?? [])
  const chosenGroups = together ? allIds : groupIds
  const themes = themeChoices(plan, chosenGroups, curricula)
  const [location, setLocation] = useState(block.location ?? '')
  const [note, setNote] = useState(block.note ? noteIn(block.note, lang) : '')
  const [date, setDate] = useState(initialDate)
  const [slot, setSlot] = useState<DaySlot>(block.slot)
  const index = topicIndex(curricula)
  const choices = topicChoices(plan, chosenGroups, curricula).filter((tp) => !topicIds.includes(tp.id))
  const addOwn = () => {
    const text = ownText.trim()
    if (!text) return
    setOwnThemes([...ownThemes, text])
    setOwnText('')
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const pending = ownText.trim() ? [...ownThemes, ownText.trim()] : ownThemes
    const perGroup = !together && chosenGroups.length > 1
    if (themeMode) {
      // Onderwerpen volgen uit de gekozen thema's (bij herhaling blijven alleen de al gekozen onderwerpen van een thema).
      const chosen = themes.filter((th) => themeIds.includes(th.id))
      const topics = chosen.flatMap((th) => {
        const kept = th.topicIds.filter((id) => block.topicIds.includes(id))
        return block.themeIds?.includes(th.id) && kept.length > 0 ? kept : th.topicIds
      })
      onSave({ groupIds: chosenGroups, topicIds: topics, themeIds, ownThemes: pending, location, note }, date, slot, perGroup)
    } else onSave({ groupIds: chosenGroups, topicIds, ownThemes: pending, location, note }, date, slot, perGroup)
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
          <div className="stack-sm">
            <div className="segments small" role="radiogroup" aria-label={t('plan.groups')}>
              {([true, false] as const).map((on) => (
                <button key={String(on)} type="button" role="radio" aria-checked={together === on} className={`segment${together === on ? ' active' : ''}`} onClick={() => setTogether(on)}>
                  {t(on ? 'plan.together' : 'plan.perGroup')}
                </button>
              ))}
            </div>
            {!together && (
              <fieldset className="checklist">
                <legend className="muted small">{t('plan.perGroupHint')}</legend>
                {plan.groups.map((g) => (
                  <label key={g.id} className="check">
                    <input type="checkbox" checked={groupIds.includes(g.id)} onChange={(e) => setGroupIds(e.target.checked ? [...groupIds, g.id] : groupIds.filter((id) => id !== g.id))} />
                    {g.name}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        )}
        {themeMode && (
          <div className="stack-sm">
            <span className="label">{t('plan.themes')}</span>
            <span className="muted small">{t('plan.themesHint')}</span>
            <div className="type-buttons" role="group" aria-label={t('plan.themes')}>
              {themes.map((th) => {
                const on = themeIds.includes(th.id)
                return (
                  <button key={th.id} type="button" aria-pressed={on} className={`chip${on ? ' active' : ''}`} onClick={() => setThemeIds(on ? themeIds.filter((id) => id !== th.id) : [...themeIds, th.id])}>
                    {localized(th.title, lang)}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {!themeMode && (
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
        )}
        <div className="stack-sm">
          <span className="label">{t('plan.ownThemes')}</span>
          {ownThemes.length > 0 && (
            <ul className="rows plan-edit-topics">
              {ownThemes.map((text, i) => (
                <li key={`${text}-${i}`} className="row-item">
                  <span className="row-main">{text}</span>
                  <button type="button" className="btn icon" aria-label={t('plan.removeTopic', { topic: text })} onClick={() => setOwnThemes(ownThemes.filter((_, j) => j !== i))}>
                    <Icon icon={X} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            <input
              className="grow"
              type="text"
              autoComplete="off"
              maxLength={120}
              aria-label={t('plan.ownTheme')}
              placeholder={t('plan.ownThemePlaceholder')}
              value={ownText}
              onChange={(e) => setOwnText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addOwn()
                }
              }}
            />
            <button type="button" className="btn small" disabled={!ownText.trim()} onClick={addOwn}>
              <Icon icon={Plus} />
              {t('plan.addOwnTheme')}
            </button>
          </div>
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
            {t('plan.clearBlock')}
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
          <PlanItems block={b} curricula={curricula} lang={lang} renderItem={(block, item) => <TopicTick store={store} notify={notify} plan={plan} block={block} item={item} curricula={curricula} students={students} />} />
          {b.note && <span className="small muted">{noteIn(b.note, lang)}</span>}
        </div>
      ))}
    </section>
  )
}
