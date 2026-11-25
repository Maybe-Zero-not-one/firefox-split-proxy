/**
 * 规则引擎的测试。不需要浏览器 —— match.js 是纯函数。
 * 分流写错的表现是"某天某站莫名其妙走错路"，很难当场发现，所以这块要钉死。
 */
import { parseRule, parseRules, matchRule, ipInCidr, hostOf, decideTarget, describeRule } from '../src/match.js';

let pass = 0;
const fails = [];
function ok(cond, label, detail) {
  if (cond) { pass += 1; return; }
  fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}
function eq(a, b, label) {
  ok(JSON.stringify(a) === JSON.stringify(b), label, `期望 ${JSON.stringify(b)}，实到 ${JSON.stringify(a)}`);
}

// ── 解析 ──────────────────────────────────────────────────────────
eq(parseRule('google.com'), { kind: 'DOMAIN-SUFFIX', value: 'google.com' }, '裸域名按后缀');
eq(parseRule('DOMAIN,x.com'), { kind: 'DOMAIN', value: 'x.com' }, 'Clash 写法 DOMAIN');
eq(parseRule('domainsuffix,y.com'), null, '拼错的 kind 不认（domainsuffix）');
eq(parseRule('DOMAIN-SUFFIX,  z.com  '), { kind: 'DOMAIN-SUFFIX', value: 'z.com' }, '两边空格被去掉');
eq(parseRule('DOMAIN-KEYWORD,Google'), { kind: 'DOMAIN-KEYWORD', value: 'google' }, '值转小写');
eq(parseRule('IP-CIDR,10.0.0.0/8'), { kind: 'IP-CIDR', value: '10.0.0.0/8' }, 'IP-CIDR');
eq(parseRule('# 注释'), null, '井号注释');
eq(parseRule('// 注释'), null, '双斜杠注释');
eq(parseRule('   '), null, '空白行');
eq(parseRule(''), null, '空串');
eq(parseRule(null), null, 'null 不炸');

eq(parseRules('a.com\nb.com\na.com\n#x\n\nDOMAIN,c.com').map((r) => r.value), ['a.com', 'b.com', 'c.com'], '批量解析去重');
eq(parseRules('a.com\r\nb.com').length, 2, 'CRLF 也能切');

// ── 匹配 ──────────────────────────────────────────────────────────
const suffix = { kind: 'DOMAIN-SUFFIX', value: 'example.com' };
ok(matchRule(suffix, 'example.com'), '后缀含自身');
ok(matchRule(suffix, 'www.example.com'), '后缀含子域');
ok(matchRule(suffix, 'a.b.example.com'), '后缀含多级子域');
ok(!matchRule(suffix, 'notexample.com'), '后缀不做子串误匹配');
ok(!matchRule(suffix, 'example.com.evil.net'), '后缀不被 .evil 骗过');
ok(matchRule(suffix, 'WWW.EXAMPLE.COM'), '大小写不敏感');

const exact = { kind: 'DOMAIN', value: 'api.example.com' };
ok(matchRule(exact, 'api.example.com'), '精确域名命中');
ok(!matchRule(exact, 'www.api.example.com'), '精确域名不含子域');

const kw = { kind: 'DOMAIN-KEYWORD', value: 'google' };
ok(matchRule(kw, 'www.google.com'), '关键词命中');
ok(matchRule(kw, 'googleapis.com'), '关键词是子串匹配（googleapis）');
ok(!matchRule(kw, 'baidu.com'), '关键词不命中');

ok(ipInCidr('10.1.2.3', '10.0.0.0/8'), '/8 网段内');
ok(ipInCidr('192.168.1.1', '192.168.1.0/24'), '/24 网段内');
ok(!ipInCidr('192.168.2.1', '192.168.1.0/24'), '/24 网段外');
ok(ipInCidr('1.2.3.4', '0.0.0.0/0'), '/0 全匹配');
ok(!ipInCidr('::::', '10.0.0.0/8'), 'IPv6 不崩、判不匹配');
ok(!ipInCidr('300.1.1.1', '10.0.0.0/8'), '非法 IP 不崩');
ok(matchRule({ kind: 'IP-CIDR', value: '10.0.0.0/8' }, '10.9.9.9'), 'IP-CIDR 规则匹配 IP host');

// ── 取 host ───────────────────────────────────────────────────────
eq(hostOf('https://a.b.com/x?y=1'), 'a.b.com', '取 host');
eq(hostOf('http://[::1]:8080/'), '::1', 'IPv6 去掉方括号');
eq(hostOf('about:blank'), '', 'about: 没有 host');
eq(hostOf('data:text/html,hi'), '', 'data: 没有 host');
eq(hostOf('坏 URL'), '', '坏 URL 不炸');

// ── 决策 ──────────────────────────────────────────────────────────
const base = {
  mode: 'proxy',
  defaultTarget: 'direct',
  rules: parseRules('google.com\nyoutube.com'),
};
eq(decideTarget('https://www.google.com/', base), 'proxy', '规则内 → 代理');
eq(decideTarget('https://www.google.com/', base), 'proxy', '含子域 → 代理');
eq(decideTarget('https://baidu.com/', base), 'direct', '规则外 → 直连');
eq(decideTarget('https://www.youtube.com/watch?v=1', base), 'proxy', 'youtube 走代理（带 query）');
eq(decideTarget('https://google.com.evil.net/', base), 'direct', '仿冒域不误判');
eq(decideTarget('https://www.google.com/', { ...base, mode: 'direct' }), 'direct', '总开关关掉后全直连');
eq(decideTarget('https://baidu.com/', { ...base, defaultTarget: 'proxy' }), 'proxy', '默认走代理时规则外也走');
eq(decideTarget('about:blank', { ...base, defaultTarget: 'proxy' }), 'direct', '没有 host 的 URL 一律直连');
eq(decideTarget('https://x.com/', { mode: 'proxy', defaultTarget: 'direct', rules: [] }), 'direct', '没规则不代理');
eq(decideTarget('https://x.com/', {}), 'direct', '空设置不炸');

// describeRule 给 UI 用
const d = describeRule({ kind: 'DOMAIN-SUFFIX', value: 'a.com' });
eq(d.label, '域名后缀', 'describeRule 中文名');
eq(d.text, 'DOMAIN-SUFFIX,a.com', 'describeRule 文本');

// ── 汇总 ──────────────────────────────────────────────────────────
if (fails.length) {
  console.log(`\nmatch.js  ❌ ${fails.length} 条失败 / 共 ${pass + fails.length} 条\n`);
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log(`match.js  ✅ ${pass} 条全过`);
