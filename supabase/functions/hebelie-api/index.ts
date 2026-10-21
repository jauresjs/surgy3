import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError, createClinicAccount, login, logout, me, requireStaff, signup } from "./auth.ts";
import {
  buildRequest,
  labelsFor,
  loadPromptCatalog,
  normalizeTreatmentIds,
  type Treatment,
} from "./prompts.ts";
import { assertTreatmentsOffered, resolveTenant } from "./tenancy.ts";

// A custom header has to be named here or the browser fails the preflight and
// the widget's calls never leave the frame.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-admin-token, x-widget-key, x-parent-origin",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const CONSENT_TEXT = "You can contact me about this preview.";
const CONSENT_VERSION = "2026-10-21";
const HOUR_LIMIT = 40;

let settingsCache: Record<string, string> | null = null;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function db() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase is not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function settings(supabase: SupabaseClient) {
  if (settingsCache) return settingsCache;
  const { data, error } = await supabase.from("private_settings").select("key, value");
  if (error) throw error;
  settingsCache = Object.fromEntries((data || []).map((row) => [row.key, row.value]));
  return settingsCache;
}

function decodePhoto(imageDataUrl: string) {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=\s]+)$/.exec(imageDataUrl || "");
  if (!match) throw new Error("Use a JPEG portrait");
  const clean = match[1].replace(/\s/g, "");
  if (clean.length > 6_000_000) throw new Error("That photo is too large");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function routePath(req: Request) {
  const path = new URL(req.url).pathname;
  const marker = "/hebelie-api";
  const at = path.indexOf(marker);
  const rest = at >= 0 ? path.slice(at + marker.length) : path;
  return rest.replace(/\/$/, "") || "/";
}

async function readJson(req: Request) {
  const text = await req.text();
  if (text.length > 8_000_000) throw new Error("Request is too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Request could not be read");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const path = routePath(req);
  try {
    const supabase = db();
    if (req.method === "POST" && path === "/generate") return await generate(req, supabase);
    if (req.method === "POST" && path === "/leads") return await saveLead(req, supabase);
    if (req.method === "GET" && path === "/widget/config") return await widgetConfig(req, supabase);
    if (req.method === "POST" && path === "/auth/signup") return await signup(supabase, await readJson(req), cors);
    if (req.method === "POST" && path === "/auth/login") return await login(supabase, await readJson(req), cors);
    if (req.method === "GET" && path === "/auth/me") return await me(supabase, req, cors);
    if (req.method === "POST" && path === "/auth/logout") return await logout(supabase, req, cors);
    if (req.method === "POST" && path === "/accounts") return await createClinicAccount(supabase, req, await readJson(req), cors);
    if (req.method === "GET" && path === "/admin/leads") return await adminLeads(req, supabase);
    if (req.method === "GET" && path === "/admin/media") return await adminMedia(req, supabase);
    return json(404, { error: "Not found" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong";
    const status = err instanceof HttpError
      ? err.status
      : /Choose|Use a JPEG|too large|could not be read|complete|phone|email|preview first|Start again/.test(message) ? 400 : 500;
    return json(status, { error: message });
  }
});

// A logo lives in the private previews bucket, so it is exchanged for a
// short-lived signed URL instead of being published. An absolute URL is used as
// it is, which lets a tenant point at their own CDN.
async function tenantLogo(supabase: SupabaseClient, path: string | null) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  try {
    const { data } = await supabase.storage.from("previews").createSignedUrl(path, 3600);
    return data?.signedUrl || null;
  } catch {
    return null;
  }
}

// Everything the widget needs before it draws: whose brand to wear, which
// treatments this clinic actually sells, and the exact consent sentence the
// server will record. The frame never hard-codes a treatment list, so turning
// one off in the database removes it from a customer's site with no redeploy.
async function widgetConfig(req: Request, supabase: SupabaseClient) {
  const tenant = await resolveTenant(supabase, req);
  const catalog = await loadPromptCatalog(supabase);
  const offered = tenant.treatments.length ? tenant.treatments : catalog.treatments.map((t) => t.id);
  const treatments = offered
    .map((id) => catalog.treatments.find((t) => t.id === id))
    .filter((t): t is Treatment => Boolean(t))
    .map((t) => ({ id: t.id, label: t.label }));
  return json(200, {
    tenant: {
      name: tenant.name,
      slug: tenant.slug,
      brand: {
        primary: tenant.brand.primary,
        accent: tenant.brand.accent,
        tagline: tenant.brand.tagline,
        bookingUrl: tenant.brand.bookingUrl,
        logoUrl: await tenantLogo(supabase, tenant.brand.logoPath),
      },
    },
    treatments,
    consent: { text: CONSENT_TEXT, version: CONSENT_VERSION },
    maxTreatments: 3,
  });
}

