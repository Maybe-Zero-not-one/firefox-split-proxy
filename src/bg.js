/**
 * 后台：持有设置 + 装 proxy.onRequest 监听。
 *
 * ⚠️ 一个必须知道的 Firefox 事实：`proxy.settings.set()` 是**全局**的
 * （所有请求一个代理），做不了"某站走代理"。真分流只能靠
 * `proxy.onRequest` —— 它对**每一个请求**单独问一次"你要走哪"，
 * 所以我们能按 URL 决定。代价是每请求一次 JS 回调，逻辑必须很轻
 * （这就是 match.js 全是纯函数、没有任何 IO 的原因）。
 */

import { decideTarget, parseRules, hostOf } from './match.js';

const api = typeof browser !== 'undefined' ? browser : chrome;

const DEFAULTS = {
  mode: 'proxy',            // 'proxy' = 分流生效；'direct' = 全部直连（等于关掉）
  defaultTarget: 'direct',  // 没命中规则时：直连
  proxyHost: '127.0.0.1',
  proxyPort: 7897,          // Clash Verge 的 mixed 口（实测这台机是 7897）
  proxyType: 'http',        // 'http' 或 'socks'；Clash 的 mixed 口两种协议都吃
  rulesText: [
    '# 一行一条。写域名默认按「后缀」处理（含自身与所有子域）',
    '# 也支持 Clash 原生写法：DOMAIN / DOMAIN-SUFFIX / DOMAIN-KEYWORD / IP-CIDR',
    '',
    'google.com',
    'youtube.com',
    'github.com',
    'openai.com',
    'x.com',
    'twitter.com',
  ].join('\n'),
};

let settings = { ...DEFAULTS, rules: [] };
let stats = { proxied: 0, direct: 0, lastProxied: [], lastDirect: [] };
const RECENT_MAX = 40;

function remember(bucket, host) {
  const list = stats[bucket];
  list.unshift(host);
  if (list.length > RECENT_MAX) list.length = RECENT_MAX;
}

function applySettings(raw) {
  const s = { ...DEFAULTS, ...(raw || {}) };
  s.proxyPort = Number(s.proxyPort) || 7897;
  s.rules = parseRules(s.rulesText || '');
  if (s.mode !== 'direct') s.mode = 'proxy';
  if (s.defaultTarget !== 'proxy') s.defaultTarget = 'direct';
  settings = s;
  return settings;
}

/** 当前的代理描述符（给 proxy.onRequest 返回） */
function proxyDescriptor() {
  const type = settings.proxyType === 'socks' ? 'socks' : 'http';
  const entry = { type, host: settings.proxyHost, port: settings.proxyPort };
  // SOCKS 要让 DNS 也在代理解（否则本地解析暴露、且可能解析错）
  if (type === 'socks') entry.proxyDNS = true;
  return entry;
}

const DIRECT = { type: 'direct' };

// ── 装载 ──────────────────────────────────────────────────────────
async function load() {
  const stored = await api.storage.local.get('settings');
  applySettings(stored?.settings);
}

// 每个请求问一次；这里必须快。解析 URL 的 host 是唯一开销。
api.proxy.onRequest.addListener((details) => {
  try {
    const target = decideTarget(details.url, settings);
    if (target === 'proxy') {
      stats.proxied += 1;
      remember('lastProxied', hostOf(details.url));
      return proxyDescriptor();
    }
    stats.direct += 1;
    remember('lastDirect', hostOf(details.url));
    return DIRECT;
  } catch (error) {
    // 这里抛异常会让请求直接失败，比走错路严重得多 —— 一律退回直连
    console.error('[split-proxy] onRequest 出错，退回直连:', error);
    return DIRECT;
  }
}, { urls: ['<all_urls>'] });

api.proxy.onError.addListener((error) => {
  console.error('[split-proxy] proxy.onError:', error?.message || error);
});

// ── 与 UI 通信 ────────────────────────────────────────────────────
api.runtime.onMessage.addListener((msg, _sender, respond) => {
  (async () => {
    try {
      if (msg?.type === 'get') {
        respond({ ok: true, settings, stats });
      } else if (msg?.type === 'save') {
        const next = applySettings({ ...settings, ...msg.patch });
        await api.storage.local.set({ settings: next });
        respond({ ok: true, settings: next });
      } else if (msg?.type === 'reset') {
        const next = applySettings({ ...DEFAULTS });
        await api.storage.local.set({ settings: next });
        respond({ ok: true, settings: next });
      } else if (msg?.type === 'resetStats') {
        stats = { proxied: 0, direct: 0, lastProxied: [], lastDirect: [] };
        respond({ ok: true, stats });
      } else if (msg?.type === 'test') {
        // 用当前代理设置实际发一次请求，看通不通（拿出口 IP 佐证）
        const pd = proxyDescriptor();
        const url = 'https://api.ipify.org?format=json';
        try {
          const r = await fetch(url, {
            cache: 'no-store',
            // Firefox 扩展里的 fetch 默认就受 proxy.onRequest 影响，
            // 这里不用也不能手动指定代理
          });
          const text = await r.text();
          respond({ ok: true, via: pd, status: r.status, body: text.slice(0, 200) });
        } catch (error) {
          respond({ ok: false, via: pd, error: String(error?.message || error) });
        }
      } else {
        respond({ ok: false, error: '未知消息: ' + msg?.type });
      }
    } catch (error) {
      respond({ ok: false, error: String(error?.message || error) });
    }
  })();
  return true;   // 异步 respond
});

load().catch((e) => console.error('[split-proxy] 载入设置失败:', e));
