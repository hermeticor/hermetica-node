import { randomUUID } from 'node:crypto';
import { type ClientOptions, createTransport } from './http.ts';
import { verifyHermeticaSignature } from './signature.ts';

/**
 * HM-I2: the calls a product's server makes, with no schema library and plain TS types (`@hermeticor/sdk-node/lite`).
 * Same transport as the full client: retries on 429/5xx, timeout, an Idempotency-Key on every write.
 * Reads HERMETICA_URL (or HERMETICA_API_URL) and HERMETICA_API_KEY (or HERMETICA_KEY) unless given.
 */
export { HermeticaError } from './http.ts';
export const verifySignature = verifyHermeticaSignature;

/** A person's ids: at least one. */
export interface Identifiers { externalId?: string; email?: string; phone?: string; anonymousId?: string }
export interface TrackEvent {
  name: string;
  /** Same key = same event (retries and replays are dropped). */
  dedupeKey?: string;
  /** Creates or updates the person (needs profiles:write); identifiers plus attributes such as firstName. */
  profile?: Identifiers & Record<string, unknown>;
  identifiers?: Identifiers;
  properties?: Record<string, unknown>;
  occurredAt?: string;
}
/** Connection, pool or route policy to send through; default: the workspace's transactional route policy. */
export interface SendRoute { connectionId?: string; poolId?: string; routePolicyId?: string }
export interface SendRaw {
  rawMime: string;
  to: string[];
  /** Overrides the From address; must be a verified sender. */
  fromEmail?: string;
  fromName?: string;
  route?: SendRoute;
  tags?: string[];
  idempotencyKey?: string;
}
/** A recipient: exactly one of email, phone, profileId or externalId. */
export interface SendRecipient {
  email?: string; phone?: string; profileId?: string; externalId?: string; name?: string;
  /** Merge vars for this recipient only. */
  vars?: Record<string, unknown>;
  consent?: 'record_optin' | 'require';
}
/** POST /v1/transactional/send: exactly one of templateId or inline html/text. The common fields; see the API reference for the rest. */
export interface TransactionalSend {
  channel?: 'email' | 'sms' | 'whatsapp' | 'push' | 'postcard';
  to: SendRecipient[];
  templateId?: string;
  versionId?: string;
  subject?: string;
  html?: string;
  text?: string;
  vars?: Record<string, unknown>;
  from?: { email: string; name?: string };
  /** Up to 5 addresses, comma separated. */
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  headers?: Record<string, string>;
  attachments?: { filename: string; contentType: string; contentBase64: string; cid?: string }[];
  purpose?: 'transactional' | 'marketing';
  topicId?: string;
  tags?: string[];
  metadata?: Record<string, string>;
  tracking?: { opens?: boolean; clicks?: boolean };
  scheduledFor?: string;
  route?: SendRoute;
  batchId?: string;
  /** Applied per recipient; a retry with the same key never sends twice. Generated when absent. */
  idempotencyKey?: string;
}
export interface SendResult {
  results: { recipient: string; jobId: string | null; status: 'queued' | 'scheduled' | 'rejected' | 'invalid' | 'duplicate'; reason?: string | null; detail?: string; note?: string }[];
}
export type LiteOptions = Partial<ClientOptions>;

export function createLiteClient(o: LiteOptions = {}, env: Record<string, string | undefined> = process.env) {
  const apiKey = o.apiKey ?? env.HERMETICA_API_KEY ?? env.HERMETICA_KEY;
  if (!apiKey) throw new Error('Hermeticor: no API key (pass apiKey, or set HERMETICA_API_KEY)');
  const http = createTransport({ ...o, apiKey, baseUrl: o.baseUrl ?? env.HERMETICA_URL ?? env.HERMETICA_API_URL ?? 'https://hermeticor.com' });
  // Every write carries a key, so the transport may retry it after a 5xx without doubling it.
  const key = (k?: string) => ({ idempotencyKey: k ?? randomUUID() });
  return {
    /** One call signs a person up: the event with `profile` creates or updates them. */
    track: (e: TrackEvent) => http<{ accepted: number; duplicates: number; rejected: { index: number; reason: string }[] }>('POST', '/v1/events', { body: e, ...key(e.dedupeKey && `event:${e.dedupeKey}`) }),
    identify: (identifiers: Identifiers, attributes: Record<string, unknown> = {}) =>
      http<{ profile: { id: string }; created: boolean }>('POST', '/v1/profiles/upsert', { body: { identifiers, attributes }, ...key() }),
    sendRaw: ({ idempotencyKey, ...body }: SendRaw) => http<SendResult>('POST', '/v1/transactional/send-raw', { body, ...key(idempotencyKey) }),
    transactional: {
      send: ({ idempotencyKey, ...body }: TransactionalSend) => http<SendResult>('POST', '/v1/transactional/send', { body, ...key(idempotencyKey) }),
    },
    /** The person left this app: its data about them goes, shared consent and suppressions stay. Idempotent. */
    forgetApp: (externalId: string, app?: string) =>
      http<{ found?: boolean; profileDeleted: boolean }>('POST', `/v1/profiles/by/external_id/${encodeURIComponent(externalId)}/forget-app`, { body: app ? { app } : {}, ...key() }),
  };
}

let shared: ReturnType<typeof createLiteClient> | undefined;
const client = () => (shared ??= createLiteClient());
export const track = (e: TrackEvent) => client().track(e);
export const identify = (identifiers: Identifiers, attributes?: Record<string, unknown>) => client().identify(identifiers, attributes);
export const sendRaw = (m: SendRaw) => client().sendRaw(m);
export const forgetApp = (externalId: string, app?: string) => client().forgetApp(externalId, app);
export const transactional = { send: (m: TransactionalSend) => client().transactional.send(m) };
