import { addHeroPoint, create, people, session, settings, tags, todos, update, type Tag, type Todo } from '../data/store'
import { dateString, dayOf, isOld, minutes, monthOf, today, todayTitle } from '../lib/time'
import { hashtags } from '../lib/text'

/** "YYYY-MM-DD" or "YYYY-MM" */
export const titleOf = (t: Pick<Todo, 'monthAndYear' | 'date'>) => (t.date ? `${t.monthAndYear}-${t.date}` : t.monthAndYear ?? '')
const me = () => session.value?.id
const live = () => [...todos.values()].filter((t) => !t.deleted)
/** Todos from delegators we're no longer connected to stay hidden */
const knownDelegator = (t: Todo) => !t.delegator || t.delegator === me() || people.value.delegators.some((p) => p.id === t.delegator)
const byOrder = (a: Todo, b: Todo) => a.order - b.order
const frogFirst = (a: Todo, b: Todo) => Number(b.frog) - Number(a.frog) || byOrder(a, b)
const onDay = (t: Todo, title: string) => t.monthAndYear === title.slice(0, 7) && (title.length === 10 ? t.date === title.slice(8) : !t.date)

/** Own todos and accepted todos delegated to me (what the user plans and completes) */
export const isMine = (t: Todo) =>
  !t.deleted && t.delegateAccepted !== false && knownDelegator(t) && (!t.delegator ? true : t.delegateAccepted === true && t.delegator !== me())

export const forDay = (title: string, completed: boolean) =>
  live().filter((t) => isMine(t) && t.completed === completed && onDay(t, title)).sort(frogFirst)

/** Everything on a day, for ordering */
export const allForDay = (title: string, completed?: boolean) =>
  live().filter((t) => t.delegateAccepted !== false && onDay(t, title) && (completed === undefined || t.completed === completed)).sort(byOrder)

/** Planning / completed lists grouped by day or month, overdue first */
export function planning(completed: boolean, query = '', hash: string[] = []) {
  const q = query.toLowerCase()
  const list = live().filter(
    (t) =>
      isMine(t) && t.completed === completed && t.monthAndYear &&
      (!q || t.text.toLowerCase().includes(q)) &&
      hash.every((h) => hashtags(t.text).some((x) => x.toLowerCase() === h.toLowerCase())),
  )
  const groups = new Map<string, Todo[]>()
  for (const t of list) groups.set(titleOf(t), [...(groups.get(titleOf(t)) ?? []), t])
  const titles = [...groups.keys()].sort()
  if (completed) titles.reverse()
  return titles.map((title) => ({ title, todos: groups.get(title)!.sort(frogFirst) }))
}

/** Delegated by me or to me (unaccepted, or completed ones) */
export const delegated = (byMe: boolean, completed = false) =>
  live()
    .filter((t) => t.delegator && t.completed === completed && (byMe ? t.delegator === me() : t.user === me() && (completed || t.delegateAccepted !== true)))
    .sort((a, b) => titleOf(a).localeCompare(titleOf(b)) || frogFirst(a, b))

/** Uncompleted todos before today, which make planning required */
export const overdueCount = () => live().filter((t) => isMine(t) && !t.completed && isOld(t.monthAndYear, t.date)).length

export const isSkippable = (t: Todo) => !t.frog && !t.time && allForDay(titleOf(t), t.completed).length > 1

// region Actions

export function skip(todo: Todo) {
  const neighbours = allForDay(titleOf(todo), todo.completed)
  let offset = 0
  let start = false
  let found = false
  for (const n of neighbours) {
    if (n.id === todo.id) {
      start = true
      continue
    }
    if (!start) continue
    offset++
    if (!n.skipped) {
      update('todo', n.id, { order: n.order - offset })
      found = true
      break
    }
  }
  if (!found) neighbours.forEach((n, i) => i > 0 && n.id !== todo.id && update('todo', n.id, { order: n.order - 1 }))
  update('todo', todo.id, { order: todo.order + offset, skipped: true })
  fixOrder([titleOf(todo)], { yieldIds: [todo.id] })
}

export function moveToToday(todo: Todo) {
  const day = today()
  const last = allForDay(dateString(day)).at(-1)?.order ?? -1
  update('todo', todo.id, { order: last + 1, date: dayOf(day), monthAndYear: monthOf(day) })
}

export function accept(todo: Todo) {
  update('todo', todo.id, { delegateAccepted: true })
  fixOrder([titleOf(todo)])
}

