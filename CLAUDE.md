# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

Motion Lab — ブラウザだけで動画（WebM）と静止画（PNG）素材を作る21種類のツール集。ビルドシステム・パッケージ管理・テスト・依存パッケージは一切なし。素の HTML / CSS / JavaScript（`"use strict"` + IIFE またはトップレベル定数）を Canvas 2D で描画している。

## 実行

`index.html` をブラウザで直接開く。ビルド・インストール手順は存在しない。ただし `kanji-data.js` などが CDN から漢字データを `fetch` するため、`file://` で CORS が問題になる場合は静的サーバー経由で開く：

```bash
python -m http.server 8000   # → http://localhost:8000/index.html
```

テスト・リンタ・フォーマッタは未導入。検証はブラウザでの目視確認と DevTools コンソールで行う。

## 全体構成

1ツール = `<name>.html` + `<name>.js`（+ 専用 CSS があるものも）の平置き。共有レイヤーは4つのみ：

| ファイル | 役割 |
| --- | --- |
| `motion-toolkit.js` | `window.MotionToolkit`。`clamp` / `lerp` / `ease` / `graphemes` / `seededRandom` / `containRect` / `outputDimensions` / `resizeOutputCanvas` / `roundedRectPath` / `formatTime` / `parseTime`、および**再生・書き出しエンジン `createPlayer`** |
| `motion-storage.js` | `MotionStorage.read/write/restoreControl`。localStorage の安全な読み書きと、min/max・option 検証つきのコントロール復元 |
| `tool-nav.js` | `window.MotionTools`。全ツールのカタログと、ヘッダー右側の共通ツールスイッチャー（`mountToolNav`） |
| `motion-fonts.js` | `MotionFonts.createFontStore(assetKey)` / `registerFontFile`。ローカルフォントの IndexedDB 保存と `FontFace` 登録 |
| `motion-order.js` | `MotionOrder.createOrderPicker`。「指定」順モードのピッカーと順位付け |
| `motion-pattern.js` | `window.MotionPattern`。背景系5ツールだけが使う。**ループ安全な位相 `loopPhase`**・波形 `wave01` / `frac`、色ヘルパー `hexToRgb` / `mixHex` / `rgbCss` / `paletteAt` / `paletteTable` / `readPalette` / `syncPaletteRows`、格子の空間座標 `gridField`、粒状ノイズ `paintGrain` |
| `motion-controls.js` | スライダーの値表示を数値入力へ置き換え（`upgradeNumericFields`）、`.color-control` の hex 表示を自動同期（`syncColorOutputs`） |
| `tool-ui.js` | 名前付きプリセットの保存・読込・削除、セクション単位の初期化、`tool-shell-compact` レイアウトの右パネル組み立て |
| `tool-ui.css` | 共通の画面部品（ヘッダー・ツールスイッチャー・セクション・トランスポート・シークバー・数値入力・順番ピッカー・出力欄） |

`kanji-data.js` は漢字系ツール用の Hanzi Writer Japanese Data 取得・localStorage キャッシュ（最大24文字）。

読み込み順は固定：`motion-storage.js` → `tool-nav.js` → `motion-toolkit.js` →（必要なら `motion-fonts.js` / `motion-order.js` / `motion-pattern.js` / `kanji-data.js`）→ `<tool>.js` → `motion-controls.js` → `tool-ui.js`。**`motion-controls.js` はツール本体の後、`tool-ui.js` は必ず最後。**

### createPlayer の契約

`MotionToolkit.createPlayer({ canvas, getDuration, isReady, render, onUpdate, onControlChange, getFileBase, loop })` は、**HTML 内の固定 ID を `document.querySelector` で直接拾う**。新規ツールの HTML は既存ツールの `.transport` / `.export-section` マークアップをそのまま流用すること。要求される ID：

`#playButton` `#restartButton` `#timeline` `#currentTime` `#totalTime` `#previewSpeed` `#imageTime` `#imageTimeValue` `#imageExportButton` `#exportButton` `#exportProgress` `#exportProgressBar` `#toast` `#outputSize`

`#currentTime` は `<output>` ではなく `<input class="time-input">` にする（`分:秒` か秒数を打つとその位置へシークする）。`#timeline` はドラッグ中 `state.isScrubbing` が立ち、再生位置による書き換えが止まる。再生中に掴んだ場合は離した時点で再生を再開する。

ツール側が実装するのは `render(playhead)` のみ（`playhead` は 0〜1 の正規化値）。書き出しは後述の `renderWebm` に委譲する。**描画は playhead から完全に決定的でなければならない**（フレーム間で乱数を引かない。ランダム性は `seededRandom(state.seed)` で固定する）。

### WebM 書き出し（renderWebm）

