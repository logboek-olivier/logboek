// Opdrachten voor de training: cursussen, studenten en planningen. Elke wijziging is een benoemde opdracht via `commit` (src/domain/commit.ts, docs/FUNDERING.md).

import { deleteCurriculum, saveCurriculum } from '../model/curricula'
import { deletePlan, savePlan } from '../model/plans'
import { addStudent, autoArchive, deleteStudents, saveStudents, setArchived, updateStudent, type StudentInput } from '../model/students'
import type { Student } from '../model/types'
import { addParticipant } from '../model/weeks'
import { opdracht, opdrachtMet } from './opdracht'
import type { Tx } from './tx'

/** Een student toevoegen; in een trip komt hij ook bij de deelnemers. */
export async function addStudentToTrip(tx: Tx, input: StudentInput, tripId: string | null): Promise<Student> {
  const student = await addStudent(tx, input, tripId ?? undefined)
  const trip = tripId ? tx.list('trips.json.enc').find((x) => x.id === tripId) : undefined
  if (trip) await addParticipant(tx, trip, student)
  return student
}

export const cursusOpslaan = opdracht('cursusOpslaan', saveCurriculum)
export const cursusVerwijderen = opdracht('cursusVerwijderen', deleteCurriculum)
export const planningOpslaan = opdracht('planningOpslaan', savePlan)
export const planningVerwijderen = opdracht('planningVerwijderen', deletePlan)
export const studentArchiveren = opdracht('studentArchiveren', setArchived)
export const studentBewerken = opdracht('studentBewerken', updateStudent)
export const studentInTripToevoegen = opdrachtMet('studentInTripToevoegen', addStudentToTrip)
export const studentToevoegen = opdrachtMet('studentToevoegen', addStudent)
export const studentenArchiveren = opdracht('studentenArchiveren', autoArchive)
export const studentenOpslaan = opdracht('studentenOpslaan', saveStudents)
export const studentenWissen = opdracht('studentenWissen', deleteStudents)
