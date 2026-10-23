import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError, requireStaff } from "./auth.ts";
import {
  CTA_LABEL_MAX,
  DEFAULT_CTA_LABEL,
  KEY_FIELDS,
  LAUNCHER_POSITIONS,
  MAX_ACTIVE_KEYS,
  WIDGET_THEMES,
  buttonOf,
  newPublicKey,
  provisionDefaultKey,
  type WidgetKeyRecord,
} from "./keys.ts";
import { loadPromptCatalog, type Treatment } from "./prompts.ts";
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
  const button = buttonOf(row as unknown as Record<string, unknown>);
  return {
    id: row.id,
    publicKey: row.public_key,
    label: row.label || "",
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    // The desk reads these instead of lastUsedAt to decide whether a key is
    // live: only a page that is not ours can set them. See tenancy.ts.
    lastParentOrigin: row.last_parent_origin,
    lastParentAt: row.last_parent_at,
    // What the installed button says and how it looks. The Install tab edits
    // these, and widget/embed.js re-reads them from /widget/config, so an edit
    // reaches a snippet that is already pasted.
    ctaLabel: button.label,
    launcherPosition: button.position,
    theme: button.theme,
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

// The colours a clinic picked, as stored. Empty string rather than null so the
// desk's fields have one "not set" value to compare against.
async function brandOf(supabase: SupabaseClient, accountId: string) {
  const { data, error } = await supabase
    .from("accounts")
    .select("brand_primary, brand_accent")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw error;
  return {
    primary: (data?.brand_primary as string) || "",
    accent: (data?.brand_accent as string) || "",
  };
}

// The treatments this clinic sells, in the order the frame will list them.
//
// An empty account_treatments is read as "the whole catalog" — the rule
// tenancy.ts and widgetConfig already follow — so this has to fall back the same
// way. A desk that showed an empty list would be reordering nothing, and the
// first save would then quietly materialise one.
async function treatmentList(supabase: SupabaseClient, accountId: string) {
  const catalog = await loadPromptCatalog(supabase);
  const { data, error } = await supabase
    .from("account_treatments")
    .select("treatment_id")
    .eq("account_id", accountId)
    .order("sort_order", { ascending: true });
  if (error) throw error;

  const offered = (data || []).map((row) => String(row.treatment_id));
  const ids = offered.length ? offered : catalog.treatments.map((t) => t.id);
  return ids
    .map((id) => catalog.treatments.find((t) => t.id === id))
    .filter((t): t is Treatment => Boolean(t))
    .map((t) => ({ id: t.id, label: t.label }));
}

// A six-digit hex, or nothing. The frame refuses any other shape before it
// reaches a style declaration, and migration 20261022120000 carries the same
// expression as a check constraint, so a value that fails here would only become
// a 500 at the database.
const HEX = /^#[0-9a-f]{6}$/i;

function colourOf(value: unknown, field: string) {
  const colour = text(value, 9);
  if (!colour) return null;
  if (!HEX.test(colour)) throw new HttpError(400, `${field} needs a colour like #8b5e3c`);
  return colour.toLowerCase();
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

  // The Install tab configures a key and the account behind it, so one call has
  // to answer both: a second round trip would let the desk render controls that
  // describe a different clinic than the keys do.
  const [brand, treatments] = await Promise.all([
    brandOf(supabase, accountId),
    treatmentList(supabase, accountId),
  ]);

  return reply(cors, 200, {
    account: { name: actor.account.name, slug: actor.account.slug },
    keys: keys.map(presentKey),
    maxActiveKeys: MAX_ACTIVE_KEYS,
    brand,
    treatments,
  });
}

// POST /admin/widget/configure
//
// One save, three writes: the key's button, the account's brand, and the order of
// the treatments this clinic offers. supabase-js has no transaction to hand, so
// each write is ordered to fail safely on its own and the answer echoes what is
// actually stored rather than what was sent: a capped label or a treatment the
// catalog no longer has comes back the way the next page view will read it.
export async function configureWidget(
  supabase: SupabaseClient,
  req: Request,
  body: Record<string, unknown>,
  cors: Record<string, string>,
) {
  const actor = await requireStaff(supabase, req, cors);
  if (actor instanceof Response) return actor;

  const accountId = actor.account.id;
  const id = text(body.id, 40);
  // A uuid cast would surface a stale button as a 500; see revokeWidgetKey.
  if (!UUID.test(id)) return reply(cors, 400, { error: "That key was not recognised" });

  const label = text(body.ctaLabel, CTA_LABEL_MAX).replace(/\s+/g, " ") || DEFAULT_CTA_LABEL;
  const position = text(body.launcherPosition, 20);
  if (!LAUNCHER_POSITIONS.includes(position)) {
    return reply(cors, 400, { error: "A launcher sits in the bottom-right or the bottom-left corner" });
  }
  const theme = text(body.theme, 10);
  if (!WIDGET_THEMES.includes(theme)) {
    return reply(cors, 400, { error: "A widget theme is light, dark or auto" });
  }
  const primary = colourOf(body.brandPrimary, "The main colour");
  const accent = colourOf(body.brandAccent, "The accent colour");

  // Matching the account as well as the id means an id learned from somewhere
  // else cannot restyle another clinic's key, and `is revoked_at null` refuses a
  // key someone has already killed.
  const { data: key, error: keyError } = await supabase
    .from("widget_keys")
    .update({ cta_label: label, launcher_position: position, theme })
    .eq("id", id)
    .eq("account_id", accountId)
    .is("revoked_at", null)
    .select(KEY_FIELDS)
    .maybeSingle();
  if (keyError) throw keyError;
  if (!key) return reply(cors, 404, { error: "That key is already gone" });

  const { error: brandError } = await supabase
    .from("accounts")
    .update({ brand_primary: primary, brand_accent: accent })
    .eq("id", accountId);
  if (brandError) throw brandError;

  const catalog = await loadPromptCatalog(supabase);
  const known = new Set(catalog.treatments.map((t) => t.id));
  const order = (Array.isArray(body.treatmentOrder) ? body.treatmentOrder : [])
    .map((value) => text(value, 40))
    .filter((value, index, list) => known.has(value) && list.indexOf(value) === index);

  // An absent list means "this build of the desk does not reorder treatments",
  // not "sell nothing": an empty account_treatments is read as the full catalog
  // all the way down the stack, so writing one from a stale tab would publish
  // treatments the clinic does not offer.
  if (order.length) {
    const rows = order.map((treatment_id, index) => ({ account_id: accountId, treatment_id, sort_order: index }));
    // Upsert first, trim second. An interrupted save then leaves a superset of
    // what the desk showed rather than the empty set, which the frame reads as
    // "sell everything" — a much louder mistake than one extra treatment.
    const { error: upsertError } = await supabase
      .from("account_treatments")
      .upsert(rows, { onConflict: "account_id,treatment_id" });
    if (upsertError) throw upsertError;

    const keep = "(" + order.map((treatmentId) => `"${treatmentId}"`).join(",") + ")";
    const { error: trimError } = await supabase
      .from("account_treatments")
      .delete()
      .eq("account_id", accountId)
      .not("treatment_id", "in", keep);
    if (trimError) throw trimError;
  }

  // The tenant cache holds this key for a minute. Without this line the settings a
  // clinic just saved would take until then to appear on its own site, which reads
  // as "the save did not work".
  forgetTenant(key.public_key);

  return reply(cors, 200, {
    key: presentKey(key as WidgetKeyRecord),
    brand: { primary: primary || "", accent: accent || "" },
    treatments: await treatmentList(supabase, accountId),
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
