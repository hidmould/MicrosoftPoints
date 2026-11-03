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
```

测试用 `tests/harness.mjs` 在 Node 里加载 `main.js`，用假的 `GM_*` 顶替油猴 API，
不需要浏览器和真实账号。
