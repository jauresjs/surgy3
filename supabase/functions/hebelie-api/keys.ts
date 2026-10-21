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

export const KEY_FIELDS = "id, public_key, label, created_at, last_used_at, last_parent_origin, last_parent_at";

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
};

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
