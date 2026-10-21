import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./auth.ts";

// Which clinic a request belongs to is decided per request, never by a constant.
//
// A widget request carries a public key. The clinic's own site carries nothing,
// so it falls back to DEFAULT_ACCOUNT_SLUG, which keeps the current Hebelie
// deployment working exactly as before.
//
// The resolved tenant is cached in memory for a minute per isolate. A revoked
// key therefore stops working within a minute, which is the same trade the
// settings and prompt caches already make.

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: string;
  brand: {
    primary: string | null;
    accent: string | null;
    tagline: string | null;
    bookingUrl: string | null;
    logoPath: string | null;
  };
  // Treatment ids this tenant sells. An empty list means the full catalog.
  treatments: string[];
  // Origins this tenant has claimed. An origin only counts once verified.
  origins: string[];
  publicKeyId: string | null;
};

const ACCOUNT_FIELDS = "id, name, slug, status, brand_primary, brand_accent, tagline, booking_url, logo_path";
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; tenant: Tenant }>();

function defaultSlug() {
  return Deno.env.get("DEFAULT_ACCOUNT_SLUG") || "hebelie";
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// A key can arrive three ways: a header (the widget's own fetch), a body field
// (the clinic's site, which has no header plumbing) and a query string (the
// config call the widget makes before it has any other state).
function publicKeyOf(req: Request, body: Record<string, unknown>) {
  const fromQuery = new URL(req.url).searchParams.get("key") || "";
  return (
    text(req.headers.get("x-widget-key"), 120) ||
    text(body.publicKey, 120) ||
    text(fromQuery, 120)
  );
}

function normalizeOrigin(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "").toLowerCase();
  if (!/^https?:\/\/[a-z0-9.-]+(:[0-9]{1,5})?$/.test(trimmed)) return "";
  return trimmed;
}

function requestOrigin(req: Request) {
  return normalizeOrigin(req.headers.get("origin") || "");
}

// The widget lives in an iframe served from Hebelie's own host, so the browser
// reports *that* host in Origin. The page doing the embedding reports itself
// through x-parent-origin, and the widget fills it from postMessage's
// event.origin. That value is the parent's real origin when the frame set it,
// but a direct API caller can send any header it likes, so this allow-list
// stops a misplaced snippet rather than a determined attacker. Revoking a key
// and HOUR_LIMIT are what actually cap abuse.
function embedderOrigin(req: Request) {
  return normalizeOrigin(req.headers.get("x-parent-origin") || "") || requestOrigin(req);
}

async function loadTenant(supabase: SupabaseClient, account: Record<string, unknown>, publicKeyId: string | null) {
  const accountId = String(account.id);
  const [offered, claimed] = await Promise.all([
    supabase
      .from("account_treatments")
      .select("treatment_id")
      .eq("account_id", accountId)
      .order("sort_order", { ascending: true }),
    supabase.from("domains").select("origin, verified_at").eq("account_id", accountId),
  ]);
  if (offered.error) throw offered.error;
  if (claimed.error) throw claimed.error;

  return {
    id: accountId,
    name: String(account.name || ""),
    slug: String(account.slug || ""),
    status: String(account.status || "trial"),
    brand: {
      primary: (account.brand_primary as string) || null,
      accent: (account.brand_accent as string) || null,
      tagline: (account.tagline as string) || null,
      bookingUrl: (account.booking_url as string) || null,
      logoPath: (account.logo_path as string) || null,
    },
    treatments: (offered.data || []).map((row) => String(row.treatment_id)),
    origins: (claimed.data || [])
      .filter((row) => row.verified_at)
      .map((row) => normalizeOrigin(String(row.origin)))
      .filter(Boolean),
    publicKeyId,
  } satisfies Tenant;
}

// Our own pages are not a tenant's site, and a clinic cannot make one of them
// look like its own: `domains` belongs to the tenant, this list does not.
//
// Two sources, both configuration rather than data:
//   - the host this function is served from, which is where the API itself
//     lives and which no third-party page can claim;
//   - WIDGET_FIRST_PARTY_ORIGINS, a comma-separated list of the hosts we serve
//     our own pages from (the desk, and the preview page behind /p/<key>).
//
// The desk previews the widget from the desk's own origin, so without this the
// first clinic to verify a domain would lock the desk out of its own preview —
// and a hosted preview page would break the same way the day it ships.
const ENV_FIRST_PARTY = "WIDGET_FIRST_PARTY_ORIGINS";

function ownOrigin(req: Request) {
  try {
    const url = new URL(req.url);
    return normalizeOrigin(`${url.protocol}//${url.host}`);
  } catch {
    return "";
  }
}

