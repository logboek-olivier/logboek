import { BellRing, ChevronDown, ChevronRight, Cloud, Hash, Target, Fingerprint as FingerprintIcon, Info, KeyRound, Languages, Lock, Presentation, ShieldCheck, Wallet, X, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { FirstNumbersSheet, firstNumbersLine } from '../components/CounterSheets'
import { DailyReminderSheet, reminderLine } from '../components/DailyReminderSheet'
import { GoalSheet, type Notify } from '../components/EditSheets'
import { SalaryDefaultsSheet, salaryDefaultsLine } from '../components/SalarySheets'
import { useIsDemo } from '../components/DemoBar'
import { startDemo, stopDemo } from '../demo'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { APP_VERSION, BUILD_DATE, COMMIT } from '../build-info'
import { formatDate, formatNm } from '../format'
import { currentSettings, yearGoal } from '../model/settings'
import type { Store } from '../storage/store'
import { describeError, MIN_PASSPHRASE_LENGTH, useSession } from '../session'
import { ErrorLine, TokenForm } from './Setup'
import { LANGS, setLang, t, useLang } from '../i18n'

// Instellingen: vergrendelen, wachtzin wijzigen, herstelcode tonen, vingerafdruk aan/uit, token vervangen. De back-up
// staat onder Meer → Opslag.

type Panel = 'none' | 'passphrase' | 'recovery' | 'fingerprint' | 'token' | 'language'

export function Settings({ store, notify }: { store: Store; notify: Notify }) {
  const onDone = (message: string) => notify(message)
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const [goalOpen, setGoalOpen] = useState(false)
  const [countersOpen, setCountersOpen] = useState(false)
  const [salaryOpen, setSalaryOpen] = useState(false)
  const [reminderOpen, setReminderOpen] = useState(false)
  const session = useSession()
  const demo = useIsDemo()
  const [panel, setPanel] = useState<Panel>('none')
  const [fingerprintPossible, setFingerprintPossible] = useState(false)
  const [fingerprintOn, setFingerprintOn] = useState(false)

  useEffect(() => {
    void session.fingerprintPossible().then(setFingerprintPossible)
    void session.hasFingerprint().then(setFingerprintOn)
  }, [session])

  const toggle = (p: Panel) => setPanel(panel === p ? 'none' : p)
  const row = (p: Exclude<Panel, 'none'>, icon: LucideIcon, label: string, content: ReactNode) => (
    <li>
      <button className="settings-row" aria-expanded={panel === p} onClick={() => toggle(p)}>
        <Icon icon={icon} />
        <span className="row-main">{label}</span>
        <Icon icon={ChevronDown} className="chevron" />
      </button>
      {panel === p && <div className="settings-panel">{content}</div>}
    </li>
  )

  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('nav.settings')}</h1>
      </header>

      <ul className="rows">
        <li>
          <button className="settings-row" onClick={() => session.lock()}>
            <Icon icon={Lock} />
            <span className="row-main">{t('settings.lock')}</span>
          </button>
        </li>
      </ul>

      <div className="section">
        <h2>{t('settings.logbook')}</h2>
        <ul className="rows">
          <li>
            <button className="settings-row" onClick={() => setGoalOpen(true)}>
              <Icon icon={Target} />
              <span className="row-main">{t('settings.yearGoal')}</span>
              <span className="muted">{formatNm(yearGoal(settings))}</span>
              <Icon icon={ChevronRight} className="chevron" />
            </button>
          </li>
          <li>
            <button className="settings-row" onClick={() => setCountersOpen(true)}>
              <Icon icon={Hash} />
              <span className="row-main">{t('counter.title')}</span>
              <span className="muted">{firstNumbersLine(store)}</span>
              <Icon icon={ChevronRight} className="chevron" />
            </button>
          </li>
          <li>
            <button className="settings-row" onClick={() => setSalaryOpen(true)}>
              <Icon icon={Wallet} />
              <span className="row-main">{t('salary.defaults')}</span>
              <span className="muted">{salaryDefaultsLine(store)}</span>
              <Icon icon={ChevronRight} className="chevron" />
            </button>
          </li>
          <li>
            <button className="settings-row" onClick={() => setReminderOpen(true)}>
              <Icon icon={BellRing} />
              <span className="row-main">{t('reminderDaily.screen')}</span>
              <span className="muted">{reminderLine(store)}</span>
              <Icon icon={ChevronRight} className="chevron" />
            </button>
          </li>
          {row('language', Languages, t('settings.language'), <LanguagePicker />)}
        </ul>
      </div>
      {countersOpen && <FirstNumbersSheet store={store} onClose={() => setCountersOpen(false)} notify={notify} />}
      {salaryOpen && <SalaryDefaultsSheet store={store} onClose={() => setSalaryOpen(false)} notify={notify} />}
      {reminderOpen && <DailyReminderSheet store={store} onClose={() => setReminderOpen(false)} notify={notify} />}
      {goalOpen && <GoalSheet store={store} current={yearGoal(settings)} onClose={() => setGoalOpen(false)} notify={notify} />}

      <DemoSection />

      {/* In de demo niets over de eigen sleutels, token of GitHub: dat hoort bij de eigen gegevens. */}
      {!demo && (
        <>
      <div className="section">
        <h2>{t('settings.security')}</h2>
        <ul className="rows">
          {row(
            'passphrase',
            KeyRound,
            t('settings.changePassphrase'),
            <ChangePassphrase
              onDone={() => {
                setPanel('none')
                onDone(t('toast.passphraseChanged'))
              }}
            />,
          )}
          {row('recovery', ShieldCheck, t('settings.showRecovery'), <RevealRecovery />)}
          {(fingerprintPossible || fingerprintOn) &&
            row(
              'fingerprint',
              FingerprintIcon,
              t(fingerprintOn ? 'fingerprint.turnOff' : 'fingerprint.turnOn'),
              <Fingerprint
                enabled={fingerprintOn}
                onDone={(on) => {
                  setFingerprintOn(on)
                  setPanel('none')
                  onDone(t(on ? 'fingerprint.on' : 'fingerprint.off'))
                }}
              />,
            )}
        </ul>
      </div>

      <div className="section">
        <h2>{t('settings.storage')}</h2>
        <ul className="rows">
          {row(
            'token',
            Cloud,
            t('settings.replaceToken'),
            <ReplaceToken
              onDone={() => {
                setPanel('none')
                onDone(t('settings.replaceToken'))
              }}
            />,
          )}
        </ul>
      </div>
        </>
      )}

      <div className="section">
        <h2>{t('settings.about')}</h2>
        <ul className="rows">
          <li className="row-item">
            <Icon icon={Info} />
            <dl className="about">
              <dt>{t('settings.version')}</dt>
              <dd className="num">{APP_VERSION}</dd>
              <dt>{t('settings.built')}</dt>
              <dd className="num">{BUILD_DATE ? formatDate(BUILD_DATE.slice(0, 10)) : t('common.unknown')}</dd>
              <dt>{t('settings.commit')}</dt>
              <dd className="num">
                <code>{COMMIT}</code>
              </dd>
              <dt>{t('settings.mapSource')}</dt>
              <dd>{t('settings.mapSourceValue')}</dd>
              <dt>{t('settings.weatherSource')}</dt>
              <dd>{t('settings.weatherSourceValue')}</dd>
            </dl>
          </li>
        </ul>
      </div>
    </section>
  )
}

