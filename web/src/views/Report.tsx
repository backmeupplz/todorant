import { useEffect } from 'preact/hooks'
import { call } from '../data/rest'
import { rev, session, todos } from '../data/store'
import { locale, t } from '../i18n'
import { useSignal } from '../lib/state'
import { addDays, dateString, parseTitle } from '../lib/time'
import { isMine } from '../logic/todos'
import { Button, Caption, Field, IconButton, Placeholder, showError, SkeletonBlock, Spinner, toast } from '../ui/kit'
import { go } from '../ui/router'
import './Report.css'

type Counts = Record<string, number>
type Meta = { completedTodosMap?: Counts; completedFrogsMap?: Counts }

/** Completed todos and frogs per "YYYY-MM-DD", the same numbers the backend's /report gives */
function localReport(hash: string, start: string, end: string): Meta {
  const done: Counts = {}
  const frogs: Counts = {}
  const tag = `#${hash}`.toLowerCase()
  for (const x of todos.values()) {
    if (!isMine(x) || !x.completed || !x.date) continue
    const day = `${x.monthAndYear}-${x.date}`
    if ((start && day < start) || (end && day > end) || (hash && !x.text.toLowerCase().includes(tag))) continue
    done[day] = (done[day] ?? 0) + 1
    if (x.frog) frogs[day] = (frogs[day] ?? 0) + 1
  }
  return { completedTodosMap: done, completedFrogsMap: frogs }
}

const sum = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0)
const fmt = (day: string) => parseTitle(day).toLocaleDateString(locale())

function Charts({ data, start, end }: { data: Meta; start?: string; end?: string }) {
  const done = data.completedTodosMap ?? {}
  const frogs = data.completedFrogsMap ?? {}
  const keys = Object.keys(done).sort()
  if (!keys.length) return <Placeholder emoji="😳" title={t('noReport.title')} text={t('noReport.text')} />
  const days: string[] = []
  const last = [end || dateString(new Date()), keys.at(-1)!].sort()[1]
  // At least two weeks unless a start date is picked, so a few days don't make a few huge bars
  const from = start ? parseTitle(start) : new Date(Math.min(+parseTitle(keys[0]), +addDays(parseTitle(last), -13)))
  for (let d = from; dateString(d) <= last; d = addDays(d, 1)) days.push(dateString(d))
  return (
    <div class="charts">
      {([['report.tasksCompleted', done], ['report.frogsCompleted', frogs]] as const).map(([title, counts]) => (
        <section key={title}>
          <Caption>{t(title)}: <b class="chart-total">{sum(counts)}</b></Caption>
          <Bars title={t(title)} days={days} counts={counts} />
        </section>
      ))}
    </div>
  )
}

/** One bar per day, scaled to the busiest day */
function Bars({ title, days, counts }: { title: string; days: string[]; counts: Counts }) {
  const max = Math.max(1, ...days.map((d) => counts[d] ?? 0))
  return (
    <figure class="chart">
      <div class="chart-plot">
        <span class="chart-max" aria-hidden="true">{max}</span>
        <svg viewBox={`0 0 ${days.length} 100`} preserveAspectRatio="none" role="img" aria-label={`${title}, ${fmt(days[0])} – ${fmt(days.at(-1)!)}: ${sum(counts)}`}>
          {days.map((d, i) => {
            const h = ((counts[d] ?? 0) / max) * 100
            return h ? <rect key={d} x={i + 0.15} width={0.7} y={100 - h} height={h}><title>{fmt(d)}: {counts[d]}</title></rect> : null
          })}
        </svg>
      </div>
      <figcaption class="chart-axis"><span>{fmt(days[0])}</span><span>{fmt(days.at(-1)!)}</span></figcaption>
    </figure>
  )
}

const enc = encodeURIComponent
const SHARE: [name: string, url: (link: string, text: string) => string][] = [
  ['Telegram', (u, m) => `https://t.me/share/url?url=${enc(u)}&text=${enc(m)}`],
  ['X', (u, m) => `https://twitter.com/intent/tweet?url=${enc(u)}&text=${enc(m)}`],
  ['Facebook', (u) => `https://www.facebook.com/sharer/sharer.php?u=${enc(u)}`],
  ['WhatsApp', (u, m) => `https://wa.me/?text=${enc(`${m} ${u}`)}`],
  ['Email', (u, m) => `mailto:?subject=${enc(m)}&body=${enc(u)}`],
]

