import { readFileSync } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildFakeMileageXlsx } from '../scripts/fake-xlsx'
import { parseMileageCsv, parseMileageFile } from '../src/import/mileage-csv'
import { decodeText } from '../src/import/rows'
import { columnIndex, isDateFormat, readXlsx, serialToIso } from '../src/import/xlsx'
import { parseXml, textContent } from '../src/import/xml'

// Excel-import met de gegenereerde nep-werkmap (verzonnen plaatsen en getallen, zelfde opbouw als het origineel).

const NOW = '2026-10-26T00:00:00.000Z'
const fixtureBytes = () => new Uint8Array(readFileSync(new URL('./fixtures/mijlen-nep.xlsx', import.meta.url)))
const csvFixture = () => readFileSync(new URL('./fixtures/mijlen-nep.csv', import.meta.url), 'utf8')

const EXPECTED_SUMMARY = {
  days: 8,
  trips: 3,
  nm: 240,
  nmByRole: { schipper: 70, 'co-schipper': 110, bemanningslid: 45, trainee: 15, instructeur: 0 },
  nmByWater: { inland: 35, sea: 95, tidal: 110 },
  nightHours: 12,
}

describe('import Excel (.xlsx)', () => {
  it('de vastgelegde fixture is precies wat de generator maakt', () => {
    expect(Buffer.from(fixtureBytes()).equals(Buffer.from(buildFakeMileageXlsx()))).toBe(true)
  })

  it('leest werkblad Sheet1 met dezelfde controlegetallen als de samenvattingsregels', () => {
    const result = parseMileageFile(fixtureBytes(), NOW)
    expect(result.kind).toBe('xlsx')
    expect(result.summary).toEqual(EXPECTED_SUMMARY)
    expect(result.trips.map((t) => t.name)).toEqual(['Oefentocht noord', 'Nepboot Twee juni 2024', 'Cursus binnenwater'])
    expect(result.warnings).toEqual([])
  })

  it('geeft dezelfde dagen als de CSV-export van hetzelfde bestand', () => {
    const fromXlsx = parseMileageFile(fixtureBytes(), NOW).legs
    const fromCsv = parseMileageCsv(csvFixture(), NOW).legs
    const strip = (legs: typeof fromXlsx) => legs.map((l) => ({ ...l, id: '', tripId: '' }))
    expect(strip(fromXlsx)).toEqual(strip(fromCsv))
  })

  it('leest serienummers, formuledatums (=A7+1) en lege datums', () => {
    const legs = parseMileageFile(fixtureBytes(), NOW).legs
    expect(legs.map((l) => [l.date, l.dateEstimated])).toEqual([
      ['2024-05-03', false],
      ['2024-05-03', true],
      ['2024-05-04', false],
      ['2024-06-10', false],
      ['2024-06-11', false],
      ['2024-06-12', false],
      ['2024-07-20', false],
      ['2024-07-21', false],
    ])
    expect(legs[0]?.windBft).toBe('3-4')
    expect(legs[1]?.windBft).toBe('4')
    expect(legs[5]?.windBft).toBeUndefined()
    expect(legs[7]).toMatchObject({ coSkipperName: 'Nep Co', nightHours: 2, nmSea: 45, source: 'import' })
  })

  it('kent het datumsysteem 1904', () => {
    const a = parseMileageFile(buildFakeMileageXlsx({ date1904: true }), NOW).legs.map((l) => l.date)
    const b = parseMileageFile(fixtureBytes(), NOW).legs.map((l) => l.date)
    expect(a).toEqual(b)
  })

  it('formule zonder opgeslagen waarde: datum van de vorige rij, geschat, met waarschuwing', () => {
    const result = parseMileageFile(buildFakeMileageXlsx({ dropCachedDate: true }), NOW)
    expect(result.legs[2]).toMatchObject({ date: '2024-05-03', dateEstimated: true })
    expect(result.warnings).toEqual(['Rij 9: datum is een formule zonder opgeslagen waarde; datum van de vorige rij genomen (geschat)'])
  })

  it('negeert de samenvatting, de rollenlijst op Blad1 en de data-validatie-extensie', () => {
    const sheets = readXlsx(fixtureBytes())
    expect(sheets.map((s) => s.name)).toEqual(['Sheet1', 'Blad1'])
    expect(sheets[1]?.rows.map((r) => r.cells[0]?.text)).toEqual(['Schipper', 'Co-schipper', 'Bemanningslid', 'Trainee', 'Instructeur'])
    expect(sheets[0]?.rows[0]?.cells[10]).toMatchObject({ number: 20 })
  })

  it('een wind als "3-4" die Excel tot datum maakte, wordt weer "3-4"', () => {
    const xlsx = minimalXlsx(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Datum</t></is></c>' +
        HEADER.slice(1).map((h, i) => `<c r="${String.fromCharCode(66 + i)}1" t="inlineStr"><is><t>${h}</t></is></c>`).join('') +
        '</row><row r="2"><c r="A2" s="1"><v>45000</v></c><c r="F2" t="inlineStr"><is><t>Schipper</t></is></c>' +
        '<c r="G2" t="inlineStr"><is><t>Nepboot</t></is></c><c r="J2" s="1"><v>45385</v></c><c r="L2"><v>12.5</v></c></row>',
    )
    const leg = parseMileageFile(xlsx, NOW).legs[0]
    expect(leg).toMatchObject({ date: '2023-03-15', windBft: '3-4', nmSea: 12.5 })
  })

  it('weigert oude .xls, lege, beschadigde en willekeurige bestanden met een begrijpelijke melding', () => {
    expect(() => parseMileageFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]), NOW)).toThrow('Oud Excel-formaat (.xls)')
    expect(() => parseMileageFile(new Uint8Array(), NOW)).toThrow('Het bestand is leeg.')
    expect(() => parseMileageFile(new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]), NOW)).toThrow('Excel-bestand is beschadigd of niet leesbaar.')
    expect(() => parseMileageFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), NOW)).toThrow('Dit is geen CSV- of Excel-bestand.')
    const noSheet = zipSync({ 'xl/workbook.xml': strToU8('<workbook><sheets/></workbook>') })
    expect(() => parseMileageFile(noSheet, NOW)).toThrow('Geen werkbladen gevonden')
  })
})

