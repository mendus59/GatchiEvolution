// Where the account API lives. The self-hosted Node server serves it at /api.
// The GitHub Pages build overwrites this file with the hosted backend's URL
// (see .github/workflows/pages.yml), or null when no backend is configured.
export const API_BASE = '/api';
