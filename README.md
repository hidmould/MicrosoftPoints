# 微软积分自动任务脚本

在后台自动完成 Microsoft Rewards 任务，完成后推送汇总。

## 授权（首次必做）

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


> 授权码**只能用一次**。若提示"换取 Token 失败"，多半是码已过期或被用过，重新走一遍上面的步骤。状态可用菜单 **📊 Token状态** 查看。

## 说明

- 代码主要改自微软积分（全能任务版），主要自己留存备份使用。
- 感谢ScriptCat001 DuskLight 潘矩森 大大 ，以及其他更多的大大。
- 仅供学习交流，账号风险自负，请遵守 Microsoft Rewards 服务条款。MIT License。

## 活动卡片与「锁」标识

日常卡片有两种：带锁标识的、不带锁的。两者都能由脚本完成，但走的是不同通道：

| 卡片 | 普通浏览器 UA | 完成方式 |
| --- | --- | --- |
| 不带锁 | `isLocked:false` | 网页 Server Action，失败再走 DAPI |
| 带锁（App 专属，`Moreactivities_RewardsApp` / `unlockCriteria=rewardsApp`） | `isLocked:true` | 改用 **Rewards 应用 UA**（`MSRewards/Desktop`）交卷，再走 DAPI 复核 |
| 真锁（`Available tomorrow` / 明天再来 / `isDisabled`） | 锁住 | 当天跳过 |

带锁的卡以前被当成「今天做不了」直接丢弃，所以总也做不成 —— 这类卡的 `hash`/`offerId` 与网页端完全一致，
只是服务端在普通 UA 下把锁图标渲染出来了，换应用 UA 就是解锁态。现在它们会被标记 `appOnly` 交给应用通道；
真锁卡仍然跳过，并且**不计入当天剩余量**，否则当天永远判不成「全部完成」。

后台上下文拿不到 `getuserinfo`（日志里的 `HTTP 401`）只影响「浏览器会话」这条通道，不再连坐应用通道。

## 排查：卡片为什么没完成

看日志里 `卡片领取未确认` 后面的方括号，**第一个失败点就是答案**：

| 诊断 | 含义 | 处理 |
| --- | --- | --- |
| `web(HTTP 401)` | 网页通道真没登录态 | 检查 scriptcat 是否授予了 cookie 权限 |
| `web(未登录跳过)` | 通道被 `webNoAuth` 熔断 | 1.1.3 起 `getuserinfo` 的 401 不再触发它 |
| `web(请求未被接受)` | Server Action 返回了错误帧 | 看紧随的 `🔬 交卷响应` 日志 |
| `web(已发出但服务端未生效)` | 受理了但没记账 | 多半是缺 `x-deployment-id` 或没登录；1.1.4 已补 dpl |
| `dapi(p=0)` | 应用通道也没给分 | 这张卡不归 DAPI 管，说明得靠网页通道 |
| `search(已上报)` / `search(已上报待记账)` | 走的是「应用内搜索」通道 | 看紧随的 `📋 搜索上报返回` 内容 |
| `err=HTTP 503` | 服务端前置校验拒绝（0.2~0.6 秒就返回，不是网络问题） | 见下方说明 |

`doPromos` 开头会打一条 `🔑 登录态：...`，直接说明有没有会话 Cookie（读不到时显示「无法读取」，
不会误判成未登录）。交卷**未受理**时会打 `🔬 交卷响应(...)`（受理成功的不打，避免刷屏），
请求抛异常时打 `🔬 交卷异常(...)` 带上错误信息。

## 首次运行：请允许 Cookie 访问

`GM_cookie` 是**需要手动授权**的权限 —— ScriptCat 只在脚本**真正调用** `GM_cookie.list()`
时弹授权框，光写 `@grant GM_cookie` 不会弹。

脚本已把这次调用放在**启动最前面**（`bootstrap` 里的 `probeCookiePermission()`）：

```
🔑 首次运行：请求 Cookie 读取权限（若弹出授权框请点「允许」）
```

看到这条就点「允许」。授权后：

```
🔑 Cookie 权限正常，已登录：MUID,_EDGE_S,SRCHHPGUSR,MSCC...
```

如果误点了拒绝：

```
🟡 Cookie 读取被拒绝或超时：脚本仍可正常运行，只是读不到登录态诊断。
   如需放权，去脚本管理器的「脚本详情 → 权限」里允许 Cookie 访问，然后重新运行。
```

