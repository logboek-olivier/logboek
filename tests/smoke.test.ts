import { describe, expect, it } from 'vitest'

describe('testomgeving', () => {
  it('heeft WebCrypto beschikbaar', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    expect(bytes).toHaveLength(16)
    expect(typeof crypto.subtle.encrypt).toBe('function')
  })
})
