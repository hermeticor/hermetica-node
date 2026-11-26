import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createLiteClient } from './lite.ts';

describe('lite client', () => {
  it('reads HERMETICA_KEY / HERMETICA_URL, posts the event with profile, and keys writes for retries', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ accepted: 1, duplicates: 0, rejected: [] }), { status: 202 }); }) as unknown as typeof globalThis.fetch;
    const hm = createLiteClient({ fetch }, { HERMETICA_KEY: 'hm_sk_x', HERMETICA_URL: 'https://h.test/' });
    expect((await hm.track({ name: 'signed_up', profile: { externalId: 'u1' } })).accepted).toBe(1);
    const h = new Headers(calls[0]!.init.headers);
    expect([calls[0]!.url, h.get('authorization'), JSON.parse(String(calls[0]!.init.body)).profile.externalId]).toEqual(['https://h.test/v1/events', 'Bearer hm_sk_x', 'u1']);
    expect(h.get('idempotency-key')).toBeTruthy();
    expect(() => createLiteClient({}, {})).toThrow(/no API key/);
  });

  it('transactional.send posts typed JSON to /v1/transactional/send; sendRaw passes fromEmail and route', async () => {
    const calls: { url: string; body: Record<string, unknown>; key: string | null }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), key: new Headers(init.headers).get('idempotency-key') });
      return new Response(JSON.stringify({ results: [{ recipient: 'a@x.test', jobId: 'j1', status: 'queued' }] }), { status: 202 });
    }) as unknown as typeof globalThis.fetch;
    const hm = createLiteClient({ apiKey: 'hm_sk_x', baseUrl: 'https://h.test', fetch });
    const r = await hm.transactional.send({ to: [{ email: 'a@x.test' }], templateId: 't1', vars: { code: '123' }, idempotencyKey: 'otp-1' });
    expect(r.results[0]!.status).toBe('queued');
    expect(calls[0]).toEqual({ url: 'https://h.test/v1/transactional/send', body: { to: [{ email: 'a@x.test' }], templateId: 't1', vars: { code: '123' } }, key: 'otp-1' });
    await hm.sendRaw({ rawMime: 'From: a@x.test\r\n\r\nhi', to: ['b@x.test'], fromEmail: 'news@x.test', route: { connectionId: 'c1' } });
    expect([calls[1]!.url, calls[1]!.body.fromEmail, calls[1]!.body.route, !!calls[1]!.key]).toEqual(['https://h.test/v1/transactional/send-raw', 'news@x.test', { connectionId: 'c1' }, true]);
  });

  it('imports no zod anywhere in its module graph (hosts on zod 3 or none can use it)', () => {
    for (const f of ['lite.ts', 'http.ts', 'signature.ts']) expect(readFileSync(new URL(f, import.meta.url), 'utf8')).not.toMatch(/from '(zod|@hermetica\/contracts)/);
    expect(new Set(readFileSync(new URL('lite.ts', import.meta.url), 'utf8').match(/from '\.\/[\w-]+\.ts'/g))).toEqual(new Set(["from './http.ts'", "from './signature.ts'"]));
  });
});
