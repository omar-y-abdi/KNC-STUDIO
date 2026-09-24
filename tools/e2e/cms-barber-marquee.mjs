import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp'
const barbers = ['Fixture barber A', 'Fixture barber B'].map((name, index) => ({
  id: `fixture-barber-${index + 1}`,
  name,
  ig: `fixture${index + 1}`,
  role_sv: 'Frisör',
  role_en: 'Barber',
  bio_sv: `Publicerad presentation ${index + 1}.`,
  bio_en: `Published profile ${index + 1}.`,
  active: true,
  sort_order: index,
  photo_path: `${index + 1}/portrait.png`,
}))
const gallery = ['salon', 'cuts'].flatMap((kind) =>
  [1, 2, 3].map((number) => ({
    id: `${kind}-${number}`,
    kind,
    storage_path: `${kind}/${number}.png`,
    alt: `${kind} fixture ${number}`,
    sort_order: number,
  })),
)

async function fixtureRoutes(context, activeBarbers) {
  await context.route('https://admin-harness.invalid/**', (route) => {
    const url = new URL(route.request().url())
    const headers = { 'Access-Control-Allow-Origin': new URL(base).origin }
    if (route.request().method() === 'OPTIONS') return route.fallback()
    if (url.pathname === '/rest/v1/rpc/public_booking_catalog')
      return route.fulfill({ headers, json: { barbers: activeBarbers.current, services: [] } })
    if (url.pathname === '/rest/v1/gallery_images') {
      const kind = url.searchParams.get('kind')?.slice(3)
      return route.fulfill({ headers, json: gallery.filter((item) => item.kind === kind) })
    }
    if (url.pathname.startsWith('/storage/v1/object/public/'))
      return route.fulfill({ headers, contentType: 'image/png', path: 'public/og-image.png' })
    return route.fallback()
  })
}

async function transformX(locator) {
  return locator.evaluate((node) => {
    const transform = globalThis.getComputedStyle(node).transform
    return transform === 'none' ? 0 : new globalThis.DOMMatrixReadOnly(transform).m41
  })
}

async function velocity(page, locator) {
  const start = await transformX(locator)
  await page.waitForTimeout(1100)
  return Math.abs((await transformX(locator)) - start) / 1.1
}

async function centeredBarber(page) {
  return page.evaluate(() => {
    const track = globalThis.document.querySelector('[aria-roledescription="carousel"]')
    if (!track) throw new Error('Public barber track missing')
    const center = globalThis.innerWidth / 2
    const cards = [...track.querySelectorAll(':scope > [role="button"]')]
    const nearest = cards
      .map((card) => ({
        name: card.querySelector('span')?.textContent ?? '',
        distance: Math.abs(
          card.getBoundingClientRect().left + card.getBoundingClientRect().width / 2 - center,
        ),
      }))
      .sort((a, b) => a.distance - b.distance)[0]
    return nearest?.name ?? ''
  })
}

async function dragLeft(page, track, distance = 0.7) {
  await track.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }))
  const viewport = page.viewportSize()
  assert.ok(viewport, 'Barber track has no visible viewport')
  // A looping track has gaps. Fixed screen coordinates repeatedly hit
  // empty space in WebKit, so those recorded "drags" never reached Embla.
  const { x, y, hit } = await track.evaluate((node) => {
    const candidates = [...node.querySelectorAll(':scope > [role="button"]')]
      .map((card) => {
        const rect = card.getBoundingClientRect()
        const left = Math.max(0, rect.left)
        const right = Math.min(globalThis.innerWidth, rect.right)
        const top = Math.max(20, rect.top)
        const bottom = Math.min(globalThis.innerHeight - 20, rect.bottom)
        return { card, left, right, top, bottom, width: right - left }
      })
      .filter(({ width, top, bottom }) => width > 60 && bottom - top > 40)
      .sort((a, b) => b.width - a.width)
    const target = candidates[0]
    if (!target) throw new Error('No visible barber card can receive a drag')
    const x = target.right - 20
    const y = target.top + Math.min(80, (target.bottom - target.top) / 2)
    if (!target.card.contains(globalThis.document.elementFromPoint(x, y)))
      throw new Error('Visible barber drag target is covered')
    return { x, y, hit: target.card.textContent?.trim().slice(0, 30) ?? '' }
  })
  const before = await transformX(track)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(Math.max(10, x - viewport.width * distance), y, { steps: 8 })
  await page.mouse.up()
  // dragFree keeps moving after pointerup. A fixed delay can identify A as
  // nearest, then click after inertia has carried it offscreen. Wait for
  // that fast motion to finish; the intended slow autoplay may continue.
  const settling = await track.evaluate(async (node) => {
    const x = () => {
      const transform = globalThis.getComputedStyle(node).transform
      return transform === 'none' ? 0 : new globalThis.DOMMatrixReadOnly(transform).m41
    }
    const started = globalThis.performance.now()
    let previous = x()
    let slowSince = null
    while (globalThis.performance.now() - started < 5000) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 50))
      const current = x()
      const now = globalThis.performance.now()
      if (Math.abs(current - previous) <= 2) slowSince ??= now
      else slowSince = null
      previous = current
      if (slowSince !== null && now - slowSince >= 200)
        return { elapsedMs: now - started, x: current }
    }
    throw new Error('Barber drag did not return to slow or paused motion')
  })
  return { hit, before, after: await transformX(track), settling }
}

