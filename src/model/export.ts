import { strToU8, zipSync } from 'fflate'
import { translate, type Lang } from '../i18n'
import { boatList } from './boats'
import { totalNm } from './derive'
import { isIncome } from './money'
import { placeCountry, placeUses } from './places'
import { eurValue, type RatesFile } from './rates'
import type { Leg, Place, Transaction, Trip } from './types'
import { weekView } from './weeks'

// Exporteren naar Excel of een ander programma (Meer → Opslag → Exporteren): leesbare CSV-bestanden van trips, dagen,
// boten, plaatsen, inkomsten en uitgaven, samen in één zip (fflate). Dit bestand is NIET versleuteld: de app vraagt
// eerst om bevestiging en deelt het pas na een tik (navigator.share of downloaden); er gaat niets vanzelf naar buiten.
// Bewust niet in de export: deelnemers en studenten (regel 14), fooi per persoon, de token en de sleutels.
// Opmaak volgt de taal: Nederlands met ; en een decimale komma (zoals Excel in het Nederlands verwacht), Engels met ,
// en een punt. Datums als jjjj-mm-dd. UTF-8 met BOM, zodat Excel accenten goed leest. Een cel die met = + - @ begint,
// krijgt een ' ervoor: Excel voert dan nooit een formule uit een plaatsnaam of notitie uit.

export type Cell = string | number | boolean | null | undefined

export interface CsvFormat {
  sep: ';' | ','
  decimal: ',' | '.'
}

export function csvFormat(lang: Lang): CsvFormat {
  return lang === 'nl' ? { sep: ';', decimal: ',' } : { sep: ',', decimal: '.' }
}

function cellText(value: Cell, format: CsvFormat, lang: Lang): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return translate(lang, value ? 'csvExport.yes' : 'csvExport.no')
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''
    const text = String(Math.round(value * 10_000) / 10_000)
    return format.decimal === ',' ? text.replace('.', ',') : text
  }
  // Formule-injectie: tekst die Excel of LibreOffice als formule zou lezen (ook na spaties, en met de brede tekens
  // ＝＋－＠), krijgt een apostrof ervoor.
  return /^[\s\u00a0]*[=+\-@\uff1d\uff0b\uff0d\uff20]|^[\t\r\n]/.test(value) ? `'${value}` : value
}

function quote(text: string, sep: string): string {
  return text.includes(sep) || text.includes('"') || text.includes('\n') || text.includes('\r') ? `"${text.replace(/"/g, '""')}"` : text
}

/** Eén CSV-tekst met kopregel, regeleinde CRLF. */
export function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[], lang: Lang): string {
  const format = csvFormat(lang)
  const line = (cells: readonly Cell[]) => cells.map((c) => quote(cellText(c, format, lang), format.sep)).join(format.sep)
  return [line(header), ...rows.map(line)].join('\r\n') + '\r\n'
}

/** Wind als bereik ("2-3") met een gedachtestreepje, zodat Excel er geen datum van maakt. */
export function windText(value: string | undefined): string | undefined {
  return value?.replace(/^(\d{1,2})\s*[-/]\s*(\d{1,2})$/, '$1–$2')
}

export interface ExportData {
  trips: readonly Trip[]
  legs: readonly Leg[]
  places: readonly Place[]
  transactions: readonly Transaction[]
  rates: RatesFile | null
}

export interface ExportFile {
  name: string
  csv: string
  rows: number
}

const alive = <T extends { deletedAt: string | null }>(list: readonly T[]) => list.filter((r) => !r.deletedAt)

