// background と options で共有する既定値
const PLAMO_DEFAULTS = Object.freeze({
  endpoint: "http://localhost:11434",
  model: "hf.co/pfnet/plamo-3-translate-2b-GGUF:Q4_K_M",
  // 原文が日本語のときの翻訳先。日本語以外の原文は常に日本語へ翻訳する。
  fromJaLang: "en",
});

// PLaMo のチャットテンプレートが受け付ける言語コード (例: en, ja, zh-hans, ja(easy))
const PLAMO_LANG_CODE_RE = /^(?:[a-z]{2,3}(?:-[a-z]{4})?|ja\(easy\))$/;

// 日本語以外の翻訳言語 (コード, 表示名)。メニュー表示やサイドバーの言語選択で使う。
const PLAMO_LANGS = Object.freeze([
  ["en", "英語"],
  ["zh-hans", "中国語 (簡体字)"],
  ["zh-hant", "中国語 (繁体字)"],
  ["ko", "韓国語"],
  ["fr", "フランス語"],
  ["de", "ドイツ語"],
  ["es", "スペイン語"],
  ["it", "イタリア語"],
  ["pt", "ポルトガル語"],
  ["ru", "ロシア語"],
  ["vi", "ベトナム語"],
  ["th", "タイ語"],
  ["id", "インドネシア語"],
  ["ja(easy)", "やさしい日本語"],
]);
