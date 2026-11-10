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
| 带锁 🔒 卡片(已解锁) | ✅  | ✅ 需先配好 CDP（见第三节） |
| 桌面端任务 | ✅ | ❌ |
| 首页待领取 | ✅ | ❌ |
| 月度计划 | ✅ | ❌ |

## 三、手动配置 Edge 的 CDP 通道（可选，只为带锁 🔒 卡片）

> 只解决带锁卡片。桌面端、首页待领取、月度计划仍需用 Chrome 跑。

### 1. 建 CDP 配置目录

资源管理器地址栏输入 `%LOCALAPPDATA%\Microsoft\Edge` 回车 → 新建文件夹，名字填 **`CDPUser Data`**。

已有就跳过。重装 Edge 或换机器后要重做一次。

### 2. 在桌面建 CDP 专用快捷方式（这样桌面才有这个浏览器的图标）

桌面空白处右键 → **新建** → **快捷方式** → 位置一栏粘贴下面整行（引号一起带上）：

```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="%LOCALAPPDATA%\Microsoft\Edge\CDPUser Data"
```

→ 下一步 → 名称填 **`Rewards Edge`** → 完成。

- Edge 装在 `C:\Program Files` 的，把前面的 exe 路径换成那一个。
- 核对：右键快捷方式 → 属性，「目标」里应该就是上面那一整行。
- 想钉到任务栏：右键快捷方式 → 固定到任务栏。

<details>
<summary>换个做法：拿现成的 Edge 快捷方式改</summary>

1. 开始菜单找到 Microsoft Edge → 右键 → 更多 → 打开文件位置
2. 复制它的快捷方式 → 桌面粘贴 → 重命名成 `Rewards Edge`
3. 右键 → 属性 → 在「目标」末尾先敲**一个空格**，再粘下面这段

```
--remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="%LOCALAPPDATA%\Microsoft\Edge\CDPUser Data"
```

4. 确定保存

</details>

### 3. 双击桌面「Rewards Edge」，在新窗口登录一次 `rewards.bing.com`

- 用的是独立配置目录，和日常的 Edge 互不影响，平时那个照常用。
- 以后跑脚本时这个窗口要一直开着，可以正常在里面浏览。
- 授权/Token 在平时的浏览器里照旧做，不用在这个窗口重复。

### 4. 验证

1. 浏览器打开 `http://127.0.0.1:9222/json/version`，出现 `"Browser": "Edg/..."` 即端口通了。
2. 脚本菜单 → **🖱️ CDP / 临时标签页状态**，看两行：

   - `CDP：✅ 可连`
   - `浏览器级 ws 通道：✅ 可用`

   都绿就配置完成，带锁卡片会由脚本在后台开临时页完成，用完自动关闭。

### 配置项（一般不用动）

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `Config.cdpPort` | 9222 | 端口；脚本会自动按 `9222 / 9224 / 9223` 逐个探测，用这三个之一就不用填 |
| `Config.cdpAutoTab` | 开 | 允许静默开临时标签页；关掉就完全不开页 |
| `Config.cdpHardTab` | 关 | 静默开页失败时的兜底，**会抢焦点**，不要开 |
| `Config.cdpProfileDir` / `cdpProfileName` | 空 | 只影响诊断里给出的提示命令，填错不影响连接 |

### 常见问题

- **双击快捷方式后端口仍不通**：之前用同一配置目录开过 Edge，旧进程会接管新命令。任务管理器结束所有 `msedge.exe`，再双击。
- **端口能连，但日志说「拿不到可用的 rewards 页」**：快捷方式参数漏了 `--remote-allow-origins=*`。右键属性补上，关掉窗口重开。
- **别加 `--profile-directory="Profile 2"`**：调试目录里通常只有 `Default`，加上会开出一个空配置。
- **别给日常配置目录加调试端口**：`--user-data-dir` 一定指向单独的 `CDPUser Data`。
