// PLaMo Translator - content script
//
// background から scripting.executeScript で都度注入される。
// 二重注入されてもリスナーが重複しないようにガードする。
// 翻訳リクエスト自体は background に runtime.sendMessage で依頼する
// (ここから fetch すると Origin がページになり ollama に弾かれるため)。

(() => {
  if (window.__plamoTranslatorLoaded) return;
  window.__plamoTranslatorLoaded = true;

  const STYLE = `
    :host { all: initial; }
    .box {
      box-sizing: border-box;
      max-width: min(560px, calc(100vw - 16px));
      min-width: 160px;
      max-height: 50vh;
      overflow: auto;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid #c9ccd1;
      background: #ffffff;
      color: #1f2328;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
      font: 14px/1.6 system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
      white-space: pre-wrap;
      word-break: break-word;
      text-align: left;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
      font-size: 11px;
      color: #6e7781;
      user-select: none;
    }
    .close {
      all: unset;
      cursor: pointer;
      padding: 0 4px;
      font-size: 16px;
      line-height: 1;
      color: #6e7781;
    }
    .close:hover { color: #1f2328; }
    .loading { color: #6e7781; font-style: italic; }
    .error { color: #cf222e; }
    @media (prefers-color-scheme: dark) {
      .box { background: #22272e; color: #e6edf3; border-color: #444c56; }
      .header, .close, .loading { color: #9198a1; }
      .close:hover { color: #e6edf3; }
      .error { color: #ff7b72; }
    }
  `;

  let host = null;
  let body = null;
  let requestSeq = 0;

  function selectionRect() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      // input/textarea 内の選択などは range の矩形が取れないので要素の矩形で代用
      const el = document.activeElement;
      return el && el !== document.body ? el.getBoundingClientRect() : null;
    }
    return rect;
  }

  function selectedText() {
    const el = document.activeElement;
    if (el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && /^(text|search|url|email)$/i.test(el.type)))) {
      const s = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
      if (s) return s;
    }
    return window.getSelection()?.toString() ?? "";
  }

  function closeOverlay() {
    if (!host) return;
    host.remove();
    host = null;
    body = null;
    requestSeq++; // 進行中のリクエスト結果を捨てる
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("mousedown", onMouseDown, true);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") closeOverlay();
  }

  function onMouseDown(e) {
    if (host && !e.composedPath().includes(host)) closeOverlay();
  }

  function openOverlay(rect) {
    closeOverlay();

    host = document.createElement("plamo-translator-overlay");
    host.style.cssText = "all: initial; position: absolute; z-index: 2147483647; top: 0; left: 0;";
    const shadow = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = STYLE;

    const box = document.createElement("div");
    box.className = "box";

    const header = document.createElement("div");
    header.className = "header";
    const label = document.createElement("span");
    label.textContent = "PLaMo 翻訳";
    const closeBtn = document.createElement("button");
    closeBtn.className = "close";
    closeBtn.textContent = "×";
    closeBtn.title = "閉じる (Esc)";
    closeBtn.addEventListener("click", closeOverlay);
    header.append(label, closeBtn);

    body = document.createElement("div");
    box.append(header, body);
    shadow.append(style, box);
    (document.body ?? document.documentElement).append(host);

    position(rect);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onMouseDown, true);
  }

  function position(rect) {
    if (!host) return;
    const margin = 8;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const r = rect ?? { left: vw / 2 - 140, top: margin, bottom: margin, width: 0 };
    const w = host.offsetWidth;
    const h = host.offsetHeight;

    let left = Math.min(Math.max(r.left, margin), Math.max(vw - w - margin, margin));
    // 基本は選択範囲の下。下に収まらず上に余裕があれば上に出す
    let top = r.bottom + margin;
    if (top + h > vh && r.top - h - margin > 0) top = r.top - h - margin;

    host.style.left = `${left + window.scrollX}px`;
    host.style.top = `${top + window.scrollY}px`;
  }

  function setContent(text, kind, rect) {
    if (!body) return;
    body.className = kind;
    body.textContent = text;
    position(rect); // 内容でサイズが変わるので再配置
  }

  async function run(text) {
    const rect = selectionRect();
    openOverlay(rect);
    const mySeq = ++requestSeq;

    if (!text || !text.trim()) {
      setContent("翻訳するテキストが選択されていません。", "error", rect);
      return;
    }

    setContent("翻訳中...", "loading", rect);
    let res;
    try {
      res = await browser.runtime.sendMessage({ type: "plamo:translate", text });
    } catch (e) {
      res = { ok: false, error: `拡張機能との通信に失敗しました: ${e.message}` };
    }
    if (mySeq !== requestSeq) return; // 閉じられた or 新しい翻訳が始まった
    if (res?.ok) {
      setContent(res.text, "result", rect);
    } else {
      setContent(`エラー: ${res?.error ?? "不明なエラー"}`, "error", rect);
    }
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type !== "plamo:start") return undefined;
    // コンテキストメニュー経由なら selectionText が来るが、改行が潰れているので
    // ページ側で取れる場合はそちらを優先する
    const text = selectedText() || message.selectionText || "";
    run(text);
    return undefined;
  });
})();
