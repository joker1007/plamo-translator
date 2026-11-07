const form = document.getElementById("form");
const fields = {
  endpoint: document.getElementById("endpoint"),
  model: document.getElementById("model"),
  targetLang: document.getElementById("targetLang"),
};
const statusEl = document.getElementById("status");

function showStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.className = isError ? "error" : "";
}

function fill(values) {
  for (const [key, el] of Object.entries(fields)) el.value = values[key];
}

async function load() {
  fill(await browser.storage.local.get(PLAMO_DEFAULTS));
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const endpoint = fields.endpoint.value.trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    showStatus("URL が不正です", true);
    return;
  }

  // 既定 (http://ollama-host/*) 以外のホストを使う場合はホスト権限を要求する。
  // permissions.request はユーザー操作の直後に同期的に呼ぶ必要があるので await より前に呼ぶ。
  // match pattern にはポートを含めない (Firefox はポートを無視して照合する)。
  const originPattern = `${url.protocol}//${url.hostname}/*`;
  const granted = await browser.permissions.request({ origins: [originPattern] }).catch((err) => {
    console.warn(err);
    return false;
  });

  await browser.storage.local.set({
    endpoint,
    model: fields.model.value.trim(),
    targetLang: fields.targetLang.value,
  });
  fields.endpoint.value = endpoint;
  showStatus(granted ? "保存しました" : "保存しました (ホスト権限が付与されていないため接続できない可能性があります)", !granted);
});

document.getElementById("reset").addEventListener("click", () => {
  fill(PLAMO_DEFAULTS);
  showStatus("既定値を入力しました。保存ボタンで確定します。");
});

load();
