// Grove kaders van landen en eilandgroepen waar Olivier vaart, om te zien of een nieuwe pin ver van het land van de
// plaats ligt ("Shamrock Quay Southampton, Engeland" midden in het Caribisch gebied). Alleen een controle vooraf, nooit
// een blokkade: "Toch hier" mag altijd. Landen staan in de mijlenregistratie als vrije tekst (Nederlands of Engels,
// soms een afkorting); onbekend = geen controle.

interface Country {
  names: string[]
  /** [west, zuid, oost, noord] in graden. */
  box: [number, number, number, number]
}

const COUNTRIES: Country[] = [
  { names: ['engeland', 'england', 'uk', 'gb', 'gbr', 'verenigd koninkrijk', 'united kingdom', 'groot-brittannie', 'great britain', 'schotland', 'scotland', 'wales', 'kanaaleilanden', 'channel islands'], box: [-8.7, 49.1, 1.8, 60.9] },
  { names: ['nederland', 'netherlands', 'the netherlands', 'holland', 'nl', 'nld'], box: [3.2, 50.7, 7.3, 53.7] },
  { names: ['belgie', 'belgium', 'be'], box: [2.5, 49.5, 6.4, 51.6] },
  { names: ['duitsland', 'germany', 'de', 'deutschland'], box: [5.8, 47.2, 15.1, 55.1] },
  { names: ['denemarken', 'denmark', 'dk'], box: [8.0, 54.5, 15.2, 57.8] },
  { names: ['noorwegen', 'norway', 'no'], box: [4.5, 57.9, 31.2, 71.2] },
  { names: ['zweden', 'sweden', 'se'], box: [10.9, 55.3, 24.2, 69.1] },
  { names: ['ierland', 'ireland', 'ie'], box: [-10.7, 51.4, -5.4, 55.4] },
  { names: ['frankrijk', 'france', 'fr', 'corsica'], box: [-5.2, 41.3, 9.6, 51.1] },
  { names: ['spanje', 'spain', 'es', 'espana', 'mallorca', 'ibiza', 'balearen', 'balearic islands'], box: [-9.4, 35.9, 4.4, 43.8] },
  { names: ['canarische eilanden', 'canary islands', 'canarias', 'tenerife', 'gran canaria', 'lanzarote'], box: [-18.2, 27.6, -13.4, 29.5] },
  { names: ['portugal', 'pt'], box: [-9.6, 36.9, -6.1, 42.2] },
  { names: ['madeira'], box: [-17.3, 32.6, -16.2, 33.2] },
  { names: ['azoren', 'azores', 'acores'], box: [-31.3, 36.9, -24.9, 39.8] },
  { names: ['italie', 'italy', 'it', 'italia', 'sardinie', 'sardinia', 'sicilie', 'sicily'], box: [6.6, 36.6, 18.6, 47.1] },
  { names: ['malta', 'mt'], box: [14.1, 35.8, 14.6, 36.1] },
  { names: ['kroatie', 'croatia', 'hr', 'hrvatska'], box: [13.4, 42.3, 19.5, 46.6] },
  { names: ['montenegro', 'me'], box: [18.4, 41.8, 20.4, 43.6] },
  { names: ['slovenie', 'slovenia', 'si'], box: [13.3, 45.4, 16.6, 46.9] },
  { names: ['griekenland', 'greece', 'gr', 'hellas'], box: [19.3, 34.8, 29.7, 41.8] },
  { names: ['turkije', 'turkey', 'tr', 'turkiye'], box: [25.6, 35.8, 44.9, 42.2] },
  { names: ['bvi', 'british virgin islands', 'britse maagdeneilanden', 'tortola', 'virgin gorda', 'jost van dyke'], box: [-64.9, 18.3, -64.2, 18.8] },
  { names: ['usvi', 'us virgin islands', 'amerikaanse maagdeneilanden', 'st thomas', 'st john', 'st croix'], box: [-65.1, 17.6, -64.5, 18.5] },
  { names: ['sint maarten', 'st maarten', 'saint martin', 'st martin', 'sint-maarten', 'sxm'], box: [-63.2, 18.0, -62.9, 18.2] },
  { names: ['anguilla'], box: [-63.5, 18.1, -62.9, 18.6] },
  { names: ['st barth', 'st barths', 'st barts', 'saint barthelemy', 'saint-barthelemy'], box: [-62.95, 17.85, -62.75, 17.97] },
  { names: ['antigua', 'antigua en barbuda', 'antigua and barbuda', 'barbuda'], box: [-62.4, 16.9, -61.6, 17.8] },
  { names: ['st kitts', 'saint kitts', 'nevis', 'st kitts en nevis', 'saint kitts and nevis'], box: [-62.9, 17.1, -62.5, 17.5] },
  { names: ['guadeloupe'], box: [-61.9, 15.8, -61.0, 16.6] },
  { names: ['dominica'], box: [-61.5, 15.2, -61.2, 15.7] },
  { names: ['martinique'], box: [-61.3, 14.3, -60.8, 14.9] },
  { names: ['st lucia', 'saint lucia', 'sint lucia'], box: [-61.1, 13.7, -60.8, 14.2] },
  { names: ['st vincent', 'saint vincent', 'sint vincent', 'grenadines', 'st vincent en de grenadines', 'saint vincent and the grenadines', 'bequia'], box: [-61.5, 12.5, -61.1, 13.4] },
  { names: ['grenada', 'carriacou'], box: [-61.9, 11.9, -61.4, 12.6] },
  { names: ['puerto rico'], box: [-67.3, 17.9, -65.2, 18.6] },
  { names: ['bahamas'], box: [-79.5, 20.9, -72.7, 27.3] },
  { names: ['vs', 'verenigde staten', 'usa', 'us', 'united states', 'amerika', 'america', 'florida'], box: [-125, 24.5, -66.9, 49.4] },
]

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[.]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Het kader van een land uit vrije tekst; null als de app het land niet kent. */
export function countryBox(country: string): [number, number, number, number] | null {
  const key = normalize(country)
  if (!key) return null
  return COUNTRIES.find((c) => c.names.includes(key))?.box ?? null
}

const NM_PER_DEGREE = 60

/** Afstand in nm van een punt tot het kader van een land (0 als het erin ligt); null bij een onbekend land. */
export function distanceToCountryNm(country: string, point: { lat: number; lon: number }): number | null {
  const box = countryBox(country)
  if (!box) return null
  const [west, south, east, north] = box
  const lat = Math.min(Math.max(point.lat, south), north)
  const lon = Math.min(Math.max(point.lon, west), east)
  const dLat = (point.lat - lat) * NM_PER_DEGREE
  const dLon = (point.lon - lon) * NM_PER_DEGREE * Math.cos((((point.lat + lat) / 2) * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLon * dLon)
}
