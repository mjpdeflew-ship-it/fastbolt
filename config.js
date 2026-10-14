/*
 * Browser-safe BoltHouse configuration.
 * Use your Supabase Project URL + publishable/anon key only.
 * NEVER put a service_role key, database password, or other secret here.
 */
window.BH_CONFIG = Object.freeze({
  SUPABASE_URL: "",       // e.g. https://YOUR_PROJECT_REF.supabase.co
  SUPABASE_ANON_KEY: "",  // Supabase publishable key (or legacy anon key)
  WHATSAPP: ""             // Optional international number, digits recommended (e.g. 201xxxxxxxxx)
});
