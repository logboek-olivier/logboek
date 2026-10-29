import type { Bytes } from '../crypto/encrypt'
import { MAX_DOCUMENT_BYTES } from '../storage/documents'
import type { Store } from '../storage/store'
import type { DueItem } from './reminders'
import { newId, type DocumentCategory, type VaultDocument } from './types'

// Kluis (Meer → Kluis): documenten met een categorie, optioneel een uitgifte- en vervaldatum en een notitie. Een foto
// (camera of galerij) wordt verkleind tot hoogstens 1600 px aan de lange kant, JPEG 0,8; een PDF blijft ongewijzigd;
// hoogstens 20 MB. Het bestand gaat versleuteld naar GitHub met een willekeurige naam (src/storage/documents.ts);
// titel, categorie en datums staan alleen in de versleutelde index. Identiteit en certificaten zijn standaard offline
// beschikbaar. De categorie identiteit bestaat, maar de app vraagt er nooit om (regel 12). Een vervaldatum staat bij de
// termijnen.

/**
 * Testfase: tot Olivier het rapport van de volledige beveiligingsreview (PR 13) heeft goedgekeurd, staat in de kluis
 * dat er alleen nepdocumenten in horen (regel 11). Na zijn akkoord in een eigen PR op true.
 */
export const VAULT_REVIEWED = false

/** Standaard offline beschikbaar (op zee zonder verbinding te openen). */
export const OFFLINE_BY_DEFAULT: ReadonlySet<DocumentCategory> = new Set(['identiteit', 'certificaten'])

export const MAX_IMAGE_SIDE = 1600
export const JPEG_QUALITY = 0.8

export function isImage(mime: string): boolean {
  return mime.startsWith('image/')
}

export function isPdf(mime: string, bytes?: Bytes): boolean {
  if (mime === 'application/pdf') return true
  // Herkend aan de inhoud ("%PDF"), niet aan naam of type: de bestandskiezer van Android geeft soms geen type mee.
  return !!bytes && bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

/** De afmetingen na verkleinen: de lange kant hoogstens MAX_IMAGE_SIDE, nooit vergroten. */
export function scaledSize(width: number, height: number, max = MAX_IMAGE_SIDE): { width: number; height: number } {
  const long = Math.max(width, height)
  if (long <= max || long === 0) return { width, height }
  const f = max / long
  return { width: Math.round(width * f), height: Math.round(height * f) }
}

/** Een foto verkleinen en als JPEG 0,8 opnieuw opslaan (in de browser, zonder netwerk). */
export async function shrinkImage(file: Blob): Promise<{ bytes: Bytes; mime: string }> {
  const bitmap = await createImageBitmap(file)
  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Geen canvas')
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob) throw new Error('Foto niet te verkleinen')
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg' }
  } finally {
    bitmap.close()
  }
}

export class UnsupportedFileError extends Error {
  constructor() {
    super('Alleen een foto of een PDF')
    this.name = 'UnsupportedFileError'
  }
}

/** Een gekozen bestand klaarmaken: foto verkleinen, PDF ongewijzigd, anders geweigerd. Groter dan 20 MB: geweigerd. */
export async function prepareFile(file: File): Promise<{ bytes: Bytes; mime: string }> {
  const raw = new Uint8Array(await file.arrayBuffer())
  if (isPdf(file.type, raw)) {
    if (raw.length > MAX_DOCUMENT_BYTES) throw new RangeError('te groot')
    return { bytes: raw, mime: 'application/pdf' }
  }
  if (!isImage(file.type) && !/\.(jpe?g|png|heic|webp)$/i.test(file.name)) throw new UnsupportedFileError()
  const shrunk = await shrinkImage(file)
  if (shrunk.bytes.length > MAX_DOCUMENT_BYTES) throw new RangeError('te groot')
  return shrunk
}

export interface DocumentInput {
  title: string
  category: DocumentCategory
  issuedAt: string
  expiresAt: string
  notes: string
  offline: boolean
}

function clean(input: DocumentInput): Pick<VaultDocument, 'title' | 'category' | 'offline'> & Partial<Pick<VaultDocument, 'issuedAt' | 'expiresAt' | 'notes'>> {
  const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
  const issuedAt = date(input.issuedAt)
  const expiresAt = date(input.expiresAt)
  const notes = input.notes.trim().slice(0, 2000)
  return {
    title: input.title.replace(/\s+/g, ' ').trim().slice(0, 120),
    category: input.category,
    offline: input.offline,
    ...(issuedAt ? { issuedAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(notes ? { notes } : {}),
  }
}

/** Een nieuw document: eerst het bestand versleuteld op het apparaat, dan de index; de sync zet beide op GitHub. */
export async function addDocument(store: Store, input: DocumentInput, file: { bytes: Bytes; mime: string }): Promise<VaultDocument> {
  const fileId = newId()
  await store.putDocumentFile(fileId, file.bytes)
  const record: VaultDocument = { id: newId(), ...clean(input), mime: file.mime, size: file.bytes.length, fileId, updatedAt: new Date().toISOString(), deletedAt: null }
  await store.put('documents/index.json.enc', record)
  return record
}

/** Titel, categorie, datums, notitie en offline wijzigen (het bestand blijft hetzelfde). */
export async function updateDocument(store: Store, document: VaultDocument, input: DocumentInput): Promise<VaultDocument> {
  const next: VaultDocument = { id: document.id, mime: document.mime, size: document.size, fileId: document.fileId, ...clean(input), updatedAt: new Date().toISOString(), deletedAt: null }
  await store.put('documents/index.json.enc', next)
  if (next.offline !== document.offline) await store.setDocumentOffline(document.fileId, next.offline).catch(() => undefined)
  return next
}

/** Documenten met een vervaldatum, voor de termijnen (verlopen bovenaan, zoals alle termijnen). */
export function documentDueItems(documents: readonly VaultDocument[]): DueItem[] {
  return documents.filter((d) => d.deletedAt === null && d.expiresAt).map((d) => ({ id: d.id, title: d.title, date: d.expiresAt!, kind: 'vervalt', source: 'document' }))
}

/** "1,2 MB", "340 kB". */
export function sizeLabel(bytes: number, format: (n: number) => string): string {
  if (bytes >= 1024 * 1024) return `${format(Math.round((bytes / (1024 * 1024)) * 10) / 10)} MB`
  return `${format(Math.max(1, Math.round(bytes / 1024)))} kB`
}
