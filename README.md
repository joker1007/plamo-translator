# PLaMo Translator (Firefox 拡張)

ページ上で選択したテキストを、ローカルネットワーク上の ollama で動く
PLaMo 3 Translate で翻訳し、選択範囲の近くにオーバーレイ表示する Firefox 拡張です。
サイドバーのフォームに入力したテキストも翻訳できます。
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

### サイドバー

DeepL のように、サイドバーのフォームに入力したテキストを翻訳できます。
**Ctrl+Alt+S** か、Firefox のサイドバー切り替え (表示 → サイドバー → PLaMo 翻訳) で開きます。

- 上部の言語選択で向きを選ぶ。片側は常に日本語で、⇄ ボタンで向きを入れ替える
  - 任意の言語 → 日本語: 翻訳元は「言語を自動検出」か特定の言語 (指定すると `source_lang` を渡す)
  - 日本語 → 任意の言語: 翻訳先を選ぶ (初期値は設定の「日本語の翻訳先言語」)
- ⇄ で入れ替えると、翻訳結果が新しい入力欄に入る
- 「入力中に自動翻訳」がオンなら入力が止まって 0.7 秒後に翻訳する。
  新しいリクエストを送ると、まだ終わっていない前のリクエストは中断する
- **Ctrl+Enter** か「翻訳」ボタンですぐに翻訳する
- 選んだ言語と自動翻訳のオン/オフは `storage.local` (`sidebarState`) に保存される

ショートカットは `about:addons` → 歯車 →「拡張機能のショートカットキーを管理」で変更できます。
Alt+英字は Firefox のメニューバー (Alt+T =「ツール」など) と衝突するため既定にしていません。

## 読み込み方法 (一時的なアドオン)

1. Firefox で `about:debugging#/runtime/this-firefox` を開く
2. 「一時的なアドオンを読み込む...」でこのディレクトリの `manifest.json` を選択
3. `about:addons` → PLaMo Translator →「権限」タブで
   `localhost` へのアクセス権限が有効になっていることを確認する
   (MV3 ではホスト権限がユーザー許可制のため。無効だと翻訳リクエストが失敗する)
4. ollama が別ホストで動いている場合は、設定でエンドポイント URL を変えて保存し、
   表示されるダイアログでそのホストへのアクセスを許可する

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
| エンドポイント URL | `http://localhost:11434` |
| モデル名 | `hf.co/pfnet/plamo-3-translate-2b-GGUF:Q4_K_M` |
| 日本語の翻訳先言語 | `en` (`ko`, `zh-hans`, `fr`, `ja(easy)` など PLaMo が受け付ける小文字の言語コード) |

「日本語の翻訳先言語」を変えると、右クリックメニューの表示も追従します。

エンドポイントを localhost 以外のホストに変えた場合は、保存時にそのホストへの権限を求めます。

## ollama 側の前提

- 設定したエンドポイントで ollama に到達できること
- モデル `hf.co/pfnet/plamo-3-translate-2b-GGUF:Q4_K_M` が pull 済みであること
  (`ollama pull hf.co/pfnet/plamo-3-translate-2b-GGUF:Q4_K_M`)
- 環境変数 `OLLAMA_ORIGINS="moz-extension://*"` を設定していること。
  既定では `Origin: moz-extension://...` のリクエストが 403 になる。
  systemd で動かしている場合は drop-in (`systemctl edit ollama`) に
  `Environment="OLLAMA_ORIGINS=moz-extension://*"` を書いて再起動する
- ollama は Host ヘッダを検査するため、エンドポイントのホスト名によっては 403 になる。
  例えば Tailscale の MagicDNS では、短いホスト名や IP は通るが `<host>.<tailnet>.ts.net` の FQDN は 403 になる
- OpenAI 互換 API (`/v1/chat/completions`) を非ストリーミングで使う。
  system メッセージに `[plamo-translate]\ntarget_lang=<言語コード>` (日本語から翻訳する場合は `source_lang=ja` も) を渡す

### http:// への接続について

Firefox の Manifest V3 は既定の CSP に `upgrade-insecure-requests` を含むため、
そのままだと `http://<host>:11434` への fetch が `https://` に昇格されて
`NetworkError` になります。`manifest.json` の `content_security_policy.extension_pages` で
`upgrade-insecure-requests` を含まない CSP (`script-src 'self'`) を明示しています。

### Origin ヘッダについて

ollama は Origin ヘッダも検査します。content script から fetch するとページの
Origin になって弾かれるため、翻訳リクエストは background script から送っています
(Origin は `moz-extension://<UUID>` になるので、上記の `OLLAMA_ORIGINS` で許可する)。

## ファイル構成

- `manifest.json` — Manifest V3 (Firefox 形式、`background.scripts`)
- `defaults.js` — 設定の既定値と言語一覧 (background / options / sidebar で共有)
- `background.js` — コンテキストメニュー・ショートカット・翻訳 API 呼び出し (サイドバーからの翻訳依頼もここで処理)
- `content.js` — 選択範囲の取得と Shadow DOM オーバーレイ (都度注入)
- `sidebar.html` / `sidebar.js` — 翻訳サイドバー (`sidebar_action`)
- `options.html` / `options.js` — 設定ページ
