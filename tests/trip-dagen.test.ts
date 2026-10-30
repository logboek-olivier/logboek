import { describe, expect, it } from 'vitest'
import type { Leg } from '../src/model/types'
import { tripDayCounts } from '../src/model/weeks'

// De tripkop: "6 dagen · 5 gelogd". Dagen = van de startdatum tot en met de einddatum; gelogd = de verschillende datums
// met een gelogde dag (twee etappes op één dag tellen als één dag). Verzonnen data.

const leg = (date: string): Leg => ({ id: date + Math.random(), tripId: 't', date, fromPlace: 'Nepa', fromCountry: '', toPlace: 'Nepb', toCountry: '', role: 'schipper', boat: 'Nepboot', nmInland: 0, nmSea: 5, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'manual', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null })

describe('dagen in een trip', () => {
  it('zes dagen van start tot en met eind, vijf gelogd (twee etappes op één dag = één dag)', () => {
    const legs = ['2026-11-01', '2026-11-02', '2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06'].map(leg)
    expect(tripDayCounts({ startDate: '2026-11-01', endDate: '2026-11-06', legs })).toEqual({ days: 6, logged: 5 })
    // Tot en met vandaag (Vandaag): alleen wat al gelogd is tot die dag.
    expect(tripDayCounts({ startDate: '2026-11-01', endDate: '2026-11-06', legs }, '2026-11-03')).toEqual({ days: 6, logged: 3 })
  })

  it('zonder datums: alleen het aantal gelogde dagen', () => {
    expect(tripDayCounts({ startDate: '', endDate: '', legs: [leg('2026-11-01')] })).toEqual({ days: null, logged: 1 })
  })
})