> 拒绝只影响**登录态诊断**，不影响任务本身（交卷靠 `GM_xmlhttpRequest` 自动带 Cookie）。
> 探测只做一次（`Config.cookieProbed`），不会每次刷新都弹框。
> 想重新触发授权：删掉这个标记再运行 —— `GM_setValue("Config.cookieProbed", false)`。

> 登录态判定用的是 `.bing.com` 下**真实存在**的 cookie（`MUID`/`MUIDB`/`_EDGE_S`/`SRCHHPGUSR`/`MSCC` 等），
> 不是 `login.live.com` 的 `ACCS_`/`MSPAuth` 那一套 —— 后者在 bing.com 域下永远读不到，
> 早期版本据此误报过「未登录」。

> 若日志里完全没有这两条，说明运行的是旧版本：ScriptCat 更新脚本后，后台 service worker
> 往往需要重启浏览器或重新加载扩展才会载入新代码，刷新页面不够。

## 两类「带锁」卡片的区别

页面上带锁图标的卡有两种，完成方式完全不同：

| 类型 | 判据 | 完成方式 |
| --- | --- | --- |
| **应用内搜索型** | `href` 是 `bing.com/search?...&PUBL=RewardsDO`（`form=ML2W4J`/`ML2Y2H`） | **开真实标签页**，让页面自己的 JS 完成记账（见下） |
| **等级门槛型** | `offerId` 含 `locked_level2` / `unlockCriteria=newLevel2` | 等级达标（`isLocked:false`+`isUnlocked:true`）就照常交卷；未达标则跳过 |

### 为什么应用内搜索型必须开标签页

这类卡**既不能用 Server Action 交卷，也不能用纯 HTTP 复现**。两条硬性限制：

1. **`rdrig` 只能靠顶层导航拿到**。服务端在 `www.bing.com` → `cn.bing.com` 的 302 里追加
   `&rdr=1&rdrig=<32位HEX>`，靠 `sec-fetch-mode: navigate` / `sec-fetch-dest: document` 判定。
   这两个是浏览器**禁止修改**的请求头，`GM_xmlhttpRequest` 伪装不出来 —— 所以无论参数多正确，
   后台 HTTP 永远拿不到 `rdrig`。
2. **`reportActivity` 返回的不是 JSON**，而是一段客户端模块（`ModernRewards...`），
   真正的记账发生在页面 JS 执行时。后台上下文没有 `sj_evt` 那套运行时。

### 实测结论（2026-11-03，用 CDP 在真实 Edge 里验证）

这类卡的行为比预想的复杂，以下是逐条实测的结果：

| 操作 | 结果 |
| --- | --- |
| 页面被动打开 | 只加载 `widget.js`，**不发 `ncheader`、不发 `reportActivity`** |
| 调用页面全局函数 `sj_rra(url)` | 请求参数与手动抓包完全一致，服务端返回 `RewardsIncrement:1`、余额 +15 |
| `sj_rra` 后等 90 秒 | **卡片仍是「+15」未完成** |
| 用户在 earn 页**真实点击**该卡 | **卡片变成「已完成」** |

根因：页面里的 `onRALoad` 事件没有绑定（`sjEvtBound=false`），缺少事件驱动 ——
所以 `sj_rra` 只是「上报了一次搜索」，服务端按普通搜索记账，但不翻转卡片状态。

**因此脚本的做法是**：打开标签页 → 等模块就绪 → 调用 `sj_rra` 上报（尽力而为，能加分的账户会拿到分）
→ 短暂等待 → 卡片没翻转就标为「需手动」，并提示你在 earn 页点一次。
同时**不再重复重试**（以前每张卡重试 3 次、每次等 60 秒，会把整轮 20 分钟预算吃光）。

> 日志里的标记：`🖐️ 以下 N 张卡已自动上报搜索，请在 earn 页手动点一次：...`

> 早期版本尝试过纯 HTTP 复现（对齐 UA / IG / ncheader body / 全部查询参数），
> 全部无效 —— 根本原因在页面运行时，而不是参数拼错。


### MV3 的一个坑：别用内存变量做并发保护

曾经用内存 `Set` 记录「这张卡的标签页已打开」，结果在 service worker 里翻车：

- MV3 的 service worker 会被挂起，**内存里的 Set 既不释放也不跨上下文共享**
- 第二次调用时 `has(url)` 恒为真 → 直接 `return` → 标签页根本没打开
- 症状：日志里只有 `🌐 打开标签页…` 而没有 `📋 已执行并关闭`

