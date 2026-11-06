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


## ⚠️ 二、Edge 上能自动完成哪些任务

脚本大部分任务用 Edge 也能跑。下面四类任务在 **Chrome 上直接可用**；
在 **Edge 上需要先开 CDP**（见下文「三、Edge 上启用 CDP」），原因是
Edge 新版本会把后台直发的请求打回登录页，脚本读不到任务数据。

| 任务 | 在 Chrome | 在 Edge（未开 CDP） | 在 Edge（已开 CDP） |
| --- | --- | --- | --- |
| 带锁 🔒 卡片(已解锁) | ✅ | ❌ | ✅ |
| 桌面端任务 | ✅ | ❌ | ✅ |
| 首页待领取 | ✅ | ❌ | ✅ |
| 月度计划 | ✅ | ❌ | ✅ |

不想配 CDP 就直接用 Chrome 跑，四类都能拿满。

## 三、Edge 上启用 CDP（让上面四类也能自动完成）

CDP = 让脚本通过 Edge 自己的调试端口，在**页面上下文里**发请求。
这样请求带着真实登录态、同源，服务端就正常受理了。

1. 用桌面上的「Rewards Edge」快捷方式启动，或手动执行（端口可按需改）：

   ```
   & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" ^
     --remote-debugging-port=9224 --remote-allow-origins=* ^
     --user-data-dir="%LOCALAPPDATA%\Microsoft\Edge\CDPUserData" ^
     --profile-directory="Profile 2"
   ```

2. 在那个窗口里**登录一次** rewards.bing.com，并**保持一个 rewards 页面开着**
   （脚本要靠它做页面同源请求；只有 earn/quest 页才算）。

3. 端口不是 9224 的话，改脚本设置项 `Config.cdpPort`。

验证方式：后台日志里应出现「CDP 已连接」或「经由 CDP 页面通道交卷成功」。
连不上时日志会给出端口探测结果和启用命令，30 分钟内不重复提示。

## 说明

- 代码主要改自微软积分（全能任务版），主要自己留存备份使用。
- 感谢ScriptCat001 DuskLight 潘矩森 大大 ，以及其他更多的大大。
- 仅供学习交流，账号风险自负，请遵守 Microsoft Rewards 服务条款。MIT License。

回归测试：

```bash
node tools/claim_test.js      # 待领积分：i18n 干扰 / 金额解析 / 领取路由
node tools/monthly_test.js    # 月度计划：解析/节流/交卷确认/跨月
node tools/sched_test.js      # 常驻调度：卡死回收/锁接管
node tools/cdp_probe.js       # CDP 连通性诊断（--submit 会真的交卷）
```

## 四、待领取积分的两个坑（已修）

这两处曾导致「明明有积分没领，却报无可领取」，记录在此以免回退：

1. **同名键干扰**：页面里有两个键——`"PointClaim"`（大写 P，界面文案表，位置靠前）和
   `"pointClaim"`（小写 p，真正的待领数据 `{"points":N,"entries":[...]}`，位置靠后）。
   匹配时若忽略大小写，会先命中文案表，导致「有 3 分待领」被误判成「金额为 0」。
2. **金额只读一小段**：命中文案表时，真实数据在几万字符之外，只往后读 1200 字符永远读不到。
   现在改为扫描全页所有小写 `pointClaim` 数据对象，取 `points` 最大值。

另外，领取请求必须发到 **`/dashboard`**，不能发 `/earn`（实测同样参数下
`POST /dashboard → 1:true`、`POST /earn → 1:false`）。