/** Hero point, epic progress and the completed flag (sounds and dialogs are the caller's) */
export function markCompleted(todo: Todo) {
  addHeroPoint()
  incrementEpicPoints(todo.text)
  update('todo', todo.id, { completed: true })
}

export const frogsLeftToday = () => forDay(todayTitle(), false).some((t) => t.frog)
export const dayComplete = () => {
  const day = allForDay(todayTitle())
  return day.length > 0 && day.every((t) => t.completed)
}

// endregion

// region fixOrder (fixOrder.ts)

export function fixOrder(titles: Iterable<string>, opts: { onTop?: string[]; onBottom?: string[]; yieldIds?: string[] } = {}) {
  const group = (t: Todo) => (opts.onTop?.includes(t.id) ? 0 : opts.onBottom?.includes(t.id) ? 2 : 1)
  const sorted = (list: Todo[]) => [...list].sort((a, b) => group(a) - group(b) || a.order - b.order)
  for (const title of new Set(titles)) {
    for (const completed of [true, false]) {
      const list = sorted(allForDay(title, completed))
      if (!completed && settings.value.preserveOrderByTime) while (!timeSorted(list)) fixOneTime(list, opts.yieldIds ?? [])
      list.forEach((t, i) => t.order !== i && update('todo', t.id, { order: i }))
    }
  }
}

function timeSorted(list: Todo[]) {
  let last: number | null = null
  for (const t of list) {
    const m = minutes(t.time)
    if (m === null) continue
    if (last !== null && m < last) return false
    last = m
  }
  return true
}

function fixOneTime(list: Todo[], yieldIds: string[]) {
  let time: number | null = null
  let prev = -1
  for (let i = 0; i < list.length; i++) {
    const m = minutes(list[i].time)
    if (m === null) continue
    if (time !== null && m < time) {
      if (yieldIds.includes(list[i].id)) list.splice(prev, 0, ...list.splice(i, 1))
      else list.splice(i, 0, ...list.splice(prev, 1))
      return
    }
    time = m
    prev = i
  }
}

// endregion

// region Tags

export const liveTags = () =>
  [...tags.values()]
    .filter((t) => !t.deleted)
    .sort((a, b) => Number(b.epic) - Number(a.epic) || a.epicOrder - b.epicOrder || b.numberOfUses - a.numberOfUses || a.tag.localeCompare(b.tag))
export const epics = () => liveTags().filter((t) => t.epic)
export const tagColor = (name: string) => liveTags().find((t) => t.tag === name)?.color || undefined

/** Tags suggested while typing */
export function suggestions(text: string, showMore: boolean): Tag[] {
  if (text.endsWith('#')) return liveTags()
  const m = text.match(/#([Ѐ-ӿa-zA-Z_0-9]+)$/)
  if (!m) return showMore || settings.value.showMoreByDefault ? liveTags() : []
  return liveTags().filter((t) => t.tag.toLowerCase().includes(m[1].toLowerCase()) && t.tag !== m[1])
}

export function incrementEpicPoints(text: string) {
  const names = new Set(hashtags(text))
  for (const e of epics()) if (names.has(e.tag) && e.epicGoal > 0 && e.epicPoints < e.epicGoal) update('tag', e.id, { epicPoints: e.epicPoints + 1 })
}

export const completeEpic = (e: Tag) => update('tag', e.id, { epic: false, epicPoints: 0, epicGoal: 0, epicCompleted: true })

/** Counts hashtag uses and creates new tags */
export function addTags(texts: string[]) {
  const counts = new Map<string, number>()
  for (const name of texts.flatMap(hashtags)) counts.set(name, (counts.get(name) ?? 0) + 1)
  for (const [name, n] of counts) {
    const existing = liveTags().find((t) => t.tag === name)
    if (existing) update('tag', existing.id, { numberOfUses: existing.numberOfUses + n })
    else create('tag', { tag: name, deleted: false, epic: false, epicCompleted: false, epicGoal: 0, epicPoints: 0, epicOrder: 0, numberOfUses: n })
  }
}

/** Renames a hashtag in every todo */
export function renameTag(tag: Tag, name: string) {
  const re = new RegExp(`(^|\\s)#${tag.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'g')
  for (const t of live()) if (t.text.search(re) >= 0) update('todo', t.id, { text: t.text.replace(re, `$1#${name}`) })
  update('tag', tag.id, { tag: name })
}

// endregion
