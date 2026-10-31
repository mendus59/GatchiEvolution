# Gatchi Evolution: architecture

A browser virtual pet that is raised like a classic pocket pet and improved by
a genetic algorithm (GA). All learning runs in the player's browser. A small
server only stores accounts and genome backups and referees versus matches.

```
 Browser                                              Server (Node, no deps)
 ┌──────────────────────────────────────────────┐     ┌──────────────────────────┐
 │ app.js  UI, pet care loop, play, versus view │     │ server.js                │
 │   │                                          │     │  accounts (scrypt)       │
 │   ├─ train-worker.js (Web Worker)            │ API │  cloud backup            │
 │   │    ga.js → runner.js → challenges/*      │◄───►│  friends, leaderboard    │
 │   │                                          │     │  versus: re-simulates    │
 │   └─ storage.js  localStorage                │     │  matches with the same   │
 │        pet, population, history, snapshots   │     │  challenge code          │
 └──────────────────────────────────────────────┘     └──────────────────────────┘
        shared, deterministic: genome.js, rng.js, runner.js, challenges/*
```

## 1. Genome

One flat vector of real numbers (currently 291 genes), quantized to 4 decimals
so JSON round trips reproduce behaviour exactly. Regions:

| Region | Genes | Purpose |
|---|---|---|
| `body` | 8 | size, limb, muscle, eye, nerve, metab, wing, focus |
| `looks` | 24 | hues, saturation, silhouette harmonics, pattern, eyes, antennae, ears, tail, cheeks, mouth, feet |
| `embed` | 16 × 4 | a learned context vector per challenge slot (10 used, 6 reserved for future games) |
| `w1`, `w2` | 156 + 39 | one shared neural network: 8 sensors + 4 context + bias → 12 hidden → 3 outputs |

**Body genes → traits (pleiotropy).** Body genes pass through a squash and
are mixed into game-facing traits with overlapping weights (`traits()` in
`genome.js`). Size makes a Gatchi strong and steady (good for Pole Balance)
but slower, a worse jumper, and a bigger target (bad for Meteor Field and
Balloon Drift). Long limbs help running and jumping but cost agility. A fast
metabolism powers reflexes but raises appetite, so the pet gets hungry faster.
This is what makes one skill help some games and hurt others.

**One shared brain.** Every challenge feeds the same network. The only thing
that differs per game is the 4-number context embedding, which is itself
evolved. Training on any game therefore always changes how the pet plays all
the others, sometimes for the better and sometimes not. The skill profile
(tested on fixed courses after every session) shows the shift with ▲/▼.

**Uniqueness.** A new pet's 291 genes are drawn from a cryptographic seed.
The looks are rendered procedurally from the genome (`render/pet.js`): body
outline from radial harmonics, colors on a wrapped hue wheel, pattern and
ornaments, plus proportions from body genes, so evolution visibly changes the
pet. With hundreds of continuous genes the odds of two Gatchis matching are
effectively zero. Every genome has a fingerprint like `GX-F362B371`.

## 2. Genetic algorithm (`ga.js`)

- Population of 24 whole-pet genomes, seeded from the pet (the pet plus
  mutants) and persisted between sessions.
- Each generation every member plays the focus challenge on 2 seeds. Seeds are
  shared within a generation (fair ranking) and change between generations
  (so it learns the game, not one layout).
- Elitism (top 2 kept, re-tested each generation), tournament selection
  (k = 3), and 60% crossover. Crossover is uniform per gene for body, looks and
  embedding, and per hidden neuron for the brain, so feature detectors stay
  intact.
- Gaussian mutation with per-region step sizes (looks drift slowly, the brain
  explores fastest), rare macro-mutations, and step size that grows when
  progress stalls.
- The generation champion becomes the pet immediately, so you watch it change.
- **Cross-train** mode uses mean score-versus-par across all 10 games as the
  fitness, for players who want a generalist.

Training runs in a Web Worker. A 24-member generation takes roughly 5–100 ms
depending on the game, so 100 generations finish in seconds to a couple of
minutes.

## 3. Challenges (`challenges/*`)

Each challenge is a deterministic, headless simulation at 60 ticks/s in a
480×270 world, plus a `draw()` for playback. Common interface:
`create(rng, traits)` returns a game with `sense(s)` (8 numbers),
`step(actions)` (3 numbers), `done`, `score`. Each has a permanent `slot`
(its embedding index) and a `par` score used for normalizing.

