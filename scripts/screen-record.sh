#!/usr/bin/env bash
# 全螢幕 / 單視窗錄影(macOS)。A 方案與 B 方案共用入口。
#
#   ./screen-record.sh full  <out.mp4> [秒數]        # A:錄整個主螢幕(含真實游標)
#   ./screen-record.sh win   <out.mov> [秒數] [app]  # B:錄單一視窗(被蓋住照錄,無游標)
#   ./screen-record.sh list                          # 列出可錄的視窗 id
#
# 依賴:ffmpeg(full 模式)、macOS 內建 screencapture(win 模式)、swift(list)
set -euo pipefail

MODE="${1:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

win_list() {
  swift "$HERE/winlist.swift" 2>/dev/null
}

case "$MODE" in
  list)
    printf '%-8s %-22s %s\n' "WINID" "APP" "TITLE"
    win_list | awk -F'\t' '{printf "%-8s %-22s %s\n", $1, $2, $5}'
    ;;

  full)
    OUT="${2:?usage: screen-record.sh full <out.mp4> [秒數]}"
    SECS="${3:-}"
    # 主螢幕在 avfoundation 的 index 依機器而異,動態抓 "Capture screen 0"。
    # 該行長這樣:[AVFoundation indev @ 0x...] [3] Capture screen 0
    # 前面有一組 log prefix 括號,所以要取「最後一組 [N]」而非第一組。
    # ffmpeg 列裝置時一定以非零 exit code 結束(它把 "" 當輸入檔會報錯),
    # 在 set -e / pipefail 下會直接殺掉 script,所以用 `|| true` 隔離。
    DEVLIST=$(ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true)
    IDX=$(printf '%s\n' "$DEVLIST" \
      | sed -nE 's/.*\[([0-9]+)\] Capture screen 0.*/\1/p' \
      | head -1)
    : "${IDX:?cannot locate 'Capture screen 0' among avfoundation devices}"
    echo "recording screen index=$IDX -> $OUT"
    if [ -n "$SECS" ]; then
      ffmpeg -y -f avfoundation -capture_cursor 1 -framerate 30 -i "${IDX}:none" \
        -t "$SECS" -c:v libx264 -pix_fmt yuv420p -crf 20 "$OUT"
    else
      echo "(Ctrl+C 停止)"
      ffmpeg -y -f avfoundation -capture_cursor 1 -framerate 30 -i "${IDX}:none" \
        -c:v libx264 -pix_fmt yuv420p -crf 20 "$OUT"
    fi
    ;;

  win)
    OUT="${2:?usage: screen-record.sh win <out.mov> [秒數] [app名]}"
    SECS="${3:-10}"
    APP="${4:-Google Chrome}"
    WINID=$(win_list | awk -F'\t' -v app="$APP" '$2 ~ app && $3 == "layer=0" {print $1; exit}')
    : "${WINID:?no visible window found for app: $APP}"
    echo "recording window id=$WINID ($APP) for ${SECS}s -> $OUT"
    # -l 指定 window id,即使視窗被其他視窗蓋住也錄得到(讀 window server backing store)
    # 注意:視窗最小化到 Dock 則無法錄;此模式不含滑鼠游標
    screencapture -x -v -V "$SECS" -l "$WINID" "$OUT"
    ;;

  *)
    sed -n '2,12p' "${BASH_SOURCE[0]}"
    exit 1
    ;;
esac
