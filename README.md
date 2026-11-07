# PLaMo Translator (Firefox 拡張)

ページ上で選択したテキストを、ローカルネットワーク上の ollama で動く
PLaMo 3 Translate で翻訳し、選択範囲の近くにオーバーレイ表示する Firefox 拡張です。
ビルド不要の素の JS/HTML/CSS で、Manifest V3 で書いています。

## 使い方

- テキストを選択して右クリック →「PLaMo で翻訳」
- またはテキストを選択して **Alt+T**
- オーバーレイは Esc キー / 外側クリック / × ボタンで閉じる

ショートカットは `about:addons` → 歯車 →「拡張機能のショートカットキーを管理」で変更できます。

## 読み込み方法 (一時的なアドオン)

1. Firefox で `about:debugging#/runtime/this-firefox` を開く
2. 「一時的なアドオンを読み込む...」でこのディレクトリの `manifest.json` を選択
3. `about:addons` → PLaMo Translator →「権限」タブで
   `ollama-host` へのアクセス権限が有効になっていることを確認する
   (MV3 ではホスト権限がユーザー許可制のため。無効だと翻訳リクエストが失敗する)

一時的なアドオンは Firefox を再起動すると消えます。コードを変更したら
`about:debugging` の「再読み込み」で反映できます。

## 設定

`about:addons` → PLaMo Translator →「設定」で変更できます (`storage.local` に保存)。

| 項目 | 既定値 |
| --- | --- |
| エンドポイント URL | `http://ollama-host:11434` |
| モデル名 | `hf.co/pfnet/plamo-3-translate-2b-GGUF:Q4_K_M` |
| 翻訳先言語 | `ja` (`en` も選択可) |

エンドポイントを `ollama-host` 以外のホストに変えた場合は、保存時にそのホストへの権限を求めます。

## ollama 側の前提

- ollama が Tailscale 経由で `http://ollama-host:11434` で到達できること
- モデル `hf.co/pfnet/plamo-3-translate-2b-GGUF:Q4_K_M` が pull 済みであること
  (`ollama pull hf.co/pfnet/plamo-3-translate-2b-GGUF:Q4_K_M`)
- ホスト名は `ollama-host` (または IP) を使う。ollama は Host ヘッダを検査するため、
  `ollama-host.<tailnet>.ts.net` のような FQDN では 403 になる
- OpenAI 互換 API (`/v1/chat/completions`) を非ストリーミングで使う。
  system メッセージに `[plamo-translate]\ntarget_lang=ja` を渡す

### Origin ヘッダについて

ollama は Origin ヘッダも検査します。content script から fetch するとページの
Origin になって弾かれるため、翻訳リクエストは background script から送っています。

さらに、ollama v0.40.14 の既定設定では `Origin: moz-extension://...` も 403 に
なることを確認しています。そのため background では `webRequest` で
**この拡張自身が送る `/v1/chat/completions` へのリクエストに限り Origin ヘッダを除去**
しています (curl と同じ Origin 無しのリクエストになる)。

ollama 側で `OLLAMA_ORIGINS=moz-extension://*` を設定すれば、この回避策が無くても
通るはずです。

## ファイル構成

- `manifest.json` — Manifest V3 (Firefox 形式、`background.scripts`)
- `defaults.js` — 設定の既定値 (background / options で共有)
- `background.js` — コンテキストメニュー・ショートカット・翻訳 API 呼び出し
- `content.js` — 選択範囲の取得と Shadow DOM オーバーレイ (都度注入)
- `options.html` / `options.js` — 設定ページ