function firstPartyOrigins(req: Request) {
  const configured = (Deno.env.get(ENV_FIRST_PARTY) || "")
    .split(",")
    .map((value) => normalizeOrigin(value))
    .filter(Boolean);
  const own = ownOrigin(req);
  return own ? [own, ...configured] : configured;
}

// True when the page doing the framing is one of ours. A caller with no origin
// at all is not first party, but `assertOriginAllowed` lets it through anyway:
// it is not a browser, and a third-party page cannot make one.
export function isFirstParty(req: Request) {
  const origin = embedderOrigin(req);
  return Boolean(origin) && firstPartyOrigins(req).includes(origin);
}

// A widget may only be called from an origin the tenant has proven it owns.
// A tenant with no verified origin yet is not restricted, because it has not
// claimed anything to be restricted to. A call with no origin at all
// (server to server, curl, health checks) is not a browser and cannot be
// spoofed by a third-party page, so it is allowed through.
export function assertOriginAllowed(req: Request, tenant: Tenant) {
  if (!tenant.origins.length) return;
  const origin = embedderOrigin(req);
  if (!origin) return;
  // Our own desk and preview pages keep working whatever a clinic has claimed.
  if (isFirstParty(req)) return;
  if (!tenant.origins.includes(origin)) {
    throw new HttpError(403, "This site is not allowed to use this widget");
  }
}

// Keep a tenant inside the treatments it actually sells.
export function assertTreatmentsOffered(tenant: Tenant, treatmentIds: string[]) {
  if (!tenant.treatments.length) return;
  for (const id of treatmentIds) {
    if (!tenant.treatments.includes(id)) {
      throw new HttpError(400, "That treatment is not offered here");
    }
  }
}

export async function resolveTenant(
  supabase: SupabaseClient,
  req: Request,
  body: Record<string, unknown> = {},
): Promise<Tenant> {
  const publicKey = publicKeyOf(req, body);
  const slug = text(body.tenant, 40) || defaultSlug();
  const cacheKey = publicKey ? `key:${publicKey}` : `slug:${slug}`;

  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    assertOriginAllowed(req, cached.tenant);
    return cached.tenant;
  }

  let account: Record<string, unknown> | null = null;
  let publicKeyId: string | null = null;

  if (publicKey) {
    const { data, error } = await supabase
      .from("widget_keys")
      .select(`id, accounts (${ACCOUNT_FIELDS})`)
      .eq("public_key", publicKey)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) throw error;
    const record = Array.isArray(data?.accounts) ? data?.accounts[0] : data?.accounts;
    if (!data || !record) throw new HttpError(401, "This widget key is not valid");
    account = record as Record<string, unknown>;
    publicKeyId = String(data.id);
    const now = new Date().toISOString();
    /* A page of our own — the desk's preview — says nothing about the clinic's
       site, so it stamps usage but not an origin. That is the difference between
       "used" and "live", and it is what lets the Install tab report the second
       without counting its own preview. */
    /* Only the header counts here. embedderOrigin falls back to this request's
       own Origin, and a frame opened on its own (a pasted frame URL, a suppressed
       referrer) reports our widget host that way — which is not a clinic site. */
    const parentOrigin = normalizeOrigin(req.headers.get("x-parent-origin") || "");
    const fromClinic = Boolean(parentOrigin) && !isFirstParty(req);
    const stamp: Record<string, unknown> = { last_used_at: now };
    if (fromClinic) {
      stamp.last_parent_origin = parentOrigin;
      stamp.last_parent_at = now;
    }
    const { error: stampError } = await supabase
      .from("widget_keys")
      .update(stamp)
      .eq("id", publicKeyId);
    /* A function deployed ahead of migration 20261021140000 has no new columns
       to write. Retrying with the older shape keeps the one thing this line did
       before — recording that the key was used — instead of losing both. */
    if (stampError && fromClinic) {
      await supabase
        .from("widget_keys")
        .update({ last_used_at: now })
        .eq("id", publicKeyId);
    }
  } else {
    const { data, error } = await supabase
      .from("accounts")
      .select(ACCOUNT_FIELDS)
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "That clinic was not found");
    account = data as Record<string, unknown>;
  }

  if (account!.status === "canceled") throw new HttpError(403, "This account is not active");

  const tenant = await loadTenant(supabase, account!, publicKeyId);
  cache.set(cacheKey, { at: Date.now(), tenant });
  assertOriginAllowed(req, tenant);
  return tenant;
}

// The admin app needs the same cache to drop a tenant after a settings change.
export function forgetTenant(publicKey: string) {
  if (publicKey) cache.delete(`key:${publicKey}`);
}
