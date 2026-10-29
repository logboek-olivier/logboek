// Kluis: de documentbestanden in logboek-data. Elk bestand staat versleuteld (AES-GCM onder de hoofdsleutel, AAD = het
// pad) in `documents/<fileId>.bin`, met een willekeurige UUID als naam; de echte naam staat alleen in de versleutelde
// index documents/index.json.enc (regels 1 en 8). Geen pad uit gegevens van buiten zonder deze controle.

export const DOCUMENTS_PREFIX = 'documents/'
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function isFileId(id: unknown): id is string {
  return typeof id === 'string' && UUID.test(id)
}

/** Het pad van een documentbestand; een id dat geen UUID is, wordt nooit een pad. */
export function documentPath(fileId: string): string {
  if (!isFileId(fileId)) throw new Error('Ongeldig documentbestand')
  return `${DOCUMENTS_PREFIX}${fileId}.bin`
}

export function fileIdOf(path: string): string | null {
  const match = /^documents\/([^/]+)\.bin$/.exec(path)
  return match && isFileId(match[1]) ? match[1] : null
}

/** Het bestand is er niet: niet op dit apparaat en (nog) niet op GitHub, of de demo. */
export class DocumentUnavailableError extends Error {
  constructor(readonly reason: 'missing' | 'demo') {
    super('Documentbestand niet beschikbaar')
    this.name = 'DocumentUnavailableError'
  }
}

export class DocumentTooLargeError extends Error {
  constructor() {
    super('Document te groot')
    this.name = 'DocumentTooLargeError'
  }
}
