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
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="%LOCALAPPDATA%\Microsoft\Edge\CDPUserData" --profile-directory="Profile 2"
```

- `--remote-allow-origins=*` 是必须的，否则后台建页会被拒绝。
- 该配置目录首次需要单独登录一次 `rewards.bing.com`。
- 想看当前状态：脚本菜单 → **🖱️ CDP / 临时标签页状态**。

### 相关配置项

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `Config.cdpPort` | 9222 | 调试端口；实际会按 `9222 / 9224 / 9223` 逐个探测 |
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
