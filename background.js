// PLaMo Translator - background script
//
// ollama は Origin ヘッダを検査しており、content script からの fetch は
// ページの Origin になって弾かれる。そのため翻訳リクエストは必ずここ
// (moz-extension:// Origin) から送る。ollama 側で
// OLLAMA_ORIGINS に moz-extension://* を許可しておく必要がある。

const REQUEST_TIMEOUT_MS = 120_000;

// 翻訳の向き。実行時 (メニュー項目 / ショートカット) で選ぶ。
const DIRECTIONS = Object.freeze({
  "to-ja": { menuId: "plamo-to-ja", command: "translate-to-ja" },
  "from-ja": { menuId: "plamo-from-ja", command: "translate-from-ja" },
});

const LANG_NAMES = {
  en: "英語", "zh-hans": "中国語 (簡体字)", "zh-hant": "中国語 (繁体字)", ko: "韓国語",
  fr: "フランス語", de: "ドイツ語", es: "スペイン語", it: "イタリア語", pt: "ポルトガル語",
  ru: "ロシア語", vi: "ベトナム語", th: "タイ語", id: "インドネシア語", "ja(easy)": "やさしい日本語",
};

function langName(code) {
  return LANG_NAMES[code] ?? code;
}

// 複数項目は Firefox が拡張名のサブメニューにまとめて表示する。
async function setupMenus() {
  const { fromJaLang } = await loadSettings();
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: DIRECTIONS["to-ja"].menuId,
    title: "日本語へ翻訳",
    contexts: ["selection"],
  });
  browser.contextMenus.create({
    id: DIRECTIONS["from-ja"].menuId,
    title: `日本語から${langName(fromJaLang)}へ翻訳`,
    contexts: ["selection"],
  });
}

browser.runtime.onInstalled.addListener(setupMenus);
browser.runtime.onStartup.addListener(setupMenus);
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.fromJaLang) setupMenus();
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  const direction = Object.keys(DIRECTIONS).find((d) => DIRECTIONS[d].menuId === info.menuItemId);
  if (!direction || !tab) return;
  startTranslation(tab, info.frameId ?? 0, info.selectionText, direction);
});

browser.commands.onCommand.addListener(async (command, tab) => {
  const direction = Object.keys(DIRECTIONS).find((d) => DIRECTIONS[d].command === command);
  if (!direction) return;
  const target = tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  if (target) startTranslation(target, 0, null, direction);
});

// content script を注入し、翻訳開始を指示する。
// content script はオーバーレイを出してから runtime.sendMessage で翻訳を依頼してくる。
async function startTranslation(tab, frameId, selectionText, direction) {
  try {
    await browser.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frameId] },
      files: ["content.js"],
    });
    await browser.tabs.sendMessage(
      tab.id,
      { type: "plamo:start", selectionText, direction },
      { frameId },
    );
  } catch (e) {
    // about: ページや addons.mozilla.org など注入できないページ
    console.warn("[plamo-translator] content script を注入できません:", e);
  }
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "plamo:translate") {
    return translate(message.text, message.direction);
  }
  return undefined;
});

async function loadSettings() {
  const stored = await browser.storage.local.get(PLAMO_DEFAULTS);
  return { ...PLAMO_DEFAULTS, ...stored };
}

// 戻り値: { ok: true, text, targetLang } | { ok: false, error }
// to-ja: 原文の言語はモデルに自動判別させるので source_lang は渡さない。
// from-ja: 原文が日本語だと分かっているので source_lang=ja を明示する。
async function translate(text, direction) {
  if (!(direction in DIRECTIONS)) return { ok: false, error: `不明な翻訳方向: ${direction}` };
  const settings = await loadSettings();
  const fromJaLang = PLAMO_LANG_CODE_RE.test(settings.fromJaLang) ? settings.fromJaLang : PLAMO_DEFAULTS.fromJaLang;
  const targetLang = direction === "to-ja" ? "ja" : fromJaLang;
  const settingsBlock = direction === "to-ja"
    ? `[plamo-translate]\ntarget_lang=ja`
    : `[plamo-translate]\ntarget_lang=${targetLang}\nsource_lang=ja`;
  const url = settings.endpoint.replace(/\/+$/, "") + "/v1/chat/completions";
  const body = {
    model: settings.model,
    messages: [
      { role: "system", content: settingsBlock },
      { role: "user", content: text },
    ],
    temperature: 0,
    stop: ["<|plamo:tag|>", "<|plamo:bos|>"],
    keep_alive: "30m",
    stream: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 500);
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}${detail ? `\n${detail}` : ""}` };
    }
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return { ok: false, error: "レスポンスに choices[0].message.content がありません" };
    }
    return { ok: true, text: content.trim(), targetLang };
  } catch (e) {
    if (e.name === "AbortError") {
      return { ok: false, error: `タイムアウトしました (${REQUEST_TIMEOUT_MS / 1000} 秒)` };
    }
    return { ok: false, error: `接続に失敗しました: ${e.message}\n(${url})` };
  } finally {
    clearTimeout(timer);
  }
}
