import type { ComponentChildren, JSX } from 'preact'
import type { TabName } from './router'

/**
 * Content-aware loading states: each screen's skeleton uses the same layout classes as the screen
 * itself (large title, top bar, day pills, rows, cards), with shimmering blocks in place of content.
 */
const W = [72, 54, 86, 40, 64, 78, 50, 92, 60, 46]
const Bar = (p: { w?: number | string; h?: number; r?: number; class?: string }) => (
  <i class={`sk ${p.class ?? ''}`} style={{ width: p.w, height: p.h ?? 14, borderRadius: p.r }} />
)
const Rows = ({ n, from = 0 }: { n: number; from?: number }) => (
  <>
    {Array.from({ length: n }, (_, i) => (
      <div key={i} class="sk-row"><Bar w={`${W[(i + from) % W.length]}%`} h={15} /></div>
    ))}
  </>
)
const Wrap = ({ children }: { children: ComponentChildren }) => (
  <div class="skeleton" aria-busy="true" aria-label="Loading">{children}</div>
)
/** Same slots as the real TopBar: icons left, segmented control centered, icons right */
const TopBar = ({ segments, left, right }: { segments: number; left: number; right: number }) => (
  <div class="topbar sk-bar">
    <div class="side">{Array.from({ length: left }, (_, i) => <Bar key={i} w={24} h={24} r={12} class="sk-icon" />)}</div>
    <div class="sk-segmented">{Array.from({ length: segments }, (_, i) => <i key={i} class={i === 0 ? 'on' : ''} />)}</div>
    <div class="side">{Array.from({ length: right }, (_, i) => <Bar key={i} w={24} h={24} r={7} class="sk-icon" />)}</div>
  </div>
)
/** Title, the (i) button and the hero points with their underline, where the real ones sit */
const LargeTitle = ({ width = 130 }: { width?: number }) => (
  <div class="large-title">
    <Bar w={width} h={28} r={8} />
    <span class="sk-info"><Bar w={22} h={22} r={11} /></span>
    <span class="sk-hero"><Bar w={26} h={18} r={5} /><Bar w={30} h={3} r={2} /></span>
  </div>
)

export const CurrentSkeleton = () => (
  <Wrap>
    <LargeTitle width={108} />
    <div class="progress"><Bar w={11} h={18} r={4} /><Bar h={5} r={3} class="fill" /><Bar w={20} h={18} r={4} /></div>
    <div class="current-card">
      <div class="line">
        <div class="body sk-line"><Bar w="62%" h={16} /></div>
        <div class="actions sk-actions">{[0, 1, 2, 3].map((i) => <Bar key={i} w={22} h={22} r={11} />)}</div>
      </div>
    </div>
  </Wrap>
)

export const PlanningSkeleton = () => (
  <Wrap>
    <TopBar segments={2} left={1} right={2} />
    {[3, 4, 2].map((n, s) => (
      <section key={s}>
        <i class="sk sk-day" />
        <Rows n={n} from={s * 3} />
      </section>
    ))}
  </Wrap>
)

export const DelegationSkeleton = () => (
  <Wrap>
    <TopBar segments={3} left={0} right={1} />
    <i class="sk sk-day" />
    <Rows n={4} from={2} />
  </Wrap>
)

export const SettingsSkeleton = () => (
  <Wrap>
    <LargeTitle />
    {[1, 3, 5].map((n, s) => (
      <section key={s}>
        <div class="caption"><Bar w={70} h={11} /></div>
        {Array.from({ length: n }, (_, i) => (
          <div key={i} class="table-row">
            <Bar w={`${W[(i + s) % W.length] / 2 + 20}%`} />
            <span class="grow" />
            {(i + s) % 2 ? <Bar w={46} h={28} r={14} /> : <Bar w={70} h={14} />}
          </div>
        ))}
      </section>
    ))}
  </Wrap>
)

/** A text page (privacy, terms) */
export const PageSkeleton = () => (
  <Wrap>
    <div class="large-title"><Bar w={220} h={30} r={8} /></div>
    <div class="sk-text">{Array.from({ length: 9 }, (_, i) => <Bar key={i} w={`${(W[i] + 100) / 2}%`} h={13} />)}</div>
  </Wrap>
)

/** Charts (stats pages) */
export const ChartsSkeleton = () => (
  <Wrap>
    <div class="large-title"><Bar w={160} h={30} r={8} /></div>
    <div class="sk-charts"><i class="sk" /><i class="sk" /></div>
  </Wrap>
)

export const TAB_SKELETONS: Record<TabName, () => JSX.Element> = {
  current: CurrentSkeleton,
  planning: PlanningSkeleton,
  delegation: DelegationSkeleton,
  settings: SettingsSkeleton,
}
