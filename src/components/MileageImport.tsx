import { LoaderCircle, Upload } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { mijlenImporteren } from '../domain/importeren'
import { recordError } from '../errors'
import { formatDateRange, formatHours, formatNm, formatNumber } from '../format'
import { t } from '../i18n'
import { roleLabel } from '../i18n/labels'
import { planImport } from '../import/apply'
import { ImportError, parseMileageFile, type ImportResult } from '../import/mileage-csv'
import type { SailingSummary } from '../model/derive'
import { ROLES } from '../model/types'
import { ErrorLine } from '../screens/Setup'
import { describeError } from '../session'
import { useBack } from '../back'
import type { Store } from '../storage/store'
import { Icon } from './Icon'

// De mijlenregistratie importeren (Logboek → Importeren en Meer → Opslag → Excel opnieuw importeren): één importer
// (src/import/apply.ts). Eerst het voorbeeld met de getallen om met Excel te vergelijken, per trip de eerste en laatste
// dag, wat er vervangen wordt en wat er vreemd is in het bestand (een eigen scherm); pas na "Importeren" verandert
// er iets.

/**
 * Een knop met bestandskiezer, en zolang er een gekozen bestand is het voorbeeld (een eigen scherm, `preview`: het
 * scherm toont dan alleen het voorbeeld). De terugknop sluit het voorbeeld zonder te importeren.
 */
export function useMileageImport(store: Store, onImported: () => void): { trigger: (label: string, primary?: boolean) => ReactNode; preview: ReactNode | null } {
  const [pending, setPending] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  useBack(!!pending, () => setPending(null))

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    setReading(true)
    try {
      // Inhoud bepaalt het formaat (CSV of .xlsx), niet de naam of het MIME-type van de bestandskiezer.
      setPending(parseMileageFile(new Uint8Array(await file.arrayBuffer())))
    } catch (e) {
      recordError(e)
      setError(e instanceof ImportError ? e.message : t('import.unreadable'))
    } finally {
      setReading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const trigger = (label: string, primary = false) => (
    <>
      <button type="button" className={`btn${primary ? ' primary' : ' small quiet'}`} onClick={() => fileInput.current?.click()} disabled={reading}>
        <Icon icon={reading ? LoaderCircle : Upload} className={reading ? 'spin' : ''} />
        {reading ? t('import.reading') : label}
      </button>
      {/* Geen accept-filter: Android en Google Drive geven CSV en Excel wisselende MIME-types en grijzen ze dan uit. */}
      <input ref={fileInput} type="file" hidden aria-label={t('import.file')} onChange={(e) => void onFile(e.target.files?.[0])} />
      <ErrorLine error={error} />
    </>
  )
  const preview = pending ? (
    <ImportPreview
      store={store}
      input={pending}
      onClose={() => setPending(null)}
      onDone={() => {
        setPending(null)
        onImported()
      }}
    />
  ) : null
  return { trigger, preview }
}

function ImportPreview({ store, input, onClose, onDone }: { store: Store; input: ImportResult; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const plan = planImport(store, input)
  const blocks = input.trips.map((trip) => ({ trip, days: input.legs.filter((l) => l.tripId === trip.id).length })).sort((a, b) => (a.trip.startDate! < b.trip.startDate! ? 1 : -1))

  async function confirm() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await mijlenImporteren(store, input)
      onDone()
    } catch (e) {
      // Bijvoorbeeld een import die een bestaande koppeling zou veranderen (src/domain/relaties.ts): niets geschreven.
      setError(describeError(e))
      setBusy(false)
    }
  }

  return (
    <section className="stack import-preview">
      <header className="page-header">
        <h1>{t('import.check')}</h1>
      </header>
      <p className="muted">{t('import.compare')}</p>
      <SummaryGrid summary={input.summary} />
      <h2>{t('import.whatHappens')}</h2>
      <ul className="plain-list small import-plan">
        <li>{t('import.planNew', { trips: formatNumber(input.trips.length), days: formatNumber(input.legs.length) })}</li>
        {plan.matched > 0 && <li>{t('import.planMatched', { n: formatNumber(plan.matched) })}</li>}
        {(plan.removedTrips.length > 0 || plan.goneDays > 0) && (
          <li>{t('import.planTrash', { trips: formatNumber(plan.removedTrips.length), days: formatNumber(plan.goneDays) })}</li>
        )}
        {plan.keptTrips.length > 0 && <li>{t('import.planKept', { names: plan.keptTrips.map((x) => x.name).join(', ') })}</li>}
        <li>{t('import.planOwn', { n: formatNumber(plan.manualLegs) })}</li>
      </ul>
      {input.warnings.length > 0 && (
        <>
          <h2>{t('import.warnings', { n: input.warnings.length })}</h2>
          <p className="muted small">{t('import.warningsHint')}</p>
          <ul className="warnings">
            {input.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </>
      )}
      <h2>{t('import.tripsInFile', { n: blocks.length })}</h2>
      <ul className="plain-list small import-trips">
        {blocks.map(({ trip, days }) => (
          <li key={trip.id} className="row">
            <span className="grow">{trip.name}</span>
            <span className="muted num">
              {formatDateRange(trip.startDate!, trip.endDate!)} · {t('import.days', { n: days })}
            </span>
          </li>
        ))}
      </ul>
      <ErrorLine error={error} />
      <div className="stack">
        <button type="button" className="btn primary" onClick={() => void confirm()} disabled={busy}>
          {busy ? t('import.importing') : t('import.import')}
        </button>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </section>
  )
}

/** Totalen om met de samenvatting in Excel te vergelijken. */
export function SummaryGrid({ summary }: { summary: SailingSummary }) {
  const water = summary.nmByWater
  return (
    <dl className="grid grid-3">
      <Stat label={t('stat.total')} value={formatNm(summary.nm)} />
      <Stat label={t('stat.days')} value={formatNumber(summary.days)} />
      <Stat label={t('stat.trips')} value={formatNumber(summary.trips)} />
      <Stat label={t('stat.nightHours')} value={formatHours(summary.nightHours)} />
      {ROLES.filter((r) => summary.nmByRole[r] > 0).map((r) => (
        <Stat key={r} label={roleLabel(r)} value={formatNm(summary.nmByRole[r])} />
      ))}
      <Stat label={t('water.inland')} value={formatNm(water.inland)} />
      <Stat label={t('water.sea')} value={formatNm(water.sea)} />
      <Stat label={t('water.tidal')} value={formatNm(water.tidal)} />
    </dl>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