现在改用**持久化、按卡片区分**的时间戳（`Config.searchTabAt.<卡片标识>`）：
既能跨挂起生效，又不会让不同卡片互相阻塞。


## 桌面奖励应用「每周专属任务」（纯 HTTP，不需要 CDP）

这是**只存在于桌面版 Microsoft Rewards 应用**里的任务，网页版 earn 页看不到入口。
2026-11-03 实测把它完全跑通，全程只用 `GM_xmlhttpRequest`，不依赖 CDP、不需要开着应用。

### 任务长什么样

一个 punchcard 父任务（如 `WW_pcparent_RewardsApp_weekly_Exclusive_Novw1_2026_punchcard`），
下面挂 8 张子卡：`Sunday`…`Saturday` + 「已安装应用」那张。每张子卡**只在它对应的星期几解锁**，
其余时间是 `isLocked:true`；整周满分 70 分，页面上的进度写作「状态: X/8 个任务」。

### 旧版为什么做不成

三个原因叠在一起，任何一个都足以让它永远「提交了但没完成」：

| 问题 | 旧版 | 实测的正确值 |
| --- | --- | --- |
| UA | `Macintosh + Safari + MSRewards/Desktop/1.4.56` | Windows + `Edg/` + `MSRewards/Desktop/<版本>` |
| 多发头 | `X-MSRewards-App: 1` | 应用**根本不发**这个头（抓包 33 个请求里一次都没出现） |
| 状态树 | 复用 `earn` 页的 `next-router-state-tree` | 必须带 **quest 段 + questId**（见下） |

第三条是关键：交卷 body 完全正确、服务端也回 `200 1:true`，但**不记账**——因为
`next-router-state-tree` 里少了 `earn → quest → [questId, 父任务ID]` 这一段。

### 真正的协议

```
POST https://rewards.bing.com/earn/quest/<父任务ID>
next-action: 707e6eb15bdfdd5fba193f0a77e934f7018faf87ce
next-router-state-tree: <带 questId 的树>
referer: 同上（quest 页）
origin: https://rewards.bing.com
content-type: text/plain;charset=UTF-8
x-rewards-source: msrewards-desktop

[hash, 11, {"offerid":"<子卡ID>","isPromotional":"$undefined","timezoneOffset":"-480"}]
```

树形（注意内层 `0`、外层 `refetch 16`，和普通 earn 页相反）：

```
["",{children:["(nav)",{children:["earn",{children:["quest",{children:[
  ["questId","<父任务ID>","d",null],{children:["__PAGE__",{},null,null,0]},null,null,0
]},null,null,0]},null,null,0]},null,null,0]},null,"refetch",16]
```

代码里对应 `Utils.questRouterStateTree(parentOfferId)`。

### 判定「是否真的记账」

响应的 `1:true` **只代表受理**——锁着的子卡同样返回 `true`。唯一可靠的判据是
**重新拉 quest 页面，看这张子卡还在不在待办列表里**。所以 `runDesktopWeeklyQuests`
每交一张就回读一次，卡消失了才算完成，否则记 `pending` 并留日志。

### 一周一次做完全部

子卡虽然按星期几逐日解锁，但**服务端接受对整周所有子卡的提交**——实测把
`Friday`/`Saturday`（当时 `isLocked:true`）也交上去，同样被记账，最后直接跑到
「状态: 8/8 个任务（70/70）」。脚本据此不做「今天星期几」的本地过滤，
把所有未完成子卡都交给服务端，由它决定给不给分。

> 这属于「服务端比客户端宽松」的边界，用不用自己判断；脚本的默认行为是**全部提交**。

### 顺带覆盖其它 punchcard

同一套通道对月度任务（`ENWW_pcparent_FY27_BingMonthlyPC_Nov_punchcard` 等）同样适用。
子卡 ID 前缀并不统一（`WW_pcchild` / `ENWW_pcchild`…），解析用的是「任意前缀 + `pcchild`」，
不再写死 `WW_`。

### 后台直发走不通，必须借页面之手（2026-11-04 第二次修正）

第一次修正后，日志仍然失败，但这次的信息量足够定位问题：

```
🖥️   形态尝试结果：无origin=500 / 同源origin=0 / 普通UA=0 / 站内XHR=0
🟠 桌面任务交卷失败：… → HTTP 0（未知，0.02秒） body=Unknown Error
```

