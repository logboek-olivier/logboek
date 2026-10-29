import { Printer } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { formatDate, formatMoney, formatRate } from '../format'
import { t } from '../i18n'
import { kindLabel, organisationLabel, sourceLabel } from '../i18n/labels'
import { getRates, subscribeRates } from '../model/rates'
import { taxYear, taxYears, type TaxGroup, type TaxLine, type TaxYear } from '../model/tax-year'
import type { Store } from '../storage/store'
import { Icon } from './Icon'
import { useCollection } from './useCollection'

// Jaaroverzicht voor de belasting (Meer → Geld): per jaar de inkomsten per organisatie in euro, met per regel het
// oorspronkelijke bedrag en de gebruikte koers met datum. Op het scherm de totalen; de PDF (printfunctie) heeft alle
// regels. Alles wordt op het apparaat gemaakt.

export function groupLabel(group: TaxGroup): string {
  return group === 'delivery' ? sourceLabel('delivery') : organisationLabel(group)
}

function otherText(other: Record<string, number>): string {
  return Object.entries(other)
    .map(([currency, amount]) => formatMoney(amount, currency))
    .join(', ')
}

/** De koers van een regel: "1 EUR = 1,0812 USD · 20 okt. 2026", ontvangen in euro, of geen koers. */
export function rateText(line: TaxLine): string {
  if (line.basis === 'eur') return ''
  if (line.basis === 'received') return t('tax.received')
  if (line.basis === 'none' || line.rate === undefined) return t('tax.noRate')
  const rate = t('tax.rate', { rate: formatRate(line.rate), currency: line.currency })
  return [rate, line.rateDate ? formatDate(line.rateDate) : '', line.provisional ? t('money.provisional') : ''].filter(Boolean).join(' · ')
}

function LinesTable({ lines }: { lines: readonly TaxLine[] }) {
  return (
    <div className="table-scroll">
      <table className="table tax-lines">
        <thead>
          <tr>
            <th>{t('field.date')}</th>
            <th>{t('tax.kind')}</th>
            <th>{t('field.trip')}</th>
            <th className="num">{t('tax.amount')}</th>
            <th>{t('tax.rateHead')}</th>
            <th className="num">{t('tax.eur')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id}>
              <td>{formatDate(line.date)}</td>
              <td>{kindLabel(line.kind)}</td>
              <td>{line.trip ?? ''}</td>
              <td className="num">{formatMoney(line.amount, line.currency)}</td>
              <td>{rateText(line)}</td>
              <td className="num">{line.eur === null ? '' : formatMoney(line.eur, 'EUR')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Totals({ data }: { data: TaxYear }) {
  return (
    <table className="table tax-totals">
      <tbody>
        {data.groups.map((g) => (
          <tr key={g.group}>
            <td>{groupLabel(g.group)}</td>
            <td className="num">
              {formatMoney(g.eur, 'EUR')}
              {Object.keys(g.other).length > 0 && <span className="muted small"> + {otherText(g.other)}</span>}
            </td>
          </tr>
        ))}
        <tr className="total-row">
          <td>{t('tax.total')}</td>
          <td className="num">{formatMoney(data.totalEur, 'EUR')}</td>
        </tr>
        {data.reimbursed.length > 0 && (
          <tr>
            <td>{t('money.reimbursed')}</td>
            <td className="num">{formatMoney(data.reimbursedEur, 'EUR')}</td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

export function TaxYearSection({ store }: { store: Store }) {
  const rates = useSyncExternalStore(subscribeRates, getRates)
  const transactions = useCollection(store, 'transactions.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const [year, setYear] = useState<number | null>(null)
  const [printRequest, setPrintRequest] = useState(0)

  useEffect(() => {
    if (printRequest > 0) window.print()
  }, [printRequest])

  const years = taxYears(transactions)
  const chosen = year !== null && years.includes(year) ? year : (years[0] ?? null)
  if (chosen === null) return null
  const data = taxYear(transactions, trips, chosen, rates)

  return (
    <div className="section card card-body stack tax-year">
      <div className="section-head">
        <h2>{t('tax.title')}</h2>
      </div>
      <label>
        {t('tax.year')}
        <select value={chosen} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <Totals data={data} />
      {data.provisional && <p className="muted small">{t('tax.provisionalHint')}</p>}
      <button type="button" className="btn" onClick={() => setPrintRequest((n) => n + 1)}>
        <Icon icon={Printer} />
        {t('tax.print')}
      </button>
      <p className="muted small">{t('tax.printHint')}</p>
      {printRequest > 0 &&
        createPortal(
          <div className="print-root tax-print">
            <h1>{t('tax.printTitle', { year: chosen })}</h1>
            <p>{t('tax.basis')}</p>
            <Totals data={data} />
            {data.groups.map((g) => (
              <section key={g.group}>
                <h2>{`${groupLabel(g.group)} · ${formatMoney(g.eur, 'EUR')}`}</h2>
                <LinesTable lines={g.lines} />
              </section>
            ))}
            {data.reimbursed.length > 0 && (
              <section>
                <h2>{`${t('money.reimbursed')} · ${formatMoney(data.reimbursedEur, 'EUR')}`}</h2>
                <p>{t('tax.reimbursedHint')}</p>
                <LinesTable lines={data.reimbursed} />
              </section>
            )}
            {data.provisional && <p>{t('tax.provisionalHint')}</p>}
            <p>{t('tax.madeOn', { date: formatDate(new Date().toISOString().slice(0, 10)) })}</p>
          </div>,
          document.body,
        )}
    </div>
  )
}
