// Where the account API lives. The self-hosted Node server serves it at /api.
// The GitHub Pages build overwrites this file with the hosted backend's URLs
// (see .github/workflows/deploy.yml), or null when no backend is configured.
export const API_BASE = '/api';
// Supabase Auth URL for "Sign in with Google", or null when Google sign-in
// isn't set up (always null for the self-hosted server).
export const GOOGLE_AUTH_URL = null;
