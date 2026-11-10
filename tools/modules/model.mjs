import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import ts from 'typescript'
import { dependenciesOf, modulePaths, ownerOf } from './boundaries.mjs'

export const jobs = [
  'format',
  'quality',
  'build',
  'public-browsers',
  'cms',
  'startup',
  'edge-functions',
  'database-current',
]
export const moduleIds = Object.keys(modulePaths).sort()

// This is an audited behavioral seam, not a general filename heuristic. The panel has one
// production parent, an explicit adapter/race harness, and a native two-engine browser spec.
// A new caller, another changed file, or shared CSS/contract input invalidates the narrow cohort.
export const deliveryCohort = {
  input: 'modules/studio/src/DeliveryStatus.tsx',
  consumers: [
    'modules/studio/src/DomainPanels.tsx',
    'tools/e2e/admin-harness.tsx',
    'tools/e2e/cms-delivery-status.spec.mjs',
  ],
  cms: ['cms-delivery-status', 'cms-owner', 'cms-workspace-views', 'cms-workspace-edge']
    .map((name) => `tools/e2e/${name}.spec.mjs`)
    .sort(),
  public: ['tools/e2e/admin-shared.spec.mjs', 'tools/e2e/admin-state.spec.mjs'],
}

export function matchesDeliveryCohort(changes, graph, inventory) {
  if (graph.testUnsupported?.some(({ file }) => !file.startsWith('tests/unit/'))) return false
  if (changes.length !== 1 || changes[0].status !== 'M' || changes[0].path !== deliveryCohort.input)
    return false
  const consumers = [
    ...new Set(
      [...graph.edges, ...(graph.testEdges ?? [])]
        .filter(({ to }) => to === deliveryCohort.input)
        .map(({ from }) => from),
    ),
  ].sort()
  return (
    JSON.stringify(consumers) === JSON.stringify(deliveryCohort.consumers) &&
    [...deliveryCohort.cms, ...deliveryCohort.public].every((path) => inventory[path])
  )
}
export const git = (root, args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
export const isTest = (path) =>
  /(?:\.test\.[cm]?[jt]sx?|\.spec\.[cm]?[jt]sx?|(?:^|\/)test[-_][^/]+\.(?:mjs|py)|(?:^|\/)\d[^/]*_test\.sql)$/.test(
    path,
  )
export const testFiles = (root) =>
  [
    ...new Set(
      git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
        .split('\0')
        .filter((path) => isTest(path) && existsSync(resolve(root, path))),
    ),
  ].sort()

export function loadInventory(root) {
  const inventory = JSON.parse(
    readFileSync(resolve(root, 'tools/modules/test-ownership.json'), 'utf8'),
  )
  const actual = testFiles(root)
  const expected = Object.keys(inventory).sort()
  const errors = [
    ...actual.filter((path) => !inventory[path]).map((path) => `Unclassified test: ${path}`),
    ...expected
      .filter((path) => !actual.includes(path))
      .map((path) => `Missing owned test: ${path}`),
  ]
  for (const [path, entry] of Object.entries(inventory)) {
    if (
      ![
        'unit',
        'integration',
        'cms',
        'public',
        'startup',
        'customer',
        'database',
        'orchestration',
      ].includes(entry.kind) ||
      !Array.isArray(entry.owners) ||
      !entry.owners.length ||
      entry.owners.some((owner) => !moduleIds.includes(owner)) ||
      !entry.reason
    )
      errors.push(`Invalid test ownership: ${path}`)
  }
  // A full fallback must still execute newly added tests in the existing runner roots. This
  // classification authorizes no narrowing: the missing declaration remains a model error.
  for (const path of actual) {
    if (inventory[path]) continue
    const kind = path.startsWith('tests/unit/')
      ? 'unit'
      : path.startsWith('tests/integration/')
        ? 'integration'
        : path.startsWith('tools/e2e/')
          ? path.endsWith('/cms-startup.spec.mjs')
            ? 'startup'
            : path.endsWith('/customer.spec.mjs')
              ? 'customer'
              : path.includes('/cms-')
                ? 'cms'
                : 'public'
          : path.startsWith('supabase/tests/')
            ? 'database'
            : 'orchestration'
    inventory[path] = {
      kind,
      owners: moduleIds,
      reason: 'Unclassified test: full fallback only; ownership declaration required',
    }
  }
  return {
    inventory: Object.fromEntries(
      Object.entries(inventory).filter(([path]) => actual.includes(path)),
    ),
    errors,
  }
}

// Tests may inspect private source. This analysis does not apply production import restrictions
// to test harnesses, and it treats every filesystem reader/unsupported dependency as always-on.
// Reachability is supplemented by the explicit behavioral owners in test-ownership.json.
export function unitOwnership(root, inventory, graph) {
  root = realpathSync(root)
  const sourceEdges = new Map()
  for (const edge of graph.edges) {
    const list = sourceEdges.get(edge.from) ?? []
    list.push(edge.to)
    sourceEdges.set(edge.from, list)
  }
  const parsedCache = new Map()
  const compiler = {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    allowImportingTsExtensions: true,
  }
  function fileInputs(path) {
    if (parsedCache.has(path)) return parsedCache.get(path)
    let targets = sourceEdges.get(path)
    let always = false
    if (!targets && /\.[cm]?[jt]sx?$/.test(path)) {
      targets = []
      const parsed = dependenciesOf(path, readFileSync(resolve(root, path), 'utf8'))
      always = parsed.unsupported.length > 0
      for (const { specifier } of parsed.dependencies) {
        if (
          /^(?:node:)?fs(?:\/promises)?$/.test(specifier) ||
          /^(?:node:)?child_process$/.test(specifier)
        )
          always = true
        const resolved = ts.resolveModuleName(
          specifier,
          resolve(root, path),
          compiler,
          ts.sys,
        ).resolvedModule
        if (resolved && (!resolved.isExternalLibraryImport || specifier.startsWith('@bladeblend/')))
          targets.push(relative(root, resolved.resolvedFileName))
        else if (!resolved && (specifier.startsWith('.') || specifier.startsWith('@bladeblend/')))
          always = true
      }
    }
    const result = { targets: targets ?? [], always }
    parsedCache.set(path, result)
    return result
  }
  function inspect(path) {
    const owners = new Set(),
      inputs = new Set(),
      pending = [path]
    let always = false
    while (pending.length) {
      const input = pending.pop()
      if (inputs.has(input)) continue
      inputs.add(input)
      const owner = ownerOf(input)
      if (owner) owners.add(owner)
      if (!/\.[cm]?[jt]sx?$/.test(input) || !existsSync(resolve(root, input))) continue
      const entry = fileInputs(input)
      always ||= entry.always
      pending.push(...entry.targets)
    }
    return { owners: [...owners].sort(), inputs: [...inputs].sort(), always }
  }
  return Object.entries(inventory)
    .filter(([, entry]) => entry.kind === 'unit')
    .map(([path, entry]) => {
      const analysis = inspect(path)
      const always = analysis.always || !analysis.owners.length
      return {
        path,
        owners: always ? moduleIds : [...new Set([...entry.owners, ...analysis.owners])].sort(),
        inputs: analysis.inputs,
        reason: always
          ? 'Always-on filesystem/process/unknown-input contract'
          : 'Explicit responsibility plus transitive source imports',
      }
    })
}

export function selectVerification(changes, graph, inventory, units, forcedReasons = []) {
  const reasons = [...forcedReasons]
  const unknownBrowserInputs = (graph.testUnsupported ?? []).filter(
    ({ file }) => !file.startsWith('tests/unit/'),
  )
  if (unknownBrowserInputs.length)
    reasons.push(
      `incomplete browser consumer graph: ${unknownBrowserInputs.map(({ reason }) => reason).join('; ')}; full verification required`,
    )
  const affected = new Set()
  const explain = []
  for (const change of changes) {
    const { path, status } = change
    const owner = ownerOf(path)
    if (status !== 'M')
      reasons.push(`${status}: ${path} requires both-version ownership; using full verification`)
    if (/(?:^|\/)(?:package(?:-lock)?\.json|deno\.(?:json|lock))$/.test(path))
      reasons.push(`Package/exports/lock configuration: ${path}`)
    if (
      (owner && !/\.[cm]?[jt]sx?$/.test(path) && !path.startsWith('supabase/migrations/')) ||
      /\.(?:css|html)$/i.test(path)
    )
      reasons.push(`Unmodeled source behavior (styles/templates/data): ${path}`)
    if (
      owner &&
      (path.includes('/src/') ||
        path.startsWith('supabase/worker/') ||
        path.startsWith('supabase/functions/') ||
        path.startsWith('supabase/migrations/'))
    ) {
      affected.add(owner)
      explain.push(`${path}: owned by ${owner}`)
    } else if (path.startsWith('public/')) {
      affected.add('public-web')
      explain.push(`${path}: public assets affect rendering, capture and published pages`)
    } else reasons.push(`Unclassified or orchestration/configuration input: ${path}`)
  }
  // Source ownership gives an initial frontier; resolved reverse imports add real consumers.
  // Root composition is intentionally a build/startup gate, not an edge back into all modules.
  for (let changed = true; changed;) {
    changed = false
    for (const { from, to } of graph.edges) {
      const consumer = ownerOf(from),
        provider = ownerOf(to)
      if (consumer && provider && affected.has(provider) && !affected.has(consumer)) {
        affected.add(consumer)
        changed = true
      }
    }
  }
  // Persisted document formats, native DOM/CSS capture, SQL/wire contracts and release hashes
  // cross runtime boundaries that import reachability cannot establish. Keep those edges broad.
  if (
    ['public-web', 'content-contracts', 'backend-contracts', 'backend'].some((id) =>
      affected.has(id),
    )
  ) {
    moduleIds.forEach((id) => affected.add(id))
    explain.push(
      'Public rendering/CSS/preview, persisted CMS content, SQL/RPC and backend wire contracts require all runtime consumers',
    )
  }
  if (affected.has('staff-admin')) {
    affected.add('studio')
    explain.push('Staff session and owner authorization guard Studio')
  }
  const narrowDelivery = !reasons.length && matchesDeliveryCohort(changes, graph, inventory)
  if (narrowDelivery)
    explain.push(
      'Audited DeliveryStatus leaf: unchanged exact DomainPanels, delivery harness and direct browser consumer set; retain delivery races, owner/workspace navigation, public CMS shell and startup',
    )
  else if (affected.has('studio'))
    explain.push(
      'Complete Studio browser cohort: shared resources harness and return/focus/navigation flows prevent a proven leaf-only omission',
    )
  const full = reasons.length > 0 || !changes.length
  if (!changes.length) reasons.push('Empty change set does not authorize omitted verification')
  if (full) moduleIds.forEach((id) => affected.add(id))
  const required = new Set(['format', 'quality', 'build'])
  if (affected.has('studio')) {
    required.add('cms')
    required.add('startup')
  }
  if (
    Object.values(inventory).some(
      (entry) => entry.kind === 'public' && entry.owners.some((owner) => affected.has(owner)),
    )
  )
    required.add('public-browsers')
  if (affected.has('backend')) {
    required.add('edge-functions')
    required.add('database-current')
  }
  const unit = units
    .filter((entry) => full || entry.owners.some((owner) => affected.has(owner)))
    .map((entry) => entry.path)
    .sort()
  const browser = Object.fromEntries(
    ['cms', 'public', 'startup', 'customer'].map((group) => [
      group,
      Object.entries(inventory)
        .filter(
          ([, entry]) =>
            entry.kind === group &&
            (full || entry.owners.some((owner) => affected.has(owner))) &&
            required.has(
              {
                cms: 'cms',
                public: 'public-browsers',
                startup: 'startup',
                customer: 'database-current',
              }[group],
            ),
        )
        .map(([path]) => path)
        .sort(),
    ]),
  )
  if (narrowDelivery) {
    browser.cms = deliveryCohort.cms
    browser.public = deliveryCohort.public
  }
  const integration = required.has('database-current')
    ? Object.entries(inventory)
        .filter(([, entry]) => entry.kind === 'integration')
        .map(([path]) => path)
        .sort()
    : []
  return {
    mode: full ? 'full' : 'affected',
    affected: [...affected].sort(),
    reasons: [...new Set([...reasons, ...explain])].sort(),
    jobs: Object.fromEntries(
      jobs.map((job) => [
        job,
        {
          required: required.has(job),
          reason: required.has(job)
            ? ['format', 'quality', 'build'].includes(job)
              ? 'Always-on boundary/static/unit/release/build gate'
              : 'Selected runtime consumers or conservative full fallback'
            : 'No affected runtime consumer in verified source and non-import graph',
        },
      ]),
    ),
    tests: { unit, integration, browser },
    shards: {
      cms: required.has('cms') ? (narrowDelivery ? 1 : 9) : 0,
      public: required.has('public-browsers') ? (browser.public.length <= 2 ? 1 : 2) : 0,
      startup: required.has('startup') ? 1 : 0,
    },
  }
}
