// PLaMo Translator - サイドバー
//
// 「任意の言語 → 日本語」と「日本語 → 任意の言語」の 2 モードを持つ翻訳フォーム。
// 片側は常に日本語で、もう片側の言語を select で選ぶ。⇄ でモードを入れ替える。
// 翻訳リクエストは background に送る (Origin を moz-extension:// にするため)。

const AUTO_DELAY_MS = 700;
const STATE_KEY = "sidebarState";

const els = {
  source: document.getElementById("source"),
  target: document.getElementById("target"),
  swap: document.getElementById("swap"),
  input: document.getElementById("input"),
  count: document.getElementById("count"),
  clear: document.getElementById("clear"),
  translate: document.getElementById("translate"),
  output: document.getElementById("output"),
  auto: document.getElementById("auto"),
  copy: document.getElementById("copy"),
};

// サイドバーはウィンドウごとに開けるので、インスタンスごとの channel で
// background 側の「古いリクエストの中断」を他のサイドバーと干渉させない。
const channel = `sidebar:${crypto.randomUUID()}`;

// mode: "to-ja" (foreignLang|auto → ja) | "from-ja" (ja → foreignLang)
const state = {
  mode: "to-ja",
  toJaSource: "auto", // to-ja モードの翻訳元。"auto" は自動判別
  fromJaTarget: PLAMO_DEFAULTS.fromJaLang, // from-ja モードの翻訳先
  autoTranslate: true,
};

let seq = 0;
let timer = null;
let lastRequestKey = null;

// やさしい日本語は翻訳先としてのみ意味がある
const SOURCE_LANGS = PLAMO_LANGS.filter(([code]) => code !== "ja(easy)");

function option(value, label) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  return o;
}

function renderSelects() {
  const { source, target } = els;
  source.replaceChildren();
  target.replaceChildren();
  if (state.mode === "to-ja") {
    source.append(option("auto", "言語を自動検出"), ...SOURCE_LANGS.map(([c, n]) => option(c, n)));
    source.value = state.toJaSource;
    if (source.value !== state.toJaSource) source.value = state.toJaSource = "auto";
    source.disabled = false;
    target.append(option("ja", "日本語"));
    target.disabled = true;
  } else {
    source.append(option("ja", "日本語"));
    source.disabled = true;
    target.append(...PLAMO_LANGS.map(([c, n]) => option(c, n)));
    // 設定ページでは一覧にない言語コードも指定できるので、その場合は選択肢に足す
    const known = PLAMO_LANGS.some(([c]) => c === state.fromJaTarget);
    if (!known && PLAMO_LANG_CODE_RE.test(state.fromJaTarget ?? "")) {
      target.append(option(state.fromJaTarget, state.fromJaTarget));
    }
    target.value = state.fromJaTarget;
    if (target.value !== state.fromJaTarget) target.value = state.fromJaTarget = PLAMO_DEFAULTS.fromJaLang;
    target.disabled = false;
  }
}

function currentLangs() {
  if (state.mode === "to-ja") {
    return { sourceLang: state.toJaSource === "auto" ? null : state.toJaSource, targetLang: "ja" };
  }
  return { sourceLang: "ja", targetLang: state.fromJaTarget };
}

function setOutput(text, kind) {
  els.output.textContent = text;
  els.output.className = kind;
  els.copy.disabled = kind !== "result";
}

function updateCount() {
  els.count.textContent = `${els.input.value.length} 文字`;
}

function saveState() {
  browser.storage.local.set({ [STATE_KEY]: { ...state } }).catch(console.warn);
}

async function translateNow() {
  clearTimeout(timer);
  const text = els.input.value;
  if (!text.trim()) {
    seq++;
    lastRequestKey = null;
    setOutput("翻訳結果", "placeholder");
    return;
  }
  const langs = currentLangs();
  const key = JSON.stringify([text, langs]);
  if (key === lastRequestKey) return; // 同じ内容で再翻訳しない
  lastRequestKey = key;

  const mySeq = ++seq;
  // 前回の結果を残したまま「翻訳中」を示すと読みづらいので置き換える
  setOutput("翻訳中...", "loading");
  let res;
  try {
    res = await browser.runtime.sendMessage({ type: "plamo:translate", text, ...langs, channel });
  } catch (e) {
    res = { ok: false, error: `拡張機能との通信に失敗しました: ${e.message}` };
  }
  if (mySeq !== seq || res?.aborted) return;
  if (res?.ok) {
    setOutput(res.text, "result");
  } else {
    lastRequestKey = null; // エラー時は同じ内容でも再試行できるようにする
    setOutput(`エラー: ${res?.error ?? "不明なエラー"}`, "error");
  }
}

function scheduleTranslate() {
  clearTimeout(timer);
  if (!state.autoTranslate) return;
  timer = setTimeout(translateNow, AUTO_DELAY_MS);
}

// 言語やモードを変えたときは入力があれば即座に翻訳し直す
function retranslate() {
  if (els.input.value.trim()) translateNow();
}

els.input.addEventListener("input", () => {
  updateCount();
  if (!els.input.value.trim()) {
    translateNow(); // 空になったら結果も消す
    return;
  }
  scheduleTranslate();
});

els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    lastRequestKey = null; // 明示的な翻訳は常に実行する
    translateNow();
  }
});

els.translate.addEventListener("click", () => {
  lastRequestKey = null;
  translateNow();
});

els.clear.addEventListener("click", () => {
  els.input.value = "";
  updateCount();
  translateNow();
  els.input.focus();
});

els.source.addEventListener("change", () => {
  state.toJaSource = els.source.value;
  saveState();
  retranslate();
});

els.target.addEventListener("change", () => {
  state.fromJaTarget = els.target.value;
  saveState();
  retranslate();
});

els.swap.addEventListener("click", () => {
  // DeepL と同様に、翻訳結果があればそれを新しい入力にする
  const hasResult = els.output.className === "result";
  if (state.mode === "to-ja") {
    // 自動検出以外の言語を選んでいたら、それを日本語からの翻訳先として引き継ぐ
    if (state.toJaSource !== "auto") state.fromJaTarget = state.toJaSource;
    state.mode = "from-ja";
  } else {
    // やさしい日本語は翻訳元に選べないので自動検出にする
    state.toJaSource = state.fromJaTarget === "ja(easy)" ? "auto" : state.fromJaTarget;
    state.mode = "to-ja";
  }
  renderSelects();
  saveState();
  if (hasResult) {
    els.input.value = els.output.textContent;
    updateCount();
  }
  retranslate();
  els.input.focus();
});

els.auto.addEventListener("change", () => {
  state.autoTranslate = els.auto.checked;
  saveState();
  if (state.autoTranslate) scheduleTranslate();
  else clearTimeout(timer);
});

els.copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(els.output.textContent);
    els.copy.textContent = "コピーしました";
  } catch (e) {
    els.copy.textContent = "コピー失敗";
    console.warn(e);
  }
  setTimeout(() => { els.copy.textContent = "コピー"; }, 1200);
});

async function init() {
  const stored = await browser.storage.local.get({ [STATE_KEY]: null, fromJaLang: PLAMO_DEFAULTS.fromJaLang });
  if (stored[STATE_KEY]) {
    Object.assign(state, stored[STATE_KEY]);
  } else {
    // 初回は設定ページの「日本語の翻訳先言語」を初期値にする
    state.fromJaTarget = stored.fromJaLang;
  }
  if (state.mode !== "to-ja" && state.mode !== "from-ja") state.mode = "to-ja";
  els.auto.checked = state.autoTranslate;
  renderSelects();
  updateCount();
  els.input.focus();
}

init();
