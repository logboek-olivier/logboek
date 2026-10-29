// Apparaat-id voor de diagnose in commitberichten ("sync <tijd> v<versie> d<apparaat-id>", regel 9): acht willekeurige
// hexadecimale tekens, één keer op dit apparaat gemaakt en in localStorage bewaard (niet gesynct). Het zegt niets over
// Olivier of het apparaat; het onderscheidt alleen telefoon en laptop in de geschiedenis van logboek-data.

const KEY = 'logboek-apparaat'
const SHAPE = /^[0-9a-f]{8}$/

let memory: string | null = null

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Het id van dit apparaat; zonder localStorage blijft het in deze sessie hetzelfde. */
export function deviceId(): string {
  try {
    const stored = globalThis.localStorage?.getItem(KEY)
    if (stored && SHAPE.test(stored)) return stored
  } catch {
    // Geen toegang tot localStorage (privévenster): dan het id van deze sessie.
  }
  memory ??= randomId()
  try {
    globalThis.localStorage?.setItem(KEY, memory)
  } catch {
    // Zie hierboven.
  }
  return memory
}

export function isDeviceId(value: string): boolean {
  return SHAPE.test(value)
}
