/**
 * 规则匹配（纯函数，没有浏览器 API）。
 *
 * 单独一个文件是为了能在 Node 里直接测：分流逻辑最容易写错，
 * 而「写错了」的表现是"某天某站莫名其妙走错路"，很难当场发现。
 *
 * 规则形状（跟 Clash 的写法刻意保持一致，抄过来就能用）：
 *   { kind: 'DOMAIN',        value: 'api.example.com' }
 *   { kind: 'DOMAIN-SUFFIX', value: 'example.com' }      ← 含 example.com 本身
 *   { kind: 'DOMAIN-KEYWORD',value: 'google' }
 *   { kind: 'IP-CIDR',       value: '10.0.0.0/8' }
 *
 * 为什么不直接用 Clash 的规则集：这里只做「走代理 / 直连」两态，
 * 不做 UDP、不做 TUN，也不需要理解 Clash 的 205 个节点。
 */

/** 把一行文本解析成一条规则；认不出来就返回 null（调用方可以据此提示） */
export function parseRule(line) {
  const raw = String(line ?? '').trim();
  if (!raw || raw.startsWith('#') || raw.startsWith('//')) return null;

  // 允许 "DOMAIN-SUFFIX,example.com" 这种 Clash 原生写法
  const m = /^([A-Z-]+)\s*,\s*(.+)$/i.exec(raw);
  if (m) {
    const kind = m[1].toUpperCase();
    const value = m[2].trim();
    if (!['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'IP-CIDR'].includes(kind)) return null;
    return { kind, value: value.toLowerCase() };
  }
  // 只写域名时按后缀处理 —— 最常见的意图
  if (/^[a-z0-9.*_-]+$/i.test(raw)) return { kind: 'DOMAIN-SUFFIX', value: raw.toLowerCase() };
  return null;
}

/** 批量解析（一行一条），顺手去重 */
export function parseRules(text) {
  const out = [];
  const seen = new Set();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const r = parseRule(line);
    if (!r) continue;
    const key = `${r.kind}|${r.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** IPv4 转整数（IPv6 直接不管：本地分流用不上，别为它写半吊子实现） */
function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/** `10.0.0.0/8` 里有没有 `192.168.1.1` */
export function ipInCidr(ip, cidr) {
  const [base, bitsRaw] = String(cidr).split('/');
  const bits = Number(bitsRaw ?? 32);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  if (a === null || b === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

/** 一个 hostname 是否命中某条规则 */
export function matchRule(rule, hostname) {
  const host = String(hostname ?? '').toLowerCase();
  if (!host || !rule) return false;
  switch (rule.kind) {
    case 'DOMAIN':
      return host === rule.value;
    case 'DOMAIN-SUFFIX':
      // 含自身：example.com 命中 example.com 和 a.example.com
      return host === rule.value || host.endsWith('.' + rule.value);
    case 'DOMAIN-KEYWORD':
      return host.includes(rule.value);
    case 'IP-CIDR':
      return ipInCidr(host, rule.value);
    default:
      return false;
  }
}

/** 从 URL 里取 hostname（失败返回空串，别抛） */
export function hostOf(url) {
  try {
    const u = new URL(String(url));
    // URL 对 IPv6 会带方括号，去掉
    return u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * 决定一个 URL 该走哪边。
 *
 * @param url 完整 URL
 * @param settings `{ rules: Rule[], mode: 'proxy'|'direct', defaultTarget: 'direct'|'proxy' }`
 *   - `mode`：总开关。'direct' 时全部直连（不装代理，等价于关掉扩展）
 *   - `defaultTarget`：没命中任何规则时走哪边
 * @returns 'proxy' | 'direct'
 */
export function decideTarget(url, settings) {
  const s = settings || {};
  if (s.mode === 'direct') return 'direct';
  const host = hostOf(url);
  if (!host) return 'direct';
  const rules = Array.isArray(s.rules) ? s.rules : [];
  for (const rule of rules) {
    if (matchRule(rule, host)) return 'proxy';
  }
  return s.defaultTarget === 'proxy' ? 'proxy' : 'direct';
}

/** 给 UI 用：这条规则长什么样 */
export function describeRule(rule) {
  const names = {
    DOMAIN: '精确域名',
    'DOMAIN-SUFFIX': '域名后缀',
    'DOMAIN-KEYWORD': '域名关键词',
    'IP-CIDR': 'IP 段',
  };
  return {
    ...rule,
    label: names[rule.kind] || rule.kind,
    text: `${rule.kind},${rule.value}`,
  };
}
