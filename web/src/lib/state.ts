import { useMemo } from 'preact/hooks'

/**
 * Minimal reactive values: reading `.value` is plain, writing it notifies subscribers and
 * re-renders the app (batched to once per frame). The app is small enough that a full
 * re-render is cheaper than fine-grained tracking.
 */
export class Signal<T> {
  private listeners = new Set<(value: T) => void>()
  constructor(private current: T) {}

  get value() {
    return this.current
  }
  set value(next: T) {
    if (Object.is(next, this.current)) return
    this.current = next
    this.listeners.forEach((f) => f(next))
    rerender()
  }

  /** Calls `f` now and on every change; returns an unsubscribe function */
  subscribe(f: (value: T) => void) {
    this.listeners.add(f)
    f(this.current)
    return () => this.listeners.delete(f)
  }
}

export const signal = <T>(value: T) => new Signal(value)
/** A signal owned by a component, kept across renders */
export const useSignal = <T>(value: T) => useMemo(() => new Signal(value), [])

let renderApp = () => {}
let scheduled = false
/** The root registers how to re-render itself */
export const onRerender = (f: () => void) => (renderApp = f)
/** At most one render per frame however many values change (e.g. while thousands of todos sync in) */
export function rerender() {
  if (scheduled) return
  scheduled = true
  const run = () => {
    scheduled = false
    renderApp()
  }
  // Hidden tabs get no animation frames; render on a timer there so state still lands
  document.hidden ? setTimeout(run, 50) : requestAnimationFrame(run)
}
