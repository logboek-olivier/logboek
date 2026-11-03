// Springen naar een ander scherm vanuit een onderdeel dat overal kan staan (bijvoorbeeld het tripoverzicht, dat in
// Deze trip, het Logboek, de agenda en Vandaag opent). Home luistert; zonder Home gebeurt er niets.

import type { AddTab } from './model/types'
import type { AddInit } from './screens/QuickAdd'

export type NavTarget = { kind: 'student'; studentId: string } | { kind: 'nakijken' } | { kind: 'geld' } | { kind: 'toevoegen'; init?: AddInit; tab?: AddTab }

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

/** Meer → Nakijken openen (vanuit Gezondheid: daar staat de fix van één tik). */
export function openReview(): void {
  listener?.({ kind: 'nakijken' })
}

/** Meer → Geld openen (vanuit Gezondheid: Te controleren staat bovenaan Geld). */
export function openMoney(): void {
  listener?.({ kind: 'geld' })
}

/** Toevoegen openen als laag over het scherm waar Olivier is (bijvoorbeeld "Dag toevoegen" in een tripoverzicht). */
export function openAdd(init?: AddInit, tab?: AddTab): void {
  listener?.({ kind: 'toevoegen', init, tab })
}
