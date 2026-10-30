import { COLLECTION_PATHS, type CollectionPath } from './model/types'

// Welke databestanden bij welk scherm horen. Is een bestand onleesbaar, dan staat de melding met de herstelknop alleen
// op de schermen van dat onderdeel; de syncstatus bovenaan noemt het pad overal (CLAUDE.md, regel 16). Elk databestand
// hoort bij minstens één scherm (tests/screen-files.test.ts).

export type ScreenId =
  | 'vandaag'
  | 'week'
  | 'toevoegen'
  | 'agenda'
  | 'logboek'
  | 'meer'
  | 'statistieken'
  | 'geld'
  | 'termijnen'
  | 'boten'
  | 'plaatsen'
  | 'kaarten'
  | 'doelen'
  | 'kluis'
  | 'carriere'
  | 'rekeningen'
  | 'cursussen'
  | 'archief'
  | 'instellingen'
  | 'opslag'

export const SCREEN_FILES: Record<ScreenId, readonly CollectionPath[]> = {
  vandaag: ['calendar.json.enc', 'trips.json.enc', 'legs.json.enc', 'plans.json.enc', 'students.json.enc', 'reminders.json.enc', 'settings.json.enc', 'weekreviews.json.enc'],
  week: ['trips.json.enc', 'legs.json.enc', 'students.json.enc', 'plans.json.enc', 'checklists.json.enc', 'curricula.json.enc', 'transactions.json.enc', 'claims.json.enc'],
  toevoegen: ['legs.json.enc', 'trips.json.enc', 'transactions.json.enc', 'places.json.enc', 'skills.json.enc', 'goals.json.enc', 'sessions.json.enc'],
  agenda: ['calendar.json.enc', 'trips.json.enc', 'legs.json.enc', 'reminders.json.enc', 'transactions.json.enc', 'weekreviews.json.enc'],
  logboek: ['trips.json.enc', 'legs.json.enc'],
  meer: [],
  statistieken: ['legs.json.enc', 'trips.json.enc', 'calendar.json.enc', 'transactions.json.enc', 'students.json.enc', 'curricula.json.enc', 'settings.json.enc'],
  geld: ['transactions.json.enc', 'calendar.json.enc', 'fixedcosts.json.enc', 'accounts.json.enc', 'balances.json.enc', 'claims.json.enc'],
  termijnen: ['reminders.json.enc', 'documents/index.json.enc', 'career.json.enc'],
  boten: ['trips.json.enc'],
  plaatsen: ['places.json.enc', 'legs.json.enc'],
  kaarten: [],
  kluis: ['documents/index.json.enc'],
  carriere: ['career.json.enc'],
  rekeningen: ['accounts.json.enc', 'balances.json.enc'],
  doelen: ['goals.json.enc', 'skills.json.enc', 'sessions.json.enc', 'legs.json.enc', 'trips.json.enc', 'transactions.json.enc'],
  cursussen: ['curricula.json.enc'],
  archief: ['students.json.enc'],
  instellingen: ['settings.json.enc'],
  opslag: COLLECTION_PATHS,
}
