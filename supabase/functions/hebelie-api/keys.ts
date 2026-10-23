import { type SupabaseClient } from "npm:@supabase/supabase-js@2";

// A widget key is a public name, not a password. It ships in the clinic's HTML
// and any visitor can read it, so hiding it buys nothing. What caps abuse is the
// ability to revoke it, the per-tenant HOUR_LIMIT, and account_treatments
// keeping a clinic from previewing something it does not sell.
//
// This module deliberately imports nothing from auth.ts or tenancy.ts: auth.ts
// calls provisionDefaultKey at signup, and tenancy.ts already imports auth.ts.
// Adding a local import here would close that cycle.

// A desk with twenty keys is a desk that has lost track of its keys. Ten leaves
// room for a site rebuild or a second landing page without turning revocation
// into a guessing game.
export const MAX_ACTIVE_KEYS = 10;

export const KEY_FIELDS =
  "id, public_key, label, created_at, last_used_at, last_parent_origin, last_parent_at, cta_label, launcher_position, theme";

export type WidgetKeyRecord = {
  id: string;
  public_key: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  // Where the widget was framed from. last_used_at cannot answer that, because
  // the desk's own preview bumps it too; see tenancy.ts.
  last_parent_origin: string | null;
  last_parent_at: string | null;
  // What the installed launcher says and how it looks. Set by the desk's Install
  // tab, read by widget/embed.js. See migration 20261022120000_widget_button.sql.
  cta_label: string;
  launcher_position: string;
  theme: string;
};

/* The three settings the installer owns, and the values each one accepts. They
   live here rather than in widget.ts because three callers need the same
   vocabulary: the desk's API, the tenant lookup the frame reads, and the
   migration's check constraints. */
export const CTA_LABEL_MAX = 40;
export const DEFAULT_CTA_LABEL = "Preview a treatment";
export const LAUNCHER_POSITIONS = ["bottom-right", "bottom-left"];
export const WIDGET_THEMES = ["light", "dark", "auto"];

export type WidgetButton = {
  label: string;
  position: string;
  theme: string;
};

/* Every fallback here is the column's own default, so a row read before
   migration 20261022120000 (a function deployed ahead of it) still draws a
   button instead of failing the whole config call. */
export function buttonOf(row: Record<string, unknown> | null | undefined): WidgetButton {
  const source = row || {};
  const label = typeof source.cta_label === "string" ? source.cta_label.replace(/\s+/g, " ").trim() : "";
  const position = String(source.launcher_position || "");
  const theme = String(source.theme || "");
  return {
    label: label.slice(0, CTA_LABEL_MAX) || DEFAULT_CTA_LABEL,
    position: LAUNCHER_POSITIONS.includes(position) ? position : "bottom-right",
    theme: WIDGET_THEMES.includes(theme) ? theme : "light",
  };
}

// `pk_live_` makes a key recognisable in a support thread and greppable in a
// page's source. The rest is the 28 hex characters of a UUID, which is 112 bits
// of randomness: a key is never a secret worth guessing, but it is also never
// going to collide with another clinic's.
export function newPublicKey() {
  return "pk_live_" + crypto.randomUUID().replace(/-/g, "");
}

// One account, one default key, however many times this runs.
//
// Only an account with no key history at all is provisioned. An account whose
// keys were all revoked made a decision, and minting a replacement behind its
// back would quietly undo it; the desk shows a Create button instead. The same
// rule makes this idempotent on a double page load, and it heals the one case
// that needs healing: a signup whose key insert failed, which auth.ts swallows
// so a signup can never fail over a widget key.
export async function provisionDefaultKey(
  supabase: SupabaseClient,
  accountId: string,
  label = "Default",
) {
  const { data: history, error: readError } = await supabase
    .from("widget_keys")
    .select("id")
    .eq("account_id", accountId)
    .limit(1);
  if (readError) throw readError;
  if (history && history.length) return null;

  const { data, error } = await supabase
    .from("widget_keys")
    .insert({ account_id: accountId, public_key: newPublicKey(), label })
    .select(KEY_FIELDS)
    .single();
  if (error) throw error;
  return data as WidgetKeyRecord;
}
