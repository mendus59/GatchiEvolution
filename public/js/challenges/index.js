// Challenge registry. A challenge's `slot` picks its embedding in the genome
// and must never change once released; new challenges take unused slots.
import hop from './hop.js';
import grove from './grove.js';
import racer from './racer.js';
import drift from './drift.js';
import catchGame from './catch.js';
import meteor from './meteor.js';
import stack from './stack.js';
import balance from './balance.js';
import climb from './climb.js';
import sling from './sling.js';

export const CHALLENGES = [hop, grove, racer, drift, catchGame, meteor, stack, balance, climb, sling];
export const byId = Object.fromEntries(CHALLENGES.map((c) => [c.id, c]));
