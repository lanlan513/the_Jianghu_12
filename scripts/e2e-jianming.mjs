/**
 * 剑鸣端到端验证（真实 Chromium）：
 *  node scripts/e2e-jianming.mjs
 *
 * 断言：
 *  1. 无用户交互不出声（enabled=false，无 AudioContext）；
 *  2. 未开声点剑 → 开声按钮提示（enableNudge+1），不跳转、不出声；
 *  3. 开声后 params 接口确定可读（baseFreq/duration/harmonics，两次一致）；
 *  4. 播放时画布由真实音频驱动（帧变化），静音/减少动态/空闲时为静态波形（帧一致）；
 *  5. 连续快速点击 20 次：playSeq 严格 +20、无页面错误、不叠加（同一时刻一段剑鸣）。
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
let failures = 0;

function assert(cond, name, detail = '') {
  const ok = !!cond;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto(`${BASE}/swords`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.ink-card [role="button"]', { timeout: 15000 });

const state = () => page.evaluate(() => window.JianMing.state());
const sampleCanvas = () =>
  page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 401) h = (h * 31 + d[i]) >>> 0;
    return h;
  });
const inkPixels = () =>
  page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return 0;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200) dark++;
    return dark;
  });

/* 1. 浏览器策略：无任何交互前不出声 */
let st = await state();
assert(st.enabled === false && st.muted === false, '无用户交互前未开声');
assert((await page.locator('canvas').count()) === 0, '未开声时无画布（仅开声按钮）');

/* 2. 未开声点剑 → 提示开声，不跳转、不出声 */
const urlBefore = page.url();
const nudgeBefore = st.enableNudge;
await page.locator('.ink-card [role="button"]').first().click();
st = await state();
assert(st.enableNudge === nudgeBefore + 1, '未开声点剑 → 开声按钮提示 +1');
assert(st.enabled === false && st.playSeq === 0, '未开声点剑不出声');
assert(page.url() === urlBefore, '点剑鸣按钮不触发卡片跳转');

/* 3. 开声 */
await page.getByRole('button', { name: /开声/ }).click();
await page.waitForFunction(() => window.JianMing.state().enabled === true);
assert(true, '开声按钮 → enabled=true');
await page.waitForSelector('canvas');

/* 4. 可断言数据接口：确定性 + 数值正确（轩辕剑：锋利98 硬度95 柔韧75 工艺100） */
const p1 = await page.evaluate(() => window.JianMing.params('1'));
const p2 = await page.evaluate(() => window.JianMing.params('1'));
assert(JSON.stringify(p1) === JSON.stringify(p2), '同一剑两次读取参数一致（无随机）');
assert(
  p1.baseFreq === 559 && p1.harmonics === 14 && p1.duration === 1.679,
  '参数由属性推导且数值正确',
  `baseFreq=${p1.baseFreq}Hz harmonics=${p1.harmonics} duration=${p1.duration}s`,
);
assert(p1.partials.length === p1.harmonics, '泛音表长度 === harmonics');
const browserSelfTest = await page.evaluate(() => window.JianMing.selfTest());
assert(browserSelfTest.pass, '浏览器内 selfTest 通过', `${browserSelfTest.results.length} 项`);

/* 5. 空闲（未播放）时画面静止 */
const idleA = await sampleCanvas();
await page.waitForTimeout(400);
const idleB = await sampleCanvas();
assert(idleA === idleB && idleA !== null, '空闲时画面为静态（帧一致）');
assert((await inkPixels()) > 0, '静态画面含水墨内容（非空白）');

/* 6. 播放 → 画面被真实声音驱动（帧变化） */
await page.locator('.ink-card [role="button"]').first().click();
st = await state();
assert(st.playSeq === 1 && st.currentSwordId === '1', '播放后状态记录当前剑');
assert(st.currentParams.baseFreq === p1.baseFreq, '当前播放参数与接口一致');
await page.waitForTimeout(300);
const playA = await sampleCanvas();
await page.waitForTimeout(200);
const playB = await sampleCanvas();
assert(playA !== playB, '播放中画面随真实频谱运动（帧不同）');

/* 7. 静音 → 画面退化为静态波形 */
await page.getByRole('button', { name: '静音' }).click();
await page.waitForTimeout(400);
const muteA = await sampleCanvas();
await page.waitForTimeout(300);
const muteB = await sampleCanvas();
assert(muteA === muteB, '静音时画面静止（静态波形）');
assert((await inkPixels()) > 0, '静音静态画面仍有波形内容');

/* 8. 取消静音 + 重新播放 → 恢复动态 */
await page.getByRole('button', { name: '取消静音' }).click();
await page.locator('.ink-card [role="button"]').first().click();
await page.waitForTimeout(300);
const reA = await sampleCanvas();
await page.waitForTimeout(200);
const reB = await sampleCanvas();
assert(reA !== reB, '取消静音并播放后画面恢复动态');

/* 9. 连续快速点击 20 次：严格单声部推进，无错误 */
const seqBefore = (await state()).playSeq;
const firstBtn = page.locator('.ink-card [role="button"]').first();
for (let i = 0; i < 20; i++) await firstBtn.click();
st = await state();
assert(st.playSeq === seqBefore + 20, '20 次快速点击 → playSeq 严格 +20', `playSeq=${st.playSeq}`);
assert(st.currentSwordId === '1', '快速切换后当前剑为最后点击者');
await page.waitForTimeout(300);
const burstA = await sampleCanvas();
await page.waitForTimeout(200);
const burstB = await sampleCanvas();
assert(burstA !== burstB, '快速点击后仍可正常发声驱动画面');

/* 10. 减少动态效果 → 静态波形（声音仍播） */
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.locator('.ink-card [role="button"]').first().click();
await page.waitForTimeout(300);
const rmA = await sampleCanvas();
await page.waitForTimeout(300);
const rmB = await sampleCanvas();
assert(rmA === rmB, '减少动态效果时画面为静态波形');
await page.emulateMedia({ reducedMotion: 'no-preference' });

/* 11. 详情页：参数展示 + 播放 */
await page.goto(`${BASE}/swords/1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=剑鸣 · 听其自鸣', { timeout: 15000 });
const detailText = await page.locator('dl').last().innerText();
assert(detailText.includes('559.00 Hz') && detailText.includes('14 个'), '详情页展示推导参数');
const seq2 = (await state()).playSeq;
await page.getByRole('button', { name: '听其自鸣' }).click();
st = await state();
assert(st.playSeq === seq2 + 1 && st.currentSwordId === '1', '详情页播放当前剑');

/* 12. 全程无页面错误 */
assert(pageErrors.length === 0, '全程无页面 JS 错误', pageErrors[0] ?? '');

await browser.close();
console.log(failures === 0 ? '\nE2E 全部通过' : `\nE2E 存在 ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
