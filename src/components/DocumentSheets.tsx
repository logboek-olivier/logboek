import { Camera, Download, FileText, FolderOpen, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { DecryptError, type Bytes } from '../crypto/encrypt'
import { recordError } from '../errors'
import { formatDate, formatNumber } from '../format'
import { t, type MessageKey } from '../i18n'
import { addDocument, isImage, OFFLINE_BY_DEFAULT, prepareFile, sizeLabel, UnsupportedFileError, updateDocument, type DocumentInput } from '../model/documents'
import { deleteDocument } from '../model/edit'
import { DOCUMENT_CATEGORIES, type DocumentCategory, type VaultDocument } from '../model/types'
import { shareOrDownload } from '../share'
import { DocumentTooLargeError, DocumentUnavailableError } from '../storage/documents'
import { NetworkError } from '../storage/github'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { CopyErrorDetails } from './ErrorDetails'
import { Icon } from './Icon'
import { NoteField } from './NoteField'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'
import { ViewRows } from './Views'

// Kluis: een document toevoegen (foto maken of bestand kiezen), bekijken (foto in beeld, PDF openen via delen of
// downloaden) en bewerken of verwijderen (met ongedaan maken). Het bestand wordt pas in het geheugen ontsleuteld als
// Olivier het opent; vergrendelen sluit het blad en laat de ontsleutelde bytes los.

export function categoryLabel(category: DocumentCategory): string {
  return t(`vault.category.${category}` as MessageKey)
}

function fileError(error: unknown): string {
  if (error instanceof DocumentTooLargeError || error instanceof RangeError) return t('vault.tooLarge')
  if (error instanceof UnsupportedFileError) return t('vault.unsupported')
  if (error instanceof DocumentUnavailableError) return t('vault.notYetUploaded')
  if (error instanceof NetworkError) return t('vault.offlineOnly')
  if (error instanceof DecryptError) return t('vault.unreadable')
  return t('vault.failed')
}

/**
 * Een neutrale bestandsnaam voor delen of downloaden: nooit de titel, die dan in Downloads of in de andere app zou staan
 * (beveiligingsreview, PR 13).
 */
function downloadName(document: VaultDocument): string {
  return document.mime === 'application/pdf' ? 'document.pdf' : 'document.jpg'
}

function DocumentFields({ value, onChange, offlineTouched, onOfflineTouched }: { value: DocumentInput; onChange: (next: DocumentInput) => void; offlineTouched: boolean; onOfflineTouched: () => void }) {
  return (
    <>
      <label>
        {t('vault.titleField')}
        <input type="text" autoComplete="off" autoCapitalize="sentences" maxLength={120} required value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} />
      </label>
      <label>
        {t('vault.category')}
        <select
          value={value.category}
          onChange={(e) => {
            const category = e.target.value as DocumentCategory
            onChange({ ...value, category, offline: offlineTouched ? value.offline : OFFLINE_BY_DEFAULT.has(category) })
          }}
        >
          {DOCUMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </select>
      </label>
      <div className="two">
        <label>
          {t('vault.issuedAt')}
          <input type="date" value={value.issuedAt} onChange={(e) => onChange({ ...value, issuedAt: e.target.value })} />
        </label>
        <label>
          {t('vault.expiresAt')}
          <input type="date" value={value.expiresAt} onChange={(e) => onChange({ ...value, expiresAt: e.target.value })} />
        </label>
      </div>
      <NoteField label={t('field.note')} value={value.notes} onChange={(notes) => onChange({ ...value, notes })} maxLength={2000} />
      <label className="check">
        <input
          type="checkbox"
          checked={value.offline}
          onChange={(e) => {
            onOfflineTouched()
            onChange({ ...value, offline: e.target.checked })
          }}
        />
        {t('vault.offline')}
      </label>
    </>
  )
}

export function AddDocumentSheet({ store, notify, onClose }: { store: Store; notify: Notify; onClose: () => void }) {
  const [file, setFile] = useState<{ bytes: Bytes; mime: string } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [offlineTouched, setOfflineTouched] = useState(false)
  const [input, setInput] = useState<DocumentInput>({ title: '', category: 'certificaten', issuedAt: '', expiresAt: '', notes: '', offline: OFFLINE_BY_DEFAULT.has('certificaten') })
  const camera = useRef<HTMLInputElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  async function choose(chosen: File | undefined) {
    if (!chosen) return
    setError(null)
    setBusy(true)
    try {
      const ready = await prepareFile(chosen)
      setFile(ready)
      setPreview(isImage(ready.mime) ? URL.createObjectURL(new Blob([ready.bytes], { type: ready.mime })) : null)
    } catch (e) {
      setFile(null)
      setError(fileError(e))
    } finally {
      setBusy(false)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!file || !input.title.trim()) return
    setBusy(true)
    setError(null)
    try {
      await addDocument(store, input, file)
      onClose()
      notify(t('vault.saved'))
    } catch (err) {
      recordError(err)
      setError(fileError(err))
      setBusy(false)
    }
  }

  return (
    <Sheet title={t('vault.add')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="two">
          <button type="button" className="btn" disabled={busy} onClick={() => camera.current?.click()}>
            <Icon icon={Camera} />
            {t('vault.takePhoto')}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => picker.current?.click()}>
            <Icon icon={FolderOpen} />
            {t('vault.chooseFile')}
          </button>
        </div>
        {/* Camera: foto direct met de achtercamera. Bestand kiezen: zonder accept-filter (Android grijst anders bestanden uit). */}
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden aria-label={t('vault.takePhoto')} onChange={(e) => void choose(e.target.files?.[0])} />
        <input ref={picker} type="file" hidden aria-label={t('vault.chooseFile')} onChange={(e) => void choose(e.target.files?.[0])} />
        {file && (
          <div className="vault-preview">
            {preview ? <img src={preview} alt={t('vault.previewAlt')} /> : <Icon icon={FileText} />}
            <span className="muted small">{`${file.mime === 'application/pdf' ? 'PDF' : 'JPEG'} · ${sizeLabel(file.bytes.length, formatNumber)}`}</span>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <DocumentFields value={input} onChange={setInput} offlineTouched={offlineTouched} onOfflineTouched={() => setOfflineTouched(true)} />
        <button className="btn primary" type="submit" disabled={!file || !input.title.trim() || busy}>
          {t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}

export function DocumentView({ store, document, notify, onClose }: { store: Store; document: VaultDocument; notify: Notify; onClose: () => void }) {
  const [editing, setEditing] = useState(false)
  const current = useCollection(store, 'documents/index.json.enc').find((d) => d.id === document.id) ?? document
  const [bytes, setBytes] = useState<Bytes | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<{ text: string; details: boolean } | null>(null)
  const [state, setState] = useState<'none' | 'pending' | 'local' | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setBytes(null)
    setError(null)
    void store.documentFileState(current.fileId).then((s) => !cancelled && setState(s)).catch(() => undefined)
    store
      .documentFile(current.fileId, current.offline)
      .then((plain) => {
        if (cancelled) return
        setBytes(plain)
        if (isImage(current.mime)) {
          objectUrl = URL.createObjectURL(new Blob([plain], { type: current.mime }))
          setUrl(objectUrl)
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return
        if (e instanceof DecryptError) recordError(e)
        setError({ text: fileError(e), details: e instanceof DecryptError })
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [store, current.fileId, current.mime, current.offline])

  if (editing) return <DocumentSheet store={store} document={current} notify={notify} onClose={onClose} />

  async function open() {
    if (!bytes) return
    setBusy(true)
    try {
      // Zonder titel: de andere app krijgt alleen het bestand.
      await shareOrDownload(new File([bytes], downloadName(current), { type: current.mime }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={current.title} onClose={onClose} onEdit={() => setEditing(true)}>
      <div className="stack view">
        {url && <img className="vault-image" src={url} alt={current.title} />}
        {!url && !error && !bytes && <p className="muted">{t('vault.opening')}</p>}
        {!url && bytes && (
          <p className="vault-pdf">
            <Icon icon={FileText} />
            {t('vault.pdf')}
          </p>
        )}
        {error && (
          <div className="notice error-block" role="alert">
            <span>{error.text}</span>
            {error.details && <CopyErrorDetails />}
          </div>
        )}
        {bytes && (
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => void open()}>
              <Icon icon={Download} />
              {t('vault.open')}
            </button>
            <p className="muted small">{t('vault.openWarning')}</p>
          </>
        )}
        <ViewRows
          rows={[
            [t('vault.category'), categoryLabel(current.category)],
            [t('vault.issuedAt'), current.issuedAt && formatDate(current.issuedAt)],
            [t('vault.expiresAt'), current.expiresAt && formatDate(current.expiresAt)],
            [t('field.note'), current.notes],
            [t('vault.size'), `${current.mime === 'application/pdf' ? 'PDF' : 'JPEG'} · ${sizeLabel(current.size, formatNumber)}`],
            [t('vault.offlineState'), t(current.offline ? 'vault.offlineYes' : 'vault.offlineNo')],
            [t('vault.uploadState'), state === 'pending' && t('vault.pending')],
          ]}
        />
      </div>
    </Sheet>
  )
}

export function DocumentSheet({ store, document, notify, onClose }: { store: Store; document: VaultDocument; notify: Notify; onClose: () => void }) {
  const [input, setInput] = useState<DocumentInput>({
    title: document.title,
    category: document.category,
    issuedAt: document.issuedAt ?? '',
    expiresAt: document.expiresAt ?? '',
    notes: document.notes ?? '',
    offline: document.offline,
  })
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!input.title.trim()) return
    setBusy(true)
    await updateDocument(store, document, input)
    onClose()
    notify(t('vault.saved'))
  }

  async function remove() {
    const undo = await deleteDocument(store, document)
    onClose()
    notify(t('toast.deleted'), undo)
  }

  return (
    <Sheet title={t('vault.edit')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <DocumentFields value={input} onChange={setInput} offlineTouched onOfflineTouched={() => undefined} />
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!input.title.trim() || busy}>
            {t('common.save')}
          </button>
          <button className="btn danger" type="button" onClick={() => void remove()}>
            <Icon icon={Trash2} />
            {t('common.delete')}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