async function clickVisibleCard(page, card) {
  const box = await card.boundingBox()
  const viewport = page.viewportSize()
  assert.ok(box && viewport, 'Barber card has no visible viewport')
  const left = Math.max(0, box.x)
  const right = Math.min(viewport.width, box.x + box.width)
  const top = Math.max(0, box.y)
  const bottom = Math.min(viewport.height, box.y + box.height)
  assert.ok(right - left > 20 && bottom - top > 20, 'Selected barber is offscreen')
  await page.mouse.click((left + right) / 2, top + Math.min(80, (bottom - top) / 2))
}

async function run(engine, name) {
  const browser = await engine.launch()
  const activeBarbers = { current: barbers }
  let captureContext
  let upgradeContext
  let liveContext
  let live
  try {
    captureContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'no-preference',
    })
    captureContext.setDefaultTimeout(15000)
    await nativeBackend(captureContext)
    await fixtureRoutes(captureContext, activeBarbers)
    const editor = await captureContext.newPage()
    await editor.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
    await editor.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    await editor.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
    // Start from the actual emitted source. Exercise the fresh public projection separately from
    // a legacy stored About template upgraded in the CMS without replacing owner content.
    const owned = await editor.evaluate(async () => {
      const backup = (await import('/src/admin/cms/backup.ts')).loadBackup()
      if (!backup) throw new Error('The actual CMS source was not captured')
      const document = globalThis.structuredClone(backup.document)
      const about = document.presentation.pages.find((page) => page.path === '/about')
      if (!about) throw new Error('The captured About template is missing')
      const parsed = new globalThis.DOMParser().parseFromString(about.content.sv.html, 'text/html')
      const name = [...parsed.querySelectorAll('span')].find(
        (node) => node.textContent?.trim() === 'Fixture barber A',
      )
      const card = name?.parentElement?.parentElement
      if (!card?.id || !card.hasAttribute('data-knc-source'))
        throw new Error('Captured canonical barber card identity is missing')
      const cardId = card.id
      name.textContent = 'Owner-styled A'
      about.content.sv.html = parsed.body.innerHTML
      for (const mode of ['light', 'dark'])
        about.content.sv.css[mode] +=
          `\n#${globalThis.CSS.escape(cardId)}{outline:3px solid #1a8e62!important}`
      const legacy = globalThis.structuredClone(document)
      const gridId = 'owner:grid.card'
      const ownerCardId = 'owner:barber.a'
      const withoutMobileRules = (css) => {
        const marker = css.indexOf(':where([data-knc-fold="barber-marquee"])')
        const start = css.lastIndexOf('@media(max-width:768px)', marker)
        if (marker < 0 || start < 0) throw new Error('Fresh mobile barber CSS is missing')
        let depth = 0
        for (let index = start; index < css.length; index++) {
          if (css[index] === '{') depth++
          if (css[index] === '}' && --depth === 0) return css.slice(0, start) + css.slice(index + 1)
        }
        throw new Error('Fresh mobile barber CSS was not closed')
      }
      for (const lang of ['sv', 'en']) {
        const variant = legacy.presentation.pages.find((page) => page.path === '/about')?.content[
          lang
        ]
        if (!variant) throw new Error('Legacy About variant missing')
        const tree = new globalThis.DOMParser().parseFromString(variant.html, 'text/html')
        const grid = tree.querySelector('[data-knc-fold="barber-marquee"]')
        const firstCard = grid?.querySelector(':scope > [data-knc-source]')
        if (!grid || !firstCard) throw new Error('Legacy barber nodes missing')
        grid.removeAttribute('data-knc-fold')
        grid.id = gridId
        firstCard.id = ownerCardId
        variant.html = tree.body.innerHTML
        for (const mode of ['light', 'dark'])
          variant.css[mode] =
            withoutMobileRules(variant.css[mode]) +
            `\n#${globalThis.CSS.escape(gridId)}{gap:8px}` +
            `\n#${globalThis.CSS.escape(ownerCardId)}{padding:20px;color:#123456;outline:3px solid #1a8e62!important}`
      }
      const { ensureCorePages } = await import('/src/admin/cms/corePages.ts')
      const upgraded = ensureCorePages(legacy, backup.document.presentation.pages)
      if (
        JSON.stringify(upgraded) !==
        JSON.stringify(ensureCorePages(upgraded, backup.document.presentation.pages))
      )
        throw new Error('Legacy mobile About upgrade accumulated changes')
      const upgradedAbout = upgraded.presentation.pages.find((page) => page.path === '/about')
      const upgradedGrid = new globalThis.DOMParser()
        .parseFromString(upgradedAbout.content.sv.html, 'text/html')
        .querySelector('[data-knc-fold="barber-marquee"]')
      if (upgradedGrid?.id !== gridId) throw new Error('Owner-renamed grid identity was lost')
      const upgradedCss = upgradedAbout.content.sv.css.light
      const ownerRule = `#${globalThis.CSS.escape(ownerCardId)}{padding:20px`
      const ownerRuleAt = upgradedCss.lastIndexOf(ownerRule)
      if (
        !upgradedCss.includes(`#${globalThis.CSS.escape(gridId)}:where`) ||
        ownerRuleAt < 0 ||
        !upgradedCss.slice(0, ownerRuleAt).includes(`#${globalThis.CSS.escape(ownerCardId)}{`)
      )
        throw new Error('Mobile CSS did not remap IDs ahead of owner overrides')
      return { document, cardId, upgraded, gridId, ownerCardId }
    })
    // The source frame uses the same mobile component with source=true: no Embla transform may
    // be frozen into the owner baseline, even when the browser has normal motion enabled.
    const source = await captureContext.newPage()
    await source.setViewportSize({ width: 390, height: 844 })
    await source.goto(`${base}/cms-public/source`)
    await source.waitForFunction(
      () => globalThis.document.documentElement.dataset['kncSourceListening'] === '1',
    )
    await source.evaluate(() =>
      globalThis.window.postMessage(
        {
          type: 'knc-source-context',
          id: 'barber-marquee',
          lang: 'sv',
          mode: 'light',
          device: 'Mobile',
          scene: 'home',
        },
        globalThis.location.origin,
      ),
    )
    try {
      await source.waitForFunction(
        () => globalThis.document.documentElement.dataset['kncSourceReady'] === 'barber-marquee',
      )
    } catch (error) {
      const state = await source.evaluate(() => ({
        ...globalThis.document.documentElement.dataset,
      }))
      throw new Error(`Mobile source context did not settle: ${JSON.stringify(state)}`, {
        cause: error,
      })
    }
    const sourceTrack = source.locator('[aria-roledescription="carousel"]').first()
    assert.equal(await sourceTrack.locator(':scope > [role="button"]').count(), 2)
    assert.equal(await transformX(sourceTrack), 0, 'Source capture ran the marquee engine')
    await captureContext.close()
    captureContext = undefined

    // Reopen a legacy, owner-edited template in the actual studio. The upgrade must give both
    // the About page and its Home composition the mobile layout without replacing card identity
    // or overriding normal owner declarations. Publish an inspector edit, then reload the studio.
    upgradeContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    })
    upgradeContext.setDefaultTimeout(15000)
    const upgradedBackend = await nativeBackend(upgradeContext, owned.upgraded)
    await fixtureRoutes(upgradeContext, activeBarbers)
    const upgradePage = await upgradeContext.newPage()
    const upgradeFrame = upgradePage.frameLocator('.gjs-frame').first()
    const mountUpgrade = async () => {
      await upgradePage.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
      await upgradePage.evaluate(async () =>
        (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
      )
      await upgradePage.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
    }
    const editorCard = upgradeFrame.locator(`[id="${owned.ownerCardId}"]`)
    const editorGrid = upgradeFrame.locator(`[id="${owned.gridId}"]`)
    const assertMobileEditor = async (scope) => {
      const grid = scope.locator('[data-knc-fold="barber-marquee"]')
      await grid.waitFor({ state: 'visible' })
      await grid.evaluate(
        (node) =>
          new Promise((resolve, reject) => {
            const info = node.firstElementChild?.querySelector('p')
            if (!info) return reject(new Error('Mobile barber profile is missing'))
            const start = globalThis.performance.now()
            const settle = () => {
              const opacity = globalThis.getComputedStyle(info).opacity
              if (opacity === '0') resolve()
              else if (globalThis.performance.now() - start > 3000)
                reject(new Error(`Collapsed barber bio stayed visible (${opacity})`))
              else globalThis.requestAnimationFrame(settle)
            }
            settle()
          }),
      )
      const styles = await grid.evaluate((node) => {
        const first = node.firstElementChild
        const info = first?.querySelector('p')
        if (!first || !info) throw new Error('Mobile barber card or profile is missing')
        const gridStyle = globalThis.getComputedStyle(node)
        const cardStyle = globalThis.getComputedStyle(first)
        const rules = []
        const collect = (group) => {
          for (const rule of group) {
            if (
              'selectorText' in rule &&
              (rule.selectorText.includes(globalThis.CSS.escape(node.id)) ||
                rule.selectorText.includes('barber-marquee'))
            )
              rules.push(rule.cssText.slice(0, 240))
            if ('cssRules' in rule && rule.cssRules) collect(rule.cssRules)
          }
        }
        for (const sheet of node.ownerDocument.styleSheets) {
          try {
            collect(sheet.cssRules)
          } catch {
            // External font sheets are not relevant to the local card selectors.
          }
        }
        const styleText = [...node.ownerDocument.querySelectorAll('style')]
          .map((style) => style.textContent ?? '')
          .join('\n')
        const styleAt = styleText.lastIndexOf(`#${globalThis.CSS.escape(node.id)}`)
        return {
          id: node.id,
          inline: node.getAttribute('style'),
          layout: gridStyle.display,
          gap: gridStyle.gap,
          padding: cardStyle.padding,
          color: cardStyle.color,
          outline: cardStyle.outlineColor,
          profileOpacity: globalThis.getComputedStyle(info).opacity,
          rules: rules.slice(-12),
          styleSnippet: styleAt < 0 ? '' : styleText.slice(styleAt, styleAt + 350),
        }
      })
      assert.equal(styles.layout, 'flex', 'CMS Mobile About kept its old desktop card grid')
      assert.equal(
        styles.gap,
        '8px',
        `Owner grid gap did not override the mobile baseline: ${JSON.stringify(styles)}`,
      )
      assert.equal(styles.padding, '20px', 'Owner card padding lost after mobile import')
      assert.equal(styles.color, 'rgb(18, 52, 86)', 'Owner card color lost after mobile import')
      assert.equal(styles.outline, 'rgb(26, 142, 98)', 'Owner card outline lost')
      assert.equal(styles.profileOpacity, '0', 'CMS Mobile preview shows the collapsed bio')
    }
    await mountUpgrade()
    await upgradePage.getByRole('button', { name: 'Om oss', exact: true }).click()
    await upgradePage.getByRole('button', { name: 'Mobil', exact: true }).click()
    await editorCard.waitFor({ state: 'visible' })
    assert.equal(await editorGrid.count(), 1, 'Owner grid identity changed during import')
    await assertMobileEditor(upgradeFrame.locator('[data-knc-surface="about"]'))
    await editorGrid.scrollIntoViewIfNeeded()
    await upgradePage.screenshot({ path: `${out}/cms-native-${name}-barber-editor.png` })
    await upgradePage.locator('#cms-library').getByRole('button', { name: 'Startsida' }).click()
    await assertMobileEditor(upgradeFrame.locator('[data-knc-surface="mobile-home"]'))
    await upgradePage.locator('#cms-library').getByRole('button', { name: 'Om oss' }).click()
    await upgradeFrame.getByText('Owner-styled A', { exact: true }).first().click()
    await upgradePage
      .locator('#cms-inspector')
      .getByLabel('Text', { exact: true })
      .fill('Owner published A')
    await upgradePage.getByRole('button', { name: 'Publicera', exact: true }).click()
    await upgradePage.waitForFunction(() =>
      globalThis.document.querySelector('.cms-status')?.textContent?.includes('Publicerad'),
    )
    assert.ok(upgradedBackend.writes.includes('publish'), 'Legacy mobile edit was not published')
    await mountUpgrade()
    await upgradePage.getByRole('button', { name: 'Om oss', exact: true }).click()
    await upgradePage.getByRole('button', { name: 'Mobil', exact: true }).click()
    await assertMobileEditor(upgradeFrame.locator('[data-knc-surface="about"]'))
    await upgradeFrame.getByText('Owner published A', { exact: true }).first().waitFor()
    const publishedPage = await upgradeContext.newPage()
    await publishedPage.setViewportSize({ width: 390, height: 844 })
    await publishedPage.goto(`${base}/about`)
    const publishedConsent = publishedPage.getByRole('button', {
      name: 'Avvisa valfri lagring',
      exact: true,
    })
    await publishedConsent.click()
    await publishedConsent.waitFor({ state: 'hidden' })
    const publishedCard = publishedPage
      .getByRole('region', { name: 'Barberarna' })
      .locator(':scope > [role="button"]')
      .first()
    await publishedCard.waitFor({ state: 'visible' })
    await publishedCard.click()
    assert.equal(await publishedCard.getAttribute('aria-expanded'), 'true')
    await publishedPage.waitForFunction(() => {
      const info = globalThis.document.querySelector(
        '[aria-roledescription="carousel"] > [role="button"] p',
      )
      return info && Number(globalThis.getComputedStyle(info).opacity) > 0.5
    })
    const publishedInfoOpacity = Number(
      await publishedCard
        .locator('p')
        .first()
        .evaluate((node) => globalThis.getComputedStyle(node).opacity),
    )
    await upgradeContext.close()
    upgradeContext = undefined

    liveContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: 'no-preference',
    })
    liveContext.setDefaultTimeout(15000)
    await nativeBackend(liveContext, owned.document)
    await fixtureRoutes(liveContext, activeBarbers)
    live = await liveContext.newPage()
    const errors = []
    live.on('pageerror', (error) => errors.push(error.message))
    await live.goto(`${base}/about`)
    const declineStorage = live.getByRole('button', {
      name: 'Avvisa valfri lagring',
      exact: true,
    })
    await declineStorage.click()
    await declineStorage.waitFor({ state: 'hidden' })
    const track = live.getByRole('region', { name: 'Barberarna' })
    const cards = track.locator(':scope > [role="button"]')
    await cards.first().waitFor({ timeout: 20000 })
    assert.equal(await cards.count(), 2, 'Two real barbers must have two canonical cards')
    assert.equal(await track.getAttribute('aria-roledescription'), 'carousel')
    const ownedCard = live.locator(`[id="${owned.cardId}"]`)
    assert.equal(await ownedCard.count(), 1, 'The owner card identity was duplicated or dropped')
    assert.ok((await ownedCard.innerText()).includes('Owner-styled A'))
    assert.equal(
      await ownedCard.evaluate((node) => globalThis.getComputedStyle(node).outlineColor),
      'rgb(26, 142, 98)',
      'Owner CSS on the canonical card was lost',
    )
    assert.equal(
      await live
        .locator('[id]')
        .evaluateAll((nodes) => nodes.length - new Set(nodes.map((node) => node.id)).size),
      0,
      'Published page has duplicate native IDs',
    )
    const galleryTrack = live.getByTestId('marquee-track').first()
    await galleryTrack.evaluate((node) =>
      node.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' }),
    )
    const galleryRate = await velocity(live, galleryTrack)
    await track.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }))
    await live.waitForTimeout(900)
    const barberRate = await velocity(live, track)
    assert.ok(barberRate > 2, `Barber marquee did not move (${barberRate.toFixed(2)} px/s)`)
    assert.ok(galleryRate > barberRate * 1.5, 'Barber marquee must move slower than the galleries')
    await live.screenshot({ path: `${out}/cms-native-${name}-barber-before.png` })

    await clickVisibleCard(live, cards.first())
    assert.equal(await cards.first().getAttribute('aria-expanded'), 'true')
    assert.equal(await cards.nth(1).getAttribute('aria-expanded'), 'false')
    assert.equal(await cards.first().locator('p').first().getAttribute('aria-hidden'), 'false')
    assert.equal(await cards.nth(1).locator('p').first().getAttribute('aria-hidden'), 'true')
    await live.waitForTimeout(250)
    const paused = await transformX(track)
    await live.waitForTimeout(900)
    assert.ok(Math.abs((await transformX(track)) - paused) < 1, 'Selection did not pause motion')
    await live.screenshot({ path: `${out}/cms-native-${name}-barber-expanded.png` })
    const scale = await cards.first().evaluate((node) => globalThis.getComputedStyle(node).scale)
    assert.notEqual(scale, '1', 'Selected card did not enlarge')
    const cardBounds = await cards.first().boundingBox()
    assert.ok(
      cardBounds && cardBounds.x >= -1 && cardBounds.x + cardBounds.width <= 391,
      `Selected card escaped viewport: ${JSON.stringify({ cardBounds, trackX: await transformX(track) })}`,
    )
    await dragLeft(live, track, 0.18)
    await live.setViewportSize({ width: 400, height: 844 })
    await live.waitForTimeout(300)
    const afterResize = await transformX(track)
    await live.waitForTimeout(900)
    assert.ok(
      Math.abs((await transformX(track)) - afterResize) < 1,
      'Resize resumed an expanded card',
    )
    await live.setViewportSize({ width: 390, height: 844 })
    await clickVisibleCard(live, cards.first())
    assert.equal(await cards.first().getAttribute('aria-expanded'), 'false')
    await live.waitForTimeout(250)
    const resumed = await transformX(track)
    await live.waitForTimeout(900)
    assert.ok(Math.abs((await transformX(track)) - resumed) > 2, 'Closing did not resume motion')

    await cards.first().focus()
    await live.waitForTimeout(250)
    const focused = await transformX(track)
    await live.waitForTimeout(900)
    assert.ok(
      Math.abs((await transformX(track)) - focused) < 1,
      'Keyboard focus did not pause motion',
    )
    await cards.first().press('Enter')
    assert.equal(await cards.first().getAttribute('aria-expanded'), 'true')
    await cards.first().press('Enter')
    assert.equal(await cards.first().getAttribute('aria-expanded'), 'false')
    await cards.first().evaluate((node) => node.blur())

    // Two cards are the smallest looping roster. Drag across the end and observe A return
    // after B; a non-looping carousel would remain pinned on B.
    const seen = [await centeredBarber(live)]
    const dragEvidence = []
    let reachedB = false
    let wrapped = false
    for (let attempt = 0; attempt < 16 && !wrapped; attempt++) {
      dragEvidence.push(await dragLeft(live, track))
      const current = await centeredBarber(live)
      seen.push(current)
      if (current === 'Fixture barber B') reachedB = true
      if (reachedB && current === 'Owner-styled A') wrapped = true
    }
    assert.ok(reachedB, `Drag never reached barber B: ${JSON.stringify({ seen, dragEvidence })}`)
    assert.ok(
      wrapped,
      `Two-barber carousel did not wrap: ${JSON.stringify({ seen, dragEvidence })}`,
    )

    await live.emulateMedia({ reducedMotion: 'reduce' })
    await live.waitForFunction(
      () =>
        globalThis.getComputedStyle(
          globalThis.document.querySelector('[aria-roledescription="carousel"]'),
        ).overflowX === 'auto',
    )
    assert.equal(await transformX(track), 0, 'Reduced motion left an Embla transform behind')
    await track.evaluate((node) => {
      node.scrollLeft = 240
    })
    assert.ok(
      (await track.evaluate((node) => node.scrollLeft)) > 0,
      'Reduced motion cannot scroll manually',
    )
    await live.screenshot({ path: `${out}/cms-native-${name}-barber-reduced.png` })

    activeBarbers.current = barbers.slice(0, 1)
    await live.emulateMedia({ reducedMotion: 'no-preference' })
    await live.reload()
    const oneTrack = live.getByRole('region', { name: 'Barberarna' })
    await oneTrack.locator(':scope > [role="button"]').first().waitFor()
    assert.equal(await oneTrack.locator(':scope > [role="button"]').count(), 1)
    assert.equal(await transformX(oneTrack), 0, 'One-barber roster should stay static')

    // A stored CMS template may reorder the original cards without changing the DB roster.
    // Embla's slide index must come from the clicked DOM node, not the roster array ordinal.
    const reordered = await live.evaluate(({ document, cardId }) => {
      const next = globalThis.structuredClone(document)
      const about = next.presentation.pages.find((page) => page.path === '/about')
      if (!about) throw new Error('Stored About page missing')
      const parsed = new globalThis.DOMParser().parseFromString(about.content.sv.html, 'text/html')
      const first = parsed.getElementById(cardId)
      const second = first?.nextElementSibling
      if (!first || !second?.hasAttribute('data-knc-source'))
        throw new Error('Canonical barber cards cannot be reordered')
      first.parentElement.insertBefore(second, first)
      about.content.sv.html = parsed.body.innerHTML
      return next
    }, owned)
    await liveContext.route('**/api/cms/presentation', (route) =>
      route.fulfill({ json: { revision: 2, presentation: reordered.presentation } }),
    )
    activeBarbers.current = barbers
    await live.reload()
    const reorderedTrack = live.getByRole('region', { name: 'Barberarna' })
    const reorderedCards = reorderedTrack.locator(':scope > [role="button"]')
    await reorderedCards.nth(1).waitFor()
    assert.ok((await reorderedCards.first().innerText()).includes('Fixture barber B'))
    assert.ok((await reorderedCards.nth(1).innerText()).includes('Owner-styled A'))
    await reorderedTrack.evaluate((node) =>
      node.scrollIntoView({ block: 'center', inline: 'nearest' }),
    )
    for (
      let attempt = 0;
      attempt < 4 && (await centeredBarber(live)) !== 'Owner-styled A';
      attempt++
    )
      await dragLeft(live, reorderedTrack)
    assert.equal(await centeredBarber(live), 'Owner-styled A')
    await clickVisibleCard(live, reorderedCards.nth(1))
    assert.equal(await reorderedCards.nth(1).getAttribute('aria-expanded'), 'true')
    const reorderedBounds = await reorderedCards.nth(1).boundingBox()
    assert.ok(
      reorderedBounds &&
        reorderedBounds.x >= -1 &&
        reorderedBounds.x + reorderedBounds.width <= 391,
      `Owner-reordered card was not centered: ${JSON.stringify(reorderedBounds)}`,
    )
    assert.deepEqual(errors, [])
    await writeFile(
      `${out}/cms-native-${name}-barber.json`,
      JSON.stringify(
        {
          galleryRate,
          barberRate,
          seen,
          dragEvidence,
          ownerCardId: owned.cardId,
          editorHomeLegacyPublicationVerified: true,
          publishedInfoOpacity,
          reordered: true,
        },
        null,
        2,
      ),
    )
    console.log(
      `PASS ${name}: canonical owner card, slow two-person loop, focus/selection, reduced motion`,
    )
  } catch (error) {
    if (live)
      await live.screenshot({ path: `${out}/cms-native-${name}-barber-failure.png` }).catch(() => {
        /* Keep the original failure if the page has closed. */
      })
    throw error
  } finally {
    await liveContext?.close()
    await upgradeContext?.close()
    await captureContext?.close()
    await browser.close()
  }
}

await mkdir(out, { recursive: true })
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  if (process.env.CMS_ENGINE && process.env.CMS_ENGINE !== name) continue
  await run(engine, name)
}
