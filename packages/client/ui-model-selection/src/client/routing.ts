/**
 * Local-time evaluation of the routing windows a catalog model advertises.
 *
 * The Host decides which provider serves a request; this module only answers
 * whether the selector should mark the model as currently routed, so the
 * reading is the browser's own clock and zone resolution.
 *
 * @module @deepseek-ai/dsh-client-ui-model-selection/routing
 */

import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'

/** The routing declaration one catalog model may carry. */
export type ModelRouting = NonNullable<ModelProviderGroup['models'][number]['routing']>

/** One window of a {@link ModelRouting} declaration. */
export type ModelRoutingWindow = ModelRouting['windows'][number]

/**
 * The local wall-clock `HH:mm` at one instant.
 * @param now - epoch milliseconds to read.
 * @param timeZone - IANA zone to read; omission reads the browser's zone.
 * @returns the two-digit hour and minute in that zone.
 */
function localClock(now: number, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-GB', {
    ...timeZone === undefined ? {} : { timeZone },
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(now))
}

/**
 * Whether one clock reading falls inside one window.
 * @param clock - the local `HH:mm` reading.
 * @param from - inclusive window start.
 * @param to - exclusive window end.
 * @returns whether the reading is inside the window.
 */
function inWindow(clock: string, from: string, to: string): boolean {
  return from <= to
    ? clock >= from && clock < to
    : clock >= from || clock < to
}

/**
 * The first declared window containing one instant.
 * @param routing - the declared windows.
 * @param now - epoch milliseconds to evaluate.
 * @returns the active window, or `undefined` when none contains the reading.
 */
export function activeRoutingWindow(routing: ModelRouting, now: number): ModelRoutingWindow | undefined {
  return routing.windows.find(entry => inWindow(localClock(now, entry.timeZone), entry.from, entry.to))
}
