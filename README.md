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
| 桌面端任务（每周专属） | ✅ |
| 首页待领取 | ✅ |
| 月度打卡 | ✅ 1.3.1 起 |

## 说明

- 代码主要改自微软积分（全能任务版），主要自己留存备份使用。
- 感谢ScriptCat001 DuskLight 潘矩森 大大 ，以及其他更多的大大。
- 仅供学习交流，账号风险自负，请遵守 Microsoft Rewards 服务条款。MIT License。
