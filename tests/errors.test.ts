import { describe, expect, it } from 'vitest'
import { errorCode, errorReport, isUserMistake, sanitize } from '../src/errors'
import { ImportError } from '../src/import/mileage-csv'
import { GithubError } from '../src/storage/github'

// Foutdetails bevatten nooit inhoud (beveiligingsregel 9). Verzonnen data.

describe('foutdetails', () => {
  it('haalt tekst tussen aanhalingstekens en bedragen uit meldingen, maar laat code-namen staan', () => {
    expect(sanitize('Unexpected token \'N\', "Nephaven 120,50" is not valid JSON')).toBe('Unexpected token \'N\', "…" is not valid JSON')
    expect(sanitize("Cannot read properties of undefined (reading 'tripId')")).toBe("Cannot read properties of undefined (reading 'tripId')")
    expect(sanitize("bedrag 'Taxi naar de haven' 35.80")).toBe("bedrag '…' #")
  })

  it('geeft versie, scherm, foutcode met status, geschoonde melding, browser en stack', () => {
    const error = new GithubError('GitHub antwoordde met een fout', 422)
    const report = errorReport(error, 'Geld', '2026-10-26T12:00:00.000Z', 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36')
    expect(report).toContain('Versie: dev (dev)')
    expect(report).toContain('Scherm: Geld')
    expect(report).toContain('Foutcode: GithubError 422')
    expect(report).toContain('Browser: Chrome 130 / Android 14')
    expect(report).toContain('Stack:')
    expect(report).not.toContain('Pixel')
  })

  it('een fout uit ontsleutelde data lekt geen inhoud', () => {
    let parseError: unknown
    try {
      JSON.parse('{"toPlace": "Geheimbaai", "amount": 120.5')
    } catch (e) {
      parseError = e
    }
    const report = errorReport(parseError, 'Zeilen', '2026-10-26T12:00:00.000Z', '')
    expect(report).toContain('Foutcode: SyntaxError')
    expect(report).not.toContain('Geheimbaai')
    expect(report).not.toContain('120')
  })

  it('importfouten noemen rij en kolom; verkeerd getypte wachtzin krijgt geen knop', () => {
    expect(errorCode(new ImportError('rol niet herkend (kolom Rol).', 11))).toBe('ImportError')
    const wrong = new Error('x')
    wrong.name = 'WrongSecretError'
    expect(isUserMistake(wrong)).toBe(true)
    expect(isUserMistake(new GithubError('x', 500))).toBe(false)
  })
})