| # | Name | Genre | Traits that matter |
|---|---|---|---|
| 0 | Hop Trail | Endless runner: jump rocks, duck birds | jump, speed, reflex, vision |
| 1 | Berry Grove | Maze forager: berries, roaming beetles | speed, vision, size |
| 2 | Loop Racer | Top-down racing on a procedural loop | speed, agility, strength, vision |
| 3 | Balloon Drift | Side-scrolling flyer with thrust | lift, reflex, size |
| 4 | Orchard Catch | Catch ripe fruit, dodge rotten | speed, agility, vision, size |
| 5 | Meteor Field | Arena survival dodger | agility, speed, vision, size |
| 6 | Tower Stack | Timing stacker with overhang slicing | reflex, focus |
| 7 | Pole Balance | Balance a pole against wind gusts | strength, mass, reflex |
| 8 | Sky Climb | Vertical bouncing platformer | jump, agility, vision |
| 9 | Target Range | Artillery with wind and miss feedback | strength, reflex, vision |

Traits also shape perception and control for every game: vision sets sensor
range, reflex sets how often the brain gets to think, and focus sets action
noise.

**Adding a challenge:** write a module with the interface above, give it the
next unused `slot` (10–15), and add it to `challenges/index.js`. Existing pets
already carry embedding genes for that slot, so they can start training on it
immediately. Never change an existing slot.

## 4. Pet care (`pet.js`)

Fullness, energy, mood and health decay in real time from timestamps (works
across closed tabs and long absences). Appetite depends on body genes. Training
costs energy and food per generation (stamina reduces it). Watching runs earns
points by score versus par; points buy food (berry, bento, cake, medicine).
Neglect drains health; at zero the pet faints until given medicine (free if
the player is broke, so a pet can never be stuck). Life stages (egg, sprout,
juvenile, adult, elder) follow total generations trained.

## 5. Storage and backup

**Local (`storage.js`, localStorage):** `gatchi:pet` (genome, care, points,
ratings), `gatchi:population` (GA population, resumes training), `gatchi:history`
(per-generation stats, last 1500), `gatchi:snapshots` (last 30 champions,
restorable from the Lineage tab), `gatchi:auth`, `gatchi:sync`. About 150 KB in
total. Export and import of a JSON save file works without an account.

**Cloud:** when signed in, the pet, the last 10 snapshots and recent history
are pushed after every training session and every 2 minutes when there are
changes. If browser data is cleared, signing in (or a surviving session token)
restores the pet automatically. The GA population is not backed up; it is
regenerated from the pet's genome.

## 6. Accounts, friends, versus (`server/`)

- Username and password, scrypt-hashed with per-user salt; random bearer
  tokens stored as SHA-256 hashes, 30-day expiry; login and register are rate
  limited.
- `PUT/GET /api/backup` validates genome shape and size.
- Friends are a follow list by username. A leaderboard ranks players by Elo.
- **Versus:** `POST /api/versus` picks 3 random challenges and a seed, then
  simulates both cloud genomes on the server with the same challenge code the
  browser uses. The result is authoritative (a modified client cannot fake a
  win), Elo is updated, and the response includes seeds and genomes so the
  client replays both pets side by side.
- Storage is one JSON file with atomic writes (`server/db.js`). Fine for an MVP
  and friends; the route handlers only touch `db.data`, so moving to SQLite or
  Postgres is contained.

**Known limits and next steps**

- Cross-engine determinism: brain math uses only basic arithmetic, but some
  games use `Math.sin/cos`, which can differ in the last bits between browser
  engines, so a replay in Firefox could drift slightly from the server's
  result. The server's numbers are always the official ones. Fixed-point trig
  tables would remove this.
- A player could upload a hand-crafted genome. Possible mitigations: store
  lineage hashes, or rate-limit how far a backup can move from the last one.
- Async friend challenges (challenge someone offline and get notified),
  tournaments, breeding two friends' Gatchis (crossover is already there).
- Hosting: the server is a single Node process, so it deploys anywhere
  (Fly.io, Render, a small VPS). Alternatively the API could move to Supabase
  or Firebase, with versus checks in an edge function.
