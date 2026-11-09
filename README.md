# 微软积分自动任务脚本

在后台自动完成 Microsoft Rewards 任务，完成后推送汇总。

## 一、授权（首次必做）

1. 自动授权:
   - 手动运行一次，等待一分钟
   - 查看token状态
   - 有token就无需其它操作
   - 无token则**手动授权**

2. **🔑 手动授权**，在打开的微软页面登录账号。(有两种方法)
   - *方案1*：点击手动授权(看准时机复制地址栏内容，地址栏会发生变化)，授权码必须包含(code=M.xxx=2052):
   - *方案2*：手动授权→F12→网络(Network)→oauth20_desktop.srf?removed=true →标头(Headers)→请求标头(Request headers)→Referer→复制右侧完整链接
     
      <img src="https://scriptcat.org/api/v2/resource/image/fZBP77hgN0mgSZl6" alt="img" style="width: 400px; height: auto;">
   
   - **📋 粘贴授权码**，把整段地址粘进去，回车。
   - 提示"授权成功"即可。之后用 Token 运行。

**授权码长什么样**：地址里包含 `code=M.xxx=2052` 的链接，形如

```
https://login.live.com/oauth20_desktop.srf?code=M.C561_BAY.2.U.MsaArtifacts.xxxxx&lc=2052
```


## ⚠️ 二、必须在Chrome浏览器才能完成的任务(须知)

脚本大部分任务用 Edge 也能跑，但下面**三类任务需在Chrome上完成**。


所以：**想拿满这三类分数，请用 Chrome 跑本脚本。**

| 任务 | 在 Chrome | 在 Edge |
| --- | --- | --- |
| 带锁 🔒 卡片(已解锁) | ✅  | ✅ 需先配好 CDP (不建议配置CDP) |
| 桌面端任务 | ✅ | ❌ |
| 首页待领取 | ✅ | ❌ |
| 月度计划 | ✅ | ❌ |

## 三、CDP 通道与临时标签页（Edge 用）

带锁卡片（应用内搜索型）必须在浏览器里做**真实鼠标点击**才会记账 ——
页面内 JS 模拟点击的 `isTrusted=false`，浏览器直接拒绝导航，这是安全边界。
所以脚本需要走一次 CDP。整个流程是这样：

1. **先检测，再开页**：只有在 `127.0.0.1` 的调试端口上真的连得上 CDP 时，才会考虑开页；
   连不上就完全不动浏览器，只在日志里提示一次（30 分钟节流）。
2. **静默打开**：用 `Target.createTarget({background:true})` 在**后台**建一个临时标签页。
   不激活、不抢焦点 —— 你用别的软件或别的标签页时，不会被弹到这个页面上。
3. **只动自己的页**：需要导航/点击时只用自己开的那个页；
   只发请求（不改地址）时才借用你已开着的 rewards 页，你完全无感。
4. **用完自动关闭**：只关自己开过的（id 记在 `Config.cdpOwnedTabs`），
   你手动开的标签页一个都不会碰。上一轮遗留的也会在下一轮开头被清掉。
5. **做完就封盘**：当天的 CDP 任务全部处理完（活动卡全清、首页待领取也过）后，
   记下 `Config.cdpDoneDate`，之后**整个脚本不再开新标签页**；第二天自动恢复。
   万一中途又有新的带锁卡出现，会自动撤销封盘重新放行。

### 怎么配

用带调试端口的快捷方式启动浏览器即可（脚本会自动探测端口，不用你手填）：

```
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="%LOCALAPPDATA%\Microsoft\Edge\CDPUser Data"
```

- `--remote-allow-origins=*` 是**必须**的，缺了它后台建页一定失败（见下面的排查）。
- `--user-data-dir` 指向哪个目录就用哪个目录的登录态；**不要在没登录过 rewards 的目录里跑**。
- 该配置目录首次需要单独登录一次 `rewards.bing.com`。
- 想看当前状态：脚本菜单 → **🖱️ CDP / 临时标签页状态**。

### 排查：「能连上端口，但拿不到可用的 rewards 页」

这条报错只有一个真正的成因 —— **启动参数漏了 `--remote-allow-origins=*`**。

现象很有迷惑性：端口是通的，`http://127.0.0.1:9222/json/version` 也能正常返回，
所以「端口配置对不对」永远查不出来。实际被拒的是脚本这一步：

```
Rejected an incoming WebSocket connection from the chrome-extension://<ScriptCat 扩展 ID> origin.
Use the command line flag --remote-allow-origins=... to allow connections from this origin
```

新版 Edge 的 DevTools 默认只接受「无 Origin」或白名单内的握手。
脚本作为扩展发起 `new WebSocket(browserWs)`，带的 Origin 是 `chrome-extension://...`，
于是握手直接 403 —— 页面级 CDP 根本没建立起来，自然开不出标签页。

两种情况不要混淆：

| 情况 | 现象 | 结论 |
| --- | --- | --- |
| `Origin` 被拒（403） | 端口能连、`/json/version` 正常、脚本日志说拿不到页 | 补 `--remote-allow-origins=*` 后重启 |
| 页面里连不上 `127.0.0.1` | 连**自建**的本地 WS 服务也超时 | 浏览器层的本地网络限制，与 CDP 无关 |

一条命令自查（在仓库根目录，需 Node 18+）：

```
node tools/cdp-verify/cdp-check.js 9222
```

它会依次验证：`/json/version` → browser ws 握手 → 后台建页 → 新页是否已登录、能否读到卡片，
最后把自己开的页关掉，不改任何配置。

### 已知的两个坑

1. **快捷方式里别带 `--profile-directory="Profile 2"`。** 调试配置目录通常只有 `Default`，
   照抄带 `Profile 2` 的命令会开出一个空的 `Profile 2`：既没登录 rewards、也没装脚本，
   看起来「窗口起来了但脚本还是连不上页」。
2. **别用默认 Edge 配置加调试端口。** 那样会把整个日常浏览器暴露在 9222 上，
   而且和你平时用的窗口抢同一个 user-data-dir。给 CDP 单独一个目录（`CDPUser Data`）。

## 四、桌面应用每周专属任务：为什么网页说 6 张未解锁、脚本报 7 张

周任务的子项 offerId 里**直接带星期**：

```
WW_pcchild3_urlreward_Monday_RewardsApp_weekly_Exclusive_Novw2_2026_punchcard
                 ↑ 周一
```

服务端按「周一 → 周日」逐日解锁。但网页端对**非应用 UA** 的请求会把所有子项
统一渲染成 `isLocked=true`（实测周一那天 7 张全锁），也就是一个降级视图：

| 请求身份 | 子项锁定数（周一实测） |
| --- | --- |
| 普通 UA 拉 quest 页 | 7 / 7 全锁 |
| 带 `MSRewards/Desktop/1.13.0` 的 UA | 6 / 7（周一那张解锁） |
| 只加 `x-rewards-source` 头 | 7 / 7（这个头不起作用） |

脚本用 `GM_xmlhttpRequest` 发请求，而 `user-agent` 是**浏览器禁止脚本设置**的请求头，
写进 headers 也会被静默丢弃 —— 所以脚本拿到的永远是那份全锁视图，
数出来就是 7 张未解锁，比网站多 1 张。

**现在的处理**：拿到子项后按 offerId 里的星期重新判定解锁态
（`周内位置 <= 今天` 即解锁），不再信网页渲染的 `isLocked`。
已完成状态仍然只信服务端的 `isCompleted` —— 父任务那个「1/8 个任务」
只说明完成了 1 张、不说明是哪一张，拿它反推会把当天要做的卡误标成已完成。

修复后同一份数据的对照：

```
修复前：待办 7 · 已解锁 0 · 未解锁 7
修复后：待办 7 · 已解锁 1 · 未解锁 6   ← 解锁的正是周一那张
```

日志里也会把未解锁的星期列出来，方便直接核对：

```
🖥️ 桌面奖励应用专属任务：1 张已解锁待办（另有 6 张未解锁，不处理）
🖥️   · [已解锁] 点亮你的每一天
🖥️   未解锁的：周二、周三、周四、周五、周六、周日（到对应那天自动处理）
```

自查（不需要重新加载脚本，直接对线上数据跑一遍）：

```
node tools/quest-verify/verify-lock-rule.js    # 规则断言（含周一/周三/周日多组场景）
node tools/quest-verify/verify-id-scope.js     # 确认月度计划不会被这条规则误改
node tools/quest-verify/live-quest-check.js    # 对当前账号的真实 quest 页跑一遍
```

## 五、应用内搜索卡「已受理但未记账」的真正原因

日志里这条：

```
🟡 桌面任务已受理但未记账（服务端没加分）：奖励应用专属, 点亮你的每一天
```

不是 CDP 没配好，也不是真实点击不够。根因是**请求头里的 cookie 被覆盖了**。

脚本上报应用内搜索时，自己拼了一个 cookie 头，里面只有一项 `_Rwho`：

```js
"cookie": `_Rwho=u=d&ts=2026-11-09`
```

而 `Cookie` 请求头是**整体覆盖**语义 —— 扩展/浏览器不会把它和你真实的 cookie 合并。
于是 `MSPAuth`、`MUID`、`WLS` 这些登录态全被顶掉了。

服务端仍然返回 HTTP 200（所以代码认为「已受理」），但响应里的
`IsAuthenticated` 是 `false`，这次上报没算在你账号头上，卡片自然不加分。

实测对照（同一请求，只差 cookie 头）：

