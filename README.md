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
test/              node:test suites
```
