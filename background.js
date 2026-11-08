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

const LANG_NAMES = Object.fromEntries(PLAMO_LANGS);

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

// メッセージ形式:
//   content script: { type: "plamo:translate", text, direction }
//   サイドバー:     { type: "plamo:translate", text, sourceLang?, targetLang, channel }
// channel を指定した場合、同じ channel の進行中リクエストは中断して新しいものに置き換える
// (サイドバーの入力中自動翻訳でリクエストが溜まらないようにするため)。
browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "plamo:translate") {
    return handleTranslate(message);
  }
  return undefined;
});

const inflight = new Map(); // channel -> AbortController

async function handleTranslate(message) {
  const settings = await loadSettings();
  let langs;
  if (message.direction) {
    langs = directionLangs(settings, message.direction);
    if (!langs) return { ok: false, error: `不明な翻訳方向: ${message.direction}` };
  } else {
    langs = { sourceLang: message.sourceLang || null, targetLang: message.targetLang };
    for (const code of [langs.sourceLang, langs.targetLang]) {
      if (code !== null && !PLAMO_LANG_CODE_RE.test(code ?? "")) {
        return { ok: false, error: `不正な言語コード: ${code}` };
      }
    }
  }

  const controller = new AbortController();
  const channel = message.channel;
  if (channel) {
    inflight.get(channel)?.abort();
    inflight.set(channel, controller);
  }
  try {
    return await translate(settings, message.text, langs, controller.signal);
  } finally {
    if (channel && inflight.get(channel) === controller) inflight.delete(channel);
  }
}

async function loadSettings() {
  const stored = await browser.storage.local.get(PLAMO_DEFAULTS);
  return { ...PLAMO_DEFAULTS, ...stored };
}

// to-ja: 原文の言語はモデルに自動判別させるので source_lang は渡さない。
// from-ja: 原文が日本語だと分かっているので source_lang=ja を明示する。
function directionLangs(settings, direction) {
  if (direction === "to-ja") return { sourceLang: null, targetLang: "ja" };
  if (direction === "from-ja") {
    const fromJaLang = PLAMO_LANG_CODE_RE.test(settings.fromJaLang) ? settings.fromJaLang : PLAMO_DEFAULTS.fromJaLang;
    return { sourceLang: "ja", targetLang: fromJaLang };
  }
  return null;
}

// 戻り値: { ok: true, text, targetLang } | { ok: false, error, aborted? }
// sourceLang が null ならモデルに原文の言語を自動判別させる。
// signal が外部から abort された場合 (同じ channel の新しいリクエストに置き換えられた) は aborted: true を返す。
async function translate(settings, text, { sourceLang, targetLang }, signal) {
  const settingsBlock = `[plamo-translate]\ntarget_lang=${targetLang}` + (sourceLang ? `\nsource_lang=${sourceLang}` : "");
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
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
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
      if (signal?.aborted) return { ok: false, aborted: true, error: "中断されました" };
      return { ok: false, error: `タイムアウトしました (${REQUEST_TIMEOUT_MS / 1000} 秒)` };
    }
    return { ok: false, error: `接続に失敗しました: ${e.message}\n(${url})` };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
