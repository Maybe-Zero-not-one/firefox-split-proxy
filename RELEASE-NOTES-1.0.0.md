## 分域代理 1.0.0

Firefox 扩展：**按域名决定哪些请求走本地 Clash，其余直连。** 只影响 Firefox，不动系统代理，也不影响其它浏览器和程序。

### 它解决什么

系统代理是一刀切：开了，银行/内网/公司系统这些必须直连的站会变慢或直接不可用；不开，需要翻墙的站上不去。TUN 模式同样是全量劫持。这个扩展把分流决定放回浏览器里 —— 每个请求单独判断，命中规则的才交给代理。

### 安装

**方式 A：临时加载**（重启浏览器失效，适合先试手感）

1. 下载本 Release 里的 `split-proxy-1.0.0.xpi`
2. 解压到任意目录
3. 打开 `about:debugging#/runtime/this-firefox`
4. 「临时载入附加组件」→ 选解压出来的 `manifest.json`

**方式 B：长期使用**

1. `about:config` → 把 `xpinstall.signatures.required` 设为 `false`
2. `about:addons` → 右上齿轮 → 「从文件安装附加组件」→ 选 `split-proxy-1.0.0.xpi`

> 方式 B 需要 Firefox **140 或更高**（manifest 里 `strict_min_version: 140`）。这是因为 AMO 现在要求新扩展声明 `data_collection_permissions`，该字段从 140 起支持。

### 配好就能用

打开工具栏图标 → 端口填你代理工具的本地混合端口（Clash Verge 默认 **7897**）→ 写规则：

```
google.com              ← 只写域名 = 后缀匹配，含所有子域
youtube.com
DOMAIN,x.com            ← 只要 x.com 本身，不含子域
DOMAIN-KEYWORD,openai   ← 域名里含 openai 就算
IP-CIDR,10.0.0.0/8      ← 按 IP 段
```

改完立刻生效，不用重启浏览器。

### 实测数据（Firefox 160.0.1）

| 场景 | 结果 |
|---|---|
| 规则内的 github.com | 走 Clash，**1849 ms** 打开 |
| 规则外的 baidu.com | 直连，**62 ms** 打开 |
| 把代理指向死端口，github 在规则内 | **失败**（`NS_ERROR_PROXY_CONNECTION_REFUSED`） |
| 同一配置下 baidu 在规则外 | **照常打开** |

第三、四行是关键：规则内的站真的被送进了代理，规则外的真的没走。

### 它不做什么

- **不提供代理服务** —— 不带节点、不读订阅，你需要自己有代理工具在跑
- **不接管系统代理、不做 TUN** —— 不影响其它浏览器和程序
- **不支持按站点切换不同节点** —— 那要在你的代理工具里配；扩展只决定「走不走这个端口」

### 两个必须知道的坑

1. **规则按域名匹配，子资源会漏。** 主页面走了代理，但它引用的 CDN 静态资源在别的域，那些不命中规则就走直连，页面会样式脚本全挂。要把 CDN 域一起写进规则。
2. **`keepHeaders` 类的头改写会删掉 CORS 头。**（这条属于同类工具的通病提醒）跨域请求如果被改写掉 `Access-Control-Allow-Origin`，浏览器会把响应扣下 —— 正文其实是回来了，但 JS 看不见。

### 隐私

- 规则和端口只存在 `storage.local`，不离开本机
- 无统计、无埋点、无崩溃上报、无远程配置
- 扩展不主动联网。唯一一次网络请求是你点「测一下出口」时请求 `api.ipify.org`，而且这次请求也走同一套规则
- 会看到你访问的每个 URL（`proxy.onRequest` 的工作方式决定，否则无法判断走不走代理），但只在内存里判断域名，不记录、不持久化、不外发。「最近走过的域名」最多 40 条，关浏览器就没了

完整隐私政策见 [AMO-SUBMISSION.md](AMO-SUBMISSION.md#privacy-policiamo-现在必填)。

### 包内容

| 文件 | 说明 |
|---|---|
| `split-proxy-1.0.0.xpi` | 扩展本体，12.9 KB，8 个源文件 |
| `split-proxy-1.0.0-source.zip` | 源码包，37 KB。解压后跑 `node test/build.mjs` 可复现出**同一个 xpi**（SHA-256 相同） |

### 许可

MIT。构建说明见 [BUILD.md](BUILD.md)，回归测试 48 + 37 + 10 = 95 条。
