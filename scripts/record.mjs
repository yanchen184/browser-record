#!/usr/bin/env node
/**
 * browser-record — 用 Playwright 錄瀏覽器操作影片,含視覺化假游標。
 *
 * 特性:
 *  - 錄的是 Playwright 自己起的 Chrome,不占你的螢幕、可被其他視窗蓋住
 *  - 頁面內注入假游標:平滑移動 + 點擊漣漪,教學影片看得出「點了哪裡」
 *  - 劇本用 JS 檔描述,與錄影引擎分離
 *
 * 用法:
 *   node record.mjs <劇本檔.mjs> [--out <輸出.mp4>] [--width 1280] [--height 800]
 *                                [--verify] [--headless] [--keep-webm]
 *
 * 劇本檔格式(export default async function):
 *   export default async ({ goto, clickAt, moveTo, scrollBy, type, pause, page }) => {
 *     await goto('https://example.com');
 *     await clickAt('a.some-link');
 *     await scrollBy(600);
 *   };
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, rmSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, dirname, join } from 'path';
import { pathToFileURL } from 'url';

// ---------- CLI 解析 ----------
const argv = process.argv.slice(2);
if (!argv[0] || argv[0] === '--help' || argv[0] === '-h') {
  console.log(
    'usage: node record.mjs <script.mjs> [--out out.mp4] [--width N] [--height N] [--verify] [--headless] [--keep-webm]'
  );
  process.exit(argv[0] ? 0 : 1);
}
const flag = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? def : argv[i + 1];
};
const has = (name) => argv.includes('--' + name);

const scenarioPath = resolve(argv[0]);
if (!existsSync(scenarioPath)) {
  console.error('FAILED: scenario not found: ' + scenarioPath);
  process.exit(1);
}
const WIDTH = parseInt(flag('width', '1280'), 10);
const HEIGHT = parseInt(flag('height', '800'), 10);
const OUT_MP4 = resolve(flag('out', join(dirname(scenarioPath), 'recording.mp4')));
const WORK_DIR = join(dirname(OUT_MP4), '.browser-record-tmp');

// ---------- 教學影片節奏(可被劇本覆寫)----------
const PACE = {
  cursorMove: 900,
  beforeClick: 450,
  afterClick: 1400,
  afterScroll: 1100,
  readPause: 2200,
};

// ---------- 注入的假游標 ----------
const CURSOR_INIT = `
(() => {
  if (window.__cursorReady && document.getElementById('__demo_cursor')) return;
  if (!document.body) return;
  const old = document.getElementById('__demo_cursor');
  if (old) old.remove();
  const oldR = document.getElementById('__demo_ripple');
  if (oldR) oldR.remove();
  const oldS = document.getElementById('__demo_cursor_style');
  if (oldS) oldS.remove();

  const style = document.createElement('style');
  style.id = '__demo_cursor_style';
  style.textContent = \`
    #__demo_cursor {
      position: fixed; top: 0; left: 0;
      width: 22px; height: 22px;
      margin-left: -11px; margin-top: -11px;
      border-radius: 50%;
      background: rgba(255,64,96,0.85);
      border: 2px solid #fff;
      box-shadow: 0 2px 10px rgba(0,0,0,0.45);
      z-index: 2147483647; pointer-events: none;
      transition: transform var(--cur-dur, 900ms) cubic-bezier(.25,.8,.3,1);
      transform: translate(-50px, -50px);
    }
    #__demo_ripple {
      position: fixed; top: 0; left: 0;
      width: 22px; height: 22px;
      margin-left: -11px; margin-top: -11px;
      border-radius: 50%;
      border: 3px solid rgba(255,64,96,0.9);
      z-index: 2147483646; pointer-events: none; opacity: 0;
    }
    @keyframes __demo_ping {
      0%   { transform: scale(1);   opacity: 0.9; }
      100% { transform: scale(3.4); opacity: 0;   }
    }
  \`;
  document.head.appendChild(style);

  const dot = document.createElement('div');
  dot.id = '__demo_cursor';
  document.body.appendChild(dot);

  const ripple = document.createElement('div');
  ripple.id = '__demo_ripple';
  document.body.appendChild(ripple);

  window.__cursorPos = window.__cursorPos || { x: -50, y: -50 };
  // SPA 重建 DOM 後還原座標,避免游標跳回原點
  if (window.__cursorPos.x > -50) {
    dot.style.transition = 'none';
    dot.style.transform = \`translate(\${window.__cursorPos.x}px, \${window.__cursorPos.y}px)\`;
    void dot.offsetWidth;
    dot.style.transition = '';
  }

  window.__cursor = {
    move(x, y, dur) {
      window.__cursorPos = { x, y };
      dot.style.setProperty('--cur-dur', dur + 'ms');
      dot.style.transform = \`translate(\${x}px, \${y}px)\`;
    },
    click(x, y) {
      ripple.style.transform = \`translate(\${x}px, \${y}px)\`;
      ripple.style.animation = 'none';
      void ripple.offsetWidth;
      ripple.style.animation = '__demo_ping 600ms ease-out';
      ripple.style.opacity = '1';
    },
  };
  window.__cursorReady = true;
})();
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (existsSync(WORK_DIR)) rmSync(WORK_DIR, { recursive: true, force: true });
  mkdirSync(WORK_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: has('headless'),
    args: ['--force-device-scale-factor=1'],
  });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
    recordVideo: { dir: WORK_DIR, size: { width: WIDTH, height: HEIGHT } },
  });
  await context.addInitScript(CURSOR_INIT);
  const page = await context.newPage();

  let shotSeq = 0;

  const ensureCursor = async () => {
    await page.evaluate(CURSOR_INIT).catch(() => {});
    const ok = await page
      .evaluate(() => !!document.getElementById('__demo_cursor'))
      .catch(() => false);
    if (!ok) await page.evaluate(CURSOR_INIT).catch(() => {});
  };

  /** 導航 + 等 hydration + 把游標帶進畫面 */
  const goto = async (url, opts = {}) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000, ...opts });
    // 註:多數站有長連線(分析/留言),networkidle 會 timeout,故用 load
    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
    await sleep(1200); // 等 hydration,否則注入的節點會被框架清掉
    await ensureCursor();
    await page.evaluate(
      ([x, y]) => window.__cursor?.move(x, y, 600),
      [Math.round(WIDTH / 2), Math.round(HEIGHT / 2)]
    );
    await sleep(PACE.readPause);
  };

  const moveTo = async (selector) => {
    await ensureCursor();
    const el = page.locator(selector).first();
    await el.waitFor({ state: 'visible', timeout: 15000 });
    await el.scrollIntoViewIfNeeded();
    await sleep(250);
    const box = await el.boundingBox();
    if (!box) throw new Error('no bounding box for ' + selector);
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    await page.evaluate(([x, y, d]) => window.__cursor?.move(x, y, d), [x, y, PACE.cursorMove]);
    await sleep(PACE.cursorMove + PACE.beforeClick);
    return { x, y, el };
  };

  const clickAt = async (selector) => {
    const { x, y, el } = await moveTo(selector);
    await page.evaluate(([x, y]) => window.__cursor?.click(x, y), [x, y]);
    await sleep(180);
    if (has('verify')) {
      await page.screenshot({ path: join(WORK_DIR, `verify_click_${++shotSeq}.png`) });
    }
    await el.click();
    await sleep(PACE.afterClick);
    await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
    await ensureCursor();
  };

  const type = async (selector, text) => {
    await moveTo(selector);
    await page.locator(selector).first().click();
    await page.locator(selector).first().type(text, { delay: 90 });
    await sleep(PACE.afterClick);
  };

  const scrollBy = async (px) => {
    await page.mouse.wheel(0, px);
    await sleep(PACE.afterScroll);
    await ensureCursor();
  };

  const pause = (ms) => sleep(ms ?? PACE.readPause);

  // ---------- 執行劇本 ----------
  const mod = await import(pathToFileURL(scenarioPath).href);
  const scenario = mod.default;
  if (typeof scenario !== 'function') {
    throw new Error('scenario must `export default async function`');
  }
  if (mod.pace) Object.assign(PACE, mod.pace);

  await scenario({ goto, clickAt, moveTo, scrollBy, type, pause, page, PACE });

  const video = page.video();
  await context.close(); // 必須 close 才會 flush 影片
  const webm = await video?.path();
  await browser.close();

  if (!webm || !existsSync(webm)) throw new Error('video not produced');

  // ---------- 轉 mp4 ----------
  execFileSync(
    'ffmpeg',
    ['-y', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', OUT_MP4],
    { stdio: 'ignore' }
  );

  // 驗證截圖搬到輸出資料夾旁
  if (has('verify')) {
    const shots = readdirSync(WORK_DIR).filter((f) => f.startsWith('verify_click_'));
    for (const s of shots) {
      execFileSync('cp', [join(WORK_DIR, s), join(dirname(OUT_MP4), s)]);
    }
    if (shots.length) console.log('VERIFY_SHOTS=' + shots.length);
  }

  if (!has('keep-webm')) rmSync(WORK_DIR, { recursive: true, force: true });

  const dur = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', OUT_MP4,
  ]).toString().trim();

  console.log('OK duration=' + dur + 's');
  console.log('VIDEO=' + OUT_MP4);
}

main().catch((e) => {
  console.error('FAILED: ' + e.message);
  process.exit(1);
});
