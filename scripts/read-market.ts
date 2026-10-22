import { writeFileSync } from 'node:fs';
import { inspectMarket, stringify } from '../src/read-only.ts';

try {
  const result = await inspectMarket(process.argv[2] ?? 'ETH');
  writeFileSync('evidence/sdk-market-2026-10-20.json', stringify(result)+'\n');
  console.log(stringify({ ok: true, markets: result.marketsCount, base: result.market.baseSymbol, snapshot: result.snapshot, registered: result.registered }));
} catch (error) {
  const result = { at: new Date().toISOString(), ok: false, error: error instanceof Error ? error.message : 'Read failed' };
  writeFileSync('evidence/sdk-market-2026-10-20.json', stringify(result)+'\n');
  console.error(stringify(result)); process.exitCode = 1;
}