`MotionToolkit.renderWebm({ canvas, totalFrames, render, onProgress, videoBitsPerSecond })` が全ツール共通の書き出しエンジンで、`Promise<Blob>` を返す。`createPlayer` を使うツールはプレイヤー経由で、使わないツール（Outline / Kanji Writer / Random Kanji / Dial Type / Text Reel）は自分の `exportVideo` から直接呼ぶ。ダウンロードは `MotionToolkit.downloadBlob(blob, fileName)`。

第一経路は **WebCodecs の `VideoEncoder`（VP9 → VP8）+ 自前の WebM マルチプレクサ**（`buildWebmBlob`、EBML を手書き）。各フレームのタイムスタンプは経過時間ではなく**フレーム番号**（`round(duration × 60)` 枚）から決まるので、1 枚の描画が 1/60 秒を超えても尺が伸びず、コマ落ちもしない — 遅い分だけ書き出し時間が延びるだけになる。キーフレームは 1 秒ごとで、クラスタもそこで切って Cues を張る。フレーム間の待ちは `setTimeout` ではなく `MessageChannel`（非表示タブでも 1 秒クランプを受けない）。

`VideoEncoder` が無い環境では `canvas.captureStream(0)` + `requestFrame()` + `MediaRecorder` の旧経路に自動フォールバックする（さらに `requestFrame` 非対応なら `captureStream(60)` の自動サンプリング）。旧経路は `MediaRecorder` が実時間でタイムスタンプを打つため、描画が重いとカクつく点に注意。

### 背景系ツールとシームレスループ

Grid Pulse / Color Grid / Gradient Loop / Stripe Drift / Noise Plasma の5本は、素材を一切読み込まず `render(playhead)` だけで絵を作る。共通の約束は3つ：

1. **時間項は必ず playhead の周期関数にする。** 位相は `MotionPattern.loopPhase(playhead, duration)` を通す。書き出しは `playhead` を 0〜1 の**両端含みで**歩くため、素直に周期関数を書くと先頭フレームが末尾にもう一度出る。`loopPhase` は 1 フレーム分だけ位相を縮めて、末尾がループ点の 1 コマ手前で終わるようにしている。
2. **周回数は整数スライダーにする。** `phase * cycles` が1ループでちょうど整数回進むので継ぎ目が消える。非整数を許すと必ず飛ぶ。
3. **模様が動くツールは、色の並びが一巡する距離だけ動かす。** Stripe Drift の `colorSpan()` がその例で、交互配色なら色数ぶん、グラデ配色なら本数ぶんの縞を1ループで送る。1本ぶんだけ送ると位置は合っても色がずれる。

ランダム性は `state.seed` と `MotionToolkit.seededRandom` に固定し、ヘッダーのボタンで seed を振り直す。粒状ノイズ（`paintGrain`）はフレームごとに引き直さず、seed 由来の固定タイルを重ねる。

Noise Plasma だけは画素単位で計算するため、`canvas.width / 粗さ` の縮小バッファへ `ImageData` を書いてから拡大している。色は `paletteTable` の256段 LUT を引く（ループ内で hex を解析しない）。

### 設定の永続化（2層）

1. **ツール自身**: 各 `<tool>.js` の先頭で `MOTION-LAB:<tool>-settings:vN` キーを定義し、`saveSettings()` / `restoreSettings()` を持つ。`restoreSettings` は `MotionStorage.restoreControl` を使う（不正値を弾くため直接 `.value =` しない）。値を変えるコントロールには `saveSettings` を繋ぐ（`createPlayer` の `onControlChange` 経由でもよい）。
2. **プリセット**: `tool-ui.js` が `<body data-tool-key="...">` を見て `settingsKeys` テーブルから設定キーを引き、`localStorage` の設定文字列と全コントロール値のスナップショットを**名前付きで何件でも**保存する（キーは `motion-lab:presets:<page>:v2`、旧 v1 の3枠は初回に移行）。読込と全体初期化は `location.reload()` して sessionStorage 経由で復元する。セクション単位の初期化はリロードせず、そのセクションのコントロールを HTML の `defaultValue` / `defaultChecked` / `defaultSelected` へ戻して `input` と `change` を投げる。

**新規ツールを追加したら `tool-ui.js` の `settingsKeys` にエントリを足すこと。** これを忘れるとプリセット UI がそのページで一切表示されない（`settingsKey` が undefined で早期 return する）。設定キーのスキーマを壊す変更をしたときは `:v1` → `:v2` のようにバージョンを上げる。

