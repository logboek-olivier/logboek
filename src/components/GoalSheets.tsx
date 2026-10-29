import { Check, Plus, Trash2, X } from 'lucide-react'
import { useState, useSyncExternalStore, type FormEvent } from 'react'
import { formatDate, formatDateShort, formatMoney, formatNm, formatNumber } from '../format'
import { getLang, t, type MessageKey } from '../i18n'
import { organisationLabel } from '../i18n/labels'
import { deleteGoal, deleteSession, deleteSkill } from '../model/edit'
import {
  GOAL_SUGGESTIONS,
  SKILL_SUGGESTIONS,
  YACHTMASTER_ITEMS,
  defaultTarget,
  goalProgress,
  logSession,
  measurements,
  newMilestone,
  parseValue,
  saveGoal,
  saveSkill,
  skillSessions,
  skillStats,
  toggleMilestone,
  type GoalData,
  type GoalProgress,
} from '../model/goals'
import { getRates, subscribeRates } from '../model/rates'
import { GOAL_METRICS, ORGANISATIONS, todayIso, type Goal, type GoalMetric, type Milestone, type Organisation, type Skill } from '../model/types'
import type { Store } from '../storage/store'
import { BarChart } from './BarChart'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'
import { ViewRows } from './Views'

// Doelen en skills: eerst bekijken, dan bewerken (potlood); verwijderen met ongedaan maken. Een doel vult zichzelf uit
// de app of Olivier meet zelf; een skill heeft sessies, een trend en mijlpalen. Zie src/model/goals.ts.

export function useGoalData(store: Store): GoalData {
  const rates = useSyncExternalStore(subscribeRates, getRates)
  return {
    legs: useCollection(store, 'legs.json.enc'),
    trips: useCollection(store, 'trips.json.enc'),
    transactions: useCollection(store, 'transactions.json.enc'),
    rates,
  }
}

/** De naam van een doel: zelf gekozen, anders uit soort, organisatie en jaar (in de taal van nu). */
export function goalLabel(goal: Goal): string {
  if (goal.title) return goal.title
  const year = goal.year ?? new Date().getFullYear()
  switch (goal.metric) {
    case 'nm':
      return t('goals.label.nm', { year })
    case 'trips':
      return t('goals.label.trips', { org: goal.organisation ? organisationLabel(goal.organisation) : t('goals.allOrgs'), year })
    case 'yachtmaster':
      return t('goals.label.yachtmaster')
    case 'inkomsten':
      return t('goals.label.inkomsten', { year })
    default:
      return t('goals.title')
  }
}

function amount(goal: Goal, n: number): string {
  if (goal.kind === 'meting') return `${formatNumber(n)}${goal.unit ? ` ${goal.unit}` : ''}`
  if (goal.metric === 'nm') return formatNm(n)
  if (goal.metric === 'inkomsten') return formatMoney(n, 'EUR')
  return formatNumber(n)
}

/** "1.240 nm van 2.500 nm", "78,4 kg · doel 77 kg", "Nog geen meting". */
export function progressText(goal: Goal, p: GoalProgress): string {
  if (p.current === null) return t('goals.noMeasurement')
  if (goal.metric === 'yachtmaster') return t('goals.yachtmasterOf', { n: p.current, total: p.target })
  if (goal.kind === 'meting') return t('goals.measured', { now: amount(goal, p.current), target: amount(goal, p.target) })
  return t('goals.of', { now: amount(goal, p.current), target: amount(goal, p.target) })
}

export function ProgressBar({ share, label }: { share: number; label: string }) {
  return (
    <span className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
      <span className="progress-fill" ref={(el) => setWidth(el, share)} />
    </span>
  )
}

/** Breedte via CSSOM (de CSP staat geen inline style-attributen toe, wel element.style). */
function setWidth(el: HTMLElement | null, share: number) {
  if (el) el.style.width = `${Math.round(share * 1000) / 10}%`
}

// ---------- Doel ----------