/** Instellingen → Demomodus: de app op voorbeelddata laten zien; stoppen brengt de eigen gegevens en taal terug. */
function DemoSection() {
  const demo = useIsDemo()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="section">
      <h2>{t('demo.title')}</h2>
      <p className="muted small">{t('demo.hint')}</p>
      {demo ? (
        <button type="button" className="btn" onClick={() => void stopDemo()}>
          <Icon icon={X} />
          {t('demo.stop')}
        </button>
      ) : (
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await startDemo()
              window.scrollTo(0, 0)
            } catch (e) {
              setError(describeError(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          <Icon icon={Presentation} />
          {busy ? t('demo.starting') : t('demo.start')}
        </button>
      )}
      <ErrorLine error={error} />
    </div>
  )
}

function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

function ChangePassphrase({ onDone }: { onDone: () => void }) {
  const session = useSession()
  const { busy, error, run } = useAction()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const ok = current.length > 0 && next.length >= MIN_PASSPHRASE_LENGTH && next === again
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (ok) void run(async () => {
      await session.changePassphrase(current, next)
      onDone()
    })
  }
  return (
    <form className="stack" onSubmit={submit}>
      <label>
        {t('passphrase.current')}
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label>
        {t('passphrase.new')}
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </label>
      <label>
        {t('passphrase.again')}
        <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
      </label>
      {next.length > 0 && next.length < MIN_PASSPHRASE_LENGTH && <p className="error">{t('passphrase.tooShortMin', { n: MIN_PASSPHRASE_LENGTH })}</p>}
      {again.length > 0 && next !== again && <p className="error">{t('passphrase.mismatch')}</p>}
      <ErrorLine error={error} />
      <button className="btn primary" type="submit" disabled={!ok || busy}>
        {busy ? t('settings.changing') : t('settings.change')}
      </button>
    </form>
  )
}

