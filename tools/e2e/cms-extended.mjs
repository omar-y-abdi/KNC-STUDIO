import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { expect } from 'playwright/test'

export async function extendedCmsScenarios({
  test,
  owner,
  api,
  studio,
  canvas,
  service,
  db,
  engine,
  publicProjection,
}) {
  const saved = async (page) =>
    expect(page.locator('.cms-draft-status')).toHaveText('Alla ändringar publicerade', {
      timeout: 20000,
    })
  const publish = async (page) => {
    await page.getByRole('button', { name: 'Publicera', exact: true }).click()
    await saved(page)
  }
  const resources = async (page) =>
    page.locator('.cms-library').getByRole('button', { name: 'Resurser', exact: true }).click()
  const pages = async (page) =>
    page.locator('.cms-library').getByRole('button', { name: 'Sidor', exact: true }).click()
  const nav = (page, name) =>
    page.locator('.cms-library').getByRole('button', { name, exact: true })
  const pending = async (page) =>
    expect(page.locator('.cms-draft-status')).toHaveText('Opublicerade ändringar')
  const field = (page, name) => page.getByLabel(name, { exact: true })
  const text = async (page, value) => {
    const node = canvas(page).locator('[data-cms-copy="site:kicker"]').first()
    await expect(node).toBeVisible()
    await node.dblclick()
    await page.locator('.cms-inline-editor').fill(value)
    await page.locator('.cms-inline-editor').press('Escape')
    await expect(node).toHaveText(value)
  }
  const importDocument = async (page, document) => {
    await page.getByLabel('Importera CMS-utkast', { exact: true }).setInputFiles({
      name: 'cms-fixture.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(document)),
    })
    await expect(page.locator('.cms-messages')).toContainText('Innehållet är inläst som utkast', {
      timeout: 20000,
    })
  }
  const closeModal = async (page) =>
    page.getByRole('dialog').getByRole('button', { name: /Stäng/, exact: false }).first().click()
  const duplicateVisibleCmsNodes = async (page) =>
    canvas(page)
      .locator('[data-cms-node]')
      .evaluateAll((nodes) => {
        const seen = new Set()
        const duplicates = new Set()
        for (const node of nodes) {
          const rect = node.getBoundingClientRect()
          const style = getComputedStyle(node)
          if (
            rect.width <= 0 ||
            rect.height <= 0 ||
            style.display === 'none' ||
            style.visibility === 'hidden'
          )
            continue
          const id = node.getAttribute('data-cms-node')
          if (!id) continue
          if (seen.has(id)) duplicates.add(id)
          else seen.add(id)
        }
        return [...duplicates]
      })
  const expectUniqueCmsNodes = async (page) =>
    expect.poll(async () => (await duplicateVisibleCmsNodes(page)).join('|')).toBe('')

  await test(
    'native-cms-node-identities-are-unique-per-rendered-surface',
    owner.session,
    async (page) => {
      await studio(page)
      await expect(canvas(page).locator('[data-cms-node]').first()).toBeVisible()
      await expectUniqueCmsNodes(page)

      await nav(page, 'Om oss').click()
      await expect(canvas(page).locator('#om-oss')).toBeVisible()
      await expectUniqueCmsNodes(page)

      await nav(page, 'Bokning').click()
      await expect(canvas(page).locator('[data-cms-node="bookingflow-div-1"]')).toBeVisible()
      await expectUniqueCmsNodes(page)

      await nav(page, 'Kundens bokningar').click()
      await expect(canvas(page).getByRole('dialog')).toBeVisible()
      await expectUniqueCmsNodes(page)
    },
  )

  await test('draft-reload-recovery-export-and-revert', owner.session, async (page) => {
    await studio(page)
    const initial = await api({ operation: 'state' }),
      value = `Reservutkast ${engine} ${randomUUID()}`
    await text(page, value)
    await pending(page)
    const event = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exportera utkast', exact: true }).click()
    const download = await event,
      backup = JSON.parse(readFileSync(await download.path(), 'utf8'))
    assert.equal(backup.document.site.kicker.sv, value)
    page.once('dialog', (dialog) => {
      void dialog.accept().catch(() => undefined)
    })
    await page.reload()
    await expect(page.locator('.cms-bottom')).toBeVisible()
    await page.getByRole('button', { name: 'Granska och återställ', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Återställ', exact: true })
      .first()
      .click()
    await expect(canvas(page).locator('[data-cms-copy="site:kicker"]').first()).toHaveText(value)
    assert.equal(
      (await api({ operation: 'state' })).revision,
      initial.revision,
      'Recovery must not publish',
    )
    page.once('dialog', (dialog) => {
      void dialog.accept().catch(() => undefined)
    })
    await page.getByRole('button', { name: 'Återställ utkast', exact: true }).click()
    await saved(page)
    await expect(canvas(page).locator('[data-cms-copy="site:kicker"]').first()).not.toHaveText(
      value,
    )
  })

  await test('legacy-write-conflict-preserves-draft', owner.session, async (page) => {
    await studio(page)
    const initial = await api({ operation: 'state' }),
      local = `Local ${engine}`,
      remote = `Legacy ${engine}`
    await text(page, local)
    await db.query(
      "insert into public.site_content(key,lang,value) values('kicker','sv',$1) on conflict(key,lang) do update set value=excluded.value",
      [remote],
    )
    await page.getByRole('button', { name: 'Publicera', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('Jämför med serverns senaste innehåll', {
      timeout: 20000,
    })
    assert.equal((await api({ operation: 'state' })).document.site.kicker.sv, remote)
    await page.getByRole('button', { name: 'Behåll mitt', exact: true }).first().click()
    await page.getByRole('button', { name: 'Förena som utkast', exact: true }).click()
    await publish(page)
    const result = await api({ operation: 'state' })
    assert.equal(result.document.site.kicker.sv, local)
    assert.equal(result.revision, initial.revision + 1)
  })

  await test('history-restores-as-draft-before-publishing', owner.session, async (page) => {
    const initial = await api({ operation: 'state' })
    await studio(page)
    await text(page, `History ${engine}`)
    await publish(page)
    const published = await api({ operation: 'state' })
    await page.getByRole('button', { name: 'Historik', exact: true }).click()
    const row = page
      .locator('.cms-history-entry')
      .filter({ has: page.getByText(`Version ${initial.revision}`, { exact: true }) })
    await row.getByRole('button', { name: 'Granska', exact: true }).click()
    page.once('dialog', (dialog) => {
      void dialog.accept().catch(() => undefined)
    })
    await page.getByRole('button', { name: 'Läs in som utkast', exact: true }).click()
    await pending(page)
    assert.equal((await api({ operation: 'state' })).revision, published.revision)
    await publish(page)
    assert.deepEqual(
      (await api({ operation: 'state' })).document.site.kicker,
      initial.document.site.kicker,
    )
  })

  await test('custom-page-create-type-locales-theme-publish', owner.session, async (page) => {
    await studio(page)
    await pages(page)
    const name = `Visual ${engine}`,
      path = `/cms-browser-${engine}`
    await page.getByRole('button', { name: '+ Ny sida', exact: true }).click()
    await field(page, 'Sidans namn').fill(name)
    await field(page, 'Adress, till exempel /vanliga-fragor').fill(path)
    await page.getByRole('button', { name: 'Skapa som utkast', exact: true }).click()
    const frame = page.frameLocator('.cms-authored-canvas iframe.gjs-frame')
    await expect(frame.locator('body')).toContainText(name)
    const heading = frame.locator('h1,h2').first()
    await heading.dblclick()
    await expect(heading).toHaveAttribute('contenteditable', 'true')
    await heading.fill('Svensk rubrik Åäö')
    await page
      .getByLabel('Redigeringsspråk')
      .getByRole('button', { name: 'EN', exact: true })
      .click()
    await expect(frame.locator('body')).toContainText(name)
    const english = frame.locator('h1,h2').first()
    await english.dblclick()
    await english.fill('English heading')
    await page.getByRole('button', { name: 'Sidans uppgifter', exact: true }).click()
    await field(page, 'Sidtitel · EN').fill(`English SEO ${engine}`)
    await field(page, 'Visa i sidmenyn').check()
    await closeModal(page)
    await publish(page)
    const document = (await api({ operation: 'state' })).document
    const result = document.presentation.pages.find((item) => item.path === path)
    assert.ok(result)
    assert.match(result.content.sv.html, /Svensk rubrik/)
    assert.match(result.content.en.html, /English heading/)
    const projection = await publicProjection()
    const publishedState = await api({ operation: 'state' })
    assert.equal(projection.revision, publishedState.revision)
    const publicPage = projection.presentation.pages.find((item) => item.path === path)
    assert.ok(publicPage)
    assert.match(publicPage.content.sv.html, /Svensk rubrik/)
    assert.match(publicPage.content.en.html, /English heading/)
    assert.equal(publicPage.title.en, `English SEO ${engine}`)
    assert.equal(publicPage.inMenu, true)
  })

  await test(
    'authored-css-color-modes-do-not-overwrite-one-another',
    owner.session,
    async (page) => {
      const state = await api({ operation: 'state' }),
        document = globalThis.structuredClone(state.document)
      const id = randomUUID(),
        name = `Color contract ${engine}`,
        path = `/cms-colors-${engine}`
      const variant = (html) => ({
        html,
        css: {
          light: '.probe{color:rgb(180,20,30);padding:24px}',
          dark: '.probe{color:rgb(20,160,80);padding:24px}',
        },
      })
      document.presentation.pages.push({
        id,
        kind: 'page',
        path,
        name: { sv: name, en: name },
        title: { sv: name, en: name },
        description: { sv: '', en: '' },
        inMenu: false,
        content: {
          sv: variant('<h1 class="probe">Palett</h1>'),
          en: variant('<h1 class="probe">Palette</h1>'),
        },
      })
      await studio(page)
      await importDocument(page, document)
      await pages(page)
      await nav(page, name).click()
      const probe = () =>
        page.frameLocator('.cms-authored-canvas iframe.gjs-frame').locator('.probe')
      await expect(probe()).toHaveCSS('color', 'rgb(180, 20, 30)')
      await page.getByRole('button', { name: 'Mörkt', exact: true }).click()
      await expect(probe()).toHaveCSS('color', 'rgb(20, 160, 80)')
      await page.getByRole('button', { name: 'Ljust', exact: true }).click()
      await expect(probe()).toHaveCSS('color', 'rgb(180, 20, 30)')
      await publish(page)
      const stored = (await api({ operation: 'state' })).document.presentation.pages.find(
        (item) => item.id === id,
      )
      assert.match(stored.content.sv.css.dark, /20,\s*160,\s*80/)
      assert.match(stored.content.sv.css.light, /180,\s*20,\s*30/)
    },
  )

  await test('site-theme-surface-muted-cover-desktop-and-mobile', owner.session, async (page) => {
    const state = await api({ operation: 'state' }),
      document = globalThis.structuredClone(state.document)
    document.presentation.themes.light = {
      ...document.presentation.themes.light,
      surface: '#123456',
      muted: '#654321',
    }
    document.presentation.themes.dark = {
      ...document.presentation.themes.dark,
      surface: '#234567',
      muted: '#fedcba',
    }

    await studio(page)
    await importDocument(page, document)

    const desktopSurface = () =>
      canvas(page).locator('[data-cms-node="desktopsite-div-2"]')
    const mutedLink = () =>
      canvas(page).locator('[data-cms-node="herolinks-button-2"]').first()

    await expect(desktopSurface()).toHaveCSS('background-color', 'rgb(18, 52, 86)')
    await expect(mutedLink()).toHaveCSS('color', 'rgb(101, 67, 33)')
    await page.screenshot({
      path: `artifacts/cms-browser/${engine}/theme-desktop-light.png`,
    })

    await page.getByRole('button', { name: 'Mörkt', exact: true }).click()
    await expect(desktopSurface()).toHaveCSS('background-color', 'rgb(35, 69, 103)')
    await expect(mutedLink()).toHaveCSS('color', 'rgb(254, 220, 186)')
    await page.screenshot({
      path: `artifacts/cms-browser/${engine}/theme-desktop-dark.png`,
    })

    await page.getByRole('button', { name: 'Mobil', exact: true }).click()
    const mobileSurface = () =>
      canvas(page).locator('[data-cms-node="mobilesite-div-2"]')
    const mobileMuted = () =>
      canvas(page).locator('[data-cms-node="mobilesite-span-19"]')

    await expect(mobileSurface()).toHaveCSS('background-color', 'rgb(35, 69, 103)')
    await expect(mobileMuted()).toHaveCSS('color', 'rgb(254, 220, 186)')
    await expect
      .poll(() =>
        canvas(page).locator('meta[name="theme-color"]').getAttribute('content'),
      )
      .toBe('#234567')
    await page.screenshot({
      path: `artifacts/cms-browser/${engine}/theme-mobile-dark.png`,
    })

    await page.getByRole('button', { name: 'Ljust', exact: true }).click()
    await expect(mobileSurface()).toHaveCSS('background-color', 'rgb(18, 52, 86)')
    await expect(mobileMuted()).toHaveCSS('color', 'rgb(101, 67, 33)')
    await expect
      .poll(() =>
        canvas(page).locator('meta[name="theme-color"]').getAttribute('content'),
      )
      .toBe('#123456')
    await page.screenshot({
      path: `artifacts/cms-browser/${engine}/theme-mobile-light.png`,
    })
  })

  await test('image-upload-metadata-archive-and-restore', owner.session, async (page) => {
    await studio(page)
    await resources(page)
    await nav(page, 'Bilder och typsnitt').click()
    const input = field(page, 'Ladda upp till filbiblioteket'),
      name = `cms-browser-${engine}.png`
    const fixture = `artifacts/cms-browser/${name}`
    writeFileSync(
      fixture,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWMAgv8AAQQBAP8H9UQAAAAASUVORK5CYII=',
        'base64',
      ),
    )
    const initial = await api({ operation: 'state' })
    await input.setInputFiles(fixture)
    await expect(page.locator('.cms-asset-details h3')).toHaveText(name, { timeout: 30000 })
    const after = await api({ operation: 'state' })
    assert.equal(after.revision, initial.revision)
    assert.deepEqual(after.document, initial.document)
    const asset = after.assets.find((item) => item.name === name)
    assert.ok(asset)
    assert.equal(asset.mime, 'image/webp')
    await field(page, 'Beskrivning / alttext').fill('Verifierad bild')
    await page.getByRole('button', { name: 'Spara filuppgifter', exact: true }).click()
    await expect(page.locator('.cms-asset-library')).toHaveAttribute('aria-busy', 'false')
    await page.getByRole('button', { name: 'Arkivera filen', exact: true }).click()
    await expect(field(page, 'Arkiverade')).toBeChecked()
    await page.getByRole('button', { name: 'Återställ till biblioteket', exact: true }).click()
    await expect(field(page, 'Arkiverade')).not.toBeChecked()
    const stored = (await api({ operation: 'state' })).assets.find((item) => item.id === asset.id)
    assert.equal(stored.alt, 'Verifierad bild')
    assert.equal(stored.archived, false)
    await input.setInputFiles({
      name: 'invalid.png',
      mimeType: 'image/png',
      buffer: Buffer.from([1, 2, 3, 4]),
    })
    await expect(page.locator('.cms-asset-library [role=alert]')).toBeVisible()
    assert.equal(
      (await api({ operation: 'state' })).assets.some((item) => item.name === 'invalid.png'),
      false,
    )
  })

  await test('second-repeated-marquee-image-edits-are-isolated', owner.session, async (page) => {
    await studio(page)
    await nav(page, 'Om oss').click()

    const rows = canvas(page).locator(
      '[data-cms-node="aboutsection-div-7"] [data-testid="marquee-row"]',
    )
    await expect(rows).toHaveCount(2)
    const second = rows.nth(1).locator('img[data-cms-node]').first()
    await expect(second).toBeVisible()
    const secondId = await second.getAttribute('data-cms-node')
    const originalSrc = await second.getAttribute('src')
    assert.ok(secondId)
    assert.ok(originalSrc)

    const firstId = await rows
      .nth(0)
      .locator('img[data-cms-node]')
      .evaluateAll(
        (nodes, src) =>
          nodes.find((node) => node.getAttribute('src') === src)?.getAttribute('data-cms-node') ??
          null,
        originalSrc,
      )
    assert.ok(firstId)
    assert.notEqual(firstId, secondId)
    const first = canvas(page).locator(`[data-cms-node="${firstId}"]`)
    await expect(first).toHaveCount(1)
    const originalFirstWidth = await first.evaluate((node) => getComputedStyle(node).width)

    await second.click()
    await expect(page.getByRole('button', { name: 'Byt bild', exact: true })).toBeVisible()
    await field(page, 'Bredd').fill('123px')
    await expect(second).toHaveCSS('width', '123px')
    await expect(first).toHaveCSS('width', originalFirstWidth)

    const replacementName = `cms-browser-${engine}.png`
    const replacement = (await api({ operation: 'state' })).assets.find(
      (item) => item.name === replacementName && !item.archived,
    )
    assert.ok(replacement)
    await page.getByRole('button', { name: 'Byt bild', exact: true }).click()
    const picker = page.getByRole('dialog').filter({ hasText: 'Välj fil' }).last()
    await expect(picker).toBeVisible()
    const asset = picker.locator('.cms-asset').filter({ hasText: replacementName }).first()
    await expect(asset).toBeVisible()
    await asset.click()
    await picker.getByRole('button', { name: 'Använd filen', exact: true }).click()
    await expect(picker).toHaveCount(0)

    await expect.poll(() => second.getAttribute('src')).not.toBe(originalSrc)
    await expect(first).toHaveAttribute('src', originalSrc)
    await expect(second).toHaveCSS('width', '123px')
    await expectUniqueCmsNodes(page)
  })

  await test(
    'mail-preview-and-delivery-use-same-committed-template',
    owner.session,
    async (page) => {
      await studio(page)
      await resources(page)
      const initial = await api({ operation: 'state' })
      const email = initial.document.emails.find(
        (item) => item.template === 'customer_confirmation' && item.lang === 'sv',
      )
      assert.ok(email)
      const links = page.locator('.cms-library .cms-nav-item')
      const label = await links.allTextContents()
      const mailLabel = label.find((value) => /bekräftelse/i.test(value) && !/barber/i.test(value))
      assert.ok(mailLabel, JSON.stringify(label))
      await nav(page, mailLabel).click()
      await field(page, 'Ämnesrad').fill(`Visual subject ${engine}`)
      await field(page, 'Rubrik').fill(`Visual title ${engine}`)
      const frame = page.frameLocator('.cms-email-canvas iframe')
      await expect(frame.locator('h1')).toHaveText(`Visual title ${engine}`)
      await page
        .locator('.cms-inspector')
        .getByRole('button', { name: 'Utseende', exact: true })
        .click()
      await field(page, 'Bakgrund').fill('#ddeeff')
      await expect(frame.locator('body')).toHaveCSS('background-color', 'rgb(221, 238, 255)')
      await publish(page)
      const delivery = await service.rpc('email_template_for_delivery', {
        p_template: 'customer_confirmation',
        p_lang: 'sv',
      })
      assert.equal(delivery.error, null)
      assert.equal(delivery.data.subject, `Visual subject ${engine}`)
      assert.equal(delivery.data.title, `Visual title ${engine}`)
      assert.ok(delivery.data.design)
      await page.getByRole('button', { name: 'Återställ originalutseendet', exact: true }).click()
      await publish(page)
      const restored = await service.rpc('email_template_for_delivery', {
        p_template: 'customer_confirmation',
        p_lang: 'sv',
      })
      assert.equal(restored.data.design ?? null, null)
    },
  )

  await test(
    'legacy-person-profile-stays-consistent-with-new-editor',
    owner.session,
    async (page) => {
      const initial = await api({ operation: 'state' }),
        person = initial.document.barbers[0]
      assert.ok(person)
      await studio(page)
      await resources(page)
      await nav(page, person.name).click()
      await field(page, 'Presentation · SV').fill(`Presentation ${engine}`)
      await page
        .getByLabel('Redigeringsspråk')
        .getByRole('button', { name: 'EN', exact: true })
        .click()
      await field(page, 'Presentation · EN').fill(`Biography ${engine}`)
      await publish(page)
      const stored = (
        await db.query('select bio_sv,bio_en from public.barbers where id=$1', [person.id])
      ).rows[0]
      assert.equal(stored.bio_sv, `Presentation ${engine}`)
      assert.equal(stored.bio_en, `Biography ${engine}`)
      await page.getByRole('button', { name: '← Admin', exact: true }).click()
      await expect(page.locator('#admin-nav-tabs')).toBeVisible()
      assert.equal(await page.locator('#admin-nav-tabs button').count(), 11)
    },
  )
}
