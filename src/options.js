/**
 * options：编辑规则 + 代理地址。
 * 规则文本存在 storage 里（不是解析后的数组）—— 用户写的注释和排版要留住。
 */
import { parseRules } from './match.js';

const api = typeof browser !== 'undefined' ? browser : chrome;
const $ = (id) => document.getElementById(id);
const send = (msg) => api.runtime.sendMessage(msg);

function setStatus(text, kind) {
  const el = $('status');
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
  if (text) setTimeout(() => { if (el.textContent === text) { el.textContent = ''; el.className = 'status'; } }, 4000);
}

function updateParsed() {
  const rules = parseRules($('rulesText').value);
  const byKind = {};
  for (const r of rules) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  const parts = Object.entries(byKind).map(([k, n]) => `${k} ${n}`);
  const el = $('parsed');
  // 用 DOM API 而不是 innerHTML：AMO lint 会把 innerHTML 标成 UNSAFE_VAR_ASSIGNMENT
  el.replaceChildren();
  if (!rules.length) {
    el.textContent = '还没有有效规则 —— 这样只有「默认走代理」开着才会用代理';
    return;
  }
  el.append('解析到 ');
  const strong = document.createElement('b');
  strong.textContent = String(rules.length);
  el.append(strong, ' 条规则');
  if (parts.length) el.append('（' + parts.join(' · ') + '）');
}

function fill(s) {
  $('proxyHost').value = s.proxyHost ?? '127.0.0.1';
  $('proxyPort').value = s.proxyPort ?? 7897;
  $('proxyType').value = s.proxyType === 'socks' ? 'socks' : 'http';
  $('defaultProxy').checked = s.defaultTarget === 'proxy';
  $('rulesText').value = s.rulesText ?? '';
  updateParsed();
}

async function load() {
  const res = await send({ type: 'get' });
  if (res?.ok) fill(res.settings);
  else setStatus('读取失败：' + (res?.error || '未知'), 'bad');
}

$('btnSave').addEventListener('click', async () => {
  const port = Number($('proxyPort').value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    setStatus('端口要在 1–65535', 'bad');
    return;
  }
  const host = $('proxyHost').value.trim();
  if (!host) { setStatus('地址不能为空', 'bad'); return; }

  $('btnSave').disabled = true;
  const res = await send({
    type: 'save',
    patch: {
      proxyHost: host,
      proxyPort: port,
      proxyType: $('proxyType').value,
      defaultTarget: $('defaultProxy').checked ? 'proxy' : 'direct',
      rulesText: $('rulesText').value,
    },
  });
  $('btnSave').disabled = false;
  if (res?.ok) {
    fill(res.settings);
    setStatus(`已保存，立即生效（${res.settings.rules.length} 条规则）`, 'ok');
  } else {
    setStatus('保存失败：' + (res?.error || '未知'), 'bad');
  }
});

$('btnReload').addEventListener('click', async () => {
  await load();
  setStatus('已重新读取', 'ok');
});

$('btnReset').addEventListener('click', async () => {
  const res = await send({ type: 'reset' });
  if (res?.ok) { fill(res.settings); setStatus('已恢复默认', 'ok'); }
  else setStatus('恢复失败：' + (res?.error || '未知'), 'bad');
});

$('rulesText').addEventListener('input', updateParsed);

load();
