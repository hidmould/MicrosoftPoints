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
| 带锁 🔒 卡片(已解锁) | ✅  | ✅ 需先配好 CDP（见第四节） |
| 桌面端任务 | ✅ | ❌ |
| 首页待领取 | ✅ | ❌ |
| 月度计划 | ✅ | ❌ |

## 三、两种通道的分工（先看这里）

脚本里有**两套完全独立的通道**，用错对象就会出现「明明不需要却开了标签页」：

| | 每日活动（页面顶部那一排 3 张） | 日常任务（下面网格里的卡片） |
| --- | --- | --- |
| 卡长什么样 | 无锁标：即将到来的喜剧活动、葡萄酒之旅、云形成类型… | 普通卡无锁；**带锁 🔒 的**才特殊 |
| 记账通道 | **DAPI**（`dapi/me/activities` 一条 POST 就记账） | 普通卡走后台网页交卷；带锁卡走 **CDP** |
| 要开标签页吗 | **❌ 从不开** | 只有带锁 🔒 的卡才开 |
| 要配 CDP 吗 | **不需要** | 带锁卡需要 |

判定逻辑写在 `API._isDailyActivity()` / `API._needsCdp()` 两个函数里：

- `_isDailyActivity()`：`source === "dapi"`，或 `offerId` 含 `Gamification_DailySet_` → 判为每日活动；
- `_needsCdp()`：每日活动一律 `false`；其余卡片里 `appOnly`（应用专属）、`levelGated`（等级门槛）、
  应用内搜索签名卡才是 `true`。

只有 `_needsCdp()` 为真的卡片才会触发静默开页，其余任务里 CDP 只**复用**你已经开着的
rewards 页（`ensurePage(..., { create: false })`），没有现成页面就直接走 DAPI / 后台请求。

### 开标签页的硬闸门（`v1.4.0`）

「不走 CDP 就不许开页」现在由代码强制保证，不是靠调用方自觉：

- 整个脚本里**只有一处**真正创建标签页 —— `CDP.openSilent()` 里的 `Target.createTarget`；
- 它进来的第一件事是**取令牌**，取不到就直接 `return null`，页根本不会建出来；
- 令牌只能由 `grantOnce(reason)` 发放，而 reason 必须在白名单里：

  | reason | 用途 |
  | --- | --- |
  | `card-cdp` | 带锁 🔒 / 应用内搜索签名卡（`form=ML2W4J` / `ML2Y2H`） |
  | `desktop` | 桌面应用专属任务（必须切应用 UA） |

- 令牌**一次性**：消费后立即失效，同一个授权开不出第二个页；
- `_ownedPage` / `ensurePage` 的 `create` 默认值都是 **`false`**，要开页必须显式传
  `create: true` 加合法 `reason`；
- 「页面代发通道」（`GM_openInTab`）已停用 —— 它不属于 CDP，开出来的页还得你再手动跑一次脚本。

实测真值表（跑的是文件里的真实函数）：

| 卡片 | 开标签页 |
| --- | --- |
| 每日活动（Comedy / 葡萄酒 / 云形成） | ❌ |
| Quiz 你是否知道答案 | ❌ |
| 拼图 完成此拼图 | ❌ |
| 即时赢奖 / 推荐奖励 | ❌ |
| 带锁 探险火星 / 古代建筑 | ✅ |
| App 专属卡 | ✅ |

菜单里那几个 `GM_openInTab`（打开 dashboard、手动授权）是你**主动点击**才触发的，不属于自动任务。

## 四、手动配置 Edge 的 CDP 通道（可选，只为带锁 🔒 卡片）

> 只解决带锁卡片。桌面端、首页待领取、月度计划仍需用 Chrome 跑。
> **每日活动不需要这一节** —— 它走 DAPI，配不配 CDP 都不会开标签页。

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
- **带锁 🔒 卡一直做不完**：已经修过三个坑（`v1.3.1`）——
  1. 国内 `www.bing.com` 会 302 到 `cn.bing.com`，跨域上报被 CORS 拦掉，现在用页面真实落地域；
  2. 后台标签页 `document.hidden=true`，Chromium 不做布局，卡片盒子是 `0×0`，
     旧代码照着 `(0,0)` 点击等于点空白却报成功，现在改成 `element.click()`；
  3. 真正记账的是 **Server Action 交卷**（返回 `1:true` 立即生效），
     搜索上报只是陪跑，现在交卷提到第一步做。
  另外入账是异步的，等待窗口从 25 秒放宽到 3 分钟，正常上报过的卡不再被误标成「需手动点击」。

- **普通的 Quiz / 拼图卡被当成带锁卡，硬要走 CDP 反而做不完**（`v1.3.3` 已修）：
  「你是否知道答案？」这类卡的 `destination` 是 `bing.com/search?...&PUBL=RewardsDO`，
  而旧判定把 `PUBL=RewardsDO` 也算成「应用内搜索签名」——它其实只是**通用跟踪参数**，
  「完成此拼图」「即时赢奖」等卡都带它。于是 quiz 卡被拽去走 CDP 真搜索，本来后台网页交卷就能完成。
  现在签名只认 `form=ML2W4J` / `form=ML2Y2H`，并且 `quiz` / `puzzle` / `image_creator`
  这三类互动卡直接排除在 CDP 之外。

  | 卡片 | form | 旧判定 | 现在 |
  | --- | --- | --- | --- |
  | 探险火星（真带锁） | `ML2W4J` | CDP | CDP ✅ |
  | 古代建筑（真带锁） | `ML2W4J` | CDP | CDP ✅ |
  | 你是否知道答案？（quiz） | `ML2BF1` | CDP ❌ | 后台网页交卷 ✅ |
  | 完成此拼图（puzzle） | `ML2BF0` | 网页 | 网页 ✅ |
