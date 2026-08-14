# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

Motion Lab — ブラウザだけで動画（WebM）と静止画（PNG）素材を作る13種類のツール集。ビルドシステム・パッケージ管理・テスト・依存パッケージは一切なし。素の HTML / CSS / JavaScript（`"use strict"` + IIFE またはトップレベル定数）を Canvas 2D で描画している。

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
| `motion-toolkit.js` | `window.MotionToolkit`。`clamp` / `lerp` / `ease` / `graphemes` / `seededRandom` / `containRect` / `outputDimensions` / `resizeOutputCanvas`、および**再生・書き出しエンジン `createPlayer`** |
| `motion-storage.js` | `MotionStorage.read/write/restoreControl`。localStorage の安全な読み書きと、min/max・option 検証つきのコントロール復元 |
| `tool-ui.js` | 全ツール共通のプリセット UI（ヘッダーに3枠のセーブスロットを動的挿入）と、`tool-shell-compact` レイアウトの右パネル組み立て |
| `tool-ui.css` | 共通の画面部品（ヘッダー・セクション・トランスポート・出力欄） |

`kanji-data.js` は漢字系ツール用の Hanzi Writer Japanese Data 取得・localStorage キャッシュ（最大24文字）。

読み込み順は固定：`motion-storage.js` → `motion-toolkit.js` → `<tool>.js` → `tool-ui.js`（`tool-ui.js` は必ず最後）。

### createPlayer の契約

`MotionToolkit.createPlayer({ canvas, getDuration, isReady, render, onUpdate, onControlChange, getFileBase, loop })` は、**HTML 内の固定 ID を `document.querySelector` で直接拾う**。新規ツールの HTML は既存ツールの `.transport` / `.export-section` マークアップをそのまま流用すること。要求される ID：

`#playButton` `#restartButton` `#timeline` `#currentTime` `#totalTime` `#previewSpeed` `#imageTime` `#imageTimeValue` `#imageExportButton` `#exportButton` `#exportProgress` `#exportProgressBar` `#toast` `#outputSize`

ツール側が実装するのは `render(playhead)` のみ（`playhead` は 0〜1 の正規化値）。WebM 書き出しは `canvas.captureStream(0)` + `videoTrack.requestFrame()` の手動フレーム駆動 + `MediaRecorder`（VP9 → VP8 → webm の順にフォールバック）。プレビューと同じ `render` を requestAnimationFrame で回しつつ、playhead は経過時間ではなく**フレーム番号**（`round(duration × 60)` 枚）から決めて 1 枚ずつ送出するため尺が縮まずフレームも欠落しない（`requestFrame` 非対応環境は `captureStream(60)` の自動サンプリングへフォールバック）。**描画は playhead から完全に決定的でなければならない**（フレーム間で乱数を引かない。ランダム性は `seededRandom(state.seed)` で固定する）。

### 設定の永続化（2層）

1. **ツール自身**: 各 `<tool>.js` の先頭で `MOTION-LAB:<tool>-settings:vN` キーを定義し、`saveSettings()` / `restoreSettings()` を持つ。`restoreSettings` は `MotionStorage.restoreControl` を使う（不正値を弾くため直接 `.value =` しない）。値を変えるコントロールには `saveSettings` を繋ぐ（`createPlayer` の `onControlChange` 経由でもよい）。
2. **プリセット**: `tool-ui.js` が `<body data-tool-key="...">` を見て `settingsKeys` テーブルから設定キーを引き、`localStorage` の設定文字列と全コントロール値のスナップショットを3枠に保存する。読込・初期化は `location.reload()` して sessionStorage 経由で復元する。

**新規ツールを追加したら `tool-ui.js` の `settingsKeys` にエントリを足すこと。** これを忘れるとプリセット UI がそのページで一切表示されない（`settingsKey` が undefined で早期 return する）。設定キーのスキーマを壊す変更をしたときは `:v1` → `:v2` のようにバージョンを上げる。

ローカルフォント対応ツール（Dial Type / Text Reel / Flip Panels / Word Conveyor / Panel Reveal / Polyomino Type）は、フォントバイナリだけ IndexedDB（`openFontDatabase` / `readFontAsset` / `writeFontAsset` / `deleteFontAsset` の同型パターンが各ファイルに複製されている）へ保存する。外部送信はしない。

### 出力サイズ

`#outputSize` の `change` で `MotionToolkit.resizeOutputCanvas(canvas, value, dimensionsLabel)` を呼び、canvas の実ピクセルと `aspect-ratio` を張り替えてから `player.reset()` → `render()` する。値は `"1600x1000"` 形式か正方形の数値（漢字系の `400` / `800`）。**canvas サイズは固定定数ではなく `canvas.width/height` から読むこと。**

## ファイル名とツール名の対応（一致しないもの）

- `outline.html` → `app.js`（Outline Motion。輪郭抽出ロジックだけ `outline-trace.js` に分離）
- `reverse-kanji.html` / `reverse-kanji.js` → 「Kanji Writer」
- `text-dial.*` → 「Dial Type」、`polyomino-motion.*` → 「Polyomino Type」

CSS は `studio-tools.css`（Slice / Flip / Stroke Assemble / Radical）、`typography-tools.css`（Word Conveyor / Panel Reveal）を共有し、残りはツール専用。`text-reel.html` は `text-dial.css` も読む。

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