**`status=0` + `0.02 秒` = 请求根本没发出去。** 原因：`Origin`、`sec-fetch-site/mode/dest`
都是浏览器的**禁改头**，`GM_xmlhttpRequest` 底层用 fetch，设这些头会直接抛错。
所以「同源origin / 站内XHR」两个候选必然失败，还把一个真正的 500 掩盖成了「未知错误」。

已把候选表收敛成两个**合法**形态：`默认`（应用身份）和`普通UA`（去掉 MSRewards 标识）。

但真正的问题是：**只要从扩展后台发，Origin 就是 `chrome-extension://<id>`，改不了。**
真机对照（真实登录账号，同一份请求）：

| 发送方 | Origin | 结果 |
| --- | --- | --- |
| rewards 页面里的 `fetch` | 浏览器自动写 `https://rewards.bing.com` | **200 + `1:true`，记账** |
| 扩展后台 `GM_xmlhttpRequest` | 强制 `chrome-extension://<id>` | **500 + 风控页** |

所以现在**换发送方**：

1. **页面通道** `API.viaPageChannel`
   后台把请求写进 GM 存储 → rewards 页面里常驻的小服务
   （`API.startPageServer`，每 1.5 秒写心跳 + 取任务）用**页面自己的 fetch** 发出去 →
   响应写回存储。Origin 天然同源。

2. **纯后台自动开页面** `API._ensurePageChannel`
   service_worker 里没有页面可借时，自动 `GM_openInTab` 打开一个
   `rewards.bing.com/earn`（后台标签、不抢焦点），轮询等心跳（最多 20 秒），
   就绪后借它代发。拿不到就退回直发，不会卡死。

3. **形态探测** 只剩 `默认` / `普通UA` 两个合法候选，能过的那种记进
   `Config.questVariant`，后续卡片直接用。

> 为什么不在后台直接发：`Origin` 是禁改头，脚本写什么都不算数。
> 「删掉 origin」只在不带任何 Origin 的裸 HTTP 客户端里有效（比如本机 Python 脚本），
> 在浏览器扩展里浏览器一定会补上扩展源。


### 2026-11-04 第三轮：三条日志各自对应一个真实 bug

这一轮日志信息很足，逐条对上：

```
🟡 代发页面 20 秒内没有就绪（可能是脚本未在该页注入），退回后台直发
🟡 桌面任务交卷未受理：… [已试形态 earn页+origin=500, quest页+origin=500, earn页+普通UA=500]
🟠 桌面任务交卷失败：… → 请求未发出（Unknown Error）
（用户反馈）打开了很多标签
```

**1. 页面服务根本没启动**

启动代码原本写在脚本末尾，但末尾前面有：

```js
if (!Utils.hasDOM()) return new Promise(() => {});
```

后台分支到这里就 return，后面顶层代码不再执行。页面分支虽不 return，但那之后还有大量
UI/菜单代码，任一环节抛错就轮不到它 —— 于是「页面开着、服务没跑」，后台永远等不到心跳。

现已移到 `TaskManager` 定义**之前**（`API.startPageServer` 已存在，且在一切 return 之前）。

**2. 标签页无限增长**

`_openingPage` 只防并发，跑完就清掉，所以每张卡、每次重试都重开一个标签。
现改用**持久化**的 `Config.pageOpenedAt`：10 分钟窗口内只要开过，就绝不再开第二个，
心跳没起来也只是在窗口内再等一会儿。（内存变量在 MV3 的 service_worker 里不可靠，
会被挂起清空，所以必须落存储。）

**3. `anonymous: false` 全部移除**

两个参考脚本的 `xhr` 包装**都不传 `anonymous`**，而本文散落 7 处 `anonymous: false`。
已全部删除。注意出口探测里那处 `anonymous: p.anonymous !== false` 是**有意保留**的
（探测要匿名、不能带 Cookie，否则 `cc=Cn` 会被 Bing 沿用），与交卷通道无关。

### 仍未确认的一环

本机用同样的 Cookie / 同样的头直连，四种组合（有无 origin × earn/quest 页）**全部 200**；
而在扩展后台发出时三种形态**全部 500**。所以剩下的差异只在「发送方」这一层。
上面三项修完后再看日志：

- 若变成 `代发页面已就绪` + `🟢 桌面专属任务完成` → 是页面服务没启动导致的，已解决；
- 若仍是 `=500` → 说明扩展后台的身份特征被 WAF 识别，需要走页面通道而不是后台直发。

### 2026-11-04 第四轮：根因是 `@background`，已改为 `@crontab`

前几轮一直在请求头/Origin/形态里打转，但都解释不了一个矛盾：
**本机（CDP 页面上下文、Python 裸 HTTP）同样的请求全部 200，扩展后台发却恒 500。**

答案在元数据里。对比两个成熟参考脚本：

| 脚本 | 定时方式 |
| --- | --- |
| 微软积分（全能任务版） | `@crontab */20 * * * *` |
| 微软积分商城签到（改进加强版） | `@crontab 3 9-18 * * *` |
| **本文（改动前）** | **`@background`** |

`@background` 让 ScriptCat 把脚本**只**跑在 service_worker 里 ——
副作用是**脚本再也不会注入任何页面**。于是：

- 「借 rewards 页面代发」这条唯一能绕开扩展 Origin 的路，永远起不来
  （日志里那句 `代发页面 20 秒内没有就绪` 就是它）；
- 后台直发又必然带 `chrome-extension://<id>` 的 Origin，被必应 WAF 500。

两条路同时堵死，怎么调请求头都没用。

**现在改成 `@crontab */20 * * * *`**：定时执行由 ScriptCat 负责，页面照常注入脚本，
代发服务能真正启动。

配套加固：

1. **代发服务启动位置**：移到 `TaskManager` 定义之前。脚本末尾有
   `if (!Utils.hasDOM()) return new Promise(() => {})`，后台分支到那儿就 return，
   之后顶层代码全不执行 —— 之前写在末尾等于白写。
2. **启动时打一条可见日志**：`🖥️ 代发服务已启动（页面上下文：rewards.bing.com）`。
   这条是「页面是否注入脚本」的唯一外部证据：`@background` 下永远不会出现。
3. **等待时间 20s → 45s**，并每 10/25 秒打一次进度。`@run-at document-start` 要等整个
   earn 页（含 Next.js 水合）跑完，慢网络下 20 秒本来就不够。
4. **跨上下文通信加监听器**：`GM_addValueChangeListener` 让页面写回结果时立刻收到，
   同时保留 600ms 轮询兜底（部分版本跨上下文 `GM_getValue` 读不到对方写入）。
5. **标签页只开一次**：持久化 `Config.pageOpenedAt`，10 分钟窗口内绝不再开第二个
   （之前 `_openingPage` 只防并发，跑完就清，每张卡都重开一个 —— 就是「打开了很多标签」）。

> 如果你更希望保持 `@background`（纯后台、不注入页面），那这条通道就只能放弃，
> 每周任务在扩展后台环境下无法完成 —— 这是浏览器对 `Origin` 的强制约束，不是脚本能绕的。

### 2026-11-04 第五轮：「7 张只成 1 张，成的还是没解锁的」

这个现象直接指向两个独立 bug，都已在代码里修掉。

**bug 1：失败帧被当成成功（`_actionLooksAccepted`）**

服务端对每次 server action 都会在 flight 流末尾给一行判定：

```
0:{"a":"$@1","q":"","i":false}
1:false          ← 这就是「没记账」
```

而旧判定是：

```js
return text.includes('"ok":true')
    || text.includes('"i":false')   // ← 失败帧里也有它
    || text.includes('"a":')        // ← 失败帧里也有它
    || text.includes("true");
```

失败帧**同时包含 `"i":false` 和 `"a":`**，于是被判定为「已受理」。后果连锁：
脚本以为成功 → 不再重试 → 日志显示完成 → 卡片其实一分没进。
这既能解释「只成 1 张」，也能解释「成的还是没解锁的那张」（见 bug 2）。

修法：只认 `<帧号>:true|false` 结果帧，取**最后一个**（结果帧总在末尾）。
两个细节：
- 分隔符可能是**换行**也可能是**空格**，真实响应两种都出现过，只认换行会把成功判成失败；
- `1:E{"digest":…}` 错误帧与 `"i":false` 这类 JSON 字段天然不匹配 `\d+:`，不会误伤。

**bug 2：提交顺序按页面顺序，锁卡排在解锁卡前面**

`open` 只过滤了 `!isCompleted`，没有按 `isLocked` 排序。页面顺序是
Sunday→Saturday，未解锁的卡排在前面，于是先提交了一堆服务端不会记账的请求，
把重试预算耗在了注定失败的卡上。

