import { randomUUID } from 'node:crypto'
import type { QueryResult } from 'pg'
import { describe, expect, it } from 'vitest'
import type { CmsState } from '../../shared/cms'
import { readEnvVars, withClient } from './_helpers'

// The publisher must recheck authority after its last lock wait. A request can pass the
// initial check before another transaction disables, resets or demotes its owner.
const env = readEnvVars('SUPABASE_DB_URL')

describe.skipIf(env === null)('CMS publication authority after lock waits', () => {
  const revocations = [
    { label: 'disabled account', enabled: false, passwordChange: false, role: 'owner' },
    { label: 'password reset required', enabled: true, passwordChange: true, role: 'owner' },
    { label: 'owner demoted to barber', enabled: true, passwordChange: false, role: 'barber' },
  ] as const

  for (const lock of ['content table', 'site row'] as const) {
    for (const revoked of revocations) {
      for (const replay of [false, true]) {
        it(`rejects ${revoked.label} on ${replay ? 'exact replay' : 'publication'} after waiting on the ${lock}`, async () => {
          if (!env) throw new Error('Local Supabase database required')
          const dbUrl = env.SUPABASE_DB_URL
          const hostname = new URL(dbUrl).hostname
          if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname))
            throw new Error('CMS concurrency fixtures require a local database')

          const actor = randomUUID()
          const requestId = randomUUID()
          await withClient(dbUrl, async (control) => {
            try {
              await control.query('insert into auth.users(id,email) values($1,$2)', [
                actor,
                `cms-lock-${actor}@example.invalid`,
              ])
              await control.query(
                `insert into public.profiles(id,role,account_enabled,must_change_password)
               values($1,'owner',true,false)`,
                [actor],
              )
              const state = (
                await control.query<{ state: CmsState }>(
                  'select public.internal_cms_state($1) as state',
                  [actor],
                )
              ).rows[0]?.state
              if (!state) throw new Error('CMS state missing')

              if (replay) {
                // A retained committed request: the replay branch must also run behind the final
                // authority check. Its fixture row does not change the authoritative site head.
                await control.query(
                  `insert into public.cms_revisions(
                   revision,actor_id,request_id,request_fingerprint,document,fingerprint,summary)
                 select greatest(coalesce(max(revision),0),$4::bigint)+1,$1,$2,md5($3::jsonb::text),
                   $3::jsonb,md5($3::jsonb::text),'Replay authorization fixture'
                 from public.cms_revisions`,
                  [actor, requestId, JSON.stringify(state.document), state.revision],
                )
              }

              await withClient(dbUrl, async (holder) => {
                await withClient(dbUrl, async (publisher) => {
                  const holderPid = (
                    await holder.query<{ pid: number }>('select pg_backend_pid() as pid')
                  ).rows[0]?.pid
                  const publisherPid = (
                    await publisher.query<{ pid: number }>('select pg_backend_pid() as pid')
                  ).rows[0]?.pid
                  let pending: Promise<QueryResult<{ state: CmsState }>> | undefined
                  await holder.query('begin')
                  await publisher.query('begin')
                  try {
                    await publisher.query("set local statement_timeout='10s'")
                    await publisher.query('set local role service_role')
                    await holder.query(
                      lock === 'content table'
                        ? 'lock table public.barbers in share row exclusive mode'
                        : 'select revision from public.cms_site where id for update',
                    )
                    pending = publisher.query<{ state: CmsState }>(
                      'select public.internal_cms_publish($1,$2::jsonb,$3,$4,$5) as state',
                      [
                        actor,
                        JSON.stringify(state.document),
                        state.revision,
                        state.fingerprint,
                        requestId,
                      ],
                    )
                    // Observe this promise below, including when the lock-wait assertion fails.
                    void pending.catch(() => undefined)
                    await expect
                      .poll(
                        async () =>
                          (
                            await control.query<{ blocked: boolean }>(
                              'select $1::int = any(pg_blocking_pids($2::int)) as blocked',
                              [holderPid, publisherPid],
                            )
                          ).rows[0]?.blocked,
                        { timeout: 5000, interval: 20 },
                      )
                      .toBe(true)

                    // Autocommit on a third connection makes revocation visible before unblocking.
                    await control.query(
                      `update public.profiles set account_enabled=$2,must_change_password=$3,role=$4
                     where id=$1`,
                      [actor, revoked.enabled, revoked.passwordChange, revoked.role],
                    )
                    await holder.query('rollback')
                    await expect(pending).rejects.toMatchObject({
                      code: '42501',
                      message: 'CMS owner required',
                    })
                  } finally {
                    // Release the blocker before draining the pending query, then undo any write
                    // even when a broken publisher succeeds and the rejection assertion fails.
                    await holder.query('rollback')
                    await pending?.catch(() => undefined)
                    await publisher.query('rollback')
                  }
                })
              })
              expect(
                (
                  await control.query<{ revision: string; fingerprint: string }>(
                    `select revision::text,md5(public.internal_cms_document()::text) as fingerprint
                   from public.cms_site where id`,
                  )
                ).rows,
              ).toEqual([{ revision: String(state.revision), fingerprint: state.fingerprint }])
            } finally {
              await control.query(
                'delete from public.cms_revisions where request_id=$1 and actor_id=$2',
                [requestId, actor],
              )
              await control.query('delete from public.profiles where id=$1', [actor])
              await control.query('delete from auth.users where id=$1', [actor])
            }
          })
        })
      }
    }
  }
})
