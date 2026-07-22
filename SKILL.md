---
name: browser-record
description: >
  錄製瀏覽器操作影片,產出教學 / demo 影片。三種模式:Playwright 錄瀏覽器內容並注入視覺化
  假游標(畫面最乾淨、不占螢幕、可被其他視窗蓋住)、macOS 全螢幕錄影(有真實游標)、
  macOS 單視窗錄影(被蓋住照錄)。當使用者說「錄影」「錄操作過程」「錄一段 demo」
  「幫我把操作錄下來」「screen record」「錄網頁操作」「做教學影片」「錄 Chrome」
  時使用。不適用:單純截圖(用 app-screenshots)、E2E 測試(用 e2e-testing)。
---

# 瀏覽器操作錄影

把「AI 操作瀏覽器」錄成影片。核心問題是**游標**與**要不要占用螢幕**,三個模式的取捨不同。

## 先選模式

| | A 全螢幕 | B 單視窗 | **C Playwright+假游標** |
|---|---|---|---|
| 真實滑鼠游標 | ✅ | ❌ | ❌(有視覺指示器) |
| 視窗被蓋住也能錄 | ❌ | ✅ | ✅(根本不占螢幕) |
| 畫面乾淨(無桌面雜訊) | ❌ | ✅ | ✅ |
| 看得出點了哪裡 | ✅ | ❌ | ✅ 漣漪動畫 |
| 錄製時你能做別的事 | ❌ | ✅ | ✅ |
| 平台 | macOS | macOS | 跨平台 |

**預設推 C。** 教學影片要的是「乾淨畫面 + 看得出點哪裡」,C 兩者都有,而且錄的時候
使用者可以繼續做自己的事。只有在**必須呈現真實滑鼠軌跡**或**要錄瀏覽器以外的 app**
時才用 A。

游標的物理限制:單視窗捕捉讀的是該視窗自己的 backing store,而游標是系統畫在所有視窗
**之上**的獨立圖層 —— 所以 B 不是「沒做這功能」,是結構上不可能有。

---

## 模式 C:Playwright + 假游標(預設)

錄的是 Playwright 自己起的 Chrome,與使用者桌面完全無關。

### 前置

**skill 自帶 playwright**(裝在 `~/.claude/skills/browser-record/node_modules/`),從任何
目錄跑都能用,不需要在使用者專案裝任何東西。若該目錄不見了,重裝:

```bash
cd ~/.claude/skills/browser-record && npm i playwright
```

另需 `ffmpeg`(轉 mp4)與 chromium(`npx playwright install chromium`,通常已有)。

### 用法

1. **複製劇本範例**改成要錄的流程:

   ```bash
   cp ~/.claude/skills/browser-record/scripts/example-scenario.mjs ./my-demo.mjs
   ```

2. **寫劇本**(`export default async` 函式,可用動作見範例檔註解):

   ```js
   export const pace = { cursorMove: 900, afterClick: 1400, readPause: 2200 };

   export default async ({ goto, clickAt, scrollBy, type, pause }) => {
     await goto('https://example.com');
     await scrollBy(500);
     await clickAt('a[href="/docs/"]');
     await type('input[name=q]', '搜尋關鍵字');
     await pause();
   };
   ```

3. **錄**:

   ```bash
   node ~/.claude/skills/browser-record/scripts/record.mjs ./my-demo.mjs \
     --out ./demo.mp4 --verify
   ```

   常用參數:`--width 1280 --height 800`、`--verify`(點擊瞬間存證截圖)、
   `--headless`(不開視窗,但字體渲染較差,教學影片不建議)、`--keep-webm`。

### 驗收(必做,不可省)

`--verify` 會在**每次點擊的瞬間**存一張截圖到輸出資料夾旁。交付前一定要 `Read` 打開
其中一張,**用眼睛確認紅色游標真的停在目標元素上**。

