// Stand-in builder workload for spike 05: keeps a builder step busy for N seconds doing real
// (throwaway) work — hashing — and prints progress every 30 s. Usage: node work.ts <seconds>
import { createHash } from 'node:crypto';
const secs = Number(process.argv[2] ?? 590);
const end = Date.now() + secs * 1000;
let n = 0;
let nextTick = Date.now() + 30_000;
let h = 'seed';
while (Date.now() < end) {
  for (let i = 0; i < 2000; i++) h = createHash('sha256').update(h).digest('hex');
  n += 2000;
  if (Date.now() >= nextTick) { console.log(`build stand-in: ${n} hashes, ${Math.round((end - Date.now()) / 1000)} s left`); nextTick += 30_000; }
  await new Promise((r) => setTimeout(r, 50));
}
console.log(`build stand-in done: ${n} hashes`);
