# 微软积分自动任务脚本

在后台自动完成 Microsoft Rewards 任务，完成后推送汇总。

---

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

&nbsp;

---

## 二、必须在Chrome浏览器或者配置CDP才能完成的任务(须知)

***(更推荐使用Chrome，CDP在Edge136版本开始默认禁用，不懂CDP不建议配置)***

了解到 **<u>Edge 151</u>** 及以前版本不需要配置CDP，我没有试过，大家可以尝试行不行

[点击了解什么是CDP](https://blog.csdn.net/weixin_29008055/article/details/165897493)(网上关于CDP相关的文章较少，可以询问AI)


| 任务 |  Chrome |  Edge |
| --- | --- | --- |
| 带锁 🔒 卡片(已解锁) | ✅  | ✅ 需先配好 CDP（见第三节） |
| 桌面端任务 | ✅ | ✅ 需先配好 CDP（见第三节） |
| 首页待领取 | ✅ | ✅ 需先配好 CDP（见第三节） |
| 月度计划 | ✅ | ✅ 需先配好 CDP（见第三节） |

(使用CDP会打开新标签页，完成任务后会自动关闭)

&nbsp;

---

## 三、手动配置 Edge 的 CDP 通道

1. 在桌面建 CDP 专用快捷方式（这样桌面才有这个浏览器的图标）

    - 桌面空白处右键 → **新建** → **快捷方式** → 位置一栏粘贴下面整行(引号一起带上)→ 下一步 → 名称填 **`Rewards Edge`**(可随意填) → 完成。

    ```
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="%LOCALAPPDATA%\Microsoft\Edge\CDPUser Data"
    ```

   - Edge 装在 `C:\Program Files` 的，把前面的 exe 路径换成那一个。
   - 端口号和存放路径不想使用上面给的这个可以自行更改成其它，但是更改后也要手动更改脚本的端口号和存放路径


2. 验证

   - 浏览器打开 `http://127.0.0.1:9222/json/version` ，出现 `"Browser": "Edg/..."` 即端口通了。(后续使用这个快捷方式作为日常浏览器)

3. 删除(不想使用CDP了怎么删除)

   - 删除桌面图标
   - 文件夹地址填写下面这个回车(把CDPUser Data删除)
   ```
   %LOCALAPPDATA%\Microsoft\Edge
   ```

&nbsp;

---

## 四、常见问题

1. 在一个浏览器内不要切换账号，cookie和缓存会串

2. 搜索任务完不不成（解决：清除一下浏览器数据，重新登陆）

&nbsp;

---

## 说明
- 代码主要改自微软积分（全能任务版），主要自己留存备份使用。
- 感谢ScriptCat001 DuskLight 潘矩森 大大 ，以及其他更多的大大。
- 仅供学习交流，账号风险自负，请遵守 Microsoft Rewards 服务条款。
- MIT License。