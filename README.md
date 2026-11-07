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


## ⚠️ 二、Edge 与 Chrome 的差别（必读）

下面这几类任务走的是微软的 Next.js Server Action 接口，服务端会强制校验 `Origin`：

- **Chrome**：扩展后台发出的请求可以用 declarativeNetRequest 把 `Origin` 摘掉，直接就能用。
- **Edge**：同一套规则会被 Edge 网络层覆盖（`Origin` 被重新写回），扩展后台这条路必被 500。

所以 Edge 上这几类任务改走 **CDP 页面通道**：在真正的 rewards 页面里发同源请求，`Origin` 天然是
`https://rewards.bing.com`，服务端正常 200。

| 任务 | 在 Chrome | 在 Edge |
| --- | --- | --- |
| 带锁 🔒 卡片(已解锁) | ✅ | ✅ 需开启 CDP |
| 桌面端任务 | ✅ | ✅ 需开启 CDP |
| 首页待领取 | ✅ | ✅ 需开启 CDP |
| 月度计划 | ✅ | ✅ 需开启 CDP |

### 在 Edge 上开启 CDP（一次性）

1. 用带调试端口的快捷方式启动 Edge（脚本「诊断」里可以直接复制现成命令）：

```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9224 --remote-allow-origins=* --user-data-dir="%LOCALAPPDATA%\Microsoft\Edge\CDPUserData" --profile-directory="Profile 2"
```

2. 首次在这个独立窗口里登录一次 rewards.bing.com（登录态和平时那个窗口是分开的）。
3. 之后不用手动开页面：脚本会自己找现成的 rewards 标签页，没有就新开一个（`Config.cdpAutoTab`，默认开）。

相关开关：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `Config.cdpPort` | `9224` | 调试端口 |
| `Config.cdpAutoTab` | `true` | 没有 rewards 页面时自动开一个 |
| `Config.pageAppUa` | `false` | 把页面请求的 UA 覆盖成脚本配的 UA（桌面专属任务被拒时可打开试） |

## 说明

- 代码主要改自微软积分（全能任务版），主要自己留存备份使用。
- 感谢ScriptCat001 DuskLight 潘矩森 大大 ，以及其他更多的大大。
- 仅供学习交流，账号风险自负，请遵守 Microsoft Rewards 服务条款。MIT License。