describe('CSV zoals Android en Excel die aanleveren', () => {
  const csv = csvFixture()
  const bytes = (s: string) => new TextEncoder().encode(s)

  it('leest UTF-8 met BOM en CRLF', () => {
    const r = parseMileageFile(bytes('﻿' + csv.replace(/\n/g, '\r\n')), NOW)
    expect(r.summary).toEqual(EXPECTED_SUMMARY)
  })

  it('leest Windows-1252 (CSV zonder UTF-8) en UTF-16 met BOM', () => {
    const latin = Uint8Array.from([...csv.replace('Lange dag', 'Lange dag café')].map((c) => (c === 'é' ? 0xe9 : c.charCodeAt(0))))
    expect(parseMileageFile(latin, NOW).legs[1]?.notes).toBe('Lange dag café')
    const utf16 = new Uint8Array(2 + csv.length * 2)
    utf16.set([0xff, 0xfe])
    for (let i = 0; i < csv.length; i++) utf16[2 + i * 2] = csv.charCodeAt(i)
    expect(parseMileageFile(utf16, NOW).summary).toEqual(EXPECTED_SUMMARY)
    expect(decodeText(bytes('﻿Datum'))).toBe('Datum')
  })

  it('leest tabs, aanhalingstekens rond de kopregel en datums zonder voorloopnul', () => {
    const tabbed = csv
      .replace(/;/g, '\t')
      .replace('03-05-2024', '3-5-2024')
      .replace('Datum\t', '"Datum"\t')
    const r = parseMileageFile(bytes(tabbed), NOW)
    expect(r.summary).toEqual(EXPECTED_SUMMARY)
    expect(r.legs[0]?.date).toBe('2024-05-03')
  })

  it('een rij met alleen een doorgetrokken Totaal-formule (0) of een datum scheidt tochten in plaats van een dag te worden', () => {
    const lines = csv.split('\n')
    lines[9] = ';;;;;;;;;;;;;0;;'
    lines.push('13-08-2024;;;;;;;;;;;;;0;;')
    const r = parseMileageFile(bytes(lines.join('\n')), NOW)
    expect(r.summary).toEqual(EXPECTED_SUMMARY)
  })

  it('meldt een rij met alleen Bijzonderheden en een ontbrekende rol met rijnummer en kolom', () => {
    const lines = csv.split('\n')
    lines[9] = ';;;;;;;;;;;;;;;losse opmerking'
    expect(parseMileageFile(bytes(lines.join('\n')), NOW).warnings).toEqual(['Rij 10: alleen Bijzonderheden ingevuld; rij overgeslagen'])
    const noRole = csv.replace('Fjordhaven;Noordland;Kaap Nevel;Noordland;Schipper', 'Fjordhaven;Noordland;Kaap Nevel;Noordland;')
    expect(() => parseMileageFile(bytes(noRole), NOW)).toThrow('Rij 7: rol ontbreekt (kolom Rol).')
  })
})

