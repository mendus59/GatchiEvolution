// Copies the shared API and game simulation code into the Supabase Edge
// Function folder, so the hosted backend runs exactly the same rules and
// challenge code as the browser. Run before `supabase functions deploy api`.
//
//   node scripts/build-edge.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'supabase/functions/api/lib');
const ENTRIES = ['server/api.js', 'server/store-postgres.js'];

fs.rmSync(OUT, { recursive: true, force: true });
const seen = new Set();
const queue = ENTRIES.map((e) => path.join(ROOT, e));
while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  const src = fs.readFileSync(file, 'utf8');
  for (const [, spec] of src.matchAll(/(?:from|import)\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    queue.push(path.resolve(path.dirname(file), spec));
  }
  const dest = path.join(OUT, path.relative(ROOT, file));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, src);
}
console.log(`Copied ${seen.size} files to ${path.relative(ROOT, OUT)}`);
