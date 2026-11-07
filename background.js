// PLaMo Translator - background script
//
// ollama は Origin ヘッダを検査しており、content script からの fetch は
// ページの Origin になって弾かれる。そのため翻訳リクエストは必ずここ
// (moz-extension:// Origin) から送る。

const MENU_ID = "plamo-translate";
const REQUEST_TIMEOUT_MS = 120_000;
const EXTENSION_BASE_URL = browser.runtime.getURL("");

// ollama の OLLAMA_ORIGINS に moz-extension://* が含まれていない環境
// (少なくとも v0.40.14 の既定) では Origin: moz-extension://... が 403 になる。
// この拡張自身が送る翻訳リクエストに限って Origin ヘッダを外し、
// curl と同じ「Origin なし」のリクエストにする。
// 対象はホスト権限を持つ URL のみ (既定は http://ollama-host/*)。
browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const fromSelf = (details.originUrl ?? details.documentUrl ?? "").startsWith(EXTENSION_BASE_URL);
    if (!fromSelf || !details.url.endsWith("/v1/chat/completions")) return {};
    return {
      requestHeaders: details.requestHeaders.filter((h) => h.name.toLowerCase() !== "origin"),
    };
  },
  { urls: ["http://*/*", "https://*/*"], types: ["xmlhttprequest"] },
  ["blocking", "requestHeaders"],
);

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: MENU_ID,
    title: "PLaMo で翻訳",
    contexts: ["selection"],
  });
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab) return;
  startTranslation(tab, info.frameId ?? 0, info.selectionText);
});

browser.commands.onCommand.addListener((command, tab) => {
  if (command !== "translate-selection") return;
  if (tab) {
    startTranslation(tab, 0, null);
  } else {
    browser.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
      if (t) startTranslation(t, 0, null);
    });
  }
});

// content script を注入し、翻訳開始を指示する。
// content script はオーバーレイを出してから runtime.sendMessage で翻訳を依頼してくる。
async function startTranslation(tab, frameId, selectionText) {
  try {
    await browser.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frameId] },
      files: ["content.js"],
    });
    await browser.tabs.sendMessage(
      tab.id,
      { type: "plamo:start", selectionText },
      { frameId },
    );
  } catch (e) {
    // about: ページや addons.mozilla.org など注入できないページ
    console.warn("[plamo-translator] content script を注入できません:", e);
  }
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "plamo:translate") {
    return translate(message.text);
  }
  return undefined;
});

async function loadSettings() {
  const stored = await browser.storage.local.get(PLAMO_DEFAULTS);
  return { ...PLAMO_DEFAULTS, ...stored };
}

// 原文が日本語かどうかの判定。
// 漢字は中国語と共通なので、かなを含むことを必須条件にする。
// そのうえで日本語の文字 (かな・漢字) が全文字の 30% 以上なら日本語とみなす
// (カタカナ語を少し含む英文などを日本語扱いしないため)。
// かなを含まない漢字だけの短文は日本語以外と判定され、日本語へ翻訳される。
function isJapanese(text) {
  const kana = text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
  if (kana === 0) return false;
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  return (kana + han) / letters >= 0.3;
}

function resolveTargetLang(text, settings) {
  if (!isJapanese(text)) return "ja";
  return PLAMO_LANG_CODE_RE.test(settings.fromJaLang) ? settings.fromJaLang : PLAMO_DEFAULTS.fromJaLang;
}

// 戻り値: { ok: true, text, targetLang } | { ok: false, error }
// 原文の言語はモデルが自動判別するので source_lang は渡さない。
async function translate(text) {
  const settings = await loadSettings();
  const targetLang = resolveTargetLang(text, settings);
  const url = settings.endpoint.replace(/\/+$/, "") + "/v1/chat/completions";
  const body = {
    model: settings.model,
    messages: [
      { role: "system", content: `[plamo-translate]\ntarget_lang=${targetLang}` },
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
