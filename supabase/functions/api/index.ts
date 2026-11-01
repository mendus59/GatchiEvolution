// Supabase Edge Function: the hosted Gatchi account API. It runs the same
// code as the self-hosted Node server (server/api.js, copied into ./lib by
// scripts/build-edge.mjs), with Postgres for storage. Versus matches are
// simulated here from the cloud genomes, so a modified client can't fake wins.
import postgres from 'npm:postgres@3.4.9';
import { createApi, MAX_BODY } from './lib/server/api.js';
import { postgresStore } from './lib/server/store-postgres.js';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 3, idle_timeout: 20 });
// Google sign-in goes through Supabase Auth in the browser. We check the
// access token it hands us by asking Supabase Auth who it belongs to.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const AUTH_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
async function verifyOAuth(accessToken: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${accessToken}`, apikey: AUTH_KEY },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user?.id ? { id: 'supabase:' + user.id, email: user.email || '' } : null;
}

const api = createApi(postgresStore(sql), { verifyOAuth });

// Bearer tokens, no cookies, so any origin may call the API.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  // The function sees /api/<route> (or /functions/v1/api/<route> locally).
  const path = url.pathname.replace(/^.*?\/api(?=\/|$)/, '') || '/';
  const bodyText = req.method === 'GET' ? '' : await req.text();
  if (bodyText.length > MAX_BODY) return json(413, { error: 'Payload too large' });
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const { status, body } = await api.handle({
    method: req.method, path, authorization: req.headers.get('authorization') || '', ip, bodyText,
  });
  return json(status, body);
});
