import { Archive, BookOpen, CalendarClock, ChevronLeft, ChevronRight, MapPin, NotebookPen, Sailboat, Settings as SettingsIcon, Wallet, type LucideIcon } from 'lucide-react'
import { Icon } from '../components/Icon'
import { t, type MessageKey } from '../i18n'

// Meer: de onderdelen die niet dagelijks nodig zijn, met het Logboek (archief; ook via de Agenda). Later komt de kluis
// hier ook.

export type MoreScreen = 'logboek' | 'geld' | 'termijnen' | 'boten' | 'plaatsen' | 'cursussen' | 'archief' | 'instellingen'

const ITEMS: { id: MoreScreen; label: MessageKey; hint: MessageKey; icon: LucideIcon }[] = [
  { id: 'logboek', label: 'nav.logbook', hint: 'more.logbookHint', icon: NotebookPen },
  { id: 'geld', label: 'nav.money', hint: 'more.moneyHint', icon: Wallet },
  { id: 'termijnen', label: 'reminder.screen', hint: 'more.remindersHint', icon: CalendarClock },
  { id: 'boten', label: 'boats.screen', hint: 'more.boatsHint', icon: Sailboat },
  { id: 'plaatsen', label: 'places.screen', hint: 'more.placesHint', icon: MapPin },
  { id: 'cursussen', label: 'curriculum.courses', hint: 'more.coursesHint', icon: BookOpen },
  { id: 'archief', label: 'nav.studentArchive', hint: 'more.archiveHint', icon: Archive },
  { id: 'instellingen', label: 'nav.settings', hint: 'more.settingsHint', icon: SettingsIcon },
]

export function More({ onOpen }: { onOpen: (screen: MoreScreen) => void }) {
  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('nav.more')}</h1>
      </header>
      <ul className="rows">
        {ITEMS.map((item) => (
          <li key={item.id}>
            <button className="settings-row" onClick={() => onOpen(item.id)}>
              <Icon icon={item.icon} />
              <span className="row-main">
                <span>{t(item.label)}</span>
                <span className="muted small">{t(item.hint)}</span>
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
