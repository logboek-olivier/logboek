import { describe, expect, it } from 'vitest'
import { setUrgentCheck, updates } from '../src/updates'

// Nieuwe versie: melden met "Herladen" op elk scherm; op een herstel- of sleutelscherm direct activeren.

describe('updates', () => {
  it('meldt een nieuwe versie en herlaadt pas op verzoek', () => {
    let applied = 0
    let notified = 0
    const unsubscribe = updates.subscribe(() => notified++)
    expect(updates.isAvailable()).toBe(false)
    updates.reload()
    expect(applied).toBe(0)
    updates.announce(() => applied++)
    expect(updates.isAvailable()).toBe(true)
    expect(notified).toBe(1)
    expect(applied).toBe(0)
    updates.reload()
    expect(applied).toBe(1)
    unsubscribe()
  })

  it('op een herstel- of sleutelscherm wordt een nieuwe versie direct actief', () => {
    let applied = 0
    setUrgentCheck(() => true)
    try {
      updates.announce(() => applied++)
      expect(applied).toBe(1)
    } finally {
      setUrgentCheck(() => false)
    }
  })
})
