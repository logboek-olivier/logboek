// Springen naar een ander scherm vanuit een onderdeel dat overal kan staan (bijvoorbeeld het tripoverzicht, dat in
// Deze trip, het Logboek, de agenda en Vandaag opent). Home luistert; zonder Home gebeurt er niets.

export type NavTarget = { kind: 'student'; studentId: string }

let listener: ((target: NavTarget) => void) | null = null

export function onNavigate(l: (target: NavTarget) => void): () => void {
  listener = l
  return () => {
    if (listener === l) listener = null
  }
}

/** De checklist van een student openen (Meer → Studentenarchief, met de student open). */
export function openStudent(studentId: string): void {
  listener?.({ kind: 'student', studentId })
}