理由:游標是注入的 DOM 節點,SPA / hydration 會把它清掉;錄影跑完不代表游標有出現。
只看 `OK duration=...` 就回報 = 假綠燈。抽影片畫格驗證也不可靠 —— 隨便挑的時間點很可能
落在游標移動前後的空檔,看不到不代表沒有。**要驗就驗點擊瞬間的截圖。**

---

## 模式 A:全螢幕錄影(要真實游標時)

```bash
# 錄 10 秒
~/.claude/skills/browser-record/scripts/screen-record.sh full ./out.mp4 10

# 不限時,Ctrl+C 停
~/.claude/skills/browser-record/scripts/screen-record.sh full ./out.mp4
```

腳本會自動偵測 `Capture screen 0` 在 avfoundation 的 index(各機器不同,不可寫死)。

前提:**Chrome 要露在外面、不能被蓋住**,且需要「螢幕錄製」權限
(系統設定 → 隱私權與安全性 → 螢幕錄製)。沒授權錄出來是黑畫面。

## 模式 B:單視窗錄影(被蓋住照錄)

```bash
# 列出可錄的視窗
~/.claude/skills/browser-record/scripts/screen-record.sh list

# 錄 Chrome 視窗 15 秒(預設抓 Google Chrome)
~/.claude/skills/browser-record/scripts/screen-record.sh win ./out.mov 15

# 指定其他 app
~/.claude/skills/browser-record/scripts/screen-record.sh win ./out.mov 15 "Safari"
```

原理:`screencapture -v -l <windowid>` 讀 window server 的 backing store,所以視窗被
其他視窗完全蓋住也錄得到乾淨內容。

限制:
- **視窗最小化到 Dock 就錄不到**(backing store 停止更新)。蓋住可以,縮小不行
- window id **每次開視窗都會變**,必須動態抓,不可寫死
- 無滑鼠游標
- 錄的是特定 window id,期間切換到別的視窗/開新視窗錄不到

---

## 踩過的坑

- **`waitUntil: 'networkidle'` 會 timeout** — 多數站有長連線(Giscus、分析腳本),
  永遠不會 idle。用 `domcontentloaded` + `waitForLoadState('load')`。
- **假游標會被 hydration 清掉** — 框架接管 DOM 時會移除注入的節點。`record.mjs` 已處理:
  `addInitScript` + 導航後延遲 1.2 秒補注入 + 每次操作前 `ensureCursor()` 自我修復,
  且會記住座標避免重建時跳回原點。
- **游標初始在畫面外** — 初始 `translate(-50px,-50px)`,若劇本第一個動作是捲動而非點擊,
  前段會完全看不到游標。`goto()` 已自動把游標帶到畫面中央。
- **注入節點要掛 `document.body` 不是 `documentElement`** — 掛 documentElement 較容易
  被框架的 DOM 重建掃掉。
- **`context.close()` 才會 flush 影片** — 直接 `browser.close()` 會拿不到檔案。
- **抽影片畫格驗游標不可靠** — 見上面「驗收」段,要驗點擊瞬間截圖。
- **`ffmpeg -list_devices` 一定回非零 exit code** — 它把 `""` 當輸入檔會報錯。在
  `set -euo pipefail` 的腳本裡直接 pipe 會靜默殺掉整個 script(exit 251,看不到錯誤),
  必須用 `|| true` 隔離。`screen-record.sh` 已處理。
- **avfoundation 裝置行有兩組方括號** — 格式是
  `[AVFoundation indev @ 0x...] [3] Capture screen 0`,用 `-F'[][]'` 取 `$2` 會抓到
  前面的 log prefix 而非 index。要用 `sed -nE 's/.*\[([0-9]+)\] Capture screen 0.*/\1/p'`。

## 相關

- `app-screenshots` — 只要靜態截圖文件時用那個,不用錄影
- `e2e-testing` — 目的是測試而非產出影片時用那個
