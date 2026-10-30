import { CalendarRange, ClipboardCheck, Archive, BarChart3, BookOpen, Briefcase, CalendarClock, ChevronLeft, ChevronRight, HardDrive, Landmark, Map as MapIcon, MapPin, NotebookPen, Sailboat, Settings as SettingsIcon, Target, Vault as VaultIcon, Wallet, type LucideIcon } from 'lucide-react'
import { Icon } from '../components/Icon'
import { useIsDemo } from '../components/DemoBar'
import { t, type MessageKey } from '../i18n'
import { useReviewItems } from '../components/ReviewNotice'
import type { Store } from '../storage/store'

// Meer: de onderdelen die niet dagelijks nodig zijn, met het Logboek (archief; ook via de Agenda). Later komt de kluis
// hier ook.

export type MoreScreen = 'periodes' | 'logboek' | 'statistieken' | 'doelen' | 'carriere' | 'rekeningen' | 'kluis' | 'geld' | 'termijnen' | 'boten' | 'plaatsen' | 'kaarten' | 'cursussen' | 'archief' | 'opslag' | 'instellingen' | 'nakijken'

const ITEMS: { id: MoreScreen; label: MessageKey; hint: MessageKey; icon: LucideIcon }[] = [
  { id: 'periodes', label: 'periods.title', hint: 'more.periodsHint', icon: CalendarRange },
  { id: 'logboek', label: 'nav.logbook', hint: 'more.logbookHint', icon: NotebookPen },
  { id: 'statistieken', label: 'nav.stats', hint: 'more.statsHint', icon: BarChart3 },
  { id: 'doelen', label: 'goals.screen', hint: 'more.goalsHint', icon: Target },
  { id: 'carriere', label: 'career.screen', hint: 'more.careerHint', icon: Briefcase },
  { id: 'geld', label: 'nav.money', hint: 'more.moneyHint', icon: Wallet },
  { id: 'rekeningen', label: 'accounts.screen', hint: 'more.accountsHint', icon: Landmark },
  { id: 'termijnen', label: 'reminder.screen', hint: 'more.remindersHint', icon: CalendarClock },
  { id: 'kluis', label: 'vault.screen', hint: 'more.vaultHint', icon: VaultIcon },
  { id: 'boten', label: 'boats.screen', hint: 'more.boatsHint', icon: Sailboat },
  { id: 'plaatsen', label: 'places.screen', hint: 'more.placesHint', icon: MapPin },
  { id: 'kaarten', label: 'maps.title', hint: 'more.mapsHint', icon: MapIcon },
  { id: 'cursussen', label: 'curriculum.courses', hint: 'more.coursesHint', icon: BookOpen },
  { id: 'archief', label: 'nav.studentArchive', hint: 'more.archiveHint', icon: Archive },
  { id: 'opslag', label: 'nav.storage', hint: 'more.storageHint', icon: HardDrive },
  { id: 'instellingen', label: 'nav.settings', hint: 'more.settingsHint', icon: SettingsIcon },
]

export function More({ store, onOpen }: { store: Store; onOpen: (screen: MoreScreen) => void }) {
  // In de demo geen Opslag (controleren en back-ups gaan over de eigen gegevens op GitHub), geen Kluis en geen
  // Rekeningen (de demo heeft geen bedragen). Nakijken alleen als er iets na te kijken is, bovenaan.
  const demo = useIsDemo()
  const review = useReviewItems(store).length
  const base = demo ? ITEMS.filter((item) => item.id !== 'opslag' && item.id !== 'kluis' && item.id !== 'rekeningen') : ITEMS
  const items = review > 0 && !demo ? [{ id: 'nakijken' as const, label: 'review.title' as const, hint: 'more.reviewHint' as const, icon: ClipboardCheck }, ...base] : base
  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('nav.more')}</h1>
      </header>
      <ul className="rows">
        {items.map((item) => (
          <li key={item.id}>
            <button className="settings-row" onClick={() => onOpen(item.id)}>
              <Icon icon={item.icon} />
              <span className="row-main">
                <span>{t(item.label)}</span>
                <span className="muted small">{item.id === 'nakijken' ? t('review.notice', { n: review }) : t(item.hint)}</span>
              </span>
              <Icon icon={ChevronRight} className="chevron" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Terug naar Meer (of de Agenda), boven een scherm dat daar geopend is. */
export function BackToMore({ onBack, to = 'nav.more' }: { onBack: () => void; to?: 'nav.more' | 'nav.calendar' }) {
  return (
    <button className="btn link back-link" onClick={onBack} aria-label={to === 'nav.more' ? t('more.back') : t('common.back')}>
      <Icon icon={ChevronLeft} />
      {t(to)}
    </button>
  )
}
