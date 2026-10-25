// Entry point for bin/factory. Plain JavaScript so it can refuse a Node too old to strip types,
// with the CLI's JSON error shape, before any .ts file loads.
// FLOOR repeats NODE_FLOOR in src/core/config.ts; test/cli.test.ts checks they match.
const FLOOR = '22.18.0';

const cmp = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

if (cmp(process.versions.node, FLOOR) < 0) {
  const message = `Node ${process.versions.node} (${process.execPath}) is below the floor ${FLOOR}. Install a newer Node and run factory setup again.`;
  process.stdout.write(JSON.stringify({ error: { code: 'NODE_VERSION', message } }) + '\n');
  process.exit(1);
}

const { main } = await import('./main.ts');
process.exitCode = await main(process.argv.slice(2));
