/**
 * 剑鸣核心自检：npx tsx scripts/selftest.ts（或 npm run selftest）
 * 断言同剑参数确定、属性→参数单调、包络与噪声确定等，失败时以非零码退出。
 */
import { selfTest } from '../src/audio/jianmingCore';

const report = selfTest();
for (const r of report.results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
const okCount = report.results.filter((r) => r.ok).length;
console.log(`\n自检 ${okCount}/${report.results.length} ${report.pass ? '全部通过' : '存在失败'}`);
process.exit(report.pass ? 0 : 1);