/** The stats page, computed from local data; sharing makes a public copy on the server */
export function Report() {
  rev.value
  const hash = useSignal('')
  const dates = useSignal(false)
  const start = useSignal('')
  const end = useSignal('')
  const link = useSignal('')
  const busy = useSignal(false)
  const tag = hash.value.trim().replace(/^#/, '')
  const data = localReport(tag, start.value, end.value)
  const message = t('report.shareMessage')
  const input = (s: typeof hash) => (e: Event) => ((s.value = (e.currentTarget as HTMLInputElement).value), (link.value = ''))

  async function share() {
    busy.value = true
    try {
      const { uuid } = await call<{ uuid: string }>('GET', `/report/share?hash=${enc(tag)}&startDate=${enc(start.value)}&endDate=${enc(end.value)}`)
      link.value = `https://todorant.com/report/${uuid}`
    } catch (e) {
      showError(e)
    } finally {
      busy.value = false
    }
  }

  return (
    <div class="report">
      <div class="report-filters">
        <Field class="grow" type="search" aria-label={t('report.hashtag')} placeholder={`#${t('report.hashtag')}`} value={hash.value} onInput={input(hash)} />
        <IconButton
          icon="calendar"
          title={`${t('report.startDate')} / ${t('report.endDate')}`}
          color={dates.value || start.value || end.value ? 'var(--orange)' : undefined}
          onClick={() => (dates.value = !dates.value)}
        />
      </div>
      {dates.value && (
        <div class="report-filters dates">
          <Field class="grow" label={t('report.startDate')} type="date" value={start.value} max={end.value || undefined} onInput={input(start)} />
          <Field class="grow" label={t('report.endDate')} type="date" value={end.value} min={start.value || undefined} onInput={input(end)} />
        </div>
      )}
      <Charts data={data} start={start.value} end={end.value} />
      {!!Object.keys(data.completedTodosMap!).length && (
        <section>
          <Caption>{t('report.share')}</Caption>
          {!link.value ? (
            <div class="page-content">
              <Button class="btn-block" disabled={busy.value} onClick={share}>{busy.value ? <Spinner /> : t('report.shareButton')}</Button>
            </div>
          ) : (
            <>
              <div class="table-row">
                <a class="label report-link" href={link.value} target="_blank" rel="noopener noreferrer" title={t('report.url')}>{link.value}</a>
                <IconButton icon="content_copy" title={t('report.url')} onClick={() => navigator.clipboard.writeText(link.value).then(() => toast(t('success')), showError)} />
                {'share' in navigator && <IconButton icon="share" title={t('report.shareButton')} onClick={() => navigator.share({ url: link.value, text: message }).catch(() => {})} />}
              </div>
              <div class="report-links">
                {SHARE.map(([name, url]) => (
                  <a key={name} class="btn btn-text btn-small" href={url(link.value, message)} target="_blank" rel="noopener noreferrer">{name}</a>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}

type Public = { meta?: Meta; user?: string; hash?: string }

/** A shared report at /report/:uuid, no sign in needed */
export function PublicReport({ uuid }: { uuid: string }) {
  const report = useSignal<Public | 'error' | null>(null)
  useEffect(() => {
    call<Public>('GET', `/report/public/${enc(uuid)}`, undefined, '').then((r) => (report.value = r), () => (report.value = 'error'))
  }, [uuid])
  const r = report.value
  if (!r) return <div class="charts">{[0, 1].map((i) => <figure key={i} class="chart"><SkeletonBlock width="100%" height={170} /></figure>)}</div>
  if (r === 'error') return <Placeholder emoji="😳" title={t('errors.report')} />
  return (
    <div class="report">
      {r.user && <h1 class="report-title">{r.user}, {t('report.title').toLowerCase()}{r.hash ? ` #${r.hash}` : ''}</h1>}
      <Charts data={r.meta ?? {}} />
      <section class="report-cta">
        <h2>{t('report.call')}</h2>
        <Button color="gradient" onClick={() => go(session.value ? '/current' : '/')}>{t('report.callButton')}</Button>
      </section>
    </div>
  )
}