async function generate(req: Request, supabase: SupabaseClient) {
  const body = await readJson(req);
  const tenant = await resolveTenant(supabase, req, body);
  const catalog = await loadPromptCatalog(supabase);
  const treatmentIds = normalizeTreatmentIds(catalog, body.treatmentIds);
  assertTreatmentsOffered(tenant, treatmentIds);
  const photoBytes = decodePhoto(body.imageDataUrl);
  const accountId = tenant.id;

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await supabase
    .from("generations")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("created_at", since);
  if ((count || 0) >= HOUR_LIMIT) return json(429, { error: "The studio is busy. Try again in a little while." });

  const expires = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  let sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (sessionId) {
    const { data: existing } = await supabase
      .from("preview_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!existing) sessionId = "";
  }
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    const photoPath = `${accountId}/${sessionId}/photo.jpg`;
    const { error: uploadError } = await supabase.storage.from("previews").upload(photoPath, photoBytes, {
      contentType: "image/jpeg",
      upsert: false,
    });
    if (uploadError) throw new Error("Could not store the portrait");
    const { error: sessionError } = await supabase.from("preview_sessions").insert({
      id: sessionId,
      account_id: accountId,
      photo_path: photoPath,
      expires_at: expires,
    });
    if (sessionError) throw new Error("Could not start the preview");
  }

  const falKey = (await settings(supabase)).fal_key;
  if (!falKey) throw new Error("Preview service is not configured");
  const falRes = await fetch("https://fal.run/fal-ai/nano-banana/edit", {
    method: "POST",
    headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildRequest(catalog, treatmentIds, "medium", body.imageDataUrl, 1)),
  });
  if (!falRes.ok) {
    await supabase.from("generations").insert({
      account_id: accountId,
      session_id: sessionId,
      treatment_ids: treatmentIds,
      intensity: "medium",
      status: "error",
    });
    return json(502, { error: "The preview could not be generated. Try again.", sessionId });
  }
  const falJson = await falRes.json();
  const resultUrl = falJson?.images?.[0]?.url;
  if (!resultUrl) {
    await supabase.from("generations").insert({
      account_id: accountId,
      session_id: sessionId,
      treatment_ids: treatmentIds,
      intensity: "medium",
      status: "error",
    });
    return json(502, { error: "The preview came back empty. Try again.", sessionId });
  }
  const resultBytes = new Uint8Array(await (await fetch(resultUrl)).arrayBuffer());
  const previewId = crypto.randomUUID();
  const resultPath = `${accountId}/${sessionId}/${previewId}.jpg`;
  const { error: resultError } = await supabase.storage.from("previews").upload(resultPath, resultBytes, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (resultError) throw new Error("Could not store the preview");
  const { error: previewError } = await supabase.from("previews").insert({
    id: previewId,
    session_id: sessionId,
    account_id: accountId,
    treatment_ids: treatmentIds,
    intensity: "medium",
    result_path: resultPath,
    expires_at: expires,
  });
  if (previewError) throw new Error("Could not save the preview");
  await supabase.from("generations").insert({
    account_id: accountId,
    session_id: sessionId,
    treatment_ids: treatmentIds,
    intensity: "medium",
    status: "ok",
  });
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < resultBytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, resultBytes.subarray(i, i + chunk));
  }
  return json(200, {
    sessionId,
    previewId,
    resultDataUrl: `data:image/jpeg;base64,${btoa(binary)}`,
  });
}

