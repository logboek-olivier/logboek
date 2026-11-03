import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { formatDate, formatMoney, formatMonth } from '../format'
import { getLang, t } from '../i18n'
import { kindLabel } from '../i18n/labels'
import type { Drill, DrillGroup, DrillPost, DrillSection } from '../domain/doorklik'
import type { Claim, Transaction, Trip } from '../model/types'
import type { Store } from '../storage/store'
import { ClaimView } from './Claims'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { TripSalarySheet } from './MoneyPath'
import { Sheet } from './Sheet'
import { groupLabel } from './TaxYear'
import { TransactionView } from './Views'

// Doorklikken in Geld (src/domain/doorklik.ts): de posten onder een bedrag, per soort en organisatie, met subtotalen die
// optellen tot het getikte bedrag. Een tik op een post opent de transactie (bekijken, dan bewerken met het potlood), het
// salaris van de tocht of de declaratie. Het blad ligt over Geld: sluiten (ook met terug) brengt Geld terug op dezelfde plek.

export interface DrillRequest {
  title: string
  drill: Drill
  /** "1 jan. 2026 – 2 nov. 2026": de periode waarop gefilterd is. */
  period?: string
  hint?: string
  /** Koppen voor de groepen op een dag ("Te ontvangen op 2 nov."), voor de verandering van de netto waarde. */
  labels?: Partial<Record<DrillSection, string>>
  /** Ook per kalenderjaar (zoals het jaaroverzicht), als de posten over meer dan één jaar gaan. */
  byYear?: boolean
  /** Altijd met plus of min (een verandering), ook als alles positief is. */
  signed?: boolean
}

/** Een bedrag met plus of min (als er ook iets af gaat), anders gewoon het bedrag. */
function amountText(eur: number, signed: boolean): string {
  if (!signed || Math.round(eur * 100) === 0) return formatMoney(eur === 0 ? 0 : eur, 'EUR')
  return `${eur >= 0 ? '+' : '−'}${formatMoney(Math.abs(eur), 'EUR')}`
}

function groupTitle(g: DrillGroup, labels: DrillRequest['labels']): string {
  // "Overig" zegt niets extra's (geld zonder organisatie): dan alleen de soort.
  const org = g.org && g.org !== 'overig' ? ` · ${groupLabel(g.org)}` : ''
  if (g.kind === 'vaste-lasten') return t('drill.fixedCosts')
  if (g.kind === 'variabel') return t('drill.variableCosts')
  if (g.kind === 'scenario-kosten') return t('drill.scenarioCosts')
  if (g.kind === 'groei-beleggen') return t('drill.growthInvestments')
  if (g.kind === 'groei-bezit') return t('drill.growthAssets')
  if (g.kind === 'rente-schuld') return t('drill.debtInterest')
  const kind = g.kind === 'onbekend' ? t('drill.investmentNoKind') : g.kind ? (g.section === 'kosten' ? t(`costCategory.${g.kind as 'overig'}`) : kindLabel(g.kind as Transaction['kind'])) : ''
  switch (g.section) {
    case 'scenario':
      return g.block ? t('scenario.blockLine', { n: g.block.number, weeks: g.block.block.weeks, amount: formatMoney(g.block.block.incomePerWeek, g.block.block.currency) }) : ''
    case 'inkomsten':
    case 'kosten':
      return `${kind}${org}`
    case 'terugbetaald':
      return `${t('money.reimbursed')}${org}`
    case 'salaris':
      return `${kindLabel('loon')}${org}`
    case 'declaraties':
      return t('drill.claims')
    case 'eind':
    case 'begin': {
      const what = g.kind === 'loon' ? `${kindLabel('loon')}${org}` : t('drill.claims')
      return `${labels?.[g.section] ?? ''} · ${what}`
    }
    case 'rekeningen':
      return t('drill.accounts')
    case 'zeilresultaat':
      return t('drill.sailingResult')
    case 'groei':
    case 'eenmalig':
      return t(`drill.section.${g.section}`)
  }
}

function postTitle(p: DrillPost): string {
  if (p.estimate && p.trip) return t('drill.tipEstimate', { trip: p.trip.name })
  if (p.oneOffName !== undefined) return p.oneOffName || t('drill.section.eenmalig')
  if (p.month && !p.tx) return formatMonth(p.month)
  if (p.tx) {
    if (p.tx.note?.trim()) return p.tx.note.trim()
    if (p.tx.kind === 'kosten' || p.tx.kind === 'investering') return t(`costCategory.${p.tx.category ?? 'overig'}`)
    return kindLabel(p.tx.kind)
  }
  if (p.claim) return t('position.claimOf', { date: formatDate(p.claim.date) })
  if (p.account) return p.account.name
  return t('drill.minusSailing')
}

