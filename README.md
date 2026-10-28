# 微软积分自动任务脚本

在后台自动完成 Microsoft Rewards 任务，完成后推送汇总。

## 授权（首次必做）

1. **🔑 手动授权**，在打开的微软页面登录账号。
2. 登录后浏览器会跳转，**复制地址栏里的完整地址（授权码）**， 形如：
`https://login.live.com/oauth20_desktop.srf?code=M.C561_BAY.2.U.MsaArtifacts.xxxxx&lc=2052`
3.  **📋 粘贴授权码**，把整段地址粘进去，回车。
4. 提示"授权成功"即可。之后用 Token 运行。

**授权码长什么样**：就是上面地址里包含 `code=M.` 的链接，形如

```
https://login.live.com/oauth20_desktop.srf?code=M.C561_BAY.2.U.MsaArtifacts.xxxxx&lc=2052
```


> 授权码**只能用一次**。若提示"换取 Token 失败"，多半是码已过期或被用过，重新走一遍上面的步骤。状态可用菜单 **📊 Token状态** 查看。

## 说明

- 代码主要改自微软积分（全能任务版），主要自己留存备份使用。
- 感谢ScriptCat001 DuskLight 潘矩森 大大 ，以及更多的大大。
- 仅供学习交流，账号风险自负，请遵守 Microsoft Rewards 服务条款。MIT License。