export function exportFiles(data: ExportData, lang: Lang): ExportFile[] {
  const L = (key: Parameters<typeof translate>[1]) => translate(lang, key)
  const trips = alive(data.trips)
  // Een record zonder datum (beschadigd bestand) mag de export niet laten vastlopen.
  const byDate = (a: { date?: string }, b: { date?: string }) => String(a.date ?? '').localeCompare(String(b.date ?? ''))
  const legs = alive(data.legs).sort(byDate)
  const places = alive(data.places)
  const transactions = alive(data.transactions).sort(byDate)
  const tripName = new Map(trips.map((t) => [t.id, t.name]))

  const tripRows = trips
    .map((trip) => ({ trip, view: weekView(trip, legs) }))
    .sort((a, b) => String(a.view.startDate ?? '').localeCompare(String(b.view.startDate ?? '')))
    .map(({ trip, view }) => {
      const days = legs.filter((l) => l.tripId === trip.id)
      return [
        trip.name,
        view.type ? L(`weekType.${view.type}`) : '',
        trip.organisation ? L(`organisation.${trip.organisation}`) : '',
        view.startDate,
        view.endDate,
        days.length,
        days.reduce((sum, l) => sum + totalNm(l), 0),
        view.boat,
        trip.boatModel,
        trip.boatLengthFt,
        trip.boatKind ? L(`boatKind.${trip.boatKind}`) : '',
        trip.base,
        trip.charter,
        trip.area,
        trip.review?.rating,
        trip.closedAt ? trip.closedAt.slice(0, 10) : '',
      ] satisfies Cell[]
    })

  const legRows = legs.map((l) => [
    l.date,
    tripName.get(l.tripId) ?? '',
    l.fromPlace,
    l.fromCountry,
    l.toPlace,
    l.toCountry,
    L(`role.${l.role}`),
    l.boat,
    l.skipperName,
    l.coSkipperName,
    windText(l.windBft),
    l.nmInland,
    l.nmSea,
    l.nmTidal,
    totalNm(l),
    l.nightHours,
    l.notes,
    l.dateEstimated,
  ] satisfies Cell[])

  const boatRows = boatList(trips, legs).map((b) => [b.name, b.model, b.lengthFt, b.lengthFt ? Math.round(b.lengthFt * 0.3048 * 10) / 10 : null, b.kind ? L(`boatKind.${b.kind}`) : '', b.tripIds.length, legs.filter((l) => b.tripIds.includes(l.tripId)).length] satisfies Cell[])

  const placeRows = placeUses(legs, places).map((u) => [u.name, u.place?.country || placeCountry(legs, places, u.name), u.place?.lat, u.place?.lon, u.days] satisfies Cell[])

  const money = (tx: Transaction): Cell[] => {
    const eur = eurValue(tx, data.rates)
    return [
      tx.date,
      L(`kind.${tx.kind}`),
      tx.amount,
      tx.currency,
      eur?.eur,
      eur?.rate,
      eur?.rateDate,
      eur ? eur.provisional : null,
      L(`source.${tx.source}`),
      tx.tripId ? (tripName.get(tx.tripId) ?? '') : '',
      tx.note,
    ]
  }
  const moneyHeader = ['date', 'kind', 'amount', 'currency', 'eur', 'rate', 'rateDate', 'provisional', 'source', 'trip', 'note'].map((k) => L(`csvExport.col.${k}` as 'csvExport.col.date'))

  return [
    { name: L('csvExport.file.trips'), csv: toCsv(['name', 'type', 'organisation', 'start', 'end', 'days', 'nm', 'boat', 'model', 'lengthFt', 'boatKind', 'base', 'charter', 'area', 'rating', 'closed'].map((k) => L(`csvExport.col.${k}` as 'csvExport.col.date')), tripRows, lang), rows: tripRows.length },
    { name: L('csvExport.file.days'), csv: toCsv(['date', 'trip', 'from', 'fromCountry', 'to', 'toCountry', 'role', 'boat', 'skipper', 'coSkipper', 'wind', 'inland', 'sea', 'tidal', 'nm', 'night', 'note', 'estimated'].map((k) => L(`csvExport.col.${k}` as 'csvExport.col.date')), legRows, lang), rows: legRows.length },
    { name: L('csvExport.file.boats'), csv: toCsv(['boat', 'model', 'lengthFt', 'lengthM', 'boatKind', 'trips', 'days'].map((k) => L(`csvExport.col.${k}` as 'csvExport.col.date')), boatRows, lang), rows: boatRows.length },
    { name: L('csvExport.file.places'), csv: toCsv(['place', 'country', 'lat', 'lon', 'days'].map((k) => L(`csvExport.col.${k}` as 'csvExport.col.date')), placeRows, lang), rows: placeRows.length },
    { name: L('csvExport.file.income'), csv: toCsv(moneyHeader, transactions.filter((t) => isIncome(t.kind)).map(money), lang), rows: transactions.filter((t) => isIncome(t.kind)).length },
    { name: L('csvExport.file.costs'), csv: toCsv(moneyHeader, transactions.filter((t) => !isIncome(t.kind)).map(money), lang), rows: transactions.filter((t) => !isIncome(t.kind)).length },
  ]
}

const BOM = '﻿'

/** Alle CSV's in één zip. */
export function exportZip(files: readonly ExportFile[]): Uint8Array {
  return zipSync(Object.fromEntries(files.map((f) => [f.name, strToU8(BOM + f.csv)])), { level: 6 })
}

export function exportFileName(date: string): string {
  return `logboek-export-${date}.zip`
}