ローカルフォント対応ツール（Dial Type / Text Reel / Flip Panels / Word Conveyor / Panel Reveal / Polyomino Type / Slide Puzzle / Memory Flip）は、フォントバイナリだけ IndexedDB へ保存する。各ツールは `MotionFonts.createFontStore(FONT_ASSET_KEY)` で `{ read, write, remove }` を作り、`MotionFonts.registerFontFile(buffer, prefix)` で `FontFace` を登録する。外部送信はしない。

### 出力サイズ

`#outputSize` の `change` で `MotionToolkit.resizeOutputCanvas(canvas, value, dimensionsLabel)` を呼び、canvas の実ピクセルと `aspect-ratio` を張り替えてから `player.reset()` → `render()` する。値は `"1600x1000"` 形式か正方形の数値（漢字系の `400` / `800`）。**canvas サイズは固定定数ではなく `canvas.width/height` から読むこと。**

## ファイル名とツール名の対応（一致しないもの）

- `outline.html` → `app.js`（Outline Motion。輪郭抽出ロジックだけ `outline-trace.js` に分離）
- `reverse-kanji.html` / `reverse-kanji.js` → 「Kanji Writer」
- `text-dial.*` → 「Dial Type」、`polyomino-motion.*` → 「Polyomino Type」
- `slide-puzzle.*` → 「Slide Puzzle」、`memory-flip.*` → 「Memory Flip」（この2つはファイル名とツール名が一致する）
- 背景系5本（`grid-pulse.*` / `color-grid.*` / `gradient-loop.*` / `stripe-drift.*` / `noise-plasma.*`）もファイル名とツール名が一致する

CSS は `studio-tools.css`（Slice / Flip / Stroke Assemble / Radical / Slide Puzzle / Pencil Hatch）、`typography-tools.css`（Word Conveyor / Panel Reveal / Memory Flip、`studio-tools.css` を `@import` している）、`background-tools.css`（背景系5ツール、同じく `studio-tools.css` を `@import`）を共有し、残りはツール専用。`text-reel.html` は `text-dial.css` も読む。ツールごとのアクセントは `body.<tool>` の `--tool-accent` / `--tool-accent-soft` で定義する。

## 新しいツールを足すときのチェックリスト

1. `<tool>.html` + `<tool>.js` を既存ツールのマークアップから起こす（`.transport` と `.export-section` はそのまま流用）。
2. `tool-ui.js` の `settingsKeys` にエントリを足す。**忘れるとそのページでプリセット UI が一切出ない。**
3. `tool-nav.js` の `TOOLS` に追加する。忘れると全ページの切替メニューに出てこない。
4. `index.html` にカードを、`home.css` にそのプレビュー用スタイルを足す。**`home.css` の `order` 一覧にも必ず1行足す。** ホームのグリッドは `order` で並べ替えているので、書き忘れたカードは `order: 0` 扱いになり、最初のカテゴリ見出しより前へ飛び出す。
5. スクリプトの読み込み順を守る（`motion-controls.js` はツール本体の後、`tool-ui.js` は最後）。
6. 値表示の `<output>` は、対応するスライダーと同じ `<label for="...">` の中に置く。`motion-controls.js` は `#<id>Value` か `label[for=<id>] output` を探し、そこへ数値入力を差し込む。
7. 全体時間のスライダーは `max="90"`、背景色の既定は `#FFFFFF`、角丸の既定は `0`。
8. `README.md` に節を足す。

## コードスタイル

- 既存コードに合わせる：`"use strict";`、`const`/`let`、オプショナルチェーン、`Object.hasOwn`、私的スコープは IIFE。トランスパイルなしでモダンブラウザに直接流すので、ES2022 相当までそのまま使ってよい。
- UI 文言・ラベル・トースト・エラーメッセージはすべて日本語。コード内のコメントは英語で簡潔に（既存の `// The tools remain usable when storage is unavailable.` に倣う）。
- storage / IndexedDB / fetch まわりは `try { } catch { }` で握りつぶし、ストレージが使えない環境でもツールが動き続けるようにする（既存の全箇所がこの方針）。
- 確定・強調色は `#E0041D` で統一（Dial Type / Flip Panels / Stroke Assemble）。
- 文字列を1文字ずつ扱うときは `MotionToolkit.graphemes()`（`Intl.Segmenter` ベース）を使う。`split("")` は使わない。
- HTML は1行に詰めた密なマークアップ（既存ファイル参照）。整形して差分を膨らませない。

## ドキュメント

`README.md` はツールごとの機能を箇条書きで列挙している。ツールの挙動・上限値・出力サイズを変更したら該当節を更新する。

## 外部データ

漢字系ツールは Hanzi Writer Japanese Data（AnimCJK / Arphic Public License・LGPL）を jsDelivr → GitHub raw の順にフォールバック取得する。オフラインではキャッシュ済み文字のみ動作する。