export function DrillSheet({ store, notify, request, onClose }: { store: Store; notify: Notify; request: DrillRequest; onClose: () => void }) {
  const { drill } = request
  const [tx, setTx] = useState<Transaction | null>(null)
  const [salaryTrip, setSalaryTrip] = useState<Trip | null>(null)
  const [claim, setClaim] = useState<Claim | null>(null)
  const signed = !!request.signed || drill.groups.some((g) => g.eur < 0 || g.posts.some((p) => (p.eur ?? 0) < 0))
  // Bij meer dan één soort groep: eerst de subtotalen per soort (inkomsten, kosten …), die samen het totaal zijn.
  const sections = [...new Set(drill.groups.map((g) => g.section))]
  const open = (p: DrillPost) => {
    if (p.claim) setClaim(p.claim)
    else if (p.tx && p.tx.kind === 'loon' && p.trip && p.tx.status === 'verwacht') setSalaryTrip(p.trip)
    else if (p.tx) setTx(p.tx)
  }
  return (
    <Sheet title={request.title} onClose={onClose}>
      <div className="stack drill">
        <p className="row drill-total">
          <strong className="grow">{t('drill.total')}</strong>
          <strong className={`num${signed ? (drill.eur >= 0 ? ' positive' : ' negative') : ''}`}>{amountText(drill.eur, signed)}</strong>
        </p>
        {Object.entries(drill.other).map(([c, v]) => (
          <p key={c} className="muted small">
            {t('money.noRateFor', { currency: c })}: {formatMoney(v, c)}
          </p>
        ))}
        {request.period && <p className="muted small">{request.period}</p>}
        {request.hint && <p className="muted small">{request.hint}</p>}
        {drill.groups.length === 0 && <p className="muted">{t('drill.empty')}</p>}
        {request.byYear && <YearLines drill={drill} />}
        {sections.length > 1 && (
          <ul className="plain-list drill-sections">
            {sections.map((s) => {
              const groups = drill.groups.filter((g) => g.section === s)
              const eur = groups.reduce((n, g) => n + Math.round(g.eur * 100), 0) / 100
              return (
                <li key={s} className="row small">
                  <span className="grow">{t(`drill.section.${s}`)}</span>
                  <span className="num">{amountText(eur, signed)}</span>
                </li>
              )
            })}
          </ul>
        )}
        {drill.groups.map((g) => (
          <section key={g.key} className="drill-group stack-sm">
            <h3 className="row small-heading">
              <span className="grow">{groupTitle(g, request.labels)}</span>
              <span className="num">{amountText(g.eur, signed)}</span>
            </h3>
            <ul className="plain-list">
              {g.posts.map((p) => {
                const body = (
                  <>
                    <span className="grow">
                      {postTitle(p)}
                      <span className="muted small">
                        {' · '}
                        {p.account ? accountDetail(p) : p.growth ? t('drill.growthDetail', { opening: formatMoney(p.growth.opening, 'EUR'), pct: (Math.round(p.growth.rate * 10000) / 100).toLocaleString(getLang() === 'nl' ? 'nl-NL' : 'en-GB') }) : p.month && !p.tx ? t('drill.until', { date: formatDate(p.date) }) : formatDate(p.date)}
                        {p.growth && p.growth.contribution > 0 ? ` · ${t('drill.growthContribution', { amount: formatMoney(p.growth.contribution, 'EUR') })}` : ''}
                        {p.trip && !p.estimate ? ` · ${p.trip.name}` : ''}
                        {p.payout ? ` · ${t('drill.payout', { date: formatDate(p.payout) })}` : ''}
                      </span>
                    </span>
                    <span className="num">
                      {p.eur !== null ? amountText(p.eur, signed) : formatMoney(p.amount, p.currency)}
                      {p.currency !== 'EUR' && p.eur !== null && (
                        <span className="muted small">
                          <br />
                          {formatMoney(p.amount, p.currency)}
                          {p.provisional ? ` · ${t('money.provisional')}` : ''}
                        </span>
                      )}
                    </span>
                  </>
                )
                const tappable = !!(p.tx || p.claim)
                return (
                  <li key={p.key}>
                    {tappable ? (
                      <button type="button" className="row drill-post" onClick={() => open(p)}>
                        {body}
                        <Icon icon={ChevronRight} />
                      </button>
                    ) : (
                      <div className="row drill-post">{body}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
      {tx && <TransactionView store={store} tx={tx} notify={notify} onClose={() => setTx(null)} />}
      {salaryTrip && <TripSalarySheet store={store} trip={salaryTrip} notify={notify} onClose={() => setSalaryTrip(null)} />}
      {claim && <ClaimView store={store} claim={claim} notify={notify} onClose={() => setClaim(null)} />}
    </Sheet>
  )
}

/** Bij een rekening: de stand op de begindag en op het einde ("€ 1.000,00 → € 1.250,00"). */
function accountDetail(p: DrillPost): string {
  if (!p.balances) return formatDate(p.date)
  const show = (n: number | null | undefined) => (n === null || n === undefined ? '–' : formatMoney(n, p.currency))
  return `${show(p.balances?.start)} → ${show(p.balances?.end)}`
}

/** Per kalenderjaar, zoals het jaaroverzicht voor de belasting: zo is een verschil met "Totaal verdiend" te verklaren. */
function YearLines({ drill }: { drill: Drill }) {
  const years = new Map<string, number>()
  for (const g of drill.groups) for (const p of g.posts) if (p.eur !== null) years.set(p.date.slice(0, 4), (years.get(p.date.slice(0, 4)) ?? 0) + Math.round(p.eur * 100))
  if (years.size < 2) return null
  return (
    <div className="stack-sm">
      <p className="muted small">{t('drill.perYear')}</p>
      <ul className="plain-list drill-sections">
        {[...years.entries()]
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([year, cents]) => (
            <li key={year} className="row small">
              <span className="grow">{year}</span>
              <span className="num">{formatMoney(cents / 100, 'EUR')}</span>
            </li>
          ))}
      </ul>
    </div>
  )
}
