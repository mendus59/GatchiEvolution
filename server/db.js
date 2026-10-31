// Tiny JSON-file database. Fine for an MVP and a handful of friends; swap for
// a real database behind the same functions when it grows (see ARCHITECTURE.md).
import fs from 'node:fs';
import path from 'node:path';

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let data = { users: {}, sessions: {}, matches: [] };
  if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let timer = null;

  function flush() {
    timer = null;
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file); // atomic replace
  }

  return {
    data,
    save() { if (!timer) timer = setTimeout(flush, 200); },
    flushNow() { if (timer) clearTimeout(timer); flush(); },
  };
}
