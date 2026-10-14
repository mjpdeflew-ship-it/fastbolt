const rawConfig = typeof window !== "undefined" ? (window.BH_CONFIG || {}) : {};
const trim = value => typeof value === "string" ? value.trim() : "";
const supabaseUrl = trim(rawConfig.SUPABASE_URL).replace(/\/+$/, "");

export const CFG = Object.freeze({
  SUPABASE_URL: supabaseUrl,
  SUPABASE_ANON_KEY: trim(rawConfig.SUPABASE_ANON_KEY),
  WHATSAPP: trim(rawConfig.WHATSAPP)
});

const STORAGE_KEY = "bh-supabase-auth-v1";
const PAGE_SIZE = 1000;
let refreshInFlight = null;

function requireConfig({ auth = false } = {}) {
  if (!CFG.SUPABASE_URL) throw new Error("Supabase is not configured. Edit config.js first.");
  if (!/^https:\/\//i.test(CFG.SUPABASE_URL)) throw new Error("SUPABASE_URL must be an HTTPS URL.");
  if (auth && !CFG.SUPABASE_ANON_KEY) throw new Error("Supabase publishable/anon key is missing from config.js.");
}

function readStoredSession() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function writeStoredSession(value) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing/storage restrictions should not crash the storefront.
  }
}

function normaliseSession(data) {
  const expiresIn = Number(data.expires_in) || 3600;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type || "bearer",
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    user: data.user || null
  };
}

export function session() {
  const value = readStoredSession();
  return value && value.access_token ? value : null;
}

async function freshAccessToken() {
  const current = session();
  if (!current) return null;
  if (Number(current.expires_at || 0) > Math.floor(Date.now() / 1000) + 45) return current.access_token;
  if (!current.refresh_token) {
    writeStoredSession(null);
    return null;
  }
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    requireConfig({ auth: true });
    const response = await fetch(`${CFG.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: CFG.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: current.refresh_token })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      writeStoredSession(null);
      return null;
    }
    const updated = normaliseSession(data);
    writeStoredSession(updated);
    return updated.access_token;
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

function safeRestPath(path) {
  if (typeof path !== "string" || !/^[A-Za-z0-9_]+(?:\?.*)?$/.test(path)) {
    throw new Error("Invalid API path. Use a table name and optional query string.");
  }
  if (/[\r\n]/.test(path)) throw new Error("Invalid API path.");
  return path;
}

async function request(url, options = {}, { auth = false } = {}) {
  requireConfig({ auth: true });
  const token = auth ? (await freshAccessToken()) : null;
  const headers = new Headers(options.headers || {});
  headers.set("apikey", CFG.SUPABASE_ANON_KEY);
  headers.set("Authorization", `Bearer ${token || CFG.SUPABASE_ANON_KEY}`);
  if (options.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...options, headers });
  if (response.status === 204) return null;
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = text; }
  }
  if (!response.ok) {
    const detail = data && typeof data === "object"
      ? (data.message || data.msg || data.error_description || data.error || data.details)
      : data;
    const error = new Error(`${response.status}: ${detail || response.statusText || "Request failed"}`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

/** Supabase PostgREST helper used by index.html. */
export async function api(tablePath, { method = "GET", body, prefer, headers = {} } = {}) {
  const path = safeRestPath(tablePath);
  const opts = { method: String(method).toUpperCase(), headers: { ...headers } };
  if (prefer) opts.headers.Prefer = prefer;
  if (body !== undefined) opts.body = JSON.stringify(body);
  return request(`${CFG.SUPABASE_URL}/rest/v1/${path}`, opts, { auth: true });
}

/** Fetches all rows in 1,000-row pages, avoiding PostgREST's usual row limit. */
export async function fetchAll(tablePath) {
  const path = safeRestPath(tablePath);
  const rows = [];
  for (let offset = 0; offset < 100000; offset += PAGE_SIZE) {
    const page = await request(`${CFG.SUPABASE_URL}/rest/v1/${path}`, {
      method: "GET",
      headers: { Range: `${offset}-${offset + PAGE_SIZE - 1}`, "Range-Unit": "items" }
    }, { auth: true });
    if (!Array.isArray(page)) throw new Error("The catalog API returned an unexpected response.");
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
  throw new Error("The response exceeded the safety limit of 100,000 rows.");
}

export async function login(email, password) {
  requireConfig({ auth: true });
  const cleanEmail = String(email || "").trim();
  if (!cleanEmail || !String(password || "")) throw new Error("Enter your email and password.");
  const data = await request(`${CFG.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: cleanEmail, password: String(password) })
  });
  if (!data || !data.access_token) throw new Error("Sign-in failed. Please check your credentials.");
  const stored = normaliseSession(data);
  writeStoredSession(stored);
  return stored;
}

export async function logout() {
  const current = session();
  try {
    if (current?.access_token && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) {
      await request(`${CFG.SUPABASE_URL}/auth/v1/logout`, { method: "POST" }, { auth: true });
    }
  } finally {
    writeStoredSession(null);
  }
}