export function GoalView({ store, goal, notify, onClose }: { store: Store; goal: Goal; notify: Notify; onClose: () => void }) {
  const [editing, setEditing] = useState(false)
  const goals = useCollection(store, 'goals.json.enc')
  const sessions = useCollection(store, 'sessions.json.enc')
  const data = useGoalData(store)
  const current = goals.find((g) => g.id === goal.id) ?? goal
  const [value, setValue] = useState('')
  const [date, setDate] = useState(todayIso())
  if (editing) return <GoalSheet store={store} goal={current} notify={notify} onClose={onClose} />
  const p = goalProgress(current, sessions, data)
  const list = measurements(current, sessions).reverse()
  const parsed = parseValue(value)

  async function measure(e: FormEvent) {
    e.preventDefault()
    if (parsed === null) return
    await logSession(store, { date, goalId: current.id, value: parsed })
    setValue('')
    notify(t('goals.measurementSaved'))
  }

  return (
    <Sheet title={goalLabel(current)} onClose={onClose} onEdit={() => setEditing(true)}>
      <div className="stack view">
        <p className="goal-progress">
          <strong>{progressText(current, p)}</strong>
          {p.done && <span className="chip-static goal-done">{t('goals.reached')}</span>}
        </p>
        <ProgressBar share={p.share} label={goalLabel(current)} />
        <ViewRows
          rows={[
            [t('goals.kind'), t(current.kind === 'auto' ? 'goals.kindAuto' : 'goals.kindMeasured')],
            [t('goals.year'), current.kind === 'auto' && current.metric !== 'yachtmaster' && String(current.year ?? '')],
            [t('goals.start'), p.start !== null && amount(current, p.start)],
            [t('goals.lastMeasured'), p.lastDate && formatDate(p.lastDate)],
          ]}
        />
        {current.metric === 'yachtmaster' && <p className="muted small">{t('stats.ryaHint')}</p>}
        {current.kind === 'meting' && (
          <>
            <form className="stack-sm" onSubmit={(e) => void measure(e)}>
              <div className="two">
                <label>
                  {current.unit ? t('goals.valueWithUnit', { unit: current.unit }) : t('goals.value')}
                  <input inputMode="decimal" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
                </label>
                <label>
                  {t('field.date')}
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
              </div>
              <button type="submit" className="btn primary" disabled={parsed === null || !date}>
                <Icon icon={Plus} />
                {t('goals.addMeasurement')}
              </button>
            </form>
            {list.length > 0 && (
              <ul className="rows">
                {list.map((s) => (
                  <li key={s.id} className="row-item">
                    <span className="row-main">
                      <span>{amount(current, s.value ?? 0)}</span>
                      <span className="muted small">{formatDate(s.date)}</span>
                    </span>
                    <button
                      type="button"
                      className="btn icon"
                      aria-label={t('goals.deleteMeasurement', { date: formatDate(s.date) })}
                      onClick={async () => notify(t('toast.deleted'), await deleteSession(store, s))}
                    >
                      <Icon icon={Trash2} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}

export function GoalSheet({ store, goal, notify, onClose }: { store: Store; goal: Goal | null; notify: Notify; onClose: () => void }) {
  const lang = getLang()
  const year = new Date().getFullYear()
  const [kind, setKind] = useState<Goal['kind']>(goal?.kind ?? 'auto')
  const [metric, setMetric] = useState<GoalMetric>(goal?.metric ?? 'nm')
  const [organisation, setOrganisation] = useState<Organisation | ''>(goal?.organisation ?? 'sailing-virgins')
  const [goalYear, setGoalYear] = useState(String(goal?.year ?? year))
  const [target, setTarget] = useState(goal ? String(goal.target) : String(defaultTarget('nm')))
  const [targetTouched, setTargetTouched] = useState(!!goal)
  const [title, setTitle] = useState(goal?.kind === 'meting' ? goal.title : '')
  const [unit, setUnit] = useState(goal?.unit ?? '')
  const [now, setNow] = useState('')
  const [lower, setLower] = useState(goal?.lower ?? false)
  const [delta, setDelta] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const parsedTarget = parseValue(target)
  const parsedNow = parseValue(now)
  const ok = parsedTarget !== null && (kind === 'auto' ? /^\d{4}$/.test(goalYear) || metric === 'yachtmaster' : title.trim() !== '')

  function chooseMetric(next: GoalMetric) {
    setMetric(next)
    if (!targetTouched) setTarget(String(defaultTarget(next)))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok || parsedTarget === null) return
    setBusy(true)
    const saved = await saveGoal(store, {
      id: goal?.id,
      kind,
      title: kind === 'meting' ? title : '',
      target: parsedTarget,
      ...(kind === 'auto'
        ? { metric, ...(metric === 'trips' && organisation ? { organisation } : {}), ...(metric !== 'yachtmaster' ? { year: Number(goalYear) } : {}) }
        : { ...(unit.trim() ? { unit: unit.trim().slice(0, 20) } : {}), lower: parsedNow !== null ? parsedTarget < parsedNow : lower }),
      doneAt: goal?.doneAt ?? null,
    })
    // Een nieuwe meting met "Nu" ingevuld: de eerste meting van vandaag.
    if (kind === 'meting' && parsedNow !== null) await logSession(store, { date: todayIso(), goalId: saved.id, value: parsedNow })
    onClose()
    notify(t('goals.saved'))
  }

  async function remove() {
    if (!goal) return
    const undo = await deleteGoal(store, goal)
    onClose()
    notify(t('toast.deleted'), undo)
  }

  return (
    <Sheet title={goal ? t('goals.edit') : t('goals.new')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        {!goal && (
          <div className="segments small" role="radiogroup" aria-label={t('goals.kind')}>
            {(['auto', 'meting'] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={`segment${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>
                {t(k === 'auto' ? 'goals.kindAuto' : 'goals.kindMeasured')}
              </button>
            ))}
          </div>
        )}
        {kind === 'auto' ? (
          <>
            <div className="type-buttons" role="radiogroup" aria-label={t('goals.metric')}>
              {GOAL_METRICS.map((m) => (
                <button key={m} type="button" role="radio" aria-checked={metric === m} className={`chip${metric === m ? ' active' : ''}`} onClick={() => chooseMetric(m)}>
                  {t(`goals.metric.${m}` as MessageKey)}
                </button>
              ))}
            </div>
            {metric === 'trips' && (
              <label>
                {t('week.organisation')}
                <select value={organisation} onChange={(e) => setOrganisation(e.target.value as Organisation | '')}>
                  <option value="">{t('goals.allOrgs')}</option>
                  {ORGANISATIONS.map((o) => (
                    <option key={o} value={o}>
                      {organisationLabel(o)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="two">
              {metric !== 'yachtmaster' && (
                <label>
                  {t('goals.year')}
                  <input inputMode="numeric" autoComplete="off" maxLength={4} value={goalYear} onChange={(e) => setGoalYear(e.target.value)} />
                </label>
              )}
              <label>
                {metric === 'yachtmaster' ? t('goals.targetItems', { total: YACHTMASTER_ITEMS }) : t('goals.target')}
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value)
                    setTargetTouched(true)
                  }}
                />
              </label>
            </div>
          </>
        ) : (
          <>
            {!goal && (
              <div className="type-buttons" aria-label={t('goals.suggestions')}>
                {GOAL_SUGGESTIONS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className="chip"
                    onClick={() => {
                      setTitle(t(`goals.suggestion.${s.key}` as MessageKey))
                      setUnit(s.unit[lang])
                      setLower(s.lower)
                      setDelta(s.delta ?? null)
                      if (s.target !== undefined) setTarget(String(s.target))
                      else if (s.delta !== undefined && parsedNow !== null) setTarget(String(Math.round((parsedNow - s.delta) * 10) / 10))
                    }}
                  >
                    {t(`goals.suggestion.${s.key}` as MessageKey)}
                  </button>
                ))}
              </div>
            )}
            <label>
              {t('goals.what')}
              <input type="text" autoComplete="off" autoCapitalize="sentences" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <div className="two">
              {!goal && (
                <label>
                  {t('goals.now')}
                  <input
                    inputMode="decimal"
                    autoComplete="off"
                    value={now}
                    onChange={(e) => {
                      setNow(e.target.value)
                      const n = parseValue(e.target.value)
                      // "5 kilo afvallen": het doel volgt de huidige waarde zolang Olivier het doel niet zelf kiest.
                      if (delta !== null && n !== null && !targetTouched) setTarget(String(Math.round((n - delta) * 10) / 10))
                    }}
                  />
                </label>
              )}
              <label>
                {t('goals.target')}
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value)
                    setTargetTouched(true)
                  }}
                />
              </label>
            </div>
            <label>
              {t('goals.unit')}
              <input type="text" autoComplete="off" maxLength={20} placeholder={t('goals.unitPlaceholder')} value={unit} onChange={(e) => setUnit(e.target.value)} />
            </label>
          </>
        )}
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!ok || busy}>
            {t('common.save')}
          </button>
          {goal && (
            <button className="btn danger" type="button" onClick={() => void remove()}>
              <Icon icon={Trash2} />
              {t('common.delete')}
            </button>
          )}
        </div>
      </form>
    </Sheet>
  )
}

// ---------- Skill ----------

function minutesText(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? t('goals.hoursMinutes', { h, m }) : t('goals.minutes', { m })
}

export function skillLine(skill: Skill, stats: ReturnType<typeof skillStats>): string {
  return [
    t('goals.sessions', { n: stats.sessions }),
    stats.minutes > 0 ? minutesText(stats.minutes) : '',
    stats.value !== null ? t(skill.best ? 'goals.best' : 'goals.total', { value: `${formatNumber(stats.value)}${skill.valueUnit ? ` ${skill.valueUnit}` : ''}` }) : '',
    stats.trend ? t(`goals.trend.${stats.trend}` as MessageKey) : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

export function SkillView({ store, skill, notify, onClose }: { store: Store; skill: Skill; notify: Notify; onClose: () => void }) {
  const [editing, setEditing] = useState(false)
  const skills = useCollection(store, 'skills.json.enc')
  const sessions = useCollection(store, 'sessions.json.enc')
  const current = skills.find((s) => s.id === skill.id) ?? skill
  const today = todayIso()
  if (editing) return <SkillSheet store={store} skill={current} notify={notify} onClose={onClose} />
  const stats = skillStats(current, sessions, today)
  const list = skillSessions(current, sessions).slice(0, 20)

  return (
    <Sheet title={current.name} onClose={onClose} onEdit={() => setEditing(true)}>
      <div className="stack view">
        <p className="muted">{skillLine(current, stats)}</p>
        {stats.weeks.some((w) => w.minutes > 0 || w.sessions > 0) && (
          <div className="stack-sm">
            <h3>{t(stats.minutes > 0 ? 'goals.minutesPerWeek' : 'goals.sessionsPerWeek')}</h3>
            <BarChart
              label={`${t(stats.minutes > 0 ? 'goals.minutesPerWeek' : 'goals.sessionsPerWeek')}: ${stats.weeks.map((w) => `${formatDateShort(w.start)} ${stats.minutes > 0 ? w.minutes : w.sessions}`).join(', ')}`}
              groups={stats.weeks.map((w) => ({ key: w.start, label: formatDateShort(w.start), values: [stats.minutes > 0 ? w.minutes : w.sessions] }))}
              format={(n) => formatNumber(n)}
              labelEvery={2}
              compact
            />
          </div>
        )}
        <SessionForm store={store} fixed={{ skill: current }} notify={notify} />
        {current.milestones.length > 0 && (
          <div className="stack-sm">
            <h3>{t('goals.milestones', { done: stats.milestonesDone, total: current.milestones.length })}</h3>
            <ul className="rows">
              {current.milestones.map((m) => (
                <li key={m.id}>
                  <button type="button" className={`row-button milestone${m.doneAt ? ' done' : ''}`} aria-pressed={!!m.doneAt} onClick={() => void toggleMilestone(store, current, m.id, today)}>
                    <Icon icon={m.doneAt ? Check : X} />
                    <span className="row-main">
                      <span>{m.title}</span>
                      {m.doneAt && <span className="muted small">{formatDate(m.doneAt)}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {list.length > 0 && (
          <div className="stack-sm">
            <h3>{t('goals.recent')}</h3>
            <ul className="rows">
              {list.map((s) => (
                <li key={s.id} className="row-item">
                  <span className="row-main">
                    <span>
                      {[
                        s.minutes !== undefined ? minutesText(s.minutes) : '',
                        s.value !== undefined ? `${formatNumber(s.value)}${current.valueUnit ? ` ${current.valueUnit}` : ''}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ') || t('goals.session')}
                    </span>
                    <span className="muted small">{[formatDate(s.date), s.note].filter(Boolean).join(' · ')}</span>
                  </span>
                  <button
                    type="button"
                    className="btn icon"
                    aria-label={t('goals.deleteSession', { date: formatDate(s.date) })}
                    onClick={async () => notify(t('toast.deleted'), await deleteSession(store, s))}
                  >
                    <Icon icon={Trash2} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Sheet>
  )
}

export function SkillSheet({ store, skill, notify, onClose }: { store: Store; skill: Skill | null; notify: Notify; onClose: () => void }) {
  const lang = getLang()
  const [name, setName] = useState(skill?.name ?? '')
  const [valueUnit, setValueUnit] = useState(skill?.valueUnit ?? '')
  const [best, setBest] = useState(skill?.best ?? false)
  const [milestones, setMilestones] = useState<Milestone[]>(skill?.milestones ?? [])
  const [newMilestoneTitle, setNewMilestoneTitle] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    const pending = newMilestoneTitle.trim() ? [...milestones, newMilestone(newMilestoneTitle)] : milestones
    await saveSkill(store, { id: skill?.id, name, ...(valueUnit.trim() ? { valueUnit: valueUnit.trim().slice(0, 20), best } : {}), milestones: pending })
    onClose()
    notify(t('goals.skillSaved'))
  }

  async function remove() {
    if (!skill) return
    const undo = await deleteSkill(store, skill)
    onClose()
    notify(t('toast.deleted'), undo)
  }

  return (
    <Sheet title={skill ? t('goals.editSkill') : t('goals.newSkill')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        {!skill && (
          <div className="type-buttons" aria-label={t('goals.suggestions')}>
            {SKILL_SUGGESTIONS.map((s) => (
              <button
                key={s.key}
                type="button"
                className="chip"
                onClick={() => {
                  setName(t(`goals.skill.${s.key}` as MessageKey))
                  setValueUnit(s.valueUnit?.[lang] ?? '')
                  setBest(s.best ?? false)
                }}
              >
                {t(`goals.skill.${s.key}` as MessageKey)}
              </button>
            ))}
          </div>
        )}
        <label>
          {t('goals.skillName')}
          <input type="text" autoComplete="off" autoCapitalize="sentences" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          {t('goals.valueUnit')}
          <input type="text" autoComplete="off" maxLength={20} placeholder={t('goals.valueUnitPlaceholder')} value={valueUnit} onChange={(e) => setValueUnit(e.target.value)} />
        </label>
        {valueUnit.trim() && (
          <div className="segments small" role="radiogroup" aria-label={t('goals.valueCounts')}>
            {[false, true].map((b) => (
              <button key={String(b)} type="button" role="radio" aria-checked={best === b} className={`segment${best === b ? ' active' : ''}`} onClick={() => setBest(b)}>
                {t(b ? 'goals.valueBest' : 'goals.valueTotal')}
              </button>
            ))}
          </div>
        )}
        <div className="stack-sm">
          <span className="label">{t('goals.milestonesTitle')}</span>
          {milestones.map((m, i) => (
            <div key={m.id} className="milestone-edit">
              <input
                type="text"
                autoComplete="off"
                maxLength={80}
                aria-label={t('goals.milestoneN', { n: i + 1 })}
                value={m.title}
                onChange={(e) => setMilestones(milestones.map((x) => (x.id === m.id ? { ...x, title: e.target.value } : x)))}
              />
              <button type="button" className="btn icon" aria-label={t('goals.removeMilestone', { title: m.title })} onClick={() => setMilestones(milestones.filter((x) => x.id !== m.id))}>
                <Icon icon={Trash2} />
              </button>
            </div>
          ))}
          <div className="milestone-edit">
            <input type="text" autoComplete="off" maxLength={80} aria-label={t('goals.newMilestone')} placeholder={t('goals.newMilestonePlaceholder')} value={newMilestoneTitle} onChange={(e) => setNewMilestoneTitle(e.target.value)} />
            <button
              type="button"
              className="btn icon"
              aria-label={t('goals.addMilestone')}
              disabled={!newMilestoneTitle.trim()}
              onClick={() => {
                setMilestones([...milestones, newMilestone(newMilestoneTitle)])
                setNewMilestoneTitle('')
              }}
            >
              <Icon icon={Plus} />
            </button>
          </div>
        </div>
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!name.trim() || busy}>
            {t('common.save')}
          </button>
          {skill && (
            <button className="btn danger" type="button" onClick={() => void remove()}>
              <Icon icon={Trash2} />
              {t('common.delete')}
            </button>
          )}
        </div>
      </form>
    </Sheet>
  )
}

// ---------- Sessie loggen (ook in Toevoegen → Skill) ----------

type Target = { skill: Skill } | { goal: Goal }

/**
 * Een sessie of meting loggen: wat (een skill of een meetdoel), minuten en/of een waarde, en de datum (vandaag). Met
 * `fixed` staat het doel vast (in het blad van een skill); anders kiest Olivier, standaard wat hij het laatst logde.
 */
export function SessionForm({ store, fixed, notify, onDone }: { store: Store; fixed?: Target; notify: Notify; onDone?: (message: string) => void }) {
  const skills = useCollection(store, 'skills.json.enc').filter((s) => !s.deletedAt)
  const goals = useCollection(store, 'goals.json.enc').filter((g) => !g.deletedAt && g.kind === 'meting')
  const sessions = useCollection(store, 'sessions.json.enc')
  const latest = [...sessions].filter((s) => !s.deletedAt).sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt))[0]
  const fallback = latest?.skillId ? `skill:${latest.skillId}` : latest?.goalId ? `goal:${latest.goalId}` : skills[0] ? `skill:${skills[0].id}` : goals[0] ? `goal:${goals[0].id}` : ''
  const [choice, setChoice] = useState<string>('')
  const key = fixed ? ('skill' in fixed ? `skill:${fixed.skill.id}` : `goal:${fixed.goal.id}`) : choice || fallback
  const skill = key.startsWith('skill:') ? skills.find((s) => s.id === key.slice(6)) : undefined
  const goal = key.startsWith('goal:') ? goals.find((g) => g.id === key.slice(5)) : undefined
  const [minutes, setMinutes] = useState('')
  const [value, setValue] = useState('')
  const [date, setDate] = useState(todayIso())
  const [busy, setBusy] = useState(false)
  const parsedMinutes = parseValue(minutes)
  const parsedValue = parseValue(value)
  const valueUnit = skill?.valueUnit ?? goal?.unit
  const ok = !!date && (skill ? parsedMinutes !== null || parsedValue !== null : goal ? parsedValue !== null : false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok) return
    setBusy(true)
    await logSession(store, { date, ...(skill ? { skillId: skill.id, minutes: parsedMinutes } : {}), ...(goal ? { goalId: goal.id } : {}), value: parsedValue })
    setBusy(false)
    setMinutes('')
    setValue('')
    try {
      navigator.vibrate?.(30)
    } catch {
      // Niet beschikbaar.
    }
    const message = t(goal ? 'goals.measurementSaved' : 'goals.sessionSaved')
    if (onDone) onDone(message)
    else notify(message)
  }

  if (!fixed && skills.length === 0 && goals.length === 0) return null

  return (
    <form className="stack-sm session-form" onSubmit={(e) => void submit(e)}>
      {!fixed && (
        <label>
          {t('goals.whatLog')}
          <select value={key} onChange={(e) => setChoice(e.target.value)}>
            {skills.length > 0 && (
              <optgroup label={t('goals.skills')}>
                {skills.map((s) => (
                  <option key={s.id} value={`skill:${s.id}`}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            )}
            {goals.length > 0 && (
              <optgroup label={t('goals.measuredGoals')}>
                {goals.map((g) => (
                  <option key={g.id} value={`goal:${g.id}`}>
                    {goalLabel(g)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
      )}
      <div className="two">
        {skill && (
          <label>
            {t('goals.minutesField')}
            <input inputMode="numeric" autoComplete="off" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </label>
        )}
        {(goal || valueUnit) && (
          <label>
            {valueUnit ? t('goals.valueWithUnit', { unit: valueUnit }) : t('goals.value')}
            <input inputMode="decimal" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
        )}
        <label>
          {t('field.date')}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <button type="submit" className={`btn${fixed ? '' : ' primary'}`} disabled={!ok || busy}>
        <Icon icon={Plus} />
        {t(goal ? 'goals.addMeasurement' : 'goals.logSession')}
      </button>
    </form>
  )
}