修法：
1. **已解锁的卡排到最前**（`unlockedFirst`），今天真正该拿分的优先处理；
2. **锁着的卡只试 1 次**（`maxAttempts = isLocked ? 1 : 2`）—— 服务端对未解锁子卡的
   回答是确定的 `1:false`，反复重试没有意义；
3. 全部锁定时直接打「本轮跳过」，不再空转提交。

日志现在会直接写明数量与状态：

```
🖥️ 发现桌面奖励应用专属任务：7 张待办（已解锁 1 张，锁定 6 张）（WW_pcparent_…）
🖥️   · [已解锁] 台球游戏
🖥️   · [锁定(未到当天)] 站着还是坐着？
```

### 2026-11-04 第六轮：为什么运行起来没有任何周任务日志

用户反馈「没有日志出来，希望像其它任务一样每轮都检测」。根因是**任务挂错了地方**：

```js
async doPromos(roundDeadline) {
    if (this.promosDate === RewardsAuto.state.dateNowNum) {
        Utils.log("✅", "活动卡片已完成");
        return true;          // ← 当天判成完成后，后面每一轮都在这里 return
    }
    ...
    await API.runDesktopWeeklyQuests();   // ← 周任务写在这里，永远执行不到
}
```

活动卡片当天做满之后，`doPromos` 每轮都走上面的短路返回，**周任务那几行代码根本不会被执行**。
而周任务的节奏是「按星期逐日解锁」——今天没做的卡明天才开，恰恰最需要每轮看一眼。

**改法：拆成独立任务 `doDesktopWeekly()`**

- 不再依附 `doPromos`，因此不受「今日已完成」短路影响，**每一轮都真的去扫描**；
- 放在 `runAll` 的最前面（活动卡片之前）：它按星期解锁、当天不做可能补不回来，优先级最高；
  放在后面时，一旦前面的任务耗光整轮预算，它同样会被轮空 —— 又是一轮没有日志；
- 完成判据**只看服务端**（quest 页子卡是否消失），不看本地日期标记，
  这样跨天、或用户在其它设备做过某张卡，都不会漏判；
- 内部异常会被吞掉并记一条日志，不会拖垮其它任务；
- 新增开关 `Tasks.desktopWeekly`（默认开）。

现在每轮的日志一定是可见的，例如：

```
🖥️ 扫描桌面奖励应用专属任务…
🖥️ 发现 1 个桌面专属任务入口：Novw1_2026_punchcard
🖥️ 发现桌面奖励应用专属任务：7 张待办（已解锁 1 张，锁定 6 张）
🖥️   · [已解锁] 台球游戏
🖥️   · [锁定(未到当天)] 站着还是坐着？
✅ 桌面专属任务本周已全部完成：WW_pcparent_…
```

（本周已做完时会直接打「已全部完成」，不会静默。）

### 不再自动打开标签页（2026-11-04）

脚本任务执行期间**不再弹出任何标签页**。之前有两处会自动开：

| 来源 | 行为 | 现状 |
| --- | --- | --- |
| 页面代发通道 `_ensurePageChannel` | `GM_openInTab` 开 rewards 页借它的 fetch | **默认关闭**（`Config.usePageChannel` 默认 false），且 `_ensurePageChannel` 另有 `Config.allowOpenTab` 双重保险 |
| CDP `earnPage()` | 找不到现成页面就 `PUT /json/new` 新开一个 | **默认不新开**，要 `Config.cdpAllowNewTab=true` 才允许 |

**关掉有影响吗？没有。**

页面代发通道在本文的部署方式下**从来没成功过**。原因很明确：脚本用 `@background`
只跑在 service_worker 里，页面永远不注入脚本，所以代发服务起不来 ——
开出去的那个标签页纯属白开（日志里「代发页面 45 秒内没有就绪」就是这个）。

而它想解决的问题（Origin 被浏览器强制成 `chrome-extension://<id>`）已经由
**CDP 页面通道**彻底覆盖，实测 200 记账。所以去掉自动开标签不影响功能。

> 剩下的 `GM_openInTab` 调用都是**用户主动触发**的，不会自己弹：
> 通知点击打开 dashboard、授权流程、菜单「手动授权」。

### 现在需要你做的一件事

CDP 通道要求**已经有一个 rewards.bing.com 页面开着**（脚本不会再替你开）。
用桌面「Rewards Edge」快捷方式启动 Edge 后，随便留一个 rewards 页标签即可；
没有时脚本安静降级到后台直发，并在日志里说明。

