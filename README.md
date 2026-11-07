# PLaMo Translator (Firefox 拡張)

ページ上で選択したテキストを、ローカルネットワーク上の ollama で動く
PLaMo 3 Translate で翻訳し、選択範囲の近くにオーバーレイ表示する Firefox 拡張です。
任意の言語 → 日本語、日本語 → 任意の言語 (設定で指定) の両方向に対応し、向きは翻訳実行時に選びます。
ビルド不要の素の JS/HTML/CSS で、Manifest V3 で書いています。

## 使い方

テキストを選択して、翻訳の向きに応じて次のどちらかを実行します。

| 向き | 右クリックメニュー (PLaMo Translator のサブメニュー) | ショートカット |
| --- | --- | --- |
| 任意の言語 → 日本語 | 「日本語へ翻訳」 | **Ctrl+Alt+J** |
| 日本語 → 設定した言語 | 「日本語から英語へ翻訳」など | **Ctrl+Alt+E** |

- 日本語へ翻訳するときは原文の言語をモデルが自動判別する (`source_lang` は渡さない)
- 日本語から翻訳するときは `source_lang=ja` を明示する
- オーバーレイは Esc キー / 外側クリック / × ボタンで閉じる

ショートカットは `about:addons` → 歯車 →「拡張機能のショートカットキーを管理」で変更できます。
Alt+英字は Firefox のメニューバー (Alt+T =「ツール」など) と衝突するため既定にしていません。

## 読み込み方法 (一時的なアドオン)

1. Firefox で `about:debugging#/runtime/this-firefox` を開く
2. 「一時的なアドオンを読み込む...」でこのディレクトリの `manifest.json` を選択
3. `about:addons` → PLaMo Translator →「権限」タブで
   `ollama-host` へのアクセス権限が有効になっていることを確認する
   (MV3 ではホスト権限がユーザー許可制のため。無効だと翻訳リクエストが失敗する)

一時的なアドオンは Firefox を再起動すると消えます。コードを変更したら
`about:debugging` の「再読み込み」で反映できます。

## xpi の作成

```sh
make        # dist/plamo-translator-<version>.xpi を生成
make lint   # manifest.json の JSON 検証と JS の構文チェック (node が必要)
make clean  # dist/ を削除
```

`zip` と `jq` が必要です。拡張にファイルを追加したら `Makefile` の `SRCS` にも足してください。

生成した xpi は署名されていないため、通常版の Firefox には恒久的にインストールできません。
Developer Edition / Nightly で `xpinstall.signatures.required` を `false` にするか、
AMO で署名 (unlisted でも可) する必要があります。

## 設定

`about:addons` → PLaMo Translator →「設定」で変更できます (`storage.local` に保存)。

| 項目 | 既定値 |
| --- | --- |
| エンドポイント URL | `http://ollama-host:11434` |
| モデル名 | `hf.co/pfnet/plamo-3-translate-2b-GGUF:Q4_K_M` |
| 日本語の翻訳先言語 | `en` (`ko`, `zh-hans`, `fr`, `ja(easy)` など PLaMo が受け付ける小文字の言語コード) |

「日本語の翻訳先言語」を変えると、右クリックメニューの表示も追従します。

エンドポイントを `ollama-host` 以外のホストに変えた場合は、保存時にそのホストへの権限を求めます。

## ollama 側の前提

- ollama が Tailscale 経由で `http://ollama-host:11434` で到達できること
- モデル `hf.co/pfnet/plamo-3-translate-2b-GGUF:Q4_K_M` が pull 済みであること
  (`ollama pull hf.co/pfnet/plamo-3-translate-2b-GGUF:Q4_K_M`)
- 環境変数 `OLLAMA_ORIGINS="moz-extension://*"` を設定していること。
  既定では `Origin: moz-extension://...` のリクエストが 403 になる。
  systemd で動かしている場合は drop-in (`systemctl edit ollama`) に
  `Environment="OLLAMA_ORIGINS=moz-extension://*"` を書いて再起動する
- ホスト名は `ollama-host` (または IP) を使う。ollama は Host ヘッダを検査するため、
  `ollama-host.<tailnet>.ts.net` のような FQDN では 403 になる
- OpenAI 互換 API (`/v1/chat/completions`) を非ストリーミングで使う。
  system メッセージに `[plamo-translate]\ntarget_lang=<言語コード>` (日本語から翻訳する場合は `source_lang=ja` も) を渡す

### http:// への接続について

Firefox の Manifest V3 は既定の CSP に `upgrade-insecure-requests` を含むため、
そのままだと `http://ollama-host:11434` への fetch が `https://` に昇格されて
`NetworkError` になります。`manifest.json` の `content_security_policy.extension_pages` で
`upgrade-insecure-requests` を含まない CSP (`script-src 'self'`) を明示しています。

### Origin ヘッダについて

ollama は Origin ヘッダも検査します。content script から fetch するとページの
Origin になって弾かれるため、翻訳リクエストは background script から送っています
(Origin は `moz-extension://<UUID>` になるので、上記の `OLLAMA_ORIGINS` で許可する)。

## ファイル構成

- `manifest.json` — Manifest V3 (Firefox 形式、`background.scripts`)
- `defaults.js` — 設定の既定値 (background / options で共有)
- `background.js` — コンテキストメニュー・ショートカット・翻訳 API 呼び出し
- `content.js` — 選択範囲の取得と Shadow DOM オーバーレイ (都度注入)
- `options.html` / `options.js` — 設定ページ