describe('bouwstenen', () => {
  it('rekent Excel-serienummers om, inclusief de schrikkeldagfout van 1900 en het 1904-systeem', () => {
    expect(serialToIso(1, false)).toBe('1900-01-01')
    expect(serialToIso(59, false)).toBe('1900-02-28')
    expect(serialToIso(61, false)).toBe('1900-03-01')
    expect(serialToIso(45000, false)).toBe('2023-03-15')
    expect(serialToIso(45000.75, false)).toBe('2023-03-15')
    expect(serialToIso(0, true)).toBe('1904-01-01')
    expect(serialToIso(43538, true)).toBe('2023-03-15')
    expect(serialToIso(-1, false)).toBeNull()
  })

  it('herkent datumnotaties', () => {
    expect(isDateFormat('d\\-m\\-yyyy;@')).toBe(true)
    expect(isDateFormat('[$-413]d mmmm yyyy')).toBe(true)
    expect(isDateFormat('[h]:mm')).toBe(true)
    expect(isDateFormat('0 "nm"')).toBe(false)
    expect(isDateFormat('#,##0.00 [$€-413]')).toBe(false)
    expect(isDateFormat('General')).toBe(false)
    expect(isDateFormat('[Red]0.0')).toBe(false)
  })

  it('leest kolomletters', () => {
    expect(columnIndex('A7')).toBe(0)
    expect(columnIndex('P6')).toBe(15)
    expect(columnIndex('AA1')).toBe(26)
  })

  it('leest XML met voorvoegsels, entiteiten, CDATA en rijke tekst zonder fonetische hulptekst', () => {
    const xml = parseXml(
      '<?xml version="1.0"?><!-- opmerking --><x:si xmlns:x="ns"><x:r><x:t>Haven &amp; </x:t></x:r><x:r><x:t xml:space="preserve">Kaap&#233; </x:t></x:r>' +
        '<x:rPh><x:t>fonetisch</x:t></x:rPh><x:t><![CDATA[<rif>]]></x:t></x:si>',
    )
    expect(xml.name).toBe('si')
    expect(textContent(xml, ['rPh'])).toBe('Haven & Kaapé <rif>')
    expect(() => parseXml('<a><b></a>')).toThrow('XML niet leesbaar')
    expect(() => parseXml('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>')).toThrow('XML niet leesbaar')
  })
})

const HEADER = [
  'Datum',
  'Van (plaats)',
  'Van (land)',
  'Naar (plaats)',
  'Naar (land)',
  'Rol',
  'Schip',
  'Schipper/trainer',
  'Co-schipper (flot.leider)',
  'Wind (bft)',
  'Binnenwater',
  'Zee',
  'Zee (getijnavigatie)',
  'Totaal',
  'Nacht-uren',
  'Bijzonderheden',
]

/** Kleinste werkmap zonder sharedStrings (inline tekst), met datumnotatie 14 op stijl 1. */
function minimalXlsx(sheetData: string): Uint8Array {
  return zipSync({
    'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="Blad" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="/xl/worksheets/blad.xml"/></Relationships>'),
    'xl/styles.xml': strToU8('<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'),
    'xl/worksheets/blad.xml': strToU8(`<worksheet><sheetData>${sheetData}</sheetData></worksheet>`),
  })
}