### 2026-11-04 第七轮：CDP 交卷「已受理但未记账」+ 只做已解锁的卡

**问题 1：CDP 交卷成功了（`1:true`），但卡片没进账**

```
🖥️   经由 CDP 页面通道交卷成功
🟡 桌面任务已受理但未记账（服务端没加分）：奖励应用专属, 装置艺术
```

这说明**交卷不是这类子卡的全部动作**。参考「商城签到改进加强版」的实测结论：

> 月度打卡（含 Rewards 应用每周专属 Quest）：按子项 href 的应用搜索签名上报 + 交卷 + 回读服务端进度核对

子卡的 href 是 `bing.com/search?q=...&form=ML2Y2H&PUBL=RewardsDO`，
属于「在 Rewards 应用内搜索」型。**只交卷时服务端看不到那次搜索**，
于是即使返回 `1:true` 也不会记账 —— 正是上面那条日志。

正确顺序（现在已实现为 `API.reportAppSearchForCard`）：

1. GET 子卡 href 拿 SERP，并从响应里取服务端分配的 `IG`；
2. POST `bing.com/rewardsapp/ncheader?...` —— 告知这次搜索的上下文；
3. POST `bing.com/rewardsapp/reportActivity?...&<子卡原始签名参数>` —— 真正记账的那一下；
4. 最后才交卷。

这三步都打在 `bing.com` 域下的普通接口，**不受 server action 的 Origin 限制**。

**问题 2：只显示、只提交已解锁的卡**

按你的要求改了：

- 未解锁的卡**不显示**、**不提交**（以前会把它们也一起提交，既浪费重试预算，
  又在日志里刷出一串「(未解锁)」，分不清「今天该做的没做成」还是「今天本来就没开」）；
- 汇总日志也只看已解锁的剩余量，例如：
  `本次完成 1 张、失败 0 张，今日已解锁的都处理完了（另有 6 张未解锁，到对应那天自动处理）`

日志现在是干净的：

```
🖥️ 扫描桌面奖励应用专属任务…
🖥️ 发现 1 个桌面专属任务入口：Novw1_2026_punchcard
🖥️ 桌面奖励应用专属任务：1 张已解锁待办（另有 6 张未解锁，不处理）
🖥️   · [已解锁] 装置艺术
🖥️   已上报应用搜索：装置艺术
🟢 桌面专属任务完成：装置艺术
```

### 2026-11-04 第八轮：明明有解锁的卡，却「扫描不到」

现象：

```
🖥️ 本轮没有桌面奖励应用每周专属任务（可能已全部完成或本周未投放）
```

而页面上明明还有已解锁的待办卡。

**根因：quest 入口解析只走了一条路径**

旧实现：

```js
const text = this._flightText(earnHtml);          // 只拼 self.__next_f.push 片段
const re = /\/earn\/quest\/(...punchcard...)/g;
```

`_flightText` 对**转义层级**非常敏感：字符串里再套一层 `\"`、
或者出现 `\u0026` 这类转义时，`JSON.parse` 失败，该片段被静默丢弃
（`catch (_) {}`），拼出来是空串 → 一个入口都找不到。

参考脚本（商城签到改进版）**不依赖 flight 解析**，它直接在整个 HTML 上跑三条正则：

```js
/"offerId":"([^"]*punchcard[^"]*)"/g
/"href":"(\/earn\/quest\/[^"]+)"/g
/href="(\/earn\/quest\/[^"]+)"/g
```

**改法：五重兜底**（`_questLinksFromEarn`）

| 层 | 依据 | 作用 |
| --- | --- | --- |
| 0 | flight 片段 | 正常情况最准 |
| 1 | `"offerId":"...punchcard..."` | 父任务字段 |
| 2 | `"href":"/earn/quest/..."` | flight 里的链接字段 |
| 3 | `href="/earn/quest/..."` | 渲染后 HTML 的链接属性 |
| 4 | `\"href\":\"/earn/quest/...` | 再套一层转义的形态 |

任一层命中即可。测试覆盖了四种形态（标准 flight / 多层转义 / 渲染后 HTML / 只有 offerId），
旧实现只有第一种能过。

**同时加的诊断**

`runDesktopWeeklyQuests` 现在会报告实际拿到的页面情况：

- earn 页 < 60k 或命中登录页特征 → 明确提示「疑似未登录，请检查 GM_cookie 授权 / 账号登录」；
- 找不到周任务入口 → 列出**所有**能识别到的 quest 入口（`earn 页 N 字节，识别到 M 个 quest 入口：…`），
  便于区分「本周真没有」和「解析失败」。

