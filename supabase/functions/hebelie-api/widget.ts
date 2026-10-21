import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requireStaff } from "./auth.ts";
import { KEY_FIELDS, MAX_ACTIVE_KEYS, newPublicKey, provisionDefaultKey, type WidgetKeyRecord } from "./keys.ts";
import { forgetTenant } from "./tenancy.ts";

// The desk's half of the widget: which keys a clinic has, minting another one,
// and killing one that leaked. The widget itself needs none of this, because a
// pasted snippet only ever carries the public key.

const LABEL_MAX = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// The public key is handed back in full on purpose: it is visible in the clinic's
// own HTML, and a desk that masks it would only make copy-paste harder.
function presentKey(row: WidgetKeyRecord) {
  return {
    id: row.id,
    publicKey: row.public_key,
    label: row.label || "",
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

async function activeKeys(supabase: SupabaseClient, accountId: string) {
  const { data, error } = await supabase
    .from("widget_keys")
    .select(KEY_FIELDS)
    .eq("account_id", accountId)
    .is("revoked_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []) as WidgetKeyRecord[];
}

// GET /admin/widget
export async function adminWidget(supabase: SupabaseClient, req: Request, cors: Record<string, string>) {
  const actor = await requireStaff(supabase, req, cors);
  if (actor instanceof Response) return actor;

  // Always the caller's own clinic, even for the platform admin. Keys belong to
  // a tenant, and a platform admin reaches other clinics through /accounts;
  // reading someone else's embed key from here would be a cross-tenant read that
  // no screen needs.
  const accountId = actor.account.id;
  let keys = await activeKeys(supabase, accountId);

  if (!keys.length) {
    // Self-heal, not rotation: an account with any key history keeps whatever it
    // decided. See provisionDefaultKey.
    await provisionDefaultKey(supabase, accountId);
    keys = await activeKeys(supabase, accountId);
  }

  return reply(cors, 200, {
    account: { name: actor.account.name, slug: actor.account.slug },
    keys: keys.map(presentKey),
    maxActiveKeys: MAX_ACTIVE_KEYS,
  });
}

// POST /admin/widget/keys
export async function createWidgetKey(
  supabase: SupabaseClient,
  req: Request,
  body: Record<string, unknown>,
  cors: Record<string, string>,
) {
  const actor = await requireStaff(supabase, req, cors);
  if (actor instanceof Response) return actor;

  const accountId = actor.account.id;
  const existing = await activeKeys(supabase, accountId);
  if (existing.length >= MAX_ACTIVE_KEYS) {
    return reply(cors, 409, {
      error: `This clinic already has ${MAX_ACTIVE_KEYS} active keys. Revoke one first.`,
    });
  }

  const label = text(body.label, LABEL_MAX);
  const { data, error } = await supabase
    .from("widget_keys")
    .insert({ account_id: accountId, public_key: newPublicKey(), label: label || null })
    .select(KEY_FIELDS)
    .single();
  if (error) throw error;

  return reply(cors, 200, { key: presentKey(data as WidgetKeyRecord) });
}

// POST /admin/widget/keys/revoke
export async function revokeWidgetKey(
  supabase: SupabaseClient,
  req: Request,
  body: Record<string, unknown>,
  cors: Record<string, string>,
) {
  const actor = await requireStaff(supabase, req, cors);
  if (actor instanceof Response) return actor;

  const id = text(body.id, 40);
  // Rejecting a malformed id here keeps a bad value from reaching Postgres as a
  // uuid cast, which would surface as a 500 for what is really a stale button.
  if (!UUID.test(id)) return reply(cors, 400, { error: "That key was not recognised" });

  // Matching the account as well as the id means an id learned from somewhere
  // else cannot revoke another clinic's key. `is revoked_at null` makes a second
  // press a no-op instead of moving the timestamp.
  const { data, error } = await supabase
    .from("widget_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("account_id", actor.account.id)
    .is("revoked_at", null)
    .select("public_key")
    .maybeSingle();
  if (error) throw error;
  if (!data) return reply(cors, 404, { error: "That key is already gone" });

  // Without this the cached tenant would keep answering for up to a minute,
  // which is a long time for a key someone revoked because it leaked.
  forgetTenant(data.public_key);

  return reply(cors, 200, { ok: true });
}
