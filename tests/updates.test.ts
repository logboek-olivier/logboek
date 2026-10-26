import { describe, expect, it } from 'vitest'
import { updates } from '../src/updates'

// Nieuwe versie: alleen melden; herladen gebeurt pas als Olivier erop tikt.

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
})