> 注：项目已回归**纯后台通道**（不再用 CDP 读页面）。参考脚本同样是裸
> `GM_xmlhttpRequest`，说明后台请求本身会带 cookie，问题不在「读不到登录态」。

### 日志：每张卡都要说清楚

周任务最容易「看起来没动静」，所以 `runDesktopWeeklyQuests` 全程打点：

```
🖥️ 扫描桌面奖励应用专属任务…
🖥️ 发现 1 个桌面专属任务入口：Novw1_2026_punchcard
🖥️ 发现桌面奖励应用专属任务：7 张待办（WW_pcparent_…）
🖥️   · [已解锁] 奥运射箭
🖥️   · [锁定(未到当天)] 披萨的历史
🟢 桌面专属任务完成：奥运射箭
🟡 桌面任务已受理但未记账（服务端没加分）：…
🟠 桌面任务交卷失败：… → HTTP 500（必应风控拦截，多半是 Origin/UA 特征）
🟡 桌面应用每周专属任务：本次完成 N 张、失败 M 张，仍剩 K 张未完成（…）
```

几个刻意的设计：

- **每张卡都标解锁状态**——`[锁定(未到当天)]` 说明「今天本来就没开」，`[已解锁]` 才是脚本该做的。
  两者排障方向完全不同，不标出来就会误以为脚本没跑。
- **失败原因翻译成人话**（`_questReason`）：500=风控拦截 / 401=登录态 / 404=action ID 变更 / 超时。
- **单张失败不再中断整批**：旧版 `runDesktopWeeklyQuests` 里没有 try/catch，
  一张卡抛 500 就直接冒泡到 `doPromos` 的 catch，整批任务静默中止——
  日志里只剩「发现 7 张待办」和「处理跳过」两条，中间全空白。
  现在每张卡单独 try/catch，失败记一笔继续下一张；单卡最多试 2 次（WAF 是瞬时的）。
- 拉 earn 页 / 读 quest 页 / 交卷后复核，三个环节各自 try/catch，任一环节挂了都留明确日志。

## 关于 503

`WW_Rewards_locked_level2_*` 这类卡在网页上可能是**已解锁**的（账号等级已达标），
此时 503 并非「等级不够」。早期版本按 offerId 拉黑这类卡，会误杀本可完成的卡，已撤回。

现在 503 一律按普通失败处理、交给外层重试，不做任何 ID 级别的拉黑。
`isUnoffered` 读写通道保留，但当前没有任何触发点。

## 测试

```bash
node tests/cardlock.test.mjs    # 锁态判定
node tests/claim.test.mjs       # 发现 → 交卷 → 复核（含 App UA 通道、dpl、成功判定）
node tests/tristate.test.mjs    # 完成状态三态（DAPI 查不到时回读网页侧）
node tests/levelgated.test.mjs  # 等级门槛卡：已解锁照常做，不按 ID 误杀
node tests/appsearch.test.mjs   # 应用内搜索型卡：交给 CDP，且不打开标签页
node tests/cookie.test.mjs      # 登录态判定：用 .bing.com 真实 cookie 名单
node tests/cdp.test.mjs         # CDP 模块：端口探测、启动命令、提示节流
node tests/probe.test.mjs       # 首次运行 Cookie 授权引导
node tests/weekly.test.mjs      # 桌面应用每周专属任务：quest 状态树、应用头、受理≠记账
node tests/weeklylogs.test.mjs  # 周任务日志与容错：单卡 500 不中断整批、每张卡标解锁态
node tests/weeklyorder.test.mjs # 执行顺序与受理判定：解锁优先、失败帧不当成功
node tests/weeklytask.test.mjs  # 独立任务：每轮检测、不受活动卡片短路影响
node tests/questparse.test.mjs    # quest 入口解析五重兜底：转义/渲染后/offerId 都能找到
node tests/questvariant.test.mjs  # 交卷形态自动探测：哪一形态能过就记住它
node tests/pagechannel.test.mjs  # 页面通道：让 rewards 页面代发，绕开扩展 Origin
node tests/pageautoserve.test.mjs # 纯后台自动开代发页面：能接上就用，接不上退回直发
```

测试用 `tests/harness.mjs` 在 Node 里加载 `main.js`，用假的 `GM_*` 顶替油猴 API，
不需要浏览器和真实账号。