async function saveLead(req: Request, supabase: SupabaseClient) {
  const body = await readJson(req);
  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();
  const email = String(body.email || "").trim();
  const city = String(body.city || "").trim();
  const sessionId = String(body.sessionId || "");
  if (!name || !city || (!phone && !email) || body.consent !== true) {
    throw new Error(!phone && !email ? "Add a phone number or an email" : "Please complete the form");
  }
  const tenant = await resolveTenant(supabase, req, body);
  const accountId = tenant.id;
  const { data: session } = await supabase
    .from("preview_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (!session) throw new Error("Generate a preview first");
  const { data: latest } = await supabase
    .from("previews")
    .select("treatment_ids")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) throw new Error("Generate a preview first");
  const { error } = await supabase.from("leads").insert({
    account_id: accountId,
    session_id: sessionId,
    public_key_id: tenant.publicKeyId,
    channel: tenant.publicKeyId ? "widget" : "site",
    name,
    phone: phone || null,
    email: email || null,
    city,
    consent_at: new Date().toISOString(),
    consent_text: CONSENT_TEXT,
    consent_version: CONSENT_VERSION,
    treatment_ids: latest.treatment_ids,
    source_url: typeof body.sourceUrl === "string" ? body.sourceUrl.slice(0, 500) : null,
  });
  if (error) throw new Error("Could not save your details");
  return json(200, { ok: true });
}

async function adminLeads(req: Request, supabase: SupabaseClient) {
  const actor = await requireStaff(supabase, req, cors);
  if (actor instanceof Response) return actor;
  const catalog = await loadPromptCatalog(supabase);
  let query = supabase
    .from("leads")
    .select("id, name, phone, email, city, consent_at, treatment_ids, channel, created_at, session_id, source_url, account_id, accounts(name)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (!actor.platform) query = query.eq("account_id", actor.account.id);
  const { data: leads, error } = await query;
  if (error) throw error;
  const sessionIds = [...new Set((leads || []).map((lead) => lead.session_id).filter(Boolean))];
  let sessions: { id: string; photo_path: string | null }[] = [];
  let previews: { id: string; session_id: string; treatment_ids: string[]; result_path: string | null; created_at: string }[] = [];
  if (sessionIds.length) {
    const sessionRes = await supabase.from("preview_sessions").select("id, photo_path").in("id", sessionIds);
    const previewRes = await supabase
      .from("previews")
      .select("id, session_id, treatment_ids, result_path, created_at")
      .in("session_id", sessionIds)
      .order("created_at", { ascending: true });
    if (sessionRes.error) throw sessionRes.error;
    if (previewRes.error) throw previewRes.error;
    sessions = sessionRes.data || [];
    previews = previewRes.data || [];
  }
  return json(200, {
    leads: (leads || []).map((lead) => {
      const session = sessions.find((item) => item.id === lead.session_id);
      const accountRecord = Array.isArray(lead.accounts) ? lead.accounts[0] : lead.accounts;
      return {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        city: lead.city,
        channel: lead.channel,
        consentAt: lead.consent_at,
        createdAt: lead.created_at,
        sourceUrl: lead.source_url,
        accountName: accountRecord?.name || "",
        treatments: labelsFor(catalog, lead.treatment_ids || []),
        photoPath: session?.photo_path || null,
        previews: previews
          .filter((preview) => preview.session_id === lead.session_id)
          .map((preview) => ({
            id: preview.id,
            treatments: labelsFor(catalog, preview.treatment_ids || []),
            resultPath: preview.result_path,
            createdAt: preview.created_at,
          })),
      };
    }),
  });
}

async function adminMedia(req: Request, supabase: SupabaseClient) {
  const actor = await requireStaff(supabase, req, cors);
  if (actor instanceof Response) return actor;
  const path = new URL(req.url).searchParams.get("path") || "";
  const match = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/(photo|[0-9a-f-]{36})\.jpg$/i.exec(path);
  if (!match || (!actor.platform && match[1] !== actor.account.id)) return json(404, { error: "Image not found" });
  const accountId = match[1];
  const { data: session } = await supabase
    .from("preview_sessions")
    .select("id")
    .eq("id", match[2])
    .eq("account_id", accountId)
    .maybeSingle();
  if (!session) return json(404, { error: "Image not found" });
  const { data, error } = await supabase.storage.from("previews").download(path);
  if (error || !data) return json(404, { error: "Image not found" });
  return new Response(data, {
    headers: { ...cors, "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300" },
  });
}
