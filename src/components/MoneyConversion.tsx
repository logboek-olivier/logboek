import { ArrowLeftRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { geldOmzetten, needsMoneyConversion, planMoneyConversion } from '../domain/geld-omzetten'
import { recordError } from '../errors'
import { t } from '../i18n'
import { useBack } from '../back'
import { useCollection } from './useCollection'
import { useSyncStatus } from './SyncStatusLine'
import type { Store } from '../storage/store'
import { Icon } from './Icon'
import type { Notify } from './EditSheets'

// "Geld omzetten" (eenmalig na de update, src/domain/geld-omzetten.ts): alleen aantallen, nooit bedragen of namen. Pas
// na één tik verandert er iets; eerst komt er een herstelpunt in de prullenbak.

const MONEY_FILES = ['trips.json.enc', 'transactions.json.enc', 'legs.json.enc'] as const

/** Moet het geld nog omgezet worden? (Niet in de demo: die begint al in het nieuwe model.) */
export function useNeedsConversion(store: Store): boolean {
  const trips = useCollection(store, 'trips.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  // Opnieuw bepalen zodra tochten of transacties veranderen (die lezen we via de store).
  return useMemo(() => (trips && transactions ? needsMoneyConversion(store) : false), [store, trips, transactions])
}

export function MoneyConversionScreen({ store, notify, onLater }: { store: Store; notify: Notify; /** "Later", en na het omzetten sluiten. Zonder: geen "Later" (Geld toont dit scherm tot het omgezet is). */ onLater?: () => void }) {
  useSyncStatus(store)
  const trips = useCollection(store, 'trips.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const counts = useMemo(() => (trips && transactions ? planMoneyConversion(store, new Date().toISOString()).counts : null), [store, trips, transactions])!
  const [busy, setBusy] = useState(false)
  useBack(!!onLater, () => onLater?.())
  const unreadable = store.unreadableFiles().some((f) => (MONEY_FILES as readonly string[]).includes(f.path))
  const ready = store.hasSynced() && !unreadable

  async function convert() {
    if (busy || !ready) return
    setBusy(true)
    try {
      const { undo } = await geldOmzetten(store)
      notify(t('convert.done'), undo)
      onLater?.()
    } catch (error) {
      recordError(error)
      notify(t('convert.failed'))
    } finally {
      setBusy(false)
    }
  }

  const lines: [number, string][] = [
    [counts.merged, t('convert.merged', { n: counts.merged })],
    [counts.created, t('convert.created', { n: counts.created })],
    [counts.cashMarks, t('convert.cashMarks', { n: counts.cashMarks })],
    [counts.missing, t('convert.missing', { n: counts.missing })],
    [counts.multiple, t('convert.multiple', { n: counts.multiple })],
  ]
  return (
    <section className="stack money-conversion">
      <h1>
        <Icon icon={ArrowLeftRight} />
        {t('convert.title')}
      </h1>
      <p>{t('convert.intro')}</p>
      <ul className="stack-sm">
        {lines
          .filter(([n]) => n > 0)
          .map(([, text]) => (
            <li key={text}>{text}</li>
          ))}
      </ul>
      <p className="muted small">{t('convert.safe')}</p>
      {!store.hasSynced() && <p className="muted small">{t('convert.waitSync')}</p>}
      {unreadable && <p className="muted small">{t('convert.unreadable')}</p>}
      <button type="button" className="btn primary" disabled={busy || !ready} onClick={() => void convert()}>
        <Icon icon={ArrowLeftRight} />
        {t('convert.button')}
      </button>
      {onLater && (
        <button type="button" className="btn quiet" onClick={onLater}>
          {t('convert.later')}
        </button>
      )}
    </section>
  )
}
