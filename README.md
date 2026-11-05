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

## Edge / Chrome 都能完成（1.3.1 起）

**不存在「必须在 Chrome 才能完成的任务」**，也不需要降级 Edge 或装 MV2 扩展。

### 真正的原因

必应的交卷 / 领取接口只接受 `Origin: https://rewards.bing.com`：

| 发送方 | Origin | 结果 |
| --- | --- | --- |
| rewards 页面里的 `fetch` | `https://rewards.bing.com` | **200 记账** ✅ |
| 扩展后台 / offscreen document | `chrome-extension://<id>` | 500 风控页 ❌ |

实测：同一份 MV3 扩展在 **Chrome 里从后台发也一样 500**。所以问题从来不是浏览器品牌。

### 解决办法：CDP 同源通道

脚本保持 `@background`（**后台常驻，关掉所有页面也会按 20 分钟一轮自动跑**），
同时通过调试端口在真实页面里发请求。

**一次性配置**（详见 `Rewards-Edge-CDP.ps1`）：

```powershell
powershell -ExecutionPolicy Bypass -File Rewards-Edge-CDP.ps1
```

它会：
1. 建一个独立配置目录 `%LOCALAPPDATA%\Microsoft\Edge\CDPUserData`（约 200KB，不影响日常 Edge）
2. 从 `Profile 6` 复制登录态（Cookies + Local State + Preferences）
3. 以 `--remote-debugging-port=9224` 启动 Edge 并打开 rewards 页

之后**保持这个窗口开着**即可，无需重复登录。

### 怎么确认生效

脚本日志里应出现：

```
CDP 调试端口 9224：✅ 可连
🖥️   经由 CDP 页面通道交卷成功
```

### 通道优先级

```
local（脚本被注入 rewards 页时）→ page（CDP）→ proxy → xhr（仅兜底）
```

| 任务 | 状态 |
| --- | --- |
| 带锁 🔒 卡片(已解锁) | ✅ |
| 桌面端任务（每周专属） | ✅ 1.4.1 起改为真实检测 |
| 首页待领取 | ✅ |
| 月度打卡 | ✅ 1.3.1 起 |

## 桌面 / 月度打卡：为什么必须「真实检测」（1.4.1）

1.3.1 的日志写着「本次完成 1 张」，实际一分没进账。原因有两层：

1. **服务端只把「未完成」的子卡写进 RSC payload。**
   已完成的子卡连 `offerId`/`hash` 都不下发。
   旧代码解析到 0 张卡就当成「本周已全部完成」上报 —— 日志漂亮，进度没动。
2. **旧代码还把 CTA 按钮上的 `M6.25 4.5A1.75`（外链箭头）当成「锁图标」**，
   于是所有带按钮的卡都被判成锁定，真正该做的卡反而被跳过。

1.4.1 改成的判定方式（全部实测过，探针脚本在 `_probe/`）：

| 判据 | 来源 |
| --- | --- |
| 进度 `N/M` | 页面顶部「状态: N/M 个任务」计数器（权威） |
| 已完成 | 该行状态图标带 `bg-statusSuccessRewardsBg`（里面是对勾） |
| 显示锁定 | 行内显式 `"isLocked":true`，或图标是空圈 `border-ctrlChoiceBaseStrokeRest` |
| 可交卷 | 服务端下发了 `offerId` + `hash`（**与是否显示锁定无关**） |

并且：

- **`全部完成` 只在 `N>=M` 且每行都有对勾时才算**；读不到计数器一律不下结论。
- 交卷后必须看到**计数器真的 +1**（或该行变成对勾）才算 `confirmed`，
  只是「响应 200/`1:true`」不够 —— 否则就报「已受理但没记账」。
- 不再按星期/锁定决定「要不要做」：只要服务端给了 `hash` 就去尝试，
  页面显示锁定也照样走一遍，成不成由交卷后的进度复核裁决。

### 只交卷就够了，不需要开标签（1.4.2）

`punchcard` 子卡和首页待领取都是 `urlreward`，记账通路就是 **CDP 页面里同源交卷**：

```
CDP 页面通道：在已开着的 rewards 页里 fetch POST（Origin 同源）→ 服务端 1:true → 记账
```

曾经试过「先导航到目标页 → 在 bing 页里上报 /rewardsapp/* → 再回来交卷」，
实测结论是**对是否记账没有帮助**，只会让浏览器来回跳页、多开标签：

| 做法 | 结果 |
| --- | --- |
| 直接交卷（已解锁卡） | `1:true`，进度 0/5 → 1/5，**真记账** |
| 访问 + 上报 + 交卷（已解锁卡） | 同样记账，没有更快也没有更稳 |
| 访问 + 上报 + 交卷（显示锁定卡） | 全是 200，进度**不动**（服务端不给记） |

所以 1.4.2 起：
- **移除**了「导航到 bing 页 + 应用搜索上报」这一整套，脚本不再自动开标签；
- `_ensurePageChannel` 直接返回 null（只借用已开着的 rewards 页，不再新开）；
- `earnPage()` 删掉「允许新开标签」的分支。

> `/rewardsapp/*` 是 bing.com 自己的接口：在 bing 页里发是 200，
> 在 rewards.bing.com 里发跨域抛异常（恒 -1），扩展后台直发也会被拒。
> 这条知识保留在 `reportAppSearchForCard` 的注释里，留给首页「等级门槛卡」用，
> 但它现在只做后台直发的尽力尝试，**不会再动你的标签页**。

> 注意：`WW_pcparent_FY27_Duolingo3M_punchcard` 这类入口有时是空壳
> （页面里既没卡片也没有计数器），现在会如实记「当前没有活动面板」，
> 不会写成「已完成」。

## 说明

- 代码主要改自微软积分（全能任务版），主要自己留存备份使用。
- 感谢ScriptCat001 DuskLight 潘矩森 大大 ，以及其他更多的大大。
- 仅供学习交流，账号风险自负，请遵守 Microsoft Rewards 服务条款。MIT License。