function RevealRecovery() {
  const session = useSession()
  const { busy, error, run } = useAction()
  const [passphrase, setPassphrase] = useState('')
  const [words, setWords] = useState<string[] | null>(null)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => setWords(await session.revealRecovery(passphrase)))
  }
  if (words) {
    return (
      <div className="stack">
        <ol className="words">
          {words.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ol>
        <button className="btn" onClick={() => setWords(null)}>
          {t('settings.hide')}
        </button>
      </div>
    )
  }
  return (
    <form className="stack" onSubmit={submit}>
      <label>
        {t('passphrase.label')}
        <input type="password" autoComplete="current-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
      </label>
      <ErrorLine error={error} />
      <button className="btn primary" type="submit" disabled={passphrase.length === 0 || busy}>
        {busy ? t('common.checking') : t('settings.show')}
      </button>
    </form>
  )
}

function Fingerprint({ enabled, onDone }: { enabled: boolean; onDone: (on: boolean) => void }) {
  const session = useSession()
  const { busy, error, run } = useAction()
  const [passphrase, setPassphrase] = useState('')
  if (enabled) {
    return (
      <div className="stack">
        <p className="muted">{t('fingerprint.offHint')}</p>
        <ErrorLine error={error} />
        <button
          className="btn primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await session.disableFingerprint()
              onDone(false)
            })
          }
        >
          {t('fingerprint.disable')}
        </button>
      </div>
    )
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await session.enableFingerprint(passphrase)
      onDone(true)
    })
  }
  return (
    <form className="stack" onSubmit={submit}>
      <p className="muted">
        {t('fingerprint.onHint')}
      </p>
      <label>
        {t('passphrase.label')}
        <input type="password" autoComplete="current-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
      </label>
      <ErrorLine error={error} />
      <button className="btn primary" type="submit" disabled={passphrase.length === 0 || busy}>
        {busy ? t('common.busy') : t('fingerprint.enable')}
      </button>
    </form>
  )
}

function ReplaceToken({ onDone }: { onDone: () => void }) {
  const session = useSession()
  const { busy, error, run } = useAction()
  return (
    <div className="stack">
      <TokenForm
        check={(token) => session.checkToken(token)}
        submitLabel={busy ? t('settings.replacing') : t('settings.replace')}
        disabled={busy}
        onDone={({ token, expiresAt }) =>
          void run(async () => {
            await session.replaceToken(token, expiresAt)
            onDone()
          })
        }
      />
      <ErrorLine error={error} />
    </div>
  )
}

/** Back-up van logboek-data op een eigen computer. De app doet hiervoor geen netwerkverkeer; dit is alleen tekst. */

/** Taal van de app op dit apparaat; standaard de taal van de telefoon. */
function LanguagePicker() {
  // In de demo geldt de keuze alleen zolang de demo loopt; de eigen taalkeuze verandert niet.
  const demo = useIsDemo()
  const lang = useLang()
  return (
    <div className="segments" role="radiogroup" aria-label={t('settings.language')}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={lang === l}
          className={`segment${lang === l ? ' active' : ''}`}
          onClick={() => setLang(l, !demo)}
        >
          {l === 'nl' ? 'Nederlands' : 'English'}
        </button>
      ))}
    </div>
  )
}
