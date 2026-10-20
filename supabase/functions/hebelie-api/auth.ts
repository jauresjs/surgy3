import { type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const PLATFORM_ADMIN_EMAIL = "tjaures.js@gmail.com";
const PASSWORD_ITERATIONS = 120_000;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function authJson(status: number, body: unknown, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function b64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(s: string) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function normalizeEmail(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    throw new HttpError(400, "Use a valid email");
  }
  return email;
}

function normalizePassword(value: unknown) {
  const password = String(value || "");
  if (password.length < 8 || password.length > 200) throw new HttpError(400, "Use at least 8 characters");
  return password;
}

function slugify(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PASSWORD_ITERATIONS);
  return `pbkdf2$${PASSWORD_ITERATIONS}$${b64url(salt)}$${b64url(hash)}`;
}

async function passwordMatches(password: string, stored: string) {
  const [algo, iter, saltPart, hashPart] = stored.split("$");
  const iterations = Number(iter);
  if (algo !== "pbkdf2" || !saltPart || !hashPart || !Number.isFinite(iterations) || iterations < 100_000) return false;
  const expected = b64urlDecode(hashPart);
  const actual = await pbkdf2(password, b64urlDecode(saltPart), iterations);
  if (actual.length !== expected.length) return false;
  let out = 0;
  for (let i = 0; i < actual.length; i++) out |= actual[i] ^ expected[i];
  return out === 0;
}

async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function openSession(supabase: SupabaseClient, staffId: string) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const { error } = await supabase.from("staff_sessions").insert({
    staff_user_id: staffId,
    token_hash: await sha256Hex(token),
    expires_at: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
  });
  if (error) throw new Error("Could not sign in");
  return token;
}

type Account = { id: string; name: string; slug: string; status: string };

export type Actor = {
  staffId: string;
  email: string;
  platform: boolean;
  account: Account;
};

function profile(email: string, account: Account, token?: string) {
  return {
    token,
    email,
    clinicName: account.name,
    platform: email === PLATFORM_ADMIN_EMAIL,
  };
}

async function createClinic(
  supabase: SupabaseClient,
  clinicName: string,
  email: string,
  password: string,
  allowPlatformEmail: boolean,
) {
  const name = clinicName.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) throw new HttpError(400, "Enter the clinic name");
  if (!allowPlatformEmail && email === PLATFORM_ADMIN_EMAIL) throw new HttpError(400, "That email is reserved");
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await supabase.from("accounts").select("id", { count: "exact", head: true }).gte("created_at", since);
  if ((count || 0) >= 30) throw new HttpError(429, "Too many new clinics. Try again in a little while.");
  const { data: existing } = await supabase.from("staff_users").select("id").eq("email", email).maybeSingle();
  if (existing) throw new HttpError(400, "An account already uses that email");
  const base = slugify(name);
  if (!base) throw new HttpError(400, "Use a clinic name with letters or numbers");
  const reserved = new Set(["hebelie", "admin", "login", "signup", "auth", "api", "desk"]);
  let slug = reserved.has(base) ? `${base}-clinic` : base;
  for (let n = 2; n < 8; n++) {
    const { data: taken } = await supabase.from("accounts").select("id").eq("slug", slug).maybeSingle();
    if (!taken) break;
    slug = `${base}-${n}`.slice(0, 48);
  }
  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .insert({ name, slug, status: "trial" })
    .select("id, name, slug, status")
    .single();
  if (accountError || !account) throw new Error("Could not create the clinic");
  const { error: planError } = await supabase.from("subscriptions").insert({
    account_id: account.id,
    status: "trialing",
  });
  if (planError) throw new Error("Could not create the clinic");
  const { data: staff, error: staffError } = await supabase
    .from("staff_users")
    .insert({
      account_id: account.id,
      email,
      role: "owner",
      password_hash: await hashPassword(password),
    })
    .select("id")
    .single();
  if (staffError || !staff) throw new Error("Could not create the clinic");
  return { account: account as Account, staffId: staff.id as string };
}

export async function signup(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
  cors: Record<string, string>,
) {
  const email = normalizeEmail(body.email);
  const password = normalizePassword(body.password);
  const created = await createClinic(supabase, String(body.clinicName || ""), email, password, true);
  const token = await openSession(supabase, created.staffId);
  return authJson(200, profile(email, created.account, token), cors);
}

export async function login(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
  cors: Record<string, string>,
) {
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const { data: staff } = await supabase
    .from("staff_users")
    .select("id, email, password_hash, account_id")
    .eq("email", email)
    .maybeSingle();
  if (!staff?.password_hash) {
    await hashPassword(password || "missing");
    return authJson(401, { error: "Email or password is wrong" }, cors);
  }
  if (!(await passwordMatches(password, staff.password_hash))) {
    return authJson(401, { error: "Email or password is wrong" }, cors);
  }
  const { data: account } = await supabase
    .from("accounts")
    .select("id, name, slug, status")
    .eq("id", staff.account_id)
    .maybeSingle();
  if (!account || account.status === "canceled") return authJson(401, { error: "Email or password is wrong" }, cors);
  const token = await openSession(supabase, staff.id);
  return authJson(200, profile(email, account as Account, token), cors);
}

export async function requireStaff(
  supabase: SupabaseClient,
  req: Request,
  cors: Record<string, string>,
): Promise<Actor | Response> {
  const token = req.headers.get("x-admin-token") || "";
  if (!token) return authJson(401, { error: "Sign in again" }, cors);
  const { data: session } = await supabase
    .from("staff_sessions")
    .select("id, expires_at, staff_user_id")
    .eq("token_hash", await sha256Hex(token))
    .maybeSingle();
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
    return authJson(401, { error: "Sign in again" }, cors);
  }
  const { data: staff } = await supabase
    .from("staff_users")
    .select("id, email, account_id")
    .eq("id", session.staff_user_id)
    .maybeSingle();
  if (!staff) return authJson(401, { error: "Sign in again" }, cors);
  const { data: account } = await supabase
    .from("accounts")
    .select("id, name, slug, status")
    .eq("id", staff.account_id)
    .maybeSingle();
  if (!account) return authJson(401, { error: "Sign in again" }, cors);
  const email = String(staff.email || "").toLowerCase();
  return {
    staffId: staff.id,
    email,
    platform: email === PLATFORM_ADMIN_EMAIL,
    account: account as Account,
  };
}

export async function me(
  supabase: SupabaseClient,
  req: Request,
  cors: Record<string, string>,
) {
  const actor = await requireStaff(supabase, req, cors);
  if (actor instanceof Response) return actor;
  return authJson(200, profile(actor.email, actor.account), cors);
}

export async function logout(
  supabase: SupabaseClient,
  req: Request,
  cors: Record<string, string>,
) {
  const token = req.headers.get("x-admin-token") || "";
  if (token) await supabase.from("staff_sessions").delete().eq("token_hash", await sha256Hex(token));
  return authJson(200, { ok: true }, cors);
}

export async function createClinicAccount(
  supabase: SupabaseClient,
  req: Request,
  body: Record<string, unknown>,
  cors: Record<string, string>,
) {
  const actor = await requireStaff(supabase, req, cors);
  if (actor instanceof Response) return actor;
  if (!actor.platform) return authJson(403, { error: "Only the Hebelie admin can create a clinic this way" }, cors);
  const email = normalizeEmail(body.email);
  const password = normalizePassword(body.password);
  const created = await createClinic(supabase, String(body.clinicName || ""), email, password, false);
  return authJson(200, { ok: true, clinicName: created.account.name, email }, cors);
}
