// Origins of the local servers behind the browser tests. playwright.config.ts starts the servers on
// these ports and publishes the origins to the workers as BASE_URL (CMS harness dev server),
// PUBLIC_BASE_URL (public preview) and CMS_STARTUP_URL (startup preview); a value already set in
// the environment wins.
//
// E2E_PORT_OFFSET moves all three ports together, so several worktrees can run Playwright at once.
// The ports of one offset are 4188, 4173 and 4189 plus the offset: keep the offsets of concurrent
// runs at least 20 apart (0, 100, 200). Offsets 1, 15 or 16 apart make one run's port another's.

const BASE_PORTS = Object.freeze({ harness: 4188, public: 4173, startup: 4189 })
const MAX_PORT_OFFSET = 1000

/**
 * @typedef {{ readonly harness: number, readonly public: number, readonly startup: number }} ServerPorts
 * @typedef {{
 *   readonly ports: ServerPorts
 *   readonly harness: string
 *   readonly public: string
 *   readonly startup: string
 * }} Origins
 * @typedef {{
 *   E2E_PORT_OFFSET?: string
 *   BASE_URL?: string
 *   PUBLIC_BASE_URL?: string
 *   CMS_STARTUP_URL?: string
 * }} OriginEnv
 */

/**
 * The server ports for one E2E_PORT_OFFSET value. Anything except a canonical decimal integer from
 * 0 to 1000 throws an error that names the variable and the rejected text.
 * @param {string | undefined} offsetText the variable as read from the environment; unset means 0
 * @returns {ServerPorts}
 */
function serverPorts(offsetText = '0') {
  if (!/^(0|[1-9]\d*)$/.test(offsetText) || Number(offsetText) > MAX_PORT_OFFSET)
    throw new Error(
      `E2E_PORT_OFFSET must be an integer from 0 to ${MAX_PORT_OFFSET}, got ${JSON.stringify(offsetText)}`,
    )
  const offset = Number(offsetText)
  return Object.freeze({
    harness: BASE_PORTS.harness + offset,
    public: BASE_PORTS.public + offset,
    startup: BASE_PORTS.startup + offset,
  })
}

const localOrigin = (/** @type {number} */ port) => `http://127.0.0.1:${port}`

/**
 * The ports the servers listen on and the origins the tests visit, for one environment. An origin
 * set in the environment replaces the derived one; the port its server listens on does not move.
 * @param {OriginEnv} env
 * @returns {Origins}
 */
export function resolveOrigins(env) {
  const ports = serverPorts(env.E2E_PORT_OFFSET)
  return Object.freeze({
    ports,
    harness: env.BASE_URL ?? localOrigin(ports.harness),
    public: env.PUBLIC_BASE_URL ?? localOrigin(ports.public),
    startup: env.CMS_STARTUP_URL ?? localOrigin(ports.startup),
  })
}

const origins = resolveOrigins(process.env)
export const harnessOrigin = origins.harness
export const publicOrigin = origins.public
export const startupOrigin = origins.startup
