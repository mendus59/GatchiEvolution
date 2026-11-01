# Gatchi Evolution

Raise a pocket pet that learns by evolution. Your Gatchi plays ten mini-games
on its own, and a genetic algorithm running in your browser reshapes its body
and brain to get better at whichever one you train. One body and one brain
serve all ten games, so getting better at one can help or hurt the others.

## Run it

Requires Node 20 or newer. There are no dependencies to install.

```sh
npm start          # http://localhost:8080
npm test           # engine + server tests
```

Environment variables: `PORT` (default 8080) and `DATA_FILE` (default
`data/db.json`).

## Hosting (free): GitHub Pages + Supabase

The game is published to GitHub Pages and the account API runs as a Supabase
Edge Function with Supabase Postgres, both on free tiers. Every push to `main`
deploys both (`.github/workflows/deploy.yml`). Until Supabase is set up, Pages
still gets the game with training and play; accounts and versus show as
offline.

One-time setup:

1. **Pages:** repo Settings → Pages → Build and deployment → Source:
   **GitHub Actions**.
2. **Supabase project:** sign up at https://supabase.com, create a new project
   (free plan). Save the database password you choose. The project id (the
   20-letter "Reference ID") is in Project Settings → General.
3. **Access token:** https://supabase.com/dashboard/account/tokens →
   Generate new token.
4. **GitHub settings:** repo Settings → Secrets and variables → Actions:
   - Variables tab: `SUPABASE_PROJECT_REF` = the project id
   - Secrets tab: `SUPABASE_ACCESS_TOKEN` = the token,
     `SUPABASE_DB_PASSWORD` = the database password
5. Actions tab → **Deploy** → Run workflow.

The game is then at `https://<user>.github.io/<repo>/`.

**Sign in with Google (optional).** Players can sign in with Google instead of
a password, or link Google to an existing account from the Account tab.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   project, then open **Google Auth Platform**. Fill in **Branding** (app name,
   support email), set **Audience** to External and press **Publish app**.
2. **Clients → Create client → Web application**:
   - Authorized JavaScript origins: `https://<user>.github.io`
   - Authorized redirect URIs: `https://<project id>.supabase.co/auth/v1/callback`
3. Add repo secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then run
   **Deploy**. It switches on Supabase's Google provider and allows redirects
   back to the Pages site. The free Supabase
project pauses after a week without use; `keepalive.yml` pings it every three
days to prevent that. If it does pause, restore it from the Supabase
dashboard.

Test the hosted function locally with the Supabase CLI
(`node scripts/build-edge.mjs && supabase start && supabase functions serve api`),
then `GATCHI_API_URL=http://localhost:54321/functions/v1/api npm test`.

## Play

1. Hatch your egg. Every Gatchi is generated from a random genome, so yours is
   one of a kind.
2. **Train:** pick a challenge and a number of generations. Watch the best and
   average scores climb and your pet change. After each session the skill
   profile shows what improved and what got worse.
3. **Play:** watch your Gatchi play a run. Points earned buy food.
4. **Care:** keep it fed, rested and happy. Training costs energy and food.
5. **Account:** sign up to back up the genome to the cloud. Clearing browser
   data won't lose your pet.
6. **Versus:** add friends and challenge them to a best-of-three across random
   challenges.
7. **Lineage:** every session saves a snapshot you can roll back to.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the genome, GA, challenge and
backup design.

## Layout

```
public/            static client (ES modules, no build step)
  js/genome.js     genome layout, traits, brain, mutation, crossover
  js/ga.js         genetic algorithm
  js/runner.js     runs a genome through a challenge
  js/challenges/   the ten games
  js/render/pet.js procedural pet artwork
  js/pet.js        pet care rules
  js/storage.js    localStorage
  js/app.js        UI
server/            accounts, backup, friends, versus
  api.js           routes (shared by Node and the Supabase function)
  store-*.js       JSON-file and Postgres storage
supabase/          migration + Edge Function for the hosted backend
test/              node:test suites
```
