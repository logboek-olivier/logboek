// Opdrachten voor doelen, skills en carrière. Elke wijziging is een benoemde opdracht via `commit` (src/domain/commit.ts, docs/FUNDERING.md).

import { saveCareer } from '../model/career'
import { deleteCareerRecord, deleteGoal, deleteSession, deleteSkill } from '../model/edit'
import { logSession, saveGoal, saveSkill, toggleMilestone } from '../model/goals'
import type { Goal } from '../model/types'
import { opdracht, opdrachtMet } from './opdracht'
import type { Tx } from './tx'

/** Een doel opslaan; een nieuwe meting met "Nu" ingevuld krijgt meteen zijn eerste meting van vandaag. */
export async function saveGoalWithFirst(tx: Tx, goal: Parameters<typeof saveGoal>[1], first: { date: string; value: number } | null): Promise<Goal> {
  const saved = await saveGoal(tx, goal)
  if (first) await logSession(tx, { date: first.date, goalId: saved.id, value: first.value })
  return saved
}

export const carriereOpslaan = opdrachtMet('carriereOpslaan', saveCareer)
export const carriereVerwijderen = opdracht('carriereVerwijderen', deleteCareerRecord)
export const doelOpslaan = opdrachtMet('doelOpslaan', saveGoal)
export const doelOpslaanMetMeting = opdrachtMet('doelOpslaanMetMeting', saveGoalWithFirst)
export const doelVerwijderen = opdracht('doelVerwijderen', deleteGoal)
export const mijlpaalAfvinken = opdracht('mijlpaalAfvinken', toggleMilestone)
export const sessieLoggen = opdrachtMet('sessieLoggen', logSession)
export const sessieVerwijderen = opdracht('sessieVerwijderen', deleteSession)
export const skillOpslaan = opdrachtMet('skillOpslaan', saveSkill)
export const skillVerwijderen = opdracht('skillVerwijderen', deleteSkill)
