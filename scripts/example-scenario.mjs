/**
 * 劇本範例 — 複製一份改成你要錄的流程。
 *
 * 跑法:
 *   node record.mjs example-scenario.mjs --out demo.mp4 --verify
 *
 * 可用動作(都會自動處理假游標):
 *   goto(url)              導航 + 等 hydration + 把游標帶進畫面
 *   clickAt(selector)      游標平滑移過去 → 漣漪 → 點擊
 *   moveTo(selector)       只移動不點(用來「指」給觀眾看)
 *   scrollBy(px)           捲動
 *   type(selector, text)   逐字打字(有打字延遲,像真人)
 *   pause(ms)              停頓,省略參數用預設的 readPause
 *   page                   原生 Playwright page,需要進階操作時用
 */

// 可選:覆寫節奏(教學影片建議慢一點)
export const pace = {
  cursorMove: 900,   // 游標滑到目標的時間
  afterClick: 1400,  // 點完停多久讓觀眾看變化
  readPause: 2200,   // 「讓觀眾讀一下」的停頓
};

export default async ({ goto, clickAt, scrollBy, pause }) => {
  await goto('https://yanchen.app/');

  await scrollBy(500);
  await scrollBy(500);
  await pause();

  await clickAt('a[href="/blog/"]');
  await pause();

  // 點第一篇文章(排除「/blog/」本身)
  await clickAt('a[href*="/blog/"]:not([href$="/blog/"])');
  await pause();

  await scrollBy(600);
  await scrollBy(600);
  await pause();
};
