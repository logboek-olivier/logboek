import { describe, expect, it, vi } from 'vitest'

// Afstand meten: hemelsbreed opgeteld over de stukken, over water met dezelfde waterroute als het mijlenvoorstel;
// buiten de vaargebieden alleen hemelsbreed. Verzonnen punten.

const routes = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../src/model/estimate', () => ({ routeBetween: routes.fn }))

const { measure, straightNm } = await import('../src/model/measure')

const A = { lat: 18.3, lon: -64.7 }
const B = { lat: 18.4, lon: -64.7 }
const C = { lat: 18.4, lon: -64.6 }

describe('meten', () => {
  it('hemelsbreed: de stukken opgeteld (0,1 graad noord = 6 nm)', () => {
    expect(straightNm([A, B])).toBeCloseTo(6, 1)
    expect(straightNm([A, B, C])).toBeGreaterThan(straightNm([A, C]))
    expect(straightNm([A])).toBe(0)
  })

  it('over water: de waterroutes van de stukken opgeteld, de route aan elkaar', async () => {
    routes.fn.mockReset()
    routes.fn.mockResolvedValueOnce({ nm: 7.5, path: [A, { lat: 18.35, lon: -64.72 }, B] })
    routes.fn.mockResolvedValueOnce({ nm: 6.2, path: [B, C] })
    const m = await measure([A, B, C])
    expect(m.water).toBeCloseTo(13.7, 6)
    expect(m.path).toEqual([A, { lat: 18.35, lon: -64.72 }, B, C])
    expect(routes.fn).toHaveBeenCalledWith(A, B)
    expect(routes.fn).toHaveBeenCalledWith(B, C)
  })

  it('één stuk buiten de vaargebieden: geen afstand over water, wel hemelsbreed', async () => {
    routes.fn.mockReset()
    routes.fn.mockResolvedValueOnce({ nm: 7.5, path: [A, B] })
    routes.fn.mockResolvedValueOnce(null)
    const m = await measure([A, B, { lat: 52, lon: 5 }])
    expect(m.water).toBeNull()
    expect(m.path).toEqual([])
    expect(m.straight).toBeGreaterThan(1000)
  })

  it('minder dan twee punten: niets te rekenen', async () => {
    routes.fn.mockReset()
    expect(await measure([A])).toEqual({ straight: 0, water: null, path: [] })
    expect(routes.fn).not.toHaveBeenCalled()
  })
})
