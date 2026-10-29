import { Plus, Target, TrendingDown, TrendingUp, Zap } from 'lucide-react'
import { useState } from 'react'
import { GoalSheet, GoalView, ProgressBar, SkillSheet, SkillView, goalLabel, progressText, skillLine, useGoalData } from '../components/GoalSheets'
import type { Notify } from '../components/EditSheets'
import { Empty } from '../components/Empty'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { t } from '../i18n'
import { active } from '../model/derive'
import { goalProgress, skillStats } from '../model/goals'
import { todayIso, type Goal, type Skill } from '../model/types'
import type { Store } from '../storage/store'

// Meer → Doelen: jaardoelen die zichzelf vullen uit de app en losse doelen die Olivier zelf meet, met voortgang; en
// skills met sessies, minuten, trend en mijlpalen. Tik = bekijken; bewerken via het potlood. Snel loggen kan ook via
// + → Skill.

export function Goals({ store, notify }: { store: Store; notify: Notify }) {
  const goals = active(useCollection(store, 'goals.json.enc'))
  const skills = active(useCollection(store, 'skills.json.enc')).sort((a, b) => a.name.localeCompare(b.name))
  const sessions = useCollection(store, 'sessions.json.enc')
  const data = useGoalData(store)
  const today = todayIso()
  const year = Number(today.slice(0, 4))
  const [viewGoal, setViewGoal] = useState<Goal | null>(null)
  const [viewSkill, setViewSkill] = useState<Skill | null>(null)
  const [newGoal, setNewGoal] = useState(false)
  const [newSkill, setNewSkill] = useState(false)
  // Lopende doelen eerst (dit jaar of zonder jaar), daarna die van eerdere jaren.
  const sorted = [...goals].sort((a, b) => Number((b.year ?? year) >= year) - Number((a.year ?? year) >= year) || (b.year ?? year) - (a.year ?? year) || goalLabel(a).localeCompare(goalLabel(b)))

  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('goals.screen')}</h1>
      </header>

      <div className="section">
        <div className="section-head">
          <h2>{t('goals.title')}</h2>
        </div>
        {sorted.length === 0 ? (
          <Empty icon={Target}>{t('goals.empty')}</Empty>
        ) : (
          <ul className="rows goal-list">
            {sorted.map((goal) => {
              const p = goalProgress(goal, sessions, data)
              return (
                <li key={goal.id}>
                  <button type="button" className="row-button goal-row" onClick={() => setViewGoal(goal)}>
                    <span className="row-main">
                      <span className="row-title">
                        {goalLabel(goal)}
                        {p.done && <span className="chip-static goal-done">{t('goals.reached')}</span>}
                      </span>
                      <span className="muted small">{progressText(goal, p)}</span>
                      <ProgressBar share={p.share} label={goalLabel(goal)} />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <button type="button" className="btn" onClick={() => setNewGoal(true)}>
          <Icon icon={Plus} />
          {t('goals.new')}
        </button>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>{t('goals.skills')}</h2>
        </div>
        {skills.length === 0 ? (
          <Empty icon={Zap}>{t('goals.skillsEmpty')}</Empty>
        ) : (
          <ul className="rows skill-list">
            {skills.map((skill) => {
              const stats = skillStats(skill, sessions, today)
              return (
                <li key={skill.id}>
                  <button type="button" className="row-button" onClick={() => setViewSkill(skill)}>
                    {stats.trend === 'op' ? <Icon icon={TrendingUp} /> : stats.trend === 'af' ? <Icon icon={TrendingDown} /> : <Icon icon={Zap} />}
                    <span className="row-main">
                      <span className="row-title">{skill.name}</span>
                      <span className="muted small">{skillLine(skill, stats)}</span>
                      {skill.milestones.length > 0 && <span className="muted small">{t('goals.milestones', { done: stats.milestonesDone, total: skill.milestones.length })}</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <button type="button" className="btn" onClick={() => setNewSkill(true)}>
          <Icon icon={Plus} />
          {t('goals.newSkill')}
        </button>
      </div>

      {viewGoal && <GoalView key={viewGoal.id} store={store} goal={viewGoal} notify={notify} onClose={() => setViewGoal(null)} />}
      {viewSkill && <SkillView key={viewSkill.id} store={store} skill={viewSkill} notify={notify} onClose={() => setViewSkill(null)} />}
      {newGoal && <GoalSheet store={store} goal={null} notify={notify} onClose={() => setNewGoal(false)} />}
      {newSkill && <SkillSheet store={store} skill={null} notify={notify} onClose={() => setNewSkill(false)} />}
    </section>
  )
}
