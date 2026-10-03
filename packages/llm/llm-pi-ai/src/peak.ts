/**
 * Time-windowed provider substitution for one pi-ai model entry.
 *
 * A model entry may name windows in which the request is served by another
 * provider resolved from pi-ai's installed catalog. The route keeps its own
 * provider, endpoint, and display name, so the switch is invisible to the
 * session log: only the wire endpoint follows the active window.
 *
 * A window is a local wall-clock interval, evaluated in its own IANA zone so a
 * deployment's peak hours do not follow the host process's zone. Windows
 * are matched in configuration order and the first match wins, which is what
 * lets a later window carry a narrower interval.
 *
 * @module dsh-llm-pi-ai/peak
 */

/** One provider a peak window may serve a model with. */
export interface PiAiPeakProvider {
  /** pi-ai provider id, resolved against the installed catalog. */
  provider: string
  /**
   * Credential reference (environment-variable name) resolved per request
   * through the credential seam; omission defers to pi-ai's provider-native
   * ambient discovery, exactly as a route's own `apiKeyEnv` does.
   */
  apiKeyEnv?: string
}

/** One local wall-clock window served by an alternate provider. */
export interface PiAiPeakWindow {
  /** Inclusive local start as `HH:mm`. */
  from: string
  /** Exclusive local end as `HH:mm`; earlier than {@link from} crosses midnight. */
  to: string
  /** IANA time zone the window is evaluated in; omission uses the process zone. */
  timeZone?: string
  /** Candidate providers in priority order; the first that serves the model is used. */
  providers: PiAiPeakProvider[]
}

/** The accepted `HH:mm` spelling: two-digit 24-hour hour and minute. */
export const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

/**
 * The local wall-clock `HH:mm` at one instant.
 * @param now - epoch milliseconds of the request.
 * @param timeZone - IANA zone to read; omission reads the process zone.
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
 * The first configured window containing one instant.
 * @param windows - configured windows, evaluated in order.
 * @param now - epoch milliseconds of the request.
 * @returns the matching window, or `undefined` when none matches.
 */
export function selectPeakWindow(
  windows: readonly PiAiPeakWindow[],
  now: number,
): PiAiPeakWindow | undefined {
  return windows.find(window => inWindow(localClock(now, window.timeZone), window.from, window.to))
}
