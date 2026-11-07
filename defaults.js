// background と options で共有する既定値
const PLAMO_DEFAULTS = Object.freeze({
  endpoint: "http://localhost:11434",
  model: "hf.co/pfnet/plamo-3-translate-2b-GGUF:Q4_K_M",
  // 原文が日本語のときの翻訳先。日本語以外の原文は常に日本語へ翻訳する。
  fromJaLang: "en",
});

// PLaMo のチャットテンプレートが受け付ける言語コード (例: en, ja, zh-hans, ja(easy))
const PLAMO_LANG_CODE_RE = /^(?:[a-z]{2,3}(?:-[a-z]{4})?|ja\(easy\))$/;
