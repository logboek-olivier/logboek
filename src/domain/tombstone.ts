import { scrubbedAccount, scrubbedBalance } from '../model/accounts'
import { scrubbedCareer } from '../model/career'
import { scrubbedClaim } from '../model/claims'
import { scrubbedDocument } from '../model/documents'
import { scrubbed } from '../model/students'
import type { Account, Balance, CareerRecord, Claim, CollectionPath, FixedCost, Student, SyncRecord, VaultDocument } from '../model/types'

/**
 * De tombstone van een record dat weer weg moet (ongedaan maken van iets nieuws). Persoonlijke en gevoelige gegevens
 * (rekeningen, standen, vaste lasten, carrière, declaraties, de kluis en studenten, regel 14) gaan zonder inhoud; de rest houdt zijn
 * inhoud, zodat hij terug te zetten is.
 */
export function tombstone(path: CollectionPath, record: SyncRecord, now: string): SyncRecord {
  switch (path) {
    case 'accounts.json.enc':
      return scrubbedAccount(record as Account, now)
    case 'balances.json.enc':
      return scrubbedBalance(record as Balance, now)
    case 'career.json.enc':
      return scrubbedCareer(record as CareerRecord, now)
    case 'claims.json.enc':
      return scrubbedClaim(record as Claim, now)
    case 'documents/index.json.enc':
      return scrubbedDocument(record as VaultDocument, now)
    case 'students.json.enc':
      return scrubbed(record as Student, now)
    case 'fixedcosts.json.enc': {
      const empty: FixedCost = { id: record.id, name: '', currency: (record as FixedCost).currency, amounts: [], updatedAt: now, deletedAt: now }
      return empty
    }
    default:
      return { ...record, updatedAt: now, deletedAt: now }
  }
}
