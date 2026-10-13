import { signal } from '../lib/state'
import { useEffect } from 'preact/hooks'
import { Icon } from '../assets/icons'
import { logout } from '../data/account'
import { call } from '../data/rest'
import { prefs, rev, session, setPref, setSetting } from '../data/store'
import { connected } from '../data/sync'
import { LANGUAGES, language, setLanguage, t, type Language } from '../i18n'
import { todayTitle } from '../lib/time'
import * as todos from '../logic/todos'
import { addTodo } from '../ui/actions'
import { confirm, dialogOpen, IconButton, lazy, Menu, showError } from '../ui/kit'
import { go, hash, query } from '../ui/router'
import { setShowPlanning } from '../ui/TodoCard'
import { Current } from './Current'
import { openApps, openHashtags, openHero, openQr, openRules, openSettings, openSupport, openWelcome } from './dialogs'

const Planning = lazy(() => import('./Planning').then((m) => m.Planning))
const Report = lazy(() => import('./Report').then((m) => m.Report))
const Delegation = lazy(() => import('./Delegation').then((m) => m.Delegation))

type Tab = 'current' | 'planning' | 'report' | 'delegation'
const TABS: Tab[] = ['current', 'planning', 'report', 'delegation']
const tab = signal<Tab>(hash.value ? 'planning' : ((sessionStorage.getItem('tab') as Tab) ?? 'current'))
const select = (next: Tab) => {
  tab.value = next
  sessionStorage.setItem('tab', next)
}
setShowPlanning(() => select('planning'))

export function Superpower() {
  rev.value
  useEffect(() => {
    // Chrome extension: ?extension=<text> opens the add dialog prefilled
    const text = query.value.get('extension')
    if (text) {
      go('/superpower', true)
      addTodo(undefined, text)
    }
    // Invite links opened while signed out
    const invite = sessionStorage.getItem('invite')
    if (invite) {
      sessionStorage.removeItem('invite')
      confirm(t('delegate.inviteConfirm')).then((yes) => yes && call('POST', '/v2/delegation/accept', { token: invite }).catch(showError))
    }
    if (!prefs.value.rulesShown) {
      setPref('rulesShown', true)
      openWelcome()
    }
    const onKey = (e: KeyboardEvent) => {
      if (!prefs.value.hotkeys || dialogOpen() || e.ctrlKey || e.metaKey || e.altKey) return
      if ((e.target as Element).closest('input, textarea, select, [contenteditable]')) return
      if (e.key === 'c') select('current')
      else if (e.key === 'p') select('planning')
      else if (e.key === 'a') (e.preventDefault(), addTodo())
      else if (tab.value === 'current' && (e.key === 'd' || e.key === 'b')) {
        const todo = todos.forDay(todayTitle(), false)[0]
        if (todo) import('../ui/actions').then((a) => (e.key === 'd' ? a.completeTodo(todo) : a.breakdownTodo(todo)))
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  const delegatedToMe = todos.delegated(false).length
  const overdue = todos.overdueCount()
  return (
    <>
      <Navbar />
      <main class="container">
        <nav class="tabs" role="tablist">
          {TABS.map((name) => (
            <button key={name} role="tab" aria-selected={tab.value === name} class={`tab${tab.value === name ? ' active' : ''}`} onClick={() => select(name)}>
              {name === 'report' ? t('report.title') : name === 'delegation' ? t('delegate.title') : t(name)}
              {name === 'delegation' && delegatedToMe > 0 && <sup> {delegatedToMe}</sup>}
              {name === 'planning' && overdue > 0 && <sup> {overdue}</sup>}
            </button>
          ))}
        </nav>
        <section class="panel">
          {tab.value === 'current' ? <Current /> : tab.value === 'planning' ? <Planning /> : tab.value === 'report' ? <Report /> : <Delegation />}
        </section>
      </main>
      <button class="fab" title={`${t('todo.create.title')} (a)`} aria-label={t('todo.create.title')} onClick={() => addTodo()}>
        <Icon name="add_plain" size={24} />
      </button>
    </>
  )
}

function Navbar() {
  return (
    <header class="navbar">
      <div class="container">
        <a href="/superpower" onClick={(e) => (e.preventDefault(), go('/superpower'))} class="grow">
          <img class="logo" src="/img/logo-small.svg" alt="Todorant" width={118} height={24} />
        </a>
        {!connected.value && <span class="offline" title="Offline — changes sync when you're back online" />}
        <Menu trigger={(toggle) => <IconButton icon="language" title="Language" onClick={toggle} />}>
          {(close) =>
            Object.entries(LANGUAGES).map(([code, name]) => (
              <button key={code} role="menuitem" aria-current={language.value === code} onClick={() => {
                setLanguage(code as Language)
                setSetting('language', code)
                close()
              }}>
                {name}
              </button>
            ))
          }
        </Menu>
        <IconButton icon="info" title={t('howto.title')} onClick={openRules} />
        <Menu trigger={(toggle) => <IconButton icon="menu" title={t('settings.title')} onClick={toggle} />}>
          {(close) => {
            const item = (icon: Parameters<typeof Icon>[0]['name'], label: string, action: () => void) => (
              <button role="menuitem" onClick={() => (close(), action())}><Icon name={icon} size={20} />{label}</button>
            )
            return (
              <>
                {item('dark_mode', t(prefs.value.dark ? 'menu.darkMode.on' : 'menu.darkMode.off'), () => setPref('dark', !prefs.value.dark))}
                {item('star', t('heroProfileTitle'), openHero)}
                {item('settings', t('settings.title'), openSettings)}
                {item('filter', t('hashtags.title'), openHashtags)}
                {item('qr_code', t('qr.code'), openQr)}
                {item('apps', t('apps'), openApps)}
                {item('help', t('supportAlert.title'), openSupport)}
                {item('logout', t('menu.logout'), logout)}
              </>
            )
          }}
        </Menu>
      </div>
    </header>
  )
}

export { session }
