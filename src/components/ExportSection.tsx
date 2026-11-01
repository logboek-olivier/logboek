import { FileSpreadsheet, ShieldAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { formatNumber } from '../format'
import { getLang, t } from '../i18n'
import { exportFileName, exportFiles, exportZip, type ExportFile } from '../model/export'
import { getRates } from '../model/rates'
import { ErrorLine } from '../screens/Setup'
import { describeError } from '../session'
import { shareOrDownload } from '../share'
import type { Store } from '../storage/store'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { todayIso } from '../basis/datum'

// Meer → Opslag → Exporteren: trips, dagen, boten, plaatsen, inkomsten en uitgaven als leesbare CSV-bestanden in één
// zip, om in Excel te openen. Het bestand is NIET versleuteld: eerst een duidelijke waarschuwing met wat erin staat en
// wat niet, pas na "Onversleuteld exporteren" wordt het gemaakt en gedeeld (navigator.share of downloaden). De app
// stuurt zelf niets. Staat er een bestand van een nieuwere versie op het apparaat, dan geen (onvolledige) export.

export function ExportSection({ store }: { store: Store }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="section stack">
      <h2>{t('csvExport.title')}</h2>
      <p className="muted">{t('csvExport.hint')}</p>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <Icon icon={FileSpreadsheet} />
        {t('csvExport.button')}
      </button>
      {open && <ExportSheet store={store} onClose={() => setOpen(false)} />}
    </div>
  )
}

function ExportSheet({ store, onClose }: { store: Store; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lang = getLang()
  const frozen = store.frozenPaths()
  // Eén keer bij het openen; een beschadigd record mag het Opslag-scherm (met back-up en herstel) niet laten vastlopen.
  const prepared = useMemo((): { files: ExportFile[] } | { error: string } => {
    try {
      return {
        files: exportFiles(
          { trips: store.list('trips.json.enc'), legs: store.list('legs.json.enc'), places: store.list('places.json.enc'), transactions: store.list('transactions.json.enc'), rates: getRates() },
          lang,
        ),
      }
    } catch (err) {
      return { error: describeError(err) }
    }
  }, [store, lang])
  const files = 'files' in prepared ? prepared.files : []

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const zip = exportZip(files)
      await shareOrDownload(new File([new Uint8Array(zip)], exportFileName(todayIso()), { type: 'application/zip' }), t('csvExport.title'))
      onClose()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={t('csvExport.title')} onClose={onClose}>
      <div className="stack">
        <p className="notice export-warning">
          <Icon icon={ShieldAlert} />
          <span>{t('csvExport.warning')}</span>
        </p>
        {frozen.length > 0 ? (
          <p className="notice">{t('csvExport.newer')}</p>
        ) : (
          <>
            <ul className="rows export-files">
              {files.map((f) => (
                <li key={f.name}>
                  <span>{f.name}</span>
                  <span className="muted small num">{t('csvExport.rows', { n: f.rows, count: formatNumber(f.rows) })}</span>
                </li>
              ))}
            </ul>
            <p className="muted small">{t('csvExport.included')}</p>
            <p className="muted small">{t('csvExport.notIncluded')}</p>
          </>
        )}
        <ErrorLine error={'error' in prepared ? prepared.error : error} />
        <button type="button" className="btn primary" disabled={busy || frozen.length > 0 || files.length === 0} onClick={() => void run()}>
          <Icon icon={FileSpreadsheet} />
          {t('csvExport.confirm')}
        </button>
        <button type="button" className="btn link" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </Sheet>
  )
}
