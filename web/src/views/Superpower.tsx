import { useEffect } from 'preact/hooks'
import { Icon } from '../assets/icons'
import { TabIcon } from '../assets/tabs'
import { call } from '../data/rest'
import { prefs, ready, rev, setPref } from '../data/store'
import { connected } from '../data/sync'
import { t } from '../i18n'
import { todayTitle } from '../lib/time'
import * as todos from '../logic/todos'
import { addTodo, breakdownTodo, completeTodo } from '../ui/actions'
import { confirm, dialogOpen, lazy, showError } from '../ui/kit'
import { DelegationSkeleton, PlanningSkeleton, SettingsSkeleton, TAB_SKELETONS } from '../ui/skeletons'
import { appRoute, go, query, type TabName } from '../ui/router'
import { Current } from './Current'

const Planning = lazy(() => import('./Planning').then((m) => m.Planning), PlanningSkeleton)
const Delegation = lazy(() => import('./Delegation').then((m) => m.Delegation), DelegationSkeleton)
const Settings = lazy(() => import('./Settings').then((m) => m.Settings), SettingsSkeleton)

const LABELS: Record<TabName, () => string> = {
  current: () => t('current'),
  planning: () => t('planning'),
  delegation: () => t('delegate.title'),
  settings: () => t('settings.title'),
}

/** The signed-in app: a tab per screen like the mobile apps; Current hides while overdue todos need planning */
export function Superpower() {
  rev.value
  const route = appRoute() ?? { tab: 'current' as TabName }
  // Until the first data arrives (a fresh device), show skeletons and don't hide/redirect tabs
  const mustPlan = ready.value && todos.overdueCount() > 0
  const tabs: TabName[] = mustPlan ? ['planning', 'delegation', 'settings'] : ['current', 'planning', 'delegation', 'settings']
  const tab = tabs.includes(route.tab) ? route.tab : tabs[0]
  useEffect(() => {
    if (ready.value && (route.tab !== tab || location.pathname === '/superpower')) go(`/${tab}`, true)
  }, [route.tab, tab, ready.value])

  useEffect(() => {
    // Chrome extension: ?extension=<text> opens the add dialog prefilled
    const text = query.value.get('extension')
    if (text) {
      go(location.pathname, true)
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
      import('./Settings').then((m) => m.openWelcome())
    }
    const onKey = (e: KeyboardEvent) => {
      if (!prefs.value.hotkeys || dialogOpen() || e.ctrlKey || e.metaKey || e.altKey) return
      if ((e.target as Element).closest('input, textarea, select, [contenteditable]')) return
      if (e.key === 'c') go('/current')
      else if (e.key === 'p') go('/planning')
      else if (e.key === 'a') (e.preventDefault(), addTodo())
      else if (appRoute()?.tab === 'current' && (e.key === 'd' || e.key === 'b')) {
        const todo = todos.forDay(todayTitle(), false)[0]
        if (todo) (e.key === 'd' ? completeTodo : breakdownTodo)(todo)
      }
    }
    addEventListener('keydown', onKey)
    // Offline on a fresh device: stop waiting and show the (empty) screens
    const giveUp = setTimeout(() => (ready.value = true), 8000)
    // Fetch the other screens and the add form while idle, so opening them is instant
    const prefetch = () => [import('./Planning'), import('./Delegation'), import('./Settings'), import('./TodoForm')]
    const idle = 'requestIdleCallback' in window ? requestIdleCallback(prefetch) : setTimeout(prefetch, 1500)
    return () => {
      removeEventListener('keydown', onKey)
      clearTimeout(giveUp)
      'cancelIdleCallback' in window ? cancelIdleCallback(idle as number) : clearTimeout(idle)
    }
  }, [])

  const inbox = todos.delegated(false).length
  return (
    <>
      <nav class="tabbar" aria-label="Todorant">
        <img class="logo" src="/img/logo-small.svg" alt="Todorant" width={118} height={24} />
        {tabs.map((name) => (
          <a
            key={name}
            href={`/${name}`}
            class={tab === name ? 'active' : undefined}
            aria-current={tab === name ? 'page' : undefined}
            onClick={(e) => (e.preventDefault(), go(`/${name}`))}
          >
            <TabIcon tab={name} size={22} />
            <span>{LABELS[name]()}</span>
            {name === 'delegation' && inbox > 0 && <span class="badge">{inbox}</span>}
          </a>
        ))}
        <button type="button" class="icon-btn nav-info" title={t('howto.title')} aria-label={t('howto.title')} onClick={() => go('/settings/rules')}>
          <Icon name="info" size={24} />
        </button>
      </nav>
      <main class="screen">
        <div key={`${tab}/${route.page ?? ''}/${ready.value}`} class="screen-in">
        {!ready.value && tab !== 'settings' ? (
          TAB_SKELETONS[tab]()
        ) : tab === 'current' ? (
          <Current />
        ) : tab === 'planning' ? (
          <Planning />
        ) : tab === 'delegation' ? (
          <Delegation />
        ) : (
          <Settings page={route.page} />
        )}
        </div>
      </main>
      {tab !== 'settings' && (
        <button class="fab" title={`${t('todo.create.title')} (a)`} aria-label={t('todo.create.title')} onClick={() => addTodo()}>
          <Icon name="add_plain" size={26} />
        </button>
      )}
      {!connected.value && <div class="offline-pill" role="status">Offline — changes sync when you're back</div>}
    </>
  )
}
