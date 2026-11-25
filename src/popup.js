/**
 * popup：只读展示 + 总开关 + 出口测试。
 * 规则的编辑放在 options 页（这里地方太小，写长列表很难受）。
 *
 * 注意：这里一律用 textContent / createElement 拼 DOM，不用 innerHTML。
 * AMO 的 lint 会把 innerHTML 标成 UNSAFE_VAR_ASSIGNMENT（审核会盯），
 * 而且这些内容里有用户可控的域名，用 DOM API 从根上就没有注入面。
 */
const api = typeof browser !== 'undefined' ? browser : chrome;
const $ = (id) => document.getElementById(id);
const send = (msg) => api.runtime.sendMessage(msg);

function render(view) {
  const s = view.settings || {};
  const st = view.stats || {};

  const on = s.mode !== 'direct';
  $('modeToggle').checked = on;
  $('stateText').textContent = on
    ? (s.defaultTarget === 'proxy' ? '分流中（默认走代理）' : '分流中（默认直连）')
    : '已停用（全部直连）';

  const type = s.proxyType === 'socks' ? 'SOCKS5' : 'HTTP';
  $('proxyAddr').textContent = `${type} ${s.proxyHost}:${s.proxyPort}`;

  const n = Array.isArray(s.rules) ? s.rules.length : 0;
  $('ruleCount').textContent = `${n} 条 · 未命中走${s.defaultTarget === 'proxy' ? '代理' : '直连'}`;
  $('counts').textContent = `代理 ${st.proxied ?? 0} · 直连 ${st.direct ?? 0}`;

  // 最近走过的域名（代理那边更重要，只列它）
  const box = $('hosts');
  const hosts = (st.lastProxied || []).slice(0, 8);
  box.replaceChildren(...hosts.map((h) => {
    const d = document.createElement('div');
    d.className = 'host';
    d.textContent = '→ ' + h;
    return d;
  }));
}

async function refresh() {
  const res = await send({ type: 'get' });
  if (res?.ok) render(res);
}

$('modeToggle').addEventListener('change', async (e) => {
  const res = await send({ type: 'save', patch: { mode: e.target.checked ? 'proxy' : 'direct' } });
  if (res?.ok) {
    const after = await send({ type: 'get' });
    render({ settings: res.settings, stats: after?.stats });
  }
});

$('btnOptions').addEventListener('click', () => api.runtime.openOptionsPage());

$('btnTest').addEventListener('click', async () => {
  const btn = $('btnTest');
  const box = $('result');
  btn.disabled = true;
  box.style.display = 'block';
  box.textContent = '测试中…（走的是当前规则）';

  const res = await send({ type: 'test' });
  btn.disabled = false;
  box.replaceChildren();

  if (res?.ok) {
    const mark = document.createElement('span');
    mark.style.color = 'var(--ok)';
    mark.textContent = '✅ 通了';
    box.append(mark, ` HTTP ${res.status} · ${res.body}`);
  } else {
    const mark = document.createElement('span');
    mark.style.color = 'var(--bad)';
    mark.textContent = '❌ ' + (res?.error || '未知错误');
    box.append(mark);
    const detail = document.createElement('div');
    detail.textContent = '目标 ' + JSON.stringify(res?.via || {});
    box.append(detail);
  }
});

refresh();
api.storage?.onChanged?.addListener(() => refresh());