| Cookie 发送方式 | HTTP | IsAuthenticated | 结果 |
| --- | --- | --- | --- |
| 浏览器自动带完整 cookie | 200 | **true** | 记账 |
| 只发 `_Rwho`（修复前） | 200 | **false** | 不记账 |
| `_Rwho` + 完整 cookie（修复后） | 200 | **true** | 记账 |

**修复**：新增 `_cookieWithRwho()`，把 `_Rwho` **追加**在真实 cookie 后面
（已有就替换，不重复），并且在上报后用响应里的 `IsAuthenticated` 做判据 ——
再出现登录态丢失会直接在日志里点名，而不是含糊地说「已受理但未记账」。

同一处缺陷还影响 `getSearchPage()` 和 `reportSearch()`（日常搜索任务），已一并修掉。

自查：

```
node tools/cookie-verify/verify-cookie-fix.js   # cookie 拼接规则断言
node tools/cookie-verify/verify-cookie-e2e.js   # 网络层实测 IsAuthenticated 是否 true
```

## 六、「桌面应用专属」卡：为什么服务端说受理、就是不加分

这是比 cookie 更根本的一层。这些卡的 offerId 带 `RewardsApp`（如
`WW_pcchild3_urlreward_Monday_RewardsApp_weekly_Exclusive_...`），
**服务端只认桌面应用身份**，判据就是 UA 里的 `MSRewards/Desktop/x.y.z` 令牌。

用普通 Edge UA 时：

- `reportActivity` 返回 **200**、`IsAuthenticated=true`
- 交卷 Server Action 返回 **200**、最后一帧是 **`true`**（参数校验通过）
- 但父任务进度**一动不动**

换成应用 UA，同样的 cookie / action / hash，进度立刻前进。

| UA | 搜索上报 | 交卷 | 进度 |
| --- | --- | --- | --- |
| 普通 Edge UA | 200 / authed | 200 / `true` | 1/8 → **1/8** |
| `MSRewards/Desktop/1.13.0` | 200 / authed | 200 / `true` | 1/8 → **2/8** |

**为什么以前必然失败**：脚本在 headers 里写了 `"user-agent": RewardsAuto.ua.rewardsApp`，
但 `User-Agent` 和 `Cookie` 一样是**浏览器禁止脚本设置**的请求头，写进去会被静默丢弃。
所以脚本自以为在扮应用，实际一直是普通浏览器身份。

**修复**：新增 `CDP.setAppUA(on)`，用 `Network.setUserAgentOverride` 在**网络层**真正改 UA
（这是唯一能生效的方式），并配合 `Network.setExtraHTTPHeaders` 带上 `x-rewards-source`。
用在两处：

1. `_reportAppSearchViaCdp()` —— 应用内搜索上报改走 CDP 后台页，全程应用 UA；
2. `submitQuestCard()` 的 CDP 页面通道 —— 交卷前先切 UA，结束后恢复成浏览器本来的 UA。

顺带记录一个佐证：服务端确实会校验参数 ——
「真卡+真 hash」返回 `true`，而「真卡+假 hash」「假卡+真 hash」「全假」都返回 `false`。
所以那种 `true` 是「这笔动作格式正确」，不等于「记到你账上了」。

自查：

```
node tools/app-ua-verify/verify-fix-e2e.js    # 端到端：覆盖 UA → 上报 → 交卷 → 看进度是否前进
```





### 相关配置项

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `Config.cdpPort` | 9222 | 调试端口；实际会按 `9222 / 9224 / 9223` 逐个探测 |
| `Config.cdpProfileDir` | `%LOCALAPPDATA%\Microsoft\Edge\CDPUser Data` | 调试窗口用的配置目录（只影响提示里那条命令） |
| `Config.cdpProfileName` | 空 | 一般留空；只有调试目录里确实有多个 Profile 时才填，填 `Profile 2` 之类 |
| `Config.cdpAutoTab` | 开 | 允许静默开临时标签页（关掉就完全不开页） |
| `Config.cdpHardTab` | 关 | 静默开页失败时的兜底；该方式**会抢焦点**，一般不要开 |

### 为什么以前带锁卡总是完成不了

旧版有三处问题，现在都已修掉：

1. `reportDailyActivity()` 只检查端口通不通就 `return true`，**一次搜索都没发出去**，
   调用方却当成「CDP 已点击」，卡片自然永远不记账。
2. `claimAll()` 点完第一张卡后页面已经跳到搜索页，代码却继续在 earn 页里找下一张，
   于是直接退出，只能完成第一张。
3. 端口默认值三处不一致（`base()` 用 9222、提示文案用 9224），一边能连一边说连不上。

## 说明

- 代码主要改自微软积分（全能任务版），主要自己留存备份使用。
- 感谢ScriptCat001 DuskLight 潘矩森 大大 ，以及其他更多的大大。
- 仅供学习交流，账号风险自负，请遵守 Microsoft Rewards 服务条款。MIT License。
