import type { CollectionPath } from './model/types'

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
  | 'geld'
  | 'termijnen'
  | 'boten'
  | 'plaatsen'
  | 'cursussen'
  | 'archief'
  | 'instellingen'

export const SCREEN_FILES: Record<ScreenId, readonly CollectionPath[]> = {
  vandaag: ['trips.json.enc', 'legs.json.enc', 'plans.json.enc', 'students.json.enc', 'reminders.json.enc', 'settings.json.enc'],
  week: ['trips.json.enc', 'legs.json.enc', 'students.json.enc', 'plans.json.enc', 'checklists.json.enc', 'curricula.json.enc', 'transactions.json.enc'],
  toevoegen: ['legs.json.enc', 'trips.json.enc', 'transactions.json.enc', 'places.json.enc'],
  agenda: ['calendar.json.enc', 'trips.json.enc', 'legs.json.enc', 'reminders.json.enc', 'transactions.json.enc'],
  logboek: ['trips.json.enc', 'legs.json.enc'],
  meer: [],
  geld: ['transactions.json.enc'],
  termijnen: ['reminders.json.enc'],
  boten: ['trips.json.enc'],
  plaatsen: ['places.json.enc', 'legs.json.enc'],
  cursussen: ['curricula.json.enc'],
  archief: ['students.json.enc'],
  instellingen: ['settings.json.enc'],
}
