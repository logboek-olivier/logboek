// Datums: één plek voor "vandaag", dagen en maanden tellen (docs/FUNDERING.md). Een datum is jjjj-mm-dd, een maand
// jjjj-mm; rekenen gebeurt in UTC, zodat zomertijd en tijdzones nooit een dag verschuiven.

/** Datum van vandaag als jjjj-mm-dd in lokale tijd. */
export function todayIso(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Het tijdstip van nu (ISO, UTC). */
export function nowIso(): string {
  return new Date().toISOString()
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days))
  return date.toISOString().slice(0, 10)
}

/** Aantal dagen van `a` tot `b` (negatief als `b` eerder is). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** De maandag van de week (maandag tot en met zondag) waarin de datum valt. */
export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  const weekday = (date.getUTCDay() + 6) % 7
  return addDays(iso, -weekday)
}

/** De zondag van de week waarin de datum valt. */
export function sundayOf(iso: string): string {
  return addDays(mondayOf(iso), 6)
}

/** De maand (jjjj-mm) van een datum. */
export function monthOf(date: string): string {
  return date.slice(0, 7)
}

/** Een maand `n` maanden verder (of terug bij een negatief getal). */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Aantal dagen in een maand. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** De laatste dag van een maand (jjjj-mm-dd). */
export function monthEnd(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`
}
