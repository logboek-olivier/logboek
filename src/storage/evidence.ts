import { decryptObject, DecryptError, FORMAT_VERSION, IV_LENGTH, TAG_LENGTH, type Bytes } from '../crypto/encrypt'
import { NewerSchemaError } from '../model/schema'
import { COLLECTION_PATHS, type CollectionPath } from '../model/types'
import { IntegrityError, parseCommitMessage, type GithubClient, type RemoteFile } from './github'
import { decodeRecords, InvalidDataError, invalidReason } from './sync'

// Bewijs per onleesbaar bestand (Meer → Opslag en "Kopieer foutdetails"): de versie die nu op GitHub staat en de
// laatste vijf commits van dat pad, elk met tijd, app-versie en apparaat-id uit het commitbericht, de blob-sha, de
// grootte, de eerste byte (de formaatversie) en wat de app ermee kan. Nooit inhoud (regel 9): alleen sha's, aantallen
// bytes, één formaatbyte en de soort uitkomst. Zo is uit de echte omgeving te zien wie wat schreef.

/**
 * Wat de app met een versie kan: leesbaar; leeg; formaat (eerste byte of lengte klopt niet, ook afgekapt); sleutel
 * (AES-GCM faalt: een andere hoofdsleutel); ander-pad (ontsleutelt met deze sleutel als een ander bestand: onder de
 * verkeerde naam gezet); ongeldig (ontsleutelt, maar geen geldig logboekbestand); nieuwer (van een nieuwere app);
 * weg (het bestand bestond bij die commit niet); integriteit (inhoud hoort niet bij de sha).
 */
export type Verdict = 'leesbaar' | 'leeg' | 'formaat' | 'sleutel' | 'nieuwer' | 'weg' | 'integriteit' | `ander-pad:${string}` | `ongeldig:${string}`

export interface VersionEvidence {
  /** Korte commit-sha (7 tekens); leeg voor de versie die nu op GitHub staat. */
  commit: string
  at: string | null
  version: string | null
  device: string | null
  /** Korte blob-sha (12 tekens). */
  blob: string | null
  size: number | null
  firstByte: number | null
  verdict: Verdict
}

export interface FileEvidence {
  path: CollectionPath
  /** Wanneer verzameld (ISO). */
  at: string
  current: VersionEvidence | null
  commits: VersionEvidence[]
}

/** Wat deze sleutel met deze bytes onder dit pad kan (zie Verdict). */
export async function classify(masterKey: CryptoKey, path: string, bytes: Bytes): Promise<Verdict> {
  if (bytes.length === 0) return 'leeg'
  if (bytes[0] !== FORMAT_VERSION || bytes.length < 1 + IV_LENGTH + TAG_LENGTH) return 'formaat'
  let plain: Bytes
  try {
    plain = await decryptObject(masterKey, path, bytes)
  } catch (error) {
    if (!(error instanceof DecryptError)) throw error
    // Ontsleutelt het als een ander bestand? Dan is het met deze sleutel onder de verkeerde naam gezet.
    for (const other of COLLECTION_PATHS) {
      if (other === path) continue
      try {
        await decryptObject(masterKey, other, bytes)
        return `ander-pad:${other}`
      } catch {
        // Volgende.
      }
    }
    return 'sleutel'
  }
  try {
    decodeRecords(path, plain)
    return 'leesbaar'
  } catch (error) {
    if (error instanceof NewerSchemaError) return 'nieuwer'
    if (error instanceof InvalidDataError) return `ongeldig:${invalidReason(plain) ?? 'onbekend'}`
    throw error
  }
}

async function describe(masterKey: CryptoKey, path: string, file: RemoteFile | null, commit: string, message: string | null, at: string | null): Promise<VersionEvidence> {
  const info = message ? parseCommitMessage(message) : { at: null, version: null, device: null }
  if (!file) return { commit, at: at ?? info.at, version: info.version, device: info.device, blob: null, size: null, firstByte: null, verdict: 'weg' }
  return {
    commit,
    at: at ?? info.at,
    version: info.version,
    device: info.device,
    blob: file.sha.slice(0, 12),
    size: file.content.length,
    firstByte: file.content.length > 0 ? file.content[0]! : null,
    verdict: await classify(masterKey, path, file.content),
  }
}

/** De versie die nu op GitHub staat plus de laatste vijf commits van dit pad. Leest alleen; schrijft nooit. */
export async function gatherEvidence(client: GithubClient, masterKey: CryptoKey, path: CollectionPath, now = new Date()): Promise<FileEvidence> {
  const read = async (ref: string | null): Promise<RemoteFile | null | 'integriteit'> => {
    try {
      return ref ? await client.getFileAt(path, ref) : await client.getFile(path)
    } catch (error) {
      if (error instanceof IntegrityError) return 'integriteit'
      throw error
    }
  }
  const integrity = (commit: string, at: string | null): VersionEvidence => ({ commit, at, version: null, device: null, blob: null, size: null, firstByte: null, verdict: 'integriteit' })
  const nowFile = await read(null)
  const current = nowFile === 'integriteit' ? integrity('', null) : await describe(masterKey, path, nowFile, '', null, null)
  const commits: VersionEvidence[] = []
  for (const c of await client.fileCommits(path, 5)) {
    const file = await read(c.sha)
    commits.push(file === 'integriteit' ? integrity(c.sha.slice(0, 7), c.at) : await describe(masterKey, path, file, c.sha.slice(0, 7), c.message, c.at))
  }
  return { path, at: now.toISOString(), current, commits }
}

/** Regels voor "Kopieer foutdetails": alleen sha's, tijden, versies, apparaat-id's, groottes, de eerste byte en de uitkomst. */
export function evidenceLines(evidence: readonly FileEvidence[], thisDevice: string): string[] {
  const lines: string[] = []
  const version = (v: VersionEvidence) =>
    [v.commit || 'nu', v.at ?? '-', v.version ? `v${v.version}` : 'v?', v.device ? `d${v.device}${v.device === thisDevice ? '(dit)' : ''}` : 'd?', v.blob ? `blob ${v.blob}` : 'geen blob', v.size !== null ? `${v.size} B` : '', v.firstByte !== null ? `byte ${v.firstByte}` : '', v.verdict].filter(Boolean).join(' ')
  for (const e of evidence) {
    lines.push(`Bewijs ${e.path} (${e.at}):`)
    if (e.current) lines.push(`  ${version(e.current)}`)
    for (const c of e.commits) lines.push(`  ${version(c)}`)
  }
  return lines
}
