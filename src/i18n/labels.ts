import type { Organisation, Role, TransactionKind, TransactionSource } from '../model/types'
import { translate, getLang, type Lang } from '.'
import { orgName } from '../basis/organisatie'

// Weergavenamen van vaste waarden in het datamodel. De opgeslagen waarden zelf blijven Nederlands (dataformaat).

export function roleLabel(role: Role, lang: Lang = getLang()): string {
  return translate(lang, `role.${role}`)
}

export function kindLabel(kind: TransactionKind, lang: Lang = getLang()): string {
  return translate(lang, `kind.${kind}`)
}

export function sourceLabel(source: TransactionSource, lang: Lang = getLang()): string {
  return translate(lang, `source.${source}`)
}

/** De naam uit Instellingen → Organisaties; eigen en overig (en een verwijderde bestaande) vertaald. */
export function organisationLabel(org: Organisation, lang: Lang = getLang()): string {
  const name = orgName(org)
  if (name) return name
  if (org === 'eigen' || org === 'overig' || org === 'sailing-virgins' || org === 'yacht-week') return translate(lang, `organisation.${org}`)
  return org
}
