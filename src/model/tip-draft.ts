import { cleanTipFrom, splitTotal } from './guests'
import { parseAmount } from './money'
import type { Participant, TipFrom } from './types'

// Invoer van "Van wie" bij een fooi (Toevoegen en het bewerkblad): wat er getypt is, en wat er wordt opgeslagen.

export interface TipDraft {
  kind: 'onbekend' | 'groep' | 'personen'
  ids: string[]
  split: boolean
  amounts: Record<string, string>
}

export const EMPTY_TIP: TipDraft = { kind: 'onbekend', ids: [], split: false, amounts: {} }

export const formatAmountInput = (n: number) => n.toFixed(2).replace('.', ',').replace(/,00$/, '')

/** Een opgeslagen fooi als invoer; personen die niet meer bij de trip horen vallen weg. */
export function draftFromTip(from: TipFrom | undefined, participants: readonly Participant[]): TipDraft {
  if (!from || from.kind === 'onbekend') return EMPTY_TIP
  if (from.kind === 'groep') return { ...EMPTY_TIP, kind: 'groep' }
  const ids = from.participantIds.filter((id) => participants.some((p) => p.id === id))
  if (ids.length === 0) return EMPTY_TIP
  const amounts = Object.fromEntries(Object.entries(from.amounts ?? {}).filter(([id]) => ids.includes(id)).map(([id, a]) => [id, formatAmountInput(a)]))
  return { kind: 'personen', ids, split: !!from.amounts && ids.length > 1, amounts }
}

/** Van "per persoon" terug naar één bedrag: het laatste totaal blijft staan in het bedragveld. */
export function totalWhenLeavingSplit(before: TipDraft, after: TipDraft): number | null {
  const total = draftTotal(before)
  return total !== undefined && total !== null && draftTotal(after) === undefined ? total : null
}

/** Per persoon ingevoerd: het totaal, of null zolang een bedrag ontbreekt of niet klopt. Anders undefined. */
export function draftTotal(draft: TipDraft): number | null | undefined {
  if (draft.kind !== 'personen' || draft.ids.length < 2 || !draft.split) return undefined
  const values = draft.ids.map((id) => parseAmount(draft.amounts[id] ?? ''))
  if (values.some((v) => v === null)) return null
  return splitTotal(Object.fromEntries(draft.ids.map((id, i) => [id, values[i]!])))
}

/** Wat er wordt opgeslagen (gecontroleerd tegen de deelnemers van de trip); undefined = onbekend. */
export function tipFromDraft(draft: TipDraft, participants: readonly Participant[]): TipFrom | undefined {
  if (draft.kind === 'groep') return participants.length > 0 ? { kind: 'groep' } : undefined
  if (draft.kind !== 'personen') return undefined
  const total = draftTotal(draft)
  const amounts = total ? Object.fromEntries(draft.ids.map((id) => [id, parseAmount(draft.amounts[id] ?? '') ?? 0])) : undefined
  return cleanTipFrom({ kind: 'personen', participantIds: draft.ids, ...(amounts ? { amounts } : {}) }, participants)
}
