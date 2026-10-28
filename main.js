// ==UserScript==
// @name         微软积分（优化版）
// @namespace    https://rewards.bing.com/
// @version      1.4.6
// @description  每天在后台自动完成 Microsoft Rewards 任务获取积分奖励，✅签入(PC+App静默)、✅阅读、✅活动、✅搜索、✅Quiz、✅拼图、✅热搜API、✅二次扫描、✅积分通知、✅连签任务检测、✅每日活动自动上报(DAPI 通道，跨浏览器一致)、✅桌面应用每周专属任务、✅Edge 浏览连签（后台累计 30 分钟，UA 自动跟随浏览器版本）、✅出口检测（VPN/代理/非大陆 IP 直接停手）（全程后台运行，不打开多余标签页）
// @icon         https://bing.com/th?id=OMR.icon-96.png&pid=Rewards
// @license      MIT
// @background
// @connect      bing.com
// @connect      login.live.com
// @connect      rewards.bing.com
// @connect      prod.rewardsplatform.microsoft.com
// @connect      hotapi.nntool.cc
// @connect      hot.baiwumm.com
// @connect      cnxiaobai.com
// @connect      disp-qryapi.3g.qq.com
// @connect      www.cloudflare.com
// @connect      ipinfo.io
// @connect      api.ip.sb
// @connect      qyapi.weixin.qq.com
// @connect      oapi.dingtalk.com
// @connect      open.feishu.cn
// @connect      push.i-i.me
// @connect      api.day.app
// @match        https://login.live.com/oauth20_desktop.srf*
// @match        https://rewards.bing.com/*
// @match        https://www.bing.com/*
// @match        https://cn.bing.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_openInTab
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_cookie
// @grant        GM_info
// @grant        GM_log
// @grant        GM_registerMenuCommand
// @storageName  BingRewardsAuto_Shared
// @tips         此脚本为开源免费使用，请勿购买
// ==/UserScript==

/* global GM_cookie, GM_getValue, GM_setValue, GM_xmlhttpRequest, GM_log, GM_info, GM_notification, GM_openInTab */

/* ==UserConfig==
Config:
    keep:
        title: 持续检测（全部完成后是否继续）
        type: checkbox
        default: true
    lock:
        title: 锁定国区（非大陆IP自动停止）
        type: checkbox
        default: true
    span:
        title: 搜索最小间隔（秒，脚本只会更慢不会更快）
        type: number
        default: 30
        min: 30
        max: 180
        unit: 秒
    api:
        title: 搜索词接口（offline为随机搜索词）
        type: select
        default: offline
        values: [offline, hot.nntool.cc, hot.baiwumm.com, hot.cnxiaobai.com]
    code:
        title: 授权码链接
        type: textarea
        description: 粘贴 login.live.com 跳转后的完整URL
Tasks:
    sign:
        title: 每日签入
        type: checkbox
        default: true
    read:
        title: 新闻阅读
        type: checkbox
        default: true
    promos:
        title: 活动卡片（含打卡）
        type: checkbox
        default: true
    quiz:
        title: Quiz 自动答题
        type: checkbox
        default: true
    search:
        title: PC搜索
        type: checkbox
        default: true
    edge:
        title: Edge 浏览连签（后台分次上报，累计 30 分钟）
        type: checkbox
        default: true
Notice:
    bro:
        title: 浏览器通知（当前脚本）
        type: checkbox
        default: true
    wework:
        title: 企业微信消息推送（群机器人）
        type: text
        password: true
        description: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    dingding:
        title: 钉钉群机器人（不加签，关键词：#）
        type: text
        password: true
        description: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    feishu:
        title: 飞书群机器人（不加签，关键词：#）
        type: text
        password: true
        description: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    pushme:
        title: PushMe（push.i-i.me）
        type: text
        password: true
        description: xxxxxxxxxxxxxxxxxxxx
    bark:
        title: Bark（bark.day.app）
        type: text
        password: true
        description: xxxxxxxxxxxxxxxxxxxx
==/UserConfig== */

const __scBgKeepAlive = (function() {
    'use strict';

    // 授权回调页：此处只做标记，真正的「捕获授权码 → 换 Token」在脚本末尾的 Auth.handleCallback()
    const IS_OAUTH_CALLBACK = location.hostname === "login.live.com"
        && location.pathname === "/oauth20_desktop.srf";

    const RewardsAuto = {
        // UA 不再写死版本：旧版固定 "Chrome/131 ... Edg/131.0.0.0"，用户把 Edge 升到 15x
        // 之后，脚本发出的请求特征反而变成「一年前的浏览器」，Edge 通道的请求也和真机对不上。
        // 现在每次访问都按当前浏览器动态生成，见下面的 UA 模块。
        get ua() { return UA.all(); },
        desktopAppHeaders: {
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) MSRewards/Desktop/1.4.56",
            "X-MSRewards-App": "1",
            "X-Rewards-Source": "msrewards-desktop"
        },
        appConfig: {
            rewardsAppId: "SAAndroid/32.6.2110003560",
            channel: "SAAndroid",
            dapiMeUrl: "https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613",
            offerIds: {
                dailyCheckIn: "Gamification_Sapphire_DailyCheckIn",
                readArticle: "ENUS_readarticle3_30points",
                dailySetPrefix: "Gamification_DailySet_",
                streakCounter: "Gamification_Streak_Counter_Promotion",
            }
        },
        searchPool: [
            "what is the weather forecast tomorrow",
            "how do I make sourdough bread at home",
            "where can I find cheap flights to tokyo",
            "why is the sky blue scientific explanation",
            "how to learn rust programming in 2026",
            "what time does the world cup final start",
            "how to fix a leaky kitchen faucet step by step",
            "what are the best vr games of 2026",
            "how to start a vegetable garden in spring",
            "where to watch new movies this week",
            "how to take care of a bonsai tree",
            "what is the difference between python async and threading",
            "how to meditate properly for beginners",
            "what is the origin of halloween traditions",
            "how do solar panels actually work",
            "what is the best mechanical keyboard for typing",
            "how to tie a windsor knot tie",
            "what causes northern lights aurora borealis",
            "how to brew the perfect espresso at home",
            "what are the symptoms of vitamin d deficiency",
            "how to sleep better naturally tonight",
            "why do cats purr when they are happy",
            "best coffee shops in san francisco downtown",
            "italian restaurants near times square",
            "tokyo cherry blossom season 2026 forecast",
            "rtx 5070 ti benchmark vs rtx 4080 super",
            "iphone 17 release date and features",
            "tesla stock price today nasdaq",
            "best noise cancelling headphones under 300",
            "fastest electric cars 0 to 60 mph",
            "vintage camera brands collectors guide",
            "budget gaming laptop with rtx 4070 2026",
            "easy chocolate chip cookies recipe from scratch",
            "30 minute home workout routine no equipment",
            "stretching exercises for lower back pain relief",
            "easy origami crane folding instructions",
            "git rebase vs merge which one to use",
            "markdown cheat sheet with examples",
            "japanese hiragana chart pronunciation",
            "ancient rome history quick overview",
            "pomodoro technique for focus and productivity",
            "healthy breakfast ideas under 10 minutes",
            "天气预报", "今日新闻热点", "美食食谱家常菜", "旅游攻略", "健康养生知识",
            "科技资讯", "电影推荐", "股票行情", "体育赛事", "历史上的今天"
        ],
        apiConfig: {
            mode: GM_getValue("Config.api", "offline"),
            arr: [
                ["hot.baiwumm.com", {
                    url: "https://hot.baiwumm.com/api/",
                    hot: ["weibo", "douyin", "baidu", "toutiao", "thepaper", "qq", "netease", "zhihu"],
                }],
                ["hot.cnxiaobai.com", {
                    url: "https://cnxiaobai.com/DailyHotApi/",
                    hot: ["weibo", "douyin", "baidu", "toutiao", "thepaper", "qq-news", "netease-news", "zhihu"],
                }],
                ["hot.nntool.cc", {
                    url: "https://hotapi.nntool.cc/",
                    hot: ["weibo", "douyin", "baidu", "toutiao", "thepaper", "qq-news", "netease-news", "zhihu"],
                }],
            ],
            url: "",
            hot: [],
            wordList: [],
            wordIndex: 0,
        },
        skipPatterns: [
            "referral", "refer and earn", "sweepstake", "entries",
            "install the", "set bing as your default", "bing wallpaper",
            "punch card", "ancient coin", "sea of thieves", "rewards extension",
            "redemption goal", "order history", "claim your gift", "shop to earn",
            "set goal", "Available tomorrow", "Offer is Locked", "Earn -1 points",
            // 拼图 / quiz 不跳过
        ],
        skipHrefs: [
            "sweepstakes/", "referandearn", "aka.ms/win", "workinprogress",
            "punchcard", "microsoft-store", "goal/all", "orderhistory",
            "/redeem", "/redeemgoal", "xbox.com/rewards"
        ],
        state: {
            token: false,
            region: "CN",
            host: "www.bing.com",
            dateNowNum: 0,
            dateNowStr: "",
            pcProgress: 0,
            pcMax: 90,
            readProgress: 0,
            readMax: 30,
            sendMSG: "",
            lastSearchProgress: -1,
            restrictedTimes: 0,
            ip: "",
            ipInfo: "",
            startTime: 0,
        }
    };

    /* ===== UA 自适应（适配新版 Edge） =====
     * 旧版把 "Chrome/131 ... Edg/131.0.0.0" 写死在代码里，浏览器升级后脚本仍在冒充
     * 一年前的 Edge —— 既是明显的「非真实客户端」特征，也让 Edge 通道的请求和真机对不上。
     * 取值顺序：
     *   1) 当前上下文的 navigator.userAgent 本来就有 Edg/：直接用它（版本永远跟浏览器同步，
     *      以后 Edge 再升级也不用改脚本）；
     *   2) 页面上下文拿到过的真实 Edge UA 存在 Config.uaEdge 里，给 UA 被裁剪成纯 Chrome 的
     *      后台 service worker 复用；
     *   3) 只有 Chrome：按 Chrome 的完整版本号合成同期 Edge UA（Edge 大版本与 Chromium 同步）；
     *   4) 什么都没有（纯沙箱）：回退到内置的近期版本。
     */
    const UA = {
        /* 内置兜底版本：只有拿不到 navigator 的环境才会用到（2026-10 的 Edge 稳定版是
         * 156.0.4314.50）。它不影响正常浏览器里的请求，那里一律用真实 UA。 */
        FALLBACK_CHROME: "156.0.0.0",
        FALLBACK_EDGE: "156.0.4314.50",
        DESKTOP: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
        ANDROID: "Mozilla/5.0 (Linux; Android 16; Redmi K20 Pro Build/BP4A.251205.006; ) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Mobile Safari/537.36",
        _cache: null,
        _cacheAt: 0,

        // navigator 在 service worker 里也存在；万一取不到就当空串
        navigatorUA() {
            try {
                return (typeof navigator !== "undefined" && navigator && navigator.userAgent)
                    ? String(navigator.userAgent) : "";
            } catch (_) {
                return "";
            }
        },

        // 只有真的看到 Edg/ 才回写，避免把沙盒里被裁剪的 UA 覆盖掉页面上拿到的真值
        remember(ua) {
            if (!/Edg\/\d/.test(ua)) return;
            try {
                if (GM_getValue("Config.uaEdge", "") !== ua) GM_setValue("Config.uaEdge", ua);
            } catch (_) { /* GM 存储不可用时忽略 */ }
        },

        all() {
            const now = Date.now();
            if (this._cache && now - this._cacheAt < 60000) return this._cache;
            const real = this.navigatorUA();
            this.remember(real);
            const saved = String(GM_getValue("Config.uaEdge", "") || "");
            const edgeUA = [real, saved].find(s => /Edg\/\d/.test(s))
                || (() => {
                    // 纯 Chrome/其它浏览器：用它的完整版本号（如 157.0.5123.9）合成同期 Edge UA
                    //（Edge 主版本跟随 Chromium，这样版本串看起来就是「这个月装的」，不会被判成过期客户端）
                    const ver = [real, saved]
                        .map(s => (String(s).match(/Chrome\/([\d.]+)/) || [])[1])
                        .find(Boolean);
                    if (ver) return `${this.DESKTOP} Chrome/${ver} Safari/537.36 Edg/${ver}`;
                    return `${this.DESKTOP} Chrome/${this.FALLBACK_CHROME} Safari/537.36 Edg/${this.FALLBACK_EDGE}`;
                })();
            this._cache = {
                // PC 通道：真 Edge 用真 UA（与 TLS 指纹一致）；其它浏览器沿用内置 Edge UA，
                // 与旧版行为保持一致，只是把版本从 131 提到了当前稳定版
                pc: /Edg\//.test(real) ? real : edgeUA,
                // Edge 专属通道（EdgeDesktop/EdgeHub）必须自称 Edge
                edge: edgeUA,
                mobile: `${this.ANDROID} EdgA/144.0.0.0`,
                app: `${this.ANDROID} BingSapphire/32.6.2110003560`,
            };
            this._cacheAt = now;
            return this._cache;
        }
    };

    /* ===== Edge 浏览连签常量 ===== */
    const EDGE = {
        PROMO_NAME: "edge_browsing_streak_flight",   // 老版本的活动名（仍可用）
        PROMO_PREFIX: /^edge_browsing_streak/i,      // 新版可能改名/加后缀，按前缀兜底匹配
        ACTIVATION_OFFER: "edge_flight_1_ww_treatment_eligible",
        TARGET_MINUTES: 30,                          // 累计满 30 分钟才记账
        MAX_EXTRA_ROUNDS: 3,                         // 次数报够但服务端没确认时，整体重来的轮数上限
    };

    const Webhooks = [
        {
            name: "企业微信",
            url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=",
            key: GM_getValue("Notice.wework", false),
            msg: {
                "msgtype": "text",
                "text": {
                    get content() {
                        return `> ${new Date().toLocaleString()}\n\n ## ${GM_info.script.name}\n ${RewardsAuto.state.sendMSG}`
                    }
                },
            },
        },
        {
            name: "钉钉",
            url: "https://oapi.dingtalk.com/robot/send?access_token=",
            key: GM_getValue("Notice.dingding", false),
            msg: {
                "msgtype": "markdown",
                "markdown": {
                    "title": GM_info.script.name,
                    get text() {
                        return `> ${new Date().toLocaleString()}\n ### ${GM_info.script.name}\n ${RewardsAuto.state.sendMSG}`
                    }
                },
            },
        },
        {
            name: "飞书",
            url: "https://open.feishu.cn/open-apis/bot/v2/hook/",
            key: GM_getValue("Notice.feishu", false),
            msg: {
                "msg_type": "interactive",
                "card": {
                    "schema": "2.0",
                    "header": {
                        "title": { "tag": "plain_text", "content": GM_info.script.name },
                        "template": "orange"
                    },
                    "body": {
                        "elements": [{
                            "tag": "markdown",
                            "text_align": "center",
                            get content() {
                                return `#### ${new Date().toLocaleString()}\n ${RewardsAuto.state.sendMSG}`
                            }
                        }]
                    }
                }
            },
        },
        {
            name: "PushMe",
            url: "https://push.i-i.me/?push_key=",
            key: GM_getValue("Notice.pushme", false),
            msg: {
                "type": "markdown",
                "title": `${GM_info.script.name}[#rewards!https://rewards.bing.com/rewards.png]`,
                get content() { return `\n ${RewardsAuto.state.sendMSG}` }
            },
        },
        {
            name: "Bark",
            url: "https://api.day.app/",
            key: GM_getValue("Notice.bark", false),
            msg: {
                "group": "rewards",
                "icon": "https://rewards.bing.com/rewards.png",
                "title": GM_info.script.name,
                get markdown() { return `\n ${RewardsAuto.state.sendMSG}` }
            },
        },
    ];

    const Utils = {
        log(icon, msg, push = false) {
            GM_log(`${icon} ${msg}`);
            if (push && GM_getValue("Notice.bro", true)) {
                try {
                    GM_notification({
                        title: GM_info.script.name + ` ${icon}`,
                        text: msg,
                        onclick: () => GM_openInTab("https://rewards.bing.com/dashboard", { active: true })
                    });
                } catch(_) {}
            }
            if (push) {
                RewardsAuto.state.sendMSG = `${icon} ${msg}`;
                this.sendWebhook();
            }
        },

        async sendWebhook() {
            await Promise.all(Webhooks.map(async (i) => {
                if (!i.key) return;
                const safeKey = String(i.key).trim();
                const targetUrl = safeKey.startsWith("http") ? safeKey : i.url + safeKey;
                try {
                    const result = await this.xhr({
                        method: "POST",
                        url: targetUrl,
                        headers: { "content-type": "application/json; charset=UTF-8" },
                        data: JSON.stringify(i.msg),
                    });
                    if (result) GM_log(`🔵 「${i.name}」消息推送完成`);
                } catch (e) {
                    GM_log(`🔴 「${i.name}」消息推送出错: ${e.message}`);
                }
            }));
        },

        /* 交互兼容层：@background 的 service_worker 里没有 prompt/alert/confirm，
         * 有 DOM 用原生对话框，没有 DOM 就转成页内输入框或通知。
         * @run-at document-start 时 body 还是 null，故只判断 document，domPrompt 内部再等 body。 */
        hasDOM() {
            return typeof document !== "undefined" && !!document && !!document.documentElement;
        },

        waitForBody(timeoutMs = 8000) {
            return new Promise(resolve => {
                const t0 = Date.now();
                const tick = () => {
                    if (document.body) return resolve(true);
                    if (Date.now() - t0 > timeoutMs) return resolve(false);
                    setTimeout(tick, 100);
                };
                tick();
            });
        },

        uiAlert(msg) {
            const text = String(msg);
            if (this.hasDOM() && typeof alert === "function") {
                try { alert(text); return; } catch (_) {}
            }
            GM_log(text);
            try { GM_notification({ title: GM_info.script.name, text: text.slice(0, 300), timeout: 10000 }); } catch (_) {}
        },

        uiConfirm(msg) {
            if (this.hasDOM() && typeof confirm === "function") {
                try { return confirm(msg); } catch (_) {}
            }
            this.uiAlert(`${msg}\n\n（当前是后台上下文，无法弹出确认框，已按「取消」处理）`);
            return false;
        },

        async uiPrompt(message, defaultValue = "") {
            if (this.hasDOM() && typeof prompt === "function") {
                try { return prompt(message, defaultValue); } catch (_) {}
            }
            if (this.hasDOM()) return this.domPrompt(message, defaultValue);
            // 后台上下文：没有输入框，打开页面由 init() 在页面里弹出
            GM_setValue("Config.pendingPaste", true);
            Utils.log("🟡", "当前为后台上下文（无输入框），已打开 rewards.bing.com 以便粘贴授权码");
            try {
                GM_notification({ title: "📋 请粘贴授权码", text: "已为你打开 rewards.bing.com，页面加载后会自动弹出输入框", timeout: 8000 });
            } catch (_) {}
            try { GM_openInTab("https://rewards.bing.com/", { active: true }); } catch (_) {}
            return null;
        },

        async domPrompt(message, defaultValue = "") {
            await this.waitForBody();
            return new Promise(resolve => {
                const wrap = document.createElement("div");
                wrap.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;";
                const box = document.createElement("div");
                box.style.cssText = "background:#fff;color:#222;padding:18px;border-radius:10px;width:min(680px,92vw);font:14px/1.6 system-ui,-apple-system,'Microsoft YaHei',sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.4);";
                const label = document.createElement("div");
                label.textContent = message;
                label.style.cssText = "margin-bottom:10px;white-space:pre-wrap;";
                const ta = document.createElement("textarea");
                ta.value = defaultValue;
                ta.spellcheck = false;
                ta.style.cssText = "width:100%;height:130px;box-sizing:border-box;padding:8px;border:1px solid #c8c8c8;border-radius:6px;font:12px/1.5 Consolas,monospace;resize:vertical;";
                const row = document.createElement("div");
                row.style.cssText = "display:flex;gap:10px;justify-content:flex-end;margin-top:12px;";
                const mkBtn = (text, primary) => {
                    const b = document.createElement("button");
                    b.textContent = text;
                    b.style.cssText = `padding:7px 18px;border-radius:6px;cursor:pointer;font:14px system-ui;border:1px solid ${primary ? "#0b6cff" : "#c8c8c8"};background:${primary ? "#0b6cff" : "#fff"};color:${primary ? "#fff" : "#222"};`;
                    return b;
                };
                const okBtn = mkBtn("确定", true);
                const cancelBtn = mkBtn("取消", false);
                const done = v => { try { wrap.remove(); } catch (_) {} resolve(v); };
                okBtn.onclick = () => done(ta.value);
                cancelBtn.onclick = () => done(null);
                ta.addEventListener("keydown", e => {
                    if (e.key === "Escape") done(null);
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) done(ta.value);
                });
                row.appendChild(cancelBtn);
                row.appendChild(okBtn);
                box.appendChild(label);
                box.appendChild(ta);
                box.appendChild(row);
                wrap.appendChild(box);
                (document.body || document.documentElement).appendChild(wrap);
                setTimeout(() => { try { ta.focus(); ta.select(); } catch (_) {} }, 50);
            });
        },

        xhr(options) {
            return new Promise((resolve, reject) => {
                const start = Date.now();
                GM_xmlhttpRequest({
                    anonymous: false,
                    ...options,
                    // 允许调用方自带超时（出口探测要短超时），没传就还是 15 秒
                    timeout: Number(options && options.timeout) || 15000,
                    onload: (res) => {
                        const cost = ((Date.now() - start) / 1000).toFixed(2);
                        if (res.status >= 200 && res.status < 300) {
                            resolve(res.responseText);
                        } else if ([301, 302, 307, 308].includes(res.status)) {
                            const match = res.responseHeaders?.match(/Location:\s*(.*?)\s*\r?\n/i);
                            resolve(match ? match[1] : false);
                        } else {
                            reject(new Error(`HTTP ${res.status}，用时 ${cost} 秒`));
                        }
                    },
                    onerror: (err) => {
                        const cost = ((Date.now() - start) / 1000).toFixed(2);
                        reject(new Error(`${err?.error || "网络错误"}，用时 ${cost} 秒`));
                    },
                    ontimeout: () => {
                        const cost = ((Date.now() - start) / 1000).toFixed(2);
                        reject(new Error(`请求超时，用时 ${cost} 秒`));
                    }
                });
            });
        },

        randomRange(min, max) {
            return Math.floor(Math.random() * (max - min + 1) + min);
        },
        getTimestamp() { return Date.now(); },
        getTodayNum() {
            const d = new Date();
            return Number(`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`);
        },
        getTodayStr() {
            const d = new Date();
            return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
        },
        getRandomUUID() { return crypto.randomUUID().replace(/-/g, "").toUpperCase(); },
        isJSON(s) {
            try { const j = JSON.parse(s); return Array.isArray(j) || (typeof j === "object" && j !== null); }
            catch { return false; }
        },
        delay(ms) { return new Promise(r => setTimeout(r, ms)); },
        randomDelay(min = 3000, max = 8000) { return this.delay(this.randomRange(min, max)); },
        waitForElement(selector, timeout = 30000) {
            return new Promise((resolve, reject) => {
                const element = document.querySelector(selector);
                if (element) return resolve(element);
                const observer = new MutationObserver((_, obs) => {
                    const el = document.querySelector(selector);
                    if (el) { obs.disconnect(); resolve(el); }
                });
                observer.observe(document.body, { childList: true, subtree: true });
                setTimeout(() => {
                    observer.disconnect();
                    const el = document.querySelector(selector);
                    el ? resolve(el) : reject(new Error(`等待元素超时: ${selector}`));
                }, timeout);
            });
        },
        waitForElementsByText(containerSelector, textPatterns, timeout = 30000) {
            return new Promise((resolve, reject) => {
                const findElements = () => {
                    const containers = document.querySelectorAll(containerSelector);
                    const results = [];
                    for (const container of containers) {
                        const text = container.textContent || "";
                        for (const pattern of textPatterns) {
                            if (text.includes(pattern)) {
                                results.push({ element: container, pattern });
                                break;
                            }
                        }
                    }
                    return results;
                };
                const found = findElements();
                if (found.length > 0) return resolve(found);
                const observer = new MutationObserver((_, obs) => {
                    const found = findElements();
                    if (found.length > 0) { obs.disconnect(); resolve(found); }
                });
                observer.observe(document.body, { childList: true, subtree: true });
                setTimeout(() => {
                    observer.disconnect();
                    const found = findElements();
                    found.length > 0 ? resolve(found) : reject(new Error("等待文本元素超时"));
                }, timeout);
            });
        },

        /* 跨上下文互斥锁：后台实例与已打开的 rewards 标签页会同时跑脚本，
         * 并发会互相覆盖 Token 并重复上报，这里用 GM 存储做带 TTL 的锁，只允许一个上下文执行任务。 */
        lockId() {
            if (!RewardsAuto.state.lockId) RewardsAuto.state.lockId = Utils.getRandomUUID();
            return RewardsAuto.state.lockId;
        },

        acquireLock(key, ttlMs = 20 * 60 * 1000) {
            const now = Date.now();
            const holder = GM_getValue(key, null);
            const mine = Utils.lockId();
            if (holder && typeof holder === "object" && holder.id && holder.id !== mine && now - (holder.ts || 0) < ttlMs) {
                return false;
            }
            GM_setValue(key, { id: mine, ts: now });
            return true;
        },

        refreshLock(key) {
            GM_setValue(key, { id: Utils.lockId(), ts: Date.now() });
        },

        releaseLock(key) {
            const holder = GM_getValue(key, null);
            if (!holder || holder.id === Utils.lockId()) GM_setValue(key, null);
        }
    };

    /* ===== 网络出口守卫（非大陆 / 机房 / 代理，均由「锁定国区」一个开关控制） =====
     * 旧实现只读 bing.com 首页的 Region/RevIpCC，于是「开着梯子也永远是中国」，原因有三：
     *   1) Utils.xhr 默认 anonymous:false，会带上 cc=Cn、SRCHHPGUSR 之类的大陆 Cookie，
     *      Bing 按 Cookie 优先回 CN，跟真实出口 IP 无关；
     *   2) 大陆出口访问 www.bing.com 会被 302 到 cn.bing.com，那一页的 Region 恒为 CN；
     *   3) 真正花积分的是 prod.rewardsplatform.microsoft.com / rewards.bing.com / login.live.com，
     *      分流规则把 bing.com 走直连、把这几个微软接口走代理时，只看 bing 首页根本发现不了。
     * 现在改成「多路独立探测 + 结论缓存 + 全流程闸门」：
     *   - bing.com：不带 Cookie + 时间戳，Bing 只能按出口 IP 回 RevIpCC；
     *   - Cloudflare cdn-cgi/trace、ipinfo.io、api.ip.sb：第三方视角的出口国家/ASN；
     *   - 腾讯 disp-qryapi：国内服务看到的出口（境内「中国 …」，境外「美国 …」）。
     * 任一路看到非 CN、出口是机房/云厂商 ASN、或走了 WARP，一律判为「不能继续」。
     */
    class RegionBlockedError extends Error {
        constructor(message) {
            super(message);
            this.name = "RegionBlockedError";
            this.regionBlocked = true;
        }
    }

    const RegionGuard = {
        _cache: null,          // 上一次结论（含 ok/reasons/signals/ip），全流程闸门复用
        _inflight: null,       // 并发合并：搜索循环里可能同时有多处调用
        _lastState: "",        // "ok" / "block"，只在状态翻转时打日志
        _lastNotifyAt: 0,      // 推送节流
        TTL_OK: 120 * 1000,    // 通过后 2 分钟内复用（中途开梯子最多 2 分钟被发现）
        TTL_BLOCK: 45 * 1000,  // 拦截后 45 秒重新确认（关掉梯子能尽快恢复）
        PROBE_TIMEOUT: 8000,
        NOTIFY_GAP: 10 * 60 * 1000,

        enabled() {
            return !!GM_getValue("Config.lock", true);
        },

        // 机房 / VPS / 公共代理的 ASN 关键词：家宽运营商（电信/联通/移动/Comcast…）不会命中
        HOSTING_RE: /cloudflare|digitalocean|vultr|linode|akamai|fastly|amazon|aws|google\s*cloud|azure|alibaba|aliyun|alicloud|tencent\s*cloud|qcloud|huawei\s*cloud|hetzner|ovh|leaseweb|contabo|hostwinds|hostinger|racknerd|colocrossing|sharktech|psychz|choopa|m247|datacamp|zenlayer|layerstack|gcore|oracle\s*cloud|\bvpn\b|\bproxy\b|tor\s*exit|ipvanish|nordvpn|expressvpn|surfshark|mullvad/i,

        /* 微软侧：不带 Cookie，问 Bing「你看到的我是哪国」。
         * 大陆出口会被 302 到 cn.bing.com，那一页没有 RevIpCC，但有只在 cn.bing.com 出现的标记
         * （「国内版 / 国际版」切换、京ICP备号），据此也能确定「微软看到的我是 CN」。 */
        async _probeBing() {
            const html = await Utils.xhr({
                url: `https://www.bing.com/?_=${Date.now()}`,
                anonymous: true,   // 关键：不带 Cookie，否则 cc=Cn 会被 Bing 沿用
                timeout: this.PROBE_TIMEOUT,
                headers: { "accept-language": "zh-CN,zh;q=0.9", "cache-control": "no-cache" }
            });
            const text = String(html || "");
            const flat = text.replace(/\s/g, "");
            const ipcc = flat.match(/RevIpCC:"([A-Za-z]{2})"/);
            const region = flat.match(/Region:"([A-Za-z]{2})"/);
            let cc = ipcc ? ipcc[1] : (region ? region[1] : "");
            if (!cc && this.CN_PAGE_RE.test(text)) cc = "CN";
            if (!cc) throw new Error("首页未返回地区标记");
            return { src: "bing", cc: cc.toUpperCase(), ip: "", org: "" };
        },

        // 只在 cn.bing.com 首页出现的特征：看到它就能断定「微软把我当大陆」。
        // 注意：这里刻意用整个 HTML 而非去空白版，中文标记不能被 \s 吃掉。
        CN_PAGE_RE: /cn\.bing\.com|京ICP备|beian\.miit\.gov\.cn|国内版<\/a>|国内版/,

        async _probeCloudflare() {
            const txt = await Utils.xhr({
                url: `https://www.cloudflare.com/cdn-cgi/trace?_=${Date.now()}`,
                anonymous: true,
                timeout: this.PROBE_TIMEOUT
            });
            const kv = {};
            String(txt || "").split("\n").forEach(line => {
                const i = line.indexOf("=");
                if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
            });
            if (!kv.loc) throw new Error("trace 格式异常");
            return {
                src: "cloudflare",
                cc: String(kv.loc).toUpperCase(),
                ip: kv.ip || "",
                org: "",
                warp: kv.warp === "on"
            };
        },

        async _probeIpinfo() {
            const txt = await Utils.xhr({
                url: `https://ipinfo.io/json?_=${Date.now()}`,
                anonymous: true,
                timeout: this.PROBE_TIMEOUT
            });
            const d = JSON.parse(txt);
            if (!d || !d.country) throw new Error(String((d && (d.error || d.message)) || "无 country 字段"));
            return { src: "ipinfo", cc: String(d.country).toUpperCase(), ip: d.ip || "", org: d.org || "" };
        },

        async _probeIpSb() {
            const txt = await Utils.xhr({
                url: `https://api.ip.sb/geoip?_=${Date.now()}`,
                anonymous: true,
                timeout: this.PROBE_TIMEOUT
            });
            const d = JSON.parse(txt);
            if (!d || !d.country_code) throw new Error("无 country_code 字段");
            return {
                src: "ip.sb",
                cc: String(d.country_code).toUpperCase(),
                ip: d.ip || "",
                org: [d.isp, d.organization, d.asn_organization].filter(Boolean).join(" ")
            };
        },

        /* 腾讯 IP 库：境内出口一定以「中国」开头，境外是「美国 加利福尼亚 …」这种 */
        async _probeTencent() {
            const txt = await Utils.xhr({
                url: "https://disp-qryapi.3g.qq.com/v1/dispatch",
                headers: { referer: "https://3g.qq.com/" },
                timeout: this.PROBE_TIMEOUT
            });
            const d = JSON.parse(txt);
            if (!d || d.code != 0) throw new Error("dispatch 返回异常");
            return {
                src: "tencent",
                cc: "",
                ip: (d.extra && d.extra.ip) || "",
                org: "",
                cnText: String(d.ipInfo || "").replace(/[#*]+/g, " ").trim()
            };
        },

        async _probeAll() {
            const jobs = [
                ["bing", () => this._probeBing()],
                ["cloudflare", () => this._probeCloudflare()],
                ["ipinfo", () => this._probeIpinfo()],
                ["ip.sb", () => this._probeIpSb()],
                ["tencent", () => this._probeTencent()]
            ];
            return await Promise.all(jobs.map(async ([src, fn]) => {
                try {
                    return await fn();
                } catch (e) {
                    return { src, error: e instanceof Error ? e : new Error(String(e)), cc: "", ip: "", org: "" };
                }
            }));
        },

        // 同一路探测重试后可能有多条结果：成功的一票为准
        _merge(list) {
            const map = new Map();
            for (const r of list) {
                if (!r) continue;
                const score = (r.error ? 0 : 2) + (r.cc ? 1 : 0);
                const cur = map.get(r.src);
                const curScore = cur ? (cur.error ? 0 : 2) + (cur.cc ? 1 : 0) : -1;
                if (score > curScore) map.set(r.src, r);
            }
            return [...map.values()];
        },

        _judge(raw) {
            const probes = this._merge(raw);
            const ok = probes.filter(p => !p.error);
            const coded = ok.filter(p => p.cc);
            const foreign = coded.filter(p => p.cc !== "CN");
            const tencent = ok.find(p => p.src === "tencent");
            const cnText = (tencent && tencent.cnText) || "";
            const tencentCN = /中国/.test(cnText);
            const tencentOverseas = !!(cnText && !tencentCN && !/局域网|内网|本地|保留|未知/.test(cnText));
            const warp = ok.find(p => p.warp);
            const hosting = ok.find(p => p.org && this.HOSTING_RE.test(p.org));

            const reasons = [];
            if (foreign.length > 0) {
                reasons.push(`出口非大陆：${foreign.map(p => `${p.src}=${p.cc}${p.ip ? `(${p.ip})` : ""}`).join("、")}`);
            }
            if (tencentOverseas) {
                reasons.push(`国内服务看到的出口在境外：${cnText}`);
            }
            if (warp) reasons.push("Cloudflare WARP 正在接管流量（代理特征）");
            if (hosting) reasons.push(`出口是机房/代理 IP：${hosting.org}`);

            const signals = probes.map(p => {
                if (p.error) return `${p.src}=✗`;
                if (p.src === "tencent") {
                    return `tencent=${tencentCN ? "CN" : tencentOverseas ? "海外" : "?"}${p.ip ? `(${p.ip})` : ""}`;
                }
                return `${p.src}=${p.cc}${p.ip ? `(${p.ip})` : ""}`;
            });

            const ipHolder = (tencent && tencent.ip) ? tencent : ok.find(p => p.ip);
            return {
                ok: reasons.length === 0,
                reasons,
                signals,
                ip: (ipHolder && ipHolder.ip) || "",
                ipInfo: cnText ? `🌏所在地区：${cnText}` : "",
                coded: coded.length,
                known: coded.length + (cnText ? 1 : 0),   // 拿到结论的路数（国家票 + 腾讯文本）
                probes: probes.length,
                failed: probes.filter(p => p.error).map(p => `${p.src}: ${p.error.message}`)
            };
        },

        /* 主动探测一次（有缓存）。返回 { ok, reasons, signals, ip, ipInfo, skipped } */
        async check({ fresh = false, quiet = false } = {}) {
            if (!this.enabled()) {
                return { ok: true, skipped: true, reasons: [], signals: [], ip: "", ipInfo: "", coded: 0, known: 0, probes: 0, failed: [] };
            }
            const now = Date.now();
            if (!fresh && this._cache && (now - this._cache.at) < (this._cache.ok ? this.TTL_OK : this.TTL_BLOCK)) {
                return this._cache;
            }
            if (this._inflight) return this._inflight;

            this._inflight = (async () => {
                let raw = await this._probeAll();
                let verdict = this._judge(raw);
                // 一路都没结论：可能刚好在切换网络/梯子启停/刚从睡眠唤醒，退避后再确认两次，
                // 连续三次全都探测失败才按「出口不明」处理（fail-safe，宁停不放）
                for (const wait of [2000, 5000]) {
                    if (verdict.known > 0) break;
                    if (!quiet) Utils.log("🟡", `出口检测没拿到任何结果，${wait / 1000} 秒后再试一次`);
                    await Utils.delay(wait);
                    raw = raw.concat(await this._probeAll());
                    verdict = this._judge(raw);
                }
                // 全都失败时不能放行：宁可停一轮，也别在出口不明的情况下上报
                if (verdict.known === 0) {
                    verdict.ok = false;
                    verdict.reasons.unshift("无法确认出口地区（所有探测都失败）");
                }
                verdict.at = Date.now();
                this._cache = verdict;

                if (verdict.ok) {
                    RewardsAuto.state.region = "CN";
                    if (verdict.ip) RewardsAuto.state.ip = verdict.ip;
                    if (this._lastState !== "ok" || fresh) {
                        Utils.log("🟢", `出口检测通过（CN）｜${verdict.signals.join("  ")}`);
                    }
                    this._lastState = "ok";
                } else {
                    if (verdict.ip) RewardsAuto.state.ip = verdict.ip;
                    if (verdict.ipInfo) RewardsAuto.state.ipInfo = verdict.ipInfo;
                    const stateChanged = this._lastState !== "block";
                    const push = stateChanged || (Date.now() - this._lastNotifyAt > this.NOTIFY_GAP);
                    if (stateChanged || fresh) {
                        Utils.log(push ? "🔴" : "🟡",
                            `检测到代理/VPN 或非大陆出口，已暂停上报\n${verdict.reasons.join("\n")}\n出口 IP：${verdict.ip || "未知"}\n${verdict.ipInfo || ""}`,
                            push);
                    }
                    if (push) this._lastNotifyAt = Date.now();
                    this._lastState = "block";
                }
                return verdict;
            })();

            try {
                return await this._inflight;
            } finally {
                this._inflight = null;
            }
        },

        /* 闸门（抛异常版）：拦截时让这一轮立刻收手，一个微软请求都不再发 */
        async guard(where = "任务") {
            const v = await this.check();
            if (!v.ok) throw new RegionBlockedError(`出口异常（${where}）：${v.reasons[0] || "未知原因"}`);
            return v;
        },

        /* 闸门（布尔版）：心跳这种「跳过一次就够」的地方用，安静返回 */
        async allow() {
            const v = await this.check();
            return v.ok;
        }
    };

    /* 授权码 / Token 策略：解析任意形态的输入 → 保存 → 立刻兑换 → 明确报错；
     * 自动获取先静默请求，失败再打开授权页，由 @match 的 handleCallback() 捕获。 */
    const CLIENT_ID = "0000000040170455";
    const REDIRECT_URI = "https://login.live.com/oauth20_desktop.srf";
    const TOKEN_SCOPE = "service::prod.rewardsplatform.microsoft.com::MBI_SSL";

    const Auth = {
        authUrl: `https://login.live.com/oauth20_authorize.srf?client_id=${CLIENT_ID}&response_type=code&scope=${TOKEN_SCOPE}&redirect_uri=${REDIRECT_URI}`,

        // 只解 %XX，不把 + 当空格（授权码里可能出现 *!$._- ，但不会出现 +）
        decode(s) {
            return String(s).replace(/%([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
        },

        normalize(code) {
            if (!code) return null;
            const c = String(code)
                .trim()
                .replace(/^[^A-Za-z0-9]+/, "")
                .replace(/[^A-Za-z0-9._*!$%~-]+$/, "");
            return c.length >= 20 ? c : null;
        },

        /** 从任意粘贴内容里取出 code：支持完整跳转地址、HTML/JSON 转义过的地址、
         *  只粘 code= 后那一段、以及前后带空格/引号/换行的粘贴。 */
        parseCode(input) {
            if (input == null) return null;
            let s = String(input)
                .replace(/[\u00a0\u3000]/g, " ")
                .replace(/\\u0026/gi, "&")
                .replace(/\\\//g, "/")
                .replace(/&amp;/gi, "&")
                .replace(/[\r\n\t]+/g, " ")
                .trim();
            if (!s) return null;

            // 1) URL / query 形态：取 code= 之后、& 之前
            const m = s.match(/[?&#;\s]code=([^&\s"'<>\\]+)/i) || s.match(/^code=([^&\s"'<>\\]+)/i);
            if (m) {
                const c = this.normalize(this.decode(m[1]));
                if (c) return c;
            }
            // 2) 裸码（MS 授权码形如 M.C561_BAY.2.U.MsaArtifacts.xxxxx）
            const bare = s.match(/M\.[A-Za-z0-9._*!$%~-]{20,}/);
            if (bare) return this.normalize(this.decode(bare[0]));
            // 3) 兜底：整串就是一个长码（可能被加了类型前缀等杂字符）
            const t = s.replace(/^[\s"'`<\[(]+/, "").replace(/[\s"'`>\])]+$/, "");
            if (/^[A-Za-z0-9._*!$%~-]{40,}$/.test(t)) return this.normalize(this.decode(t));
            return null;
        },

        preview(code) {
            if (!code) return "(空)";
            return `${code.slice(0, 12)}…${code.slice(-6)}（${code.length} 字符）`;
        },

        /** 该授权码是否已经成功兑换过（授权码只保留展示，不再重复拿去换 Token） */
        used(code) {
            if (!GM_getValue("Config.codeUsed", false)) return false;
            const fp = String(GM_getValue("Config.codeFingerprint", ""));
            return !fp || fp === String(code || "").slice(-32);
        },

        /** 读取已保存的授权码；无法解析时只告警一次，绝不删除用户粘贴的内容 */
        stored() {
            const raw = GM_getValue("Config.code", "");
            if (!raw) return null;
            const code = this.parseCode(raw);
            if (!code) {
                if (!this._warned) {
                    this._warned = true;
                    Utils.log("🟡", `已保存的授权码无法解析（长度 ${String(raw).length}），请重新「📋 粘贴授权码」`);
                }
                return null;
            }
            // 已经用它换到 Token 了：保留在存储里（状态菜单可见），但不再重复兑换
            if (this.used(code)) return null;
            return code;
        },

        /** 保存原始输入（保留完整 URL，方便状态菜单回显）+ 时间戳 */
        save(raw) {
            const code = this.parseCode(raw);
            GM_setValue("Config.code", String(raw).trim());
            GM_setValue("Config.codeTime", Utils.getTimestamp());
            // 换了新的授权码 → 旧的「已兑换」标记作废
            GM_setValue("Config.codeUsed", false);
            GM_setValue("Config.codeFingerprint", code ? code.slice(-32) : "");
            // 换了授权码 → 之前缓存的 access_token 属于旧凭据，立即作废
            GM_setValue("Config.accessToken", "");
            GM_setValue("Config.accessTokenTime", 0);
            RewardsAuto.state.token = null;
            return code;
        },

        clear(reason) {
            GM_setValue("Config.code", "");
            GM_setValue("Config.codeTime", 0);
            GM_setValue("Config.codeUsed", false);
            GM_setValue("Config.codeFingerprint", "");
            if (reason) Utils.log("🟡", `已清除授权码：${reason}`);
        },

        /** 用授权码换 Token（成功即写入 refresh_token / access_token 缓存）。
         *  keep=true 时保留授权码，只标记已兑换，便于状态菜单回显。 */
        async exchange(code, keep = true) {
            Utils.log("🟡", `正在用授权码换取 Token（${this.preview(code)}）...`);
            const r = await API.tokenRequest({
                client_id: CLIENT_ID,
                code,
                redirect_uri: REDIRECT_URI,
                grant_type: "authorization_code",
            });
            if (r.ok) {
                API.applyToken(r.json);
                if (keep) {
                    GM_setValue("Config.codeUsed", true);
                    GM_setValue("Config.codeFingerprint", String(code).slice(-32));
                    Utils.log("🟢", "授权码换取 Token 成功（授权码已保留）", true);
                } else {
                    Utils.log("🟢", "授权码换取 Token 成功，已保存", true);
                    this.clear();
                }
                return true;
            }
            const fatal = ["invalid_grant", "invalid_request", "unauthorized_client", "invalid_client"].includes(r.error);
            Utils.log("🔴", `授权码换取 Token 失败：${r.error}${r.description ? " - " + r.description : ""}`);
            if (fatal) this.clear("授权码已过期或已被使用过");
            return false;
        },

        /** 静默通道：后台直接请求 authorize 端点，看能不能直接拿到跳转里的 code */
        async fetchViaXhr() {
            let res;
            try {
                res = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "GET",
                        url: this.authUrl,
                        anonymous: false,
                        headers: typeof navigator !== "undefined" ? { "User-Agent": navigator.userAgent } : {},
                        timeout: 20000,
                        onload: r => resolve(r),
                        onerror: e => reject(new Error((e && e.error) || "网络错误")),
                        ontimeout: () => reject(new Error("请求超时")),
                    });
                });
            } catch (e) {
                Utils.log("🟡", `静默获取授权码失败：${e.message}`);
                return null;
            }
            const candidates = [];
            if (res.finalUrl) candidates.push(res.finalUrl);
            if (res.responseURL) candidates.push(res.responseURL);
            if (res.status >= 300 && res.status < 400) {
                const loc = (res.responseHeaders || "").match(/location:\s*(\S+)/i);
                if (loc) candidates.push(loc[1]);
            }
            if (res.responseText) {
                const m = res.responseText.match(/oauth20_desktop\.srf\?[^"'\s<>]*code=[^"'\s<>]+/i)
                    || res.responseText.match(/[?&]code=M\.[^"'\s<>&]+/i);
                if (m) candidates.push(m[0]);
            }
            for (const c of candidates) {
                const code = this.parseCode(c);
                if (code) return code;
            }
            Utils.log("🟡", `静默通道没拿到授权码（HTTP ${res.status}，最终地址 ${res.finalUrl || res.responseURL || "未知"}）`);
            return null;
        },

        /** 等待页面捕获授权码（或其它上下文直接换好了 Token） */
        async waitForCode(since, timeoutMs = 180000) {
            const step = 3000;
            for (let waited = 0; waited < timeoutMs; waited += step) {
                await Utils.delay(step);
                const raw = GM_getValue("Config.code", "");
                const t = Number(GM_getValue("Config.codeTime", 0)) || 0;
                const code = raw ? this.parseCode(raw) : null;
                const freshToken = () => GM_getValue("Config.token", false)
                    && (Number(GM_getValue("Config.tokenTime", 0)) || 0) >= since;
                if (code && t >= since) {
                    // 回调页可能正在同时兑换同一个 code，先等 2.5 秒，
                    // 避免第二次必然 invalid_grant（看起来像「授权失败」）。
                    await Utils.delay(2500);
                    if (freshToken()) return { tokenReady: true };
                    return { code };
                }
                if (freshToken()) return { tokenReady: true };
            }
            return {};
        },

        async autoFetch(reason) {
            Utils.log("🟡", `${reason}，尝试自动获取授权码...`);
            const viaXhr = await this.fetchViaXhr();
            if (viaXhr) {
                Utils.log("🟢", "自动获取授权码成功（静默通道）");
                return { code: viaXhr };
            }
            // 「自动授权」的设置项已从配置面板移除，行为保持原样（默认开启：没有可用 Token 时自动打开授权页）。
            // 需要临时关掉时用 GM_setValue("Config.autoAuth", false)，恢复用 true 或删除该键。
            if (!GM_getValue("Config.autoAuth", true)) {
                Utils.log("🔴", "自动获取授权码失败（「自动授权」已被关闭），请点菜单「🔑 手动授权」，登录后把跳转地址粘贴到「📋 粘贴授权码」。", true);
                return {};
            }
            const since = Utils.getTimestamp();
            try {
                GM_openInTab(this.authUrl, { active: true });
            } catch (e) {
                Utils.log("🔴", `无法打开授权页：${e.message}`, true);
                return {};
            }
            Utils.log("🟡", "已打开微软授权页，等待授权码（最多 3 分钟；若要求登录请在页面完成登录）...");
            const got = await this.waitForCode(since, 180000);
            if (got.tokenReady) {
                Utils.log("🟢", "其它上下文已完成授权，直接复用 Token");
                return { tokenReady: true };
            }
            if (got.code) {
                Utils.log("🟢", "已捕获授权码");
                return { code: got.code };
            }
            Utils.log("🔴", "等待授权码超时。请点菜单「🔑 手动授权」，登录后把跳转地址粘贴到「📋 粘贴授权码」。", true);
            return {};
        },

        /** 授权回调页：捕获 code → 立刻兑换 → 通知并关闭页面 */
        async handleCallback() {
            const params = new URLSearchParams(location.search);
            const err = params.get("error");
            if (err) {
                const desc = params.get("error_description") || "";
                Utils.log("🔴", `授权页返回错误：${err} - ${desc}`, true);
                try { GM_notification({ title: "🔴 授权失败", text: `${err}：${desc}`, timeout: 0 }); } catch (_) {}
                return;
            }
            const code = this.parseCode(location.href);
            if (!code) {
                Utils.log("🔴", "授权回调页里没有找到 code 参数", true);
                try { GM_notification({ title: "🔴 授权失败", text: "跳转地址里没有 code 参数", timeout: 0 }); } catch (_) {}
                return;
            }
            this.save(location.href);
            Utils.log("🟡", `已捕获授权码（${this.preview(code)}），正在换取 Token...`);
            const ok = await this.exchange(code);
            if (ok) {
                try { GM_notification({ title: "🟢 授权成功", text: "Token 已保存，可以关闭此页了", timeout: 6000 }); } catch (_) {}
                setTimeout(() => { try { window.close(); } catch (_) {} }, 2000);
            } else {
                try { GM_notification({ title: "🔴 授权失败", text: "授权码换取 Token 失败，请查看脚本日志后重新授权", timeout: 0 }); } catch (_) {}
            }
        },

        /** 粘贴流程：解析 → 保存 → 立刻兑换 → 明确告知结果 */
        async pasteFlow(input) {
            let raw = input;
            if (raw == null) {
                raw = await Utils.uiPrompt(
                    "粘贴授权页跳转后的完整地址：\n" +
                    "形如 https://login.live.com/oauth20_desktop.srf?code=M.C561_BAY...&lc=2052"
                );
                if (raw == null) return false;
            }
            const code = this.save(raw);
            if (!code) {
                Utils.uiAlert("❌ 没能从粘贴内容里解析出授权码。\n\n请确认复制的是授权页跳转后的完整地址（里面要带 code=），然后重新粘贴。");
                Utils.log("🔴", `粘贴的授权码无法解析（长度 ${String(raw).trim().length}）`);
                return false;
            }
            Utils.log("🟢", `授权码已保存（${this.preview(code)}），立即换取 Token...`);
            const ok = await this.exchange(code);
            Utils.uiAlert(ok
                ? "✅ 授权成功，Token 已保存。\n\n授权码也已保留（可在「📊 Token状态」里查看）。授权码本身只能用一次，\n后续使用的是token，无需你再操作。"
                : "⚠️ 授权码已保存，但换取 Token 失败。\n\n最常见原因：授权码已过期或已被使用过。\n请重新点「🔑 手动授权」，登录后立刻复制跳转地址再粘贴。");
            return ok;
        },
    };

    const API = {
        /* 统一走 POST 表单请求 token 端点，并解析 400 响应里的 JSON 错误体，
         * 否则 invalid_grant 会被当成网络错误盲重试。 */
        async tokenRequest(params) {
            const body = Object.entries(params)
                .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
                .join("&");
            let res;
            try {
                res = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "POST",
                        url: "https://login.live.com/oauth20_token.srf",
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        data: body,
                        timeout: 20000,
                        onload: r => resolve(r),
                        onerror: e => reject(new Error((e && e.error) || "网络错误")),
                        ontimeout: () => reject(new Error("请求超时")),
                    });
                });
            } catch (e) {
                return { ok: false, status: 0, error: "network", description: e.message };
            }
            let json = null;
            try { json = JSON.parse(res.responseText || ""); } catch (_) {}
            if (json && json.access_token && json.refresh_token) {
                return { ok: true, status: res.status, json };
            }
            const error = (json && json.error) || `HTTP ${res.status}`;
            const description = (json && (json.error_description || json.error_codes))
                || String(res.responseText || "").slice(0, 200);
            return { ok: false, status: res.status, error: String(error), description: String(description) };
        },

        applyToken(data) {
            GM_setValue("Config.token", data.refresh_token);
            GM_setValue("Config.tokenTime", Utils.getTimestamp());
            // 缓存 access_token：同一账号的多个上下文可复用，避免并发刷新互相踢 token
            GM_setValue("Config.accessToken", data.access_token);
            GM_setValue("Config.accessTokenTime", Date.now());
            RewardsAuto.state.token = data.access_token;
        },

        async refreshWithToken(refreshToken) {
            return await this.tokenRequest({
                client_id: CLIENT_ID,
                refresh_token: refreshToken,
                scope: TOKEN_SCOPE,
                grant_type: "REFRESH_TOKEN",
            });
        },

        async withTokenRetry(requestFn) {
            let token = RewardsAuto.state.token;
            if (!token) return null;
            try {
                return await requestFn(token);
            } catch (e) {
                if (e.message && e.message.includes("401")) {
                    // 401 只代表 access_token 过期，绝不能清 refresh_token，
                    // 否则一次偶发 401 会让当天后续任务全部退化成「需要手动授权」。
                    Utils.log("🟡", "access_token 过期，使用 refresh_token 续期...");
                    RewardsAuto.state.token = null;
                    GM_setValue("Config.accessToken", "");
                    GM_setValue("Config.accessTokenTime", 0);
                    const refreshed = await this.renewToken();
                    if (!refreshed) return null;
                    return await requestFn(RewardsAuto.state.token);
                }
                throw e;
            }
        },

        /** 统一 Token 入口（缓存复用 + 跨上下文单飞）。
         *  MS 的 refresh_token 每次刷新都轮换，并发刷新会让其中一个拿着作废的 token 换来 invalid_grant。 */
        async renewToken() {
            if (!GM_getValue("Tasks.sign", true) && !GM_getValue("Tasks.read", true)) return true;
            const cachedAt = GM_getValue("Config.accessTokenTime", 0);
            const cachedAT = GM_getValue("Config.accessToken", "");
            if (cachedAT && cachedAt && Date.now() - cachedAt < 45 * 60 * 1000) {
                RewardsAuto.state.token = cachedAT;
                return true;
            }
            if (!Utils.acquireLock("Config.tokenLock", 90 * 1000)) {
                Utils.log("⏳", "其它上下文正在刷新 Token，等待复用...");
                for (let i = 0; i < 10; i++) {
                    await Utils.delay(2000);
                    const at = GM_getValue("Config.accessToken", "");
                    const ts = GM_getValue("Config.accessTokenTime", 0);
                    if (at && ts > cachedAt) {
                        RewardsAuto.state.token = at;
                        Utils.log("🟢", "已复用其它上下文刷新的 Token");
                        return true;
                    }
                }
                Utils.log("🟡", "等待 Token 超时，本上下文自行刷新");
            }
            try {
                return await this.renewTokenInner();
            } finally {
                Utils.releaseLock("Config.tokenLock");
            }
        },

        async renewTokenInner() {
            // ---------- 1) 已有 refresh_token：直接刷新 ----------
            let refreshToken = GM_getValue("Config.token", false);
            const tokenTime = Number(GM_getValue("Config.tokenTime", 0)) || 0;
            if (refreshToken && tokenTime > 0) {
                const days = (Utils.getTimestamp() - tokenTime) / (1000 * 60 * 60 * 24);
                if (days > 7) {
                    Utils.log("🟡", `Token 已 ${Math.floor(days)} 天，提前续期`);
                    refreshToken = false;
                }
            }
            if (refreshToken) {
                const r = await this.refreshWithToken(refreshToken);
                if (r.ok) { this.applyToken(r.json); return true; }
                Utils.log("🔴", `刷新 Token 失败：${r.error}${r.description ? " - " + r.description : ""}`);
                // 并发轮换：别的上下文可能已经换出了新 refresh_token
                const latest = GM_getValue("Config.token", false);
                if (latest && latest !== refreshToken) {
                    Utils.log("🟡", "检测到其它上下文已更新 refresh_token，改用新值重试");
                    const r2 = await this.refreshWithToken(latest);
                    if (r2.ok) { this.applyToken(r2.json); return true; }
                }
                if (r.error !== "invalid_grant") {
                    // 网络 / 服务端临时故障：不要清 Token，下次再试
                    return false;
                }
                Utils.log("🟡", "refresh_token 已失效，需要重新授权");
                GM_setValue("Config.token", false);
                GM_setValue("Config.tokenTime", 0);
            }

            // ---------- 2) 优先使用「📋 粘贴授权码」保存的码 ----------
            const storedCode = Auth.stored();
            if (storedCode) {
                Utils.log("🟡", "发现已保存的授权码，尝试用它换取 Token...");
                if (await Auth.exchange(storedCode)) return true;
            }

            // ---------- 3) 自动获取授权码 ----------
            const got = await Auth.autoFetch(refreshToken ? "Token 刷新失败" : "检测到尚未授权");
            if (got.tokenReady) return true;
            if (got.code) {
                if (await Auth.exchange(got.code)) return true;
                Utils.log("🔴", "授权码换取 Token 失败，请重新「🔑 手动授权」", true);
            }
            return false;
        },

        async getRewardsInfo(maxRetries = 3) {
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    const html = await Utils.xhr({ url: "https://rewards.bing.com/earn" });
                    const clean = html.replace(/\\"/g, '"');
                    let balance = 0;
                    let pcMax = 60, pcCur = 0, mobMax = 0, mobCur = 0;
                    let dailyOffer = 0;
                    let searchQuotaFound = false;
                    const pcIdx = clean.indexOf('"pointsCounters":{');
                    if (pcIdx !== -1) {
                        let start = pcIdx + 17, depth = 0, end = start;
                        for (let i = start; i < clean.length && i < start + 500; i++) {
                            if (clean[i] === '{') depth++;
                            if (clean[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
                        }
                        try {
                            const pts = JSON.parse(clean.substring(start, end));
                            pcMax = pts.pc?.max ?? 60;
                            pcCur = pts.pc?.progress ?? 0;
                            mobMax = pts.mobile?.max ?? 0;
                            mobCur = pts.mobile?.progress ?? 0;
                            dailyOffer = pts.dailyOffer ?? 0;
                            if (pts.totalPoints != null) balance = Number(pts.totalPoints);
                        } catch {}
                    }
                    if (balance === 0) {
                        const balMatch = clean.match(/"balance":(\d+)/) || clean.match(/"availablePoints":(\d+)/);
                        if (balMatch) balance = parseInt(balMatch[1]);
                    }
                    const todayDetails = [];
                    const acIdx = clean.indexOf('"activityCards":[');
                    if (acIdx !== -1) {
                        let acStart = acIdx + 16, acDepth = 0, acEnd = acStart;
                        for (let i = acStart; i < clean.length && i < acStart + 5000; i++) {
                            if (clean[i] === '[') acDepth++;
                            if (clean[i] === ']') { acDepth--; if (acDepth === 0) { acEnd = i + 1; break; } }
                        }
                        try {
                            const cardsStr = clean.substring(acStart, acEnd);
                            const cardRegex = /"title":"([^"]+)".*?"points":(\d+).*?"isCompleted":(true|false)/g;
                            let cardMatch;
                            while ((cardMatch = cardRegex.exec(cardsStr)) !== null) {
                                const title = cardMatch[1];
                                const points = parseInt(cardMatch[2]);
                                const isCompleted = cardMatch[3] === "true";
                                if (points > 0 && isCompleted) todayDetails.push({ title, points });
                            }
                        } catch {}
                    }
                    const toNum = value => parseInt(String(value).replace(/,/g, ''), 10) || 0;
                    const searchRowMatch = clean.match(/<p>\s*必应搜索\s*<\/p>\s*<\/div>\s*<div(?=[^>]*justify-self-end)[^>]*>([\s\S]{0,500}?)<\/div>/i);
                    const searchHtmlMatch = searchRowMatch
                        ? (searchRowMatch[1].match(/<span[^>]*>([\d,]+)<\/span>\s*<span[^>]*>\s*\/\s*([\d,]+)\s*<\/span>/i)
                            || searchRowMatch[1].match(/([\d,]+)\s*\/\s*([\d,]+)/))
                        : null;
                    if (searchHtmlMatch) {
                        pcCur = toNum(searchHtmlMatch[1]);
                        pcMax = toNum(searchHtmlMatch[2]);
                        searchQuotaFound = pcMax > 0;
                        todayDetails.push({ title: '必应搜索', points: pcCur, max: pcMax });
                        Utils.log("🔍", `页面表格配额: PC ${pcCur}/${pcMax}`);
                    }
                    const searchRscMatch = clean.match(/"combinedSearch":\{[^}]*"progress":(\d+)[^}]*"max":(\d+)/);
                    if (searchRscMatch && !todayDetails.some(d => d.title === '必应搜索')) {
                        pcCur = toNum(searchRscMatch[1]);
                        pcMax = toNum(searchRscMatch[2]);
                        searchQuotaFound = pcMax > 0;
                        todayDetails.push({ title: '必应搜索', points: pcCur, max: pcMax });
                    }
                    if (dailyOffer > 0) todayDetails.push({ title: '优惠', points: dailyOffer });
                    const otherActivityRegex = /<p>([^<]+)<\/p><\/div><div[^>]*>(\d+)<\/div>/g;
                    let otherMatch;
                    while ((otherMatch = otherActivityRegex.exec(clean)) !== null) {
                        const title = otherMatch[1];
                        const points = parseInt(otherMatch[2]);
                        if (points > 0 && !todayDetails.some(d => d.title === title)) {
                            todayDetails.push({ title, points });
                        }
                    }
                    const history = { month: 0, year: 0, lifetime: 0 };
                    const historyRscMatch = clean.match(/"pointsHistory":\{[^}]*"thisMonth":\{"earn":(\d+)[^}]*"thisYear":\{"earn":(\d+)[^}]*"lifetime":\{"earn":(\d+)/);
                    if (historyRscMatch) {
                        history.month = parseInt(historyRscMatch[1]);
                        history.year = parseInt(historyRscMatch[2]);
                        history.lifetime = parseInt(historyRscMatch[3]);
                    } else {
                        const monthHtmlMatch = clean.match(/本月.*?(\d[\d,]*)<\/div>/);
                        const yearHtmlMatch = clean.match(/今年.*?(\d[\d,]*)<\/div>/);
                        const lifetimeHtmlMatch = clean.match(/生存期.*?(\d[\d,]*)<\/div>/);
                        const monthJsonMatch = clean.match(/"monthlyPoints":(\d+)/);
                        const yearJsonMatch = clean.match(/"yearlyPoints":(\d+)/);
                        const lifetimeJsonMatch = clean.match(/"lifetimePoints":(\d+)/);
                        if (monthHtmlMatch) history.month = parseInt(monthHtmlMatch[1].replace(/,/g, ''));
                        else if (monthJsonMatch) history.month = parseInt(monthJsonMatch[1]);
                        if (yearHtmlMatch) history.year = parseInt(yearHtmlMatch[1].replace(/,/g, ''));
                        else if (yearJsonMatch) history.year = parseInt(yearJsonMatch[1]);
                        if (lifetimeHtmlMatch) history.lifetime = parseInt(lifetimeHtmlMatch[1].replace(/,/g, ''));
                        else if (lifetimeJsonMatch) history.lifetime = parseInt(lifetimeJsonMatch[1]);
                    }
                    if (!searchQuotaFound) {
                        const userInfoResult = await this.getSearchQuotaFromUserInfo();
                        if (userInfoResult) {
                            Utils.log("🟢", "页面未命中搜索配额，使用 getuserinfo 兜底");
                            return userInfoResult;
                        }
                    }
                    if (!searchQuotaFound && RewardsAuto.state.token) {
                        const apiResult = await this.getSearchQuotaFromAPI();
                        if (apiResult) {
                            Utils.log("🟢", "页面未命中搜索配额，使用 DAPI 兜底");
                            return apiResult;
                        }
                    }
                    // 补一次 DAPI 查询，保证汇总里的阅读进度是真实值（否则永远显示 0/30）
                    let readProgress = RewardsAuto.state.readProgress ?? 0;
                    let readMax = RewardsAuto.state.readMax ?? 30;
                    const readInfo = await this.getReadProgress();
                    if (readInfo) {
                        readProgress = readInfo.progress;
                        readMax = readInfo.max;
                        RewardsAuto.state.readProgress = readProgress;
                        RewardsAuto.state.readMax = readMax;
                    } else {
                        Utils.log("🟡", "阅读进度查询失败，汇总里的阅读进度可能不准");
                    }
                    return { balance, pc: { progress: pcCur, max: pcMax }, mobile: { progress: mobCur, max: mobMax }, readProgress, readMax, dailyOffer, todayDetails, history };
                } catch (e) {
                    if (attempt < maxRetries) { await Utils.delay(3210); continue; }
                    Utils.log("🔴", `仪表盘获取失败: ${e.message}`);
                    return false;
                }
            }
            return false;
        },

        async signApp() {
            const region = GM_getValue("Config.lock", true) ? "cn" : RewardsAuto.state.region.toLowerCase();
            try {
                const res = await this.withTokenRetry(token => Utils.xhr({
                    method: "POST",
                    url: "https://prod.rewardsplatform.microsoft.com/dapi/me/activities",
                    headers: {
                        "content-type": "application/json; charset=UTF-8",
                        "user-agent": RewardsAuto.ua.app,
                        "authorization": `Bearer ${token}`,
                        "x-rewards-appid": RewardsAuto.appConfig.rewardsAppId,
                        "x-rewards-ismobile": "true",
                        "x-rewards-country": region,
                        "x-rewards-language": "zh",
                        "x-rewards-partnerid": "startapp",
                        "x-rewards-flights": "rwgobig"
                    },
                    data: JSON.stringify({
                        amount: 1, id: Utils.getRandomUUID().replace(/-/g, '') + Utils.getRandomUUID().replace(/-/g, '').slice(0, 24),
                        type: 103, country: region, channel: RewardsAuto.appConfig.channel
                    })
                }));
                if (Utils.isJSON(res)) {
                    const data = JSON.parse(res);
                    const response = data.response || {};
                    if (response.activity) return Number(response.activity.p || response.activity.points || 0);
                    if (response.isDuplicate || response.activity === null) return 0;
                    Utils.log("🟡", `App签入响应未确认: ${String(res).slice(0, 120)}`);
                }
            } catch (e) {
                Utils.log("🔴", `App签入失败: ${e.message}`);
            }
            return -1;
        },

        async getRequestVerificationToken(pageUrl = "https://rewards.bing.com/") {
            try {
                const html = await Utils.xhr({
                    url: pageUrl,
                    headers: { "user-agent": RewardsAuto.ua.pc, "referer": "https://rewards.bing.com/" },
                    anonymous: false
                });
                const tokenMatch = html.match(/name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)["']/i)
                    || html.match(/RequestVerificationToken.*?value=["']([^"']+)["']/i)
                    || html.match(/"verificationToken"\s*:\s*"([^"]+)"/i)
                    || html.match(/"__RequestVerificationToken"\s*:\s*"([^"]+)"/i);
                return tokenMatch ? tokenMatch[1].replace(/&amp;/g, "&") : "";
            } catch (e) {
                Utils.log("🟡", `活动Token获取失败: ${e.message}`);
                return "";
            }
        },

        async reportActivity(offerId, hash, referer = "https://rewards.bing.com/") {
            const token = await this.getRequestVerificationToken(referer);
            const params = new URLSearchParams({ id: offerId, hash: hash || "1", activityAmount: "1" });
            if (token) params.set("__RequestVerificationToken", token);
            const headers = {
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "user-agent": RewardsAuto.ua.pc,
                "referer": referer,
                "origin": "https://rewards.bing.com",
                "x-requested-with": "XMLHttpRequest"
            };
            if (token) headers["RequestVerificationToken"] = token;
            return await Utils.xhr({
                method: "POST",
                url: "https://rewards.bing.com/api/reportactivity?X-Requested-With=XMLHttpRequest",
                headers, data: params.toString(), anonymous: false
            });
        },

        async reportDailyActivity(searchUrl) {
            try {
                const fullUrl = searchUrl.startsWith("http") ? searchUrl : `https://cn.bing.com${searchUrl}`;
                const ig = Utils.getRandomUUID().replace(/-/g, '').substring(0, 32).toUpperCase();
                const cnUrl = fullUrl.replace(/^https?:\/\/www\.bing\.com/, "https://cn.bing.com")
                                     .replace(/^https:\/\/bing\.com/, "https://cn.bing.com");
                const cnUrlObj = new URL(cnUrl);
                const cnSp = cnUrlObj.searchParams;
                const reportParams = new URLSearchParams();
                reportParams.set("IG", ig);
                reportParams.set("IID", "commerce.5067");
                if (cnSp.get("form")) reportParams.set("form", cnSp.get("form"));
                if (cnSp.get("ocid") || cnSp.get("OCID")) reportParams.set("ocid", cnSp.get("ocid") || cnSp.get("OCID"));
                if (cnSp.get("rnoreward")) reportParams.set("rnoreward", cnSp.get("rnoreward"));
                try {
                    await Utils.xhr({
                        method: "GET", url: cnUrl,
                        headers: {
                            "user-agent": RewardsAuto.ua.pc,
                            "referer": "https://rewards.bing.com/",
                            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                            "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
                        }
                    });
                } catch (_) {}
                const ncheaderParams = new URLSearchParams();
                ncheaderParams.set("ver", String(Date.now()).substring(0, 8));
                ncheaderParams.set("IID", "commerce.5057");
                ncheaderParams.set("IG", ig);
                try {
                    await Utils.xhr({
                        method: "POST",
                        url: `https://cn.bing.com/rewardsapp/ncheader?${ncheaderParams.toString()}`,
                        headers: {
                            "content-type": "application/x-www-form-urlencoded",
                            "user-agent": RewardsAuto.ua.pc,
                            "referer": cnUrl,
                            "origin": "https://cn.bing.com",
                            "accept": "*/*",
                            "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
                        },
                        data: "wb=1;i=1;v=1"
                    });
                } catch (_) {}
                const bodyParams = new URLSearchParams();
                bodyParams.set("url", cnUrl);
                bodyParams.set("V", "web");
                await Utils.xhr({
                    method: "POST",
                    url: `https://cn.bing.com/rewardsapp/reportActivity?${reportParams.toString()}`,
                    headers: {
                        "content-type": "application/x-www-form-urlencoded",
                        "user-agent": RewardsAuto.ua.pc,
                        "referer": cnUrl,
                        "origin": "https://cn.bing.com",
                        "accept": "*/*",
                        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
                    },
                    data: bodyParams.toString()
                });
                return true;
            } catch (e) {
                Utils.log("🟡", `每日活动上报失败: ${e.message}`);
                return false;
            }
        },

        async signPC() {
            try {
                const res = await this.reportActivity("Gamification_DailyCheckIn", "1", "https://rewards.bing.com/");
                if (Utils.isJSON(res)) {
                    const data = JSON.parse(res);
                    return Number(data.points || data.response?.activity?.p || 0);
                }
            } catch (e) {
                if (e.message?.includes("401")) RewardsAuto.state.pc401 = true;
                Utils.log("🟡", `PC签入失败: ${e.message}`);
            }
            return -1;
        },

        async appActivity(type, offerid) {
            const region = GM_getValue("Config.lock", true) ? "cn" : RewardsAuto.state.region.toLowerCase();
            const body = {
                amount: 1, country: region,
                id: Utils.getRandomUUID().replace(/-/g, '') + Utils.getRandomUUID().replace(/-/g, '').slice(0, 24),
                type: type, channel: RewardsAuto.appConfig.channel
            };
            if (offerid) body.attributes = { offerid: offerid };
            try {
                const res = await this.withTokenRetry(token => Utils.xhr({
                    method: "POST",
                    url: "https://prod.rewardsplatform.microsoft.com/dapi/me/activities",
                    headers: {
                        "content-type": "application/json; charset=utf-8",
                        "user-agent": RewardsAuto.ua.app,
                        "authorization": `Bearer ${token}`,
                        "x-rewards-appid": RewardsAuto.appConfig.rewardsAppId,
                        "x-rewards-ismobile": "true",
                        "x-rewards-country": region,
                        "x-rewards-language": "zh"
                    },
                    data: JSON.stringify(body)
                }));
                if (Utils.isJSON(res)) {
                    const data = JSON.parse(res);
                    return {
                        points: data.response?.activity?.p || 0,
                        isDuplicate: data.response?.isDuplicate || false,
                        balance: data.response?.balance || 0
                    };
                }
            } catch (e) {
                Utils.log("🔴", `App活动失败(${offerid}): ${e.message}`);
            }
            return null;
        },

        async getReadProgress() {
            try {
                const res = await this.withTokenRetry(token => Utils.xhr({
                    url: "https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613",
                    headers: {
                        "content-type": "application/json; charset=UTF-8",
                        "user-agent": RewardsAuto.ua.app,
                        "authorization": `Bearer ${token}`,
                        "x-rewards-appid": RewardsAuto.appConfig.rewardsAppId,
                        "x-rewards-ismobile": "true",
                        "x-rewards-country": "cn",
                        "x-rewards-language": "zh"
                    }
                }));
                if (Utils.isJSON(res)) {
                    const promos = JSON.parse(res).response?.promotions || [];
                    const readOfferId = RewardsAuto.appConfig.offerIds.readArticle;
                    const task = promos.find(x => x.attributes?.offerid === readOfferId);
                    if (task && task.attributes) {
                        const progress = parseInt(task.attributes.progress) || 0;
                        const max = parseInt(task.attributes.max) || 30;
                        Utils.log("📊", `阅读进度查询: ${progress}/${max} (offerid: ${readOfferId})`);
                        return { progress, max };
                    } else {
                        Utils.log("🟡", `阅读任务未找到 (offerid: ${readOfferId})`);
                    }
                } else {
                    Utils.log("🟡", `DAPI 响应不是 JSON: ${String(res).substring(0, 100)}`);
                }
            } catch (e) {
                Utils.log("🔴", `阅读进度获取失败: ${e.message}`);
            }
            return false;
        },

        /* ===== Edge 通道（浏览连签 / Edge browsing streak） =====
         * 微软给 Edge 用户的每日任务：在 Edge 里累计浏览满 30 分钟即记账，满 30 分钟后
         * promotion.attributes.complete 翻成 true。这一项只存在于 Edge 通道下
         * （channel=edge、appid=EdgeDesktop、partnerid=EdgeHub），SAAndroid/App 通道
         * 看不到它，所以必须单独一套请求头，不能复用 appActivity。
         * 计时由服务端按「每次上报覆盖 report_per_minutes 分钟」累加：分次上报才有效，
         * 两次间隔小于 report_per_minutes 会被判重（response.isDuplicate=true，不计次）。
         */
        edgeRegion() {
            if (GM_getValue("Config.lock", true)) return "cn";
            const region = String(RewardsAuto.state.region || "us").toLowerCase();
            return region || "us";
        },

        _edgeHeaders(region, token) {
            const country = region || this.edgeRegion();
            return {
                "accept": "*/*",
                "content-type": "application/json; charset=UTF-8",
                "user-agent": RewardsAuto.ua.edge,
                "authorization": `Bearer ${token}`,
                "x-rewards-appid": "EdgeDesktop",
                "x-rewards-partnerid": "EdgeHub",
                "x-rewards-country": country,
                "x-rewards-language": country === "cn" ? "zh-CN" : "en-US",
            };
        },

        // Profile,Promotions：一次拿到账号档案 + 全部 promotion（含 Edge 连签那一项）
        async getEdgeProfile(region) {
            try {
                const res = await this.withTokenRetry(token => Utils.xhr({
                    url: "https://prod.rewardsplatform.microsoft.com/dapi/me?channel=edge&options=Profile,Promotions",
                    headers: this._edgeHeaders(region, token)
                }));
                if (!res || !Utils.isJSON(res)) {
                    Utils.log("🟡", `Edge 通道返回非 JSON：${String(res).substring(0, 80)}`);
                    return null;
                }
                const data = JSON.parse(res);
                if (data.code !== 0 || !data.response) {
                    Utils.log("🟡", `Edge 通道查询失败：code=${data.code}`);
                    return null;
                }
                return data.response;
            } catch (e) {
                Utils.log("🟡", `Edge 通道查询异常: ${e.message}`);
                return null;
            }
        },

        // 上报一次浏览活动：服务端按 report_offer_type 记账，amount 固定 1
        async reportEdgeActivity({ offerid, type, region }) {
            try {
                const res = await this.withTokenRetry(token => Utils.xhr({
                    method: "POST",
                    url: "https://prod.rewardsplatform.microsoft.com/dapi/me/activities",
                    headers: this._edgeHeaders(region, token),
                    data: JSON.stringify({
                        amount: 1,
                        attributes: { offerid },
                        request_user_info: true,
                        type
                    })
                }));
                return (res && Utils.isJSON(res)) ? JSON.parse(res) : { code: -1, response: null };
            } catch (e) {
                Utils.log("🟡", `Edge 连签上报异常: ${e.message}`);
                return { code: -1, response: null };
            }
        },

        // 激活 Edge 连签活动：新账号/新周期要先在 earn 页「开启」一次，否则 promotion 不会出现
        async activateEdgeBrowsing() {
            const earnUrl = "https://rewards.bing.com/earn";
            try {
                let html = "";
                try {
                    html = await Utils.xhr({
                        url: `${earnUrl}?section=streaks`,
                        headers: { "user-agent": RewardsAuto.ua.pc, "referer": earnUrl }
                    });
                } catch (_) { /* 换 earn 首页再试 */ }
                if (!html || !String(html).includes("edge_flight")) {
                    try {
                        html = await Utils.xhr({
                            url: earnUrl,
                            headers: { "user-agent": RewardsAuto.ua.pc, "referer": earnUrl }
                        });
                    } catch (_) { /* 下面统一判空 */ }
                }
                if (!html) return "failed";
                const clean = String(html).replace(/\\"/g, '"');
                // 新版 Edge 把活动 id 从 edge_flight_1_... 升到了 edge_flight_2_...，
                // 所以按前缀取，已知的 1 号优先
                const ids = [...clean.matchAll(/"activationOfferId":"(edge_flight[^"]*)"/g)].map(m => m[1]);
                if (ids.length === 0) {
                    // 页面上连 edge 的活动位都没有：账号/地区不支持，今天不用再试
                    return /"partner":"edge"/.test(clean) ? "failed" : "absent";
                }
                const offerId = ids.includes(EDGE.ACTIVATION_OFFER) ? EDGE.ACTIVATION_OFFER : ids[0];
                const idx = clean.indexOf(`"activationOfferId":"${offerId}"`);
                const win = clean.substring(Math.max(0, idx - 600), idx + 500);
                if (/"isEnabled":true/.test(win)) return "already";
                const hashMatch = win.match(/"activationHash":"([^"]+)"/);
                const typeMatch = win.match(/"activationActivityType":(\d+)/);
                const hash = hashMatch ? hashMatch[1] : "";
                const actType = typeMatch ? Number(typeMatch[1]) : 714;
                if (!hash || hash === "$undefined") return "failed";
                const nextAction = await this.getNextActionHash(html);
                await Utils.xhr({
                    method: "POST",
                    url: earnUrl,
                    headers: {
                        "content-type": "text/plain;charset=UTF-8",
                        "next-action": nextAction,
                        "origin": "https://rewards.bing.com",
                        "referer": earnUrl,
                        "user-agent": RewardsAuto.ua.pc,
                    },
                    data: JSON.stringify([hash, actType, { offerid: offerId, isPromotional: "$undefined", timezoneOffset: "-480" }])
                });
                return "activated";
            } catch (e) {
                Utils.log("🟡", `Edge 连签激活失败: ${e.message}`);
                return "failed";
            }
        },

        /* DAPI 权威任务状态：网页通道依赖 Cookie 与 UA 指纹，Edge 与 Chrome/Firefox 不一致且无法复核；
         * 这里直接读 BingSapphire App 的 DAPI 接口（Bearer Token），可精确读到每张卡的 progress/max。 */
        _promoCache: null,

        async getAppPromotions(force = false) {
            const now = Date.now();
            if (!force && this._promoCache && now - this._promoCache.ts < 15000) return this._promoCache.list;
            try {
                const res = await this.withTokenRetry(token => Utils.xhr({
                    url: RewardsAuto.appConfig.dapiMeUrl,
                    headers: {
                        "content-type": "application/json; charset=UTF-8",
                        "user-agent": RewardsAuto.ua.app,
                        "authorization": `Bearer ${token}`,
                        "x-rewards-appid": RewardsAuto.appConfig.rewardsAppId,
                        "x-rewards-ismobile": "true",
                        "x-rewards-country": GM_getValue("Config.lock", true) ? "cn" : "us",
                        "x-rewards-language": "zh"
                    }
                }));
                if (Utils.isJSON(res)) {
                    const list = JSON.parse(res).response?.promotions || [];
                    this._promoCache = { list, ts: Date.now() };
                    return list;
                }
                Utils.log("🟡", `DAPI 任务列表非 JSON: ${String(res).slice(0, 100)}`);
            } catch (e) {
                Utils.log("🟡", `DAPI 任务列表获取失败: ${e.message}`);
            }
            return null;
        },

        async getPromotionMap(force = false) {
            const list = await this.getAppPromotions(force);
            if (!list) return null;
            const map = new Map();
            for (const p of list) {
                const a = p.attributes || {};
                // 注意：部分 promotion（如 Gamification_Streak_Counter_Promotion）没有 offerid，
                // 其身份就是 promotion 的 name 字段，这类条目必须用 name 做键，否则会丢字段。
                const offerId = a.offerid || a.offerId || p.name;
                if (!offerId) continue;
                const max = parseInt(a.max ?? a.activitymax ?? 0, 10) || 0;
                // 注意字段名：日常卡片用 progress，BingSapphire 系（含 streak 计数）用 activity_progress
                const progress = parseInt(a.progress ?? a.activity_progress ?? a.activityprogress ?? 0, 10) || 0;
                map.set(offerId, {
                    offerId,
                    name: p.name || "",
                    max,
                    progress,
                    complete: String(a.complete).toLowerCase() === "true" || (max > 0 && progress >= max),
                    title: a.title || p.name || "",
                    destination: a.destination || "",
                    type: a.type || "",
                    state: a.State || "",
                    dailySetDate: a.daily_set_date || "",
                    hidden: String(a.hidden).toLowerCase() === "true"
                });
            }
            return map;
        },

        async isOfferComplete(offerId, force = false) {
            if (!offerId) return null;
            const map = await this.getPromotionMap(force);
            if (!map) return null;
            const item = map.get(offerId);
            return item ? item.complete : null;
        },

        // 通过 DAPI 发现「今日日常活动卡片」，不依赖页面 HTML / Cookie；preMap 可复用已获取的 map
        async discoverDailySetCards(preMap = null) {
            const todayStr = Utils.getTodayStr();
            const todayNum = String(Utils.getTodayNum());
            const map = preMap || await this.getPromotionMap(true);
            if (!map) return [];
            const cards = [];
            for (const item of map.values()) {
                const isDailySet = item.offerId.includes(RewardsAuto.appConfig.offerIds.dailySetPrefix)
                    || (item.type === "urlreward" && item.dailySetDate === todayStr);
                if (!isDailySet) continue;
                const scheduledToday = item.dailySetDate === todayStr || item.offerId.includes(todayNum);
                if (!scheduledToday) continue;
                if (item.complete) continue;
                cards.push({
                    title: item.title || item.offerId,
                    points: item.max || 10,
                    offerId: item.offerId,
                    hash: "",
                    kind: "daily",
                    url: "https://rewards.bing.com/earn",
                    destination: item.destination || "",
                    source: "dapi"
                });
            }
            return cards;
        },

        async getRewardsToken() {
            try {
                const html = await Utils.xhr({
                    url: "https://rewards.bing.com/",
                    headers: { "user-agent": RewardsAuto.ua.pc, "referer": "https://rewards.bing.com/" }
                });
                if (html) {
                    const match = html.replace(/\s/g, "").match(/RequestVerificationToken(.*?)value="(.*?)"/);
                    if (match) return match[2];
                }
            } catch (e) {
                Utils.log("🟡", `RequestVerificationToken 获取失败: ${e.message}`);
            }
            return false;
        },

        async getSearchQuotaFromUserInfo(light = false) {
            try {
                const res = await Utils.xhr({
                    url: `https://rewards.bing.com/api/getuserinfo?type=1&X-Requested-With=XMLHttpRequest&_=${Date.now()}`,
                    headers: {
                        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "user-agent": RewardsAuto.ua.pc,
                        "referer": "https://rewards.bing.com/",
                        "x-requested-with": "XMLHttpRequest"
                    },
                    anonymous: false
                });
                if (!Utils.isJSON(res)) return false;
                const data = JSON.parse(res);
                const dashboard = data.dashboard || data;
                const userStatus = dashboard.userStatus || {};
                const counters = userStatus.counters || {};
                const sumCounter = items => {
                    if (!Array.isArray(items)) return { progress: 0, max: 0 };
                    return items.reduce((acc, item) => {
                        acc.progress += Number(item.pointProgress || 0);
                        acc.max += Number(item.pointProgressMax || item.pointMax || 0);
                        return acc;
                    }, { progress: 0, max: 0 });
                };
                const pc = sumCounter(counters.pcSearch);
                if (pc.max === 0) return false;
                const balance = Number(userStatus.availablePoints || dashboard.availablePoints || 0);
                let readProgress = RewardsAuto.state.readProgress ?? 0;
                let readMax = RewardsAuto.state.readMax ?? 30;
                /* light=true：只取搜索配额。搜索节拍器每次搜索后都要核对一次记账，
                 * 这里省掉额外的阅读进度请求和日志，免得 20 次搜索刷 20 行 + 20 个请求。 */
                if (!light) {
                    try {
                        const readInfo = await API.getReadProgress();
                        if (readInfo) { readProgress = readInfo.progress; readMax = readInfo.max; }
                    } catch (e) {}
                    Utils.log("📊", `getuserinfo查询: PC ${pc.progress}/${pc.max}, 阅读 ${readProgress}/${readMax}, 积分 ${balance}`);
                }
                return {
                    balance, pc, readProgress, readMax, dailyOffer: 0,
                    todayDetails: pc.max > 0 ? [{ title: "必应搜索", points: pc.progress, max: pc.max }] : [],
                    history: null
                };
            } catch (e) {
                if (GM_getValue("Config.debugDAPI", false)) {
                    Utils.log("🟡", `getuserinfo 查询失败: ${e.message}`);
                }
                return false;
            }
        },

        async getSearchQuotaFromAPI(light = false) {
            try {
                const res = await this.withTokenRetry(token => Utils.xhr({
                    url: "https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613",
                    headers: {
                        "content-type": "application/json; charset=UTF-8",
                        "user-agent": RewardsAuto.ua.app,
                        "authorization": `Bearer ${token}`,
                        "x-rewards-appid": RewardsAuto.appConfig.rewardsAppId,
                        "x-rewards-ismobile": "true",
                        "x-rewards-country": "cn",
                        "x-rewards-language": "zh"
                    }
                }));
                if (Utils.isJSON(res)) {
                    const data = JSON.parse(res);
                    const response = data.response || {};
                    const promos = response.promotions || [];
                    const counters = response.counters || response.userStatus?.counters;
                    if (!counters) return false;
                    let pcCur = 0, pcMax = 0;
                    if (counters?.pcSearch && counters.pcSearch.length > 0) {
                        pcCur = counters.pcSearch[0].pointProgress || 0;
                        pcMax = counters.pcSearch[0].pointProgressMax || 0;
                    }
                    if (pcMax === 0) return false;
                    const balance = response.balance || response.userStatus?.availablePoints || 0;
                    let readProgress = RewardsAuto.state.readProgress ?? 0;
                    let readMax = RewardsAuto.state.readMax ?? 30;
                    if (!light) {
                        try {
                            const readInfo = await API.getReadProgress();
                            if (readInfo) { readProgress = readInfo.progress; readMax = readInfo.max; }
                        } catch (e) {}
                        Utils.log("📊", `DAPI查询: PC ${pcCur}/${pcMax}, 阅读 ${readProgress}/${readMax}, 积分 ${balance}`);
                    }
                    return { balance, pc: { progress: pcCur, max: pcMax }, readProgress, readMax, dailyOffer: 0, todayDetails: [], history: null };
                }
            } catch (e) {
                if (!light) Utils.log("🟡", `DAPI查询失败: ${e.message}`);
            }
            return false;
        },

        /* ===== 搜索记账核对 =====
         * PC 搜索的积分是「服务端记账」，本地 +3 只是猜测：被限流时搜索照发但一分不给。
         * 所以每搜一次就核对一次真实进度，节拍器才知道该加速还是该退让。
         * 优先用 getuserinfo（轻量 GET，带 PC 会话 Cookie），拿不到再走 App 通道的 DAPI。 */
        async getPcQuota() {
            try {
                const ui = await this.getSearchQuotaFromUserInfo(true);
                if (ui && ui.pc && ui.pc.max > 0) return { progress: ui.pc.progress, max: ui.pc.max };
            } catch (_) {}
            try {
                if (RewardsAuto.state.token) {
                    const dapi = await this.getSearchQuotaFromAPI(true);
                    if (dapi && dapi.pc && dapi.pc.max > 0) return { progress: dapi.pc.progress, max: dapi.pc.max };
                }
            } catch (_) {}
            return null;
        },

        async getBalance() {
            try {
                const res = await this.withTokenRetry(token => Utils.xhr({
                    url: "https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=105",
                    headers: {
                        "content-type": "application/json; charset=UTF-8",
                        "user-agent": RewardsAuto.ua.app,
                        "authorization": `Bearer ${token}`,
                        "x-rewards-appid": RewardsAuto.appConfig.rewardsAppId,
                        "x-rewards-ismobile": "true",
                        "x-rewards-country": "cn",
                        "x-rewards-language": "zh"
                    }
                }));
                if (Utils.isJSON(res)) {
                    const data = JSON.parse(res);
                    return data.response?.balance || 0;
                }
            } catch (e) {}
            try {
                const res2 = await Utils.xhr({
                    url: `https://rewards.bing.com/api/getuserinfo?type=1&X-Requested-With=XMLHttpRequest&_=${Date.now()}`,
                    headers: {
                        "user-agent": RewardsAuto.ua.pc,
                        "referer": "https://rewards.bing.com/",
                        "x-requested-with": "XMLHttpRequest"
                    },
                });
                if (Utils.isJSON(res2)) {
                    const data2 = JSON.parse(res2);
                    return data2.dashboard?.availablePoints || data2.balance || 0;
                }
            } catch (e) {}
            return 0;
        },

        async doRead() {
            const region = GM_getValue("Config.lock", true) ? "cn" : RewardsAuto.state.region.toLowerCase();
            try {
                const id = Utils.getRandomUUID().replace(/-/g, '') + Utils.getRandomUUID().replace(/-/g, '').slice(0, 24);
                const res = await this.withTokenRetry(token => Utils.xhr({
                    method: "POST",
                    url: "https://prod.rewardsplatform.microsoft.com/dapi/me/activities",
                    headers: {
                        "content-type": "application/json; charset=utf-8",
                        "user-agent": RewardsAuto.ua.app,
                        "authorization": `Bearer ${token}`,
                        "x-rewards-appid": RewardsAuto.appConfig.rewardsAppId,
                        "x-rewards-ismobile": "true",
                        "x-rewards-country": region,
                        "x-rewards-language": "zh"
                    },
                    data: JSON.stringify({
                        amount: 1, country: region, id: id, type: 101,
                        attributes: { offerid: RewardsAuto.appConfig.offerIds.readArticle }
                    })
                }));
                if (Utils.isJSON(res)) {
                    const data = JSON.parse(res);
                    return { points: data.response?.activity?.p || 0, isDuplicate: data.response?.isDuplicate || false };
                }
                return null;
            } catch (e) {
                Utils.log("🔴", `阅读请求失败: ${e.message}`);
                return false;
            }
        },

        async discoverCards() {
            const cards = [];
            const seenCardKeys = new Set();
            let earnHtml = ""; // 提升到 try 外：桌面奖励任务解析块需要复用 earn 页 HTML
            try {
                const html = await Utils.xhr({ url: "https://rewards.bing.com/earn" });
                if (!html) { Utils.log("🔴", "earn 页面返回空"); return cards; }
                earnHtml = html;
                const clean = html.replace(/\\"/g, '"');
                
                const pushCard = (card) => {
                    if (!card || !card.offerId || !card.hash || card.points <= 0) return;
                    const key = `${card.offerId}:${card.hash}`;
                    if (seenCardKeys.has(key)) return;
                    seenCardKeys.add(key);
                    cards.push(card);
                };

                const inferKind = (offerId, title = "") => {
                    const text = `${offerId} ${title}`.toLowerCase();
                    if (/quiz|trivia|question|测验|答案/.test(text)) return "quiz";
                    if (/puzzle|拼图/.test(text)) return "puzzle";
                    if (/image|图片|设计/.test(text)) return "image_creator";
                    if (/explore|search|浏览|探索/.test(text)) return "explore_search";
                    if (/dailyset|daily|每日/.test(text)) return "daily";
                    if (/streak|打卡|连续/.test(text)) return "streak";
                    return "open_only";
                };

                const parseCard = (obj) => {
                    const offerIdMatch = obj.match(/"offerId":"([^"]+)"/i) || obj.match(/"offerid":"([^"]+)"/i);
                    const hashMatch = obj.match(/"hash":"([^"]+)"/) || obj.match(/"activityId":"([^"]+)"/) || obj.match(/"id":"([^"]+)"/);
                    if (!offerIdMatch || !hashMatch) return null;
                    const offerId = offerIdMatch[1];
                    const hash = hashMatch[1];
                    const pointsMatch = obj.match(/"points":(\d+)/);
                    const isCompletedMatch = obj.match(/"isCompleted":(true|false)/i) || obj.match(/"state":"(completed|CLAIMED)"/i);
                    const titleMatch = obj.match(/"title":"([^"]+)"/) || obj.match(/"name":"([^"]+)"/);
                    const points = pointsMatch ? parseInt(pointsMatch[1]) : 0;
                    const isCompleted = isCompletedMatch ? (isCompletedMatch[1] === "true" || isCompletedMatch[1] === "completed") : false;
                    if (isCompleted) return null;
                    const title = titleMatch ? titleMatch[1] : "";
                    const skip = RewardsAuto.skipPatterns.some(p => title.toLowerCase().includes(p.toLowerCase()) || offerId.toLowerCase().includes(p.toLowerCase()));
                    if (skip) return null;
                    return { title, points, offerId, hash, kind: inferKind(offerId, title) };
                };

                try {
                    const userInfo = await Utils.xhr({
                        url: `https://rewards.bing.com/api/getuserinfo?type=1&X-Requested-With=XMLHttpRequest&_=${Date.now()}`,
                        headers: { "user-agent": RewardsAuto.ua.pc, "referer": "https://rewards.bing.com/", "x-requested-with": "XMLHttpRequest" },
                        anonymous: false
                    });
                    if (Utils.isJSON(userInfo)) {
                        const data = JSON.parse(userInfo);
                        const dashboard = data.dashboard || data;
                        const now = new Date();
                        const todayKeys = new Set([
                            `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}/${now.getFullYear()}`,
                            `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`
                        ]);
                        const normalizeDashboardCard = (item, kind) => {
                            if (!item) return null;
                            const offerId = item.offerId || item.offerid || item.id || item.name;
                            const hash = item.hash || item.activityId;
                            const title = item.title || item.name || item.description || "";
                            const points = Number(item.points ?? item.pointProgressMax ?? item.max ?? 0);
                            const doneMax = Number(item.pointProgressMax || 0);
                            const doneCur = Number(item.pointProgress || 0);
                            const isCompleted = item.isCompleted || item.complete || (doneMax > 0 && doneCur >= doneMax);
                            if (!offerId || !hash || points <= 0 || isCompleted) return null;
                            const skip = RewardsAuto.skipPatterns.some(p => title.toLowerCase().includes(p.toLowerCase()) || offerId.toLowerCase().includes(p.toLowerCase()));
                            if (skip) return null;
                            return { title, points, offerId, hash, kind: kind || inferKind(offerId, title), source: "getuserinfo", url: item.destinationUrl || "https://rewards.bing.com/" };
                        };

                        const dailySetPromotions = dashboard.dailySetPromotions || {};
                        for (const dateKey of todayKeys) {
                            const dailyItems = dailySetPromotions[dateKey];
                            if (Array.isArray(dailyItems)) {
                                for (const item of dailyItems) pushCard(normalizeDashboardCard(item, "daily"));
                            }
                        }
                        const morePromotions = dashboard.morePromotions || dashboard.promotions || [];
                        if (Array.isArray(morePromotions)) {
                            for (const item of morePromotions) pushCard(normalizeDashboardCard(item));
                        }
                    }
                } catch (e) {
                    Utils.log("🟡", `getuserinfo 活动解析跳过: ${e.message}`);
                }

                // --- [Next.js Flight Chunks & DAPI parsing] ---
                try {
                    const chunks = [];
                    const pushRegex = /self\.__next_f\.push\(\[\d+,\s*"(.*?)"\]\)/gs;
                    let mFlight;
                    while ((mFlight = pushRegex.exec(html)) !== null) {
                        try {
                            const unescaped = JSON.parse(`"${mFlight[1]}"`);
                            chunks.push(unescaped);
                        } catch (_) {}
                    }
                    const fullFlightText = chunks.length > 0 ? chunks.join("") : html.replace(/\\"/g, '"');
                    const offerObjRegex = /\{[^{}]*?"offerId"\s*:\s*"([^"]+)"[^{}]*?\}/g;
                    let om;
                    while ((om = offerObjRegex.exec(fullFlightText)) !== null) {
                        try {
                            const jsonStr = om[0].replace(/:\$undefined/g, ":null").replace(/:\$D[^\",}]+/g, ":null");
                            const item = JSON.parse(jsonStr);
                            if (!item.offerId || !item.hash) continue;
                            if (item.isCompleted === true || item.isLocked === true) continue;
                            const points = Number(item.points || 0);
                            if (points <= 0 && !item.offerId.includes("DailySet")) continue;
                            pushCard({
                                title: item.title || item.name || item.offerId,
                                points: points || 10,
                                offerId: item.offerId,
                                hash: item.hash,
                                kind: inferKind(item.offerId, item.title || ""),
                                destination: item.destination || item.destinationUrl || "",
                                url: "https://rewards.bing.com/earn"
                            });
                        } catch (_) {}
                    }
                } catch (e) {
                    Utils.log("🟡", `Flight 数据解析异常: ${e.message}`);
                }

                if (cards.length === 0) {
                    const dataRegex = /data-offer-id="([^"]+)"[^>]*data-hash="([^"]+)"/gi;
                    let m;
                    while ((m = dataRegex.exec(html)) !== null) {
                        const offerId = m[1];
                        const hash = m[2];
                        const skip = RewardsAuto.skipPatterns.some(p => offerId.toLowerCase().includes(p.toLowerCase()));
                        if (skip) continue;
                        pushCard({ title: "日常任务", points: 10, offerId, hash, kind: "daily" });
                    }
                }

                if (cards.length > 0) {
                    Utils.log("🧩", `成功获取 ${cards.length} 个可执行卡片`);
                } else {
                    Utils.log("🟡", "未发现可执行的活动卡片（可能均已手动完成或被过滤）");
                }
            } catch (e) {
                Utils.log("🔴", `卡片解析失败: ${e.message}`);
            }
            
                // --- [桌面奖励应用专属任务检测与解析] ---
                // 注意：此块必须留在 try 内，一旦引用 try 外的 html 会抛 ReferenceError 并被 catch 静默吞掉。
                try {
                    if (!earnHtml) return cards;
                    const questMatch = earnHtml.match(/href="(\/earn\/quest\/(WW_pcparent_RewardsApp_weekly_Exclusive[^"]+))"/i)
                        || earnHtml.match(/"(\/earn\/quest\/(WW_pcparent_RewardsApp_weekly_Exclusive[^"]+))"/i);
                    if (questMatch) {
                        const questPath = questMatch[1];
                        const questUrl = "https://rewards.bing.com" + questPath;
                        const questHtml = await Utils.xhr({
                            url: questUrl,
                            headers: RewardsAuto.desktopAppHeaders
                        });
                        if (questHtml) {
                            const qChunks = [];
                            const qPushRegex = /self\.__next_f\.push\(\[\d+,\s*"(.*?)"\]\)/gs;
                            let qm;
                            while ((qm = qPushRegex.exec(questHtml)) !== null) {
                                try { qChunks.push(JSON.parse(`"${qm[1]}"`)); } catch (_) {}
                            }
                            const qText = qChunks.length > 0 ? qChunks.join("") : questHtml.replace(/\\"/g, '"');
                            const qOfferRegex = /\{[^{}]*?"offerId"\s*:\s*"(WW_pcchild\d+[^"]+)"[^{}]*?\}/g;
                            let qo;
                            while ((qo = qOfferRegex.exec(qText)) !== null) {
                                try {
                                    const qItem = JSON.parse(qo[0].replace(/:\$undefined/g, ":null").replace(/:\$D[^\",}]+/g, ":null"));
                                    if (qItem.offerId && qItem.hash && qItem.isLocked === false && qItem.isCompleted === false) {
                                        Utils.log("🖥️", `发现已解锁桌面奖励任务: ${qItem.title || qItem.offerId}`);
                                        pushCard({
                                            title: `[桌面专享] ${qItem.title || qItem.name || qItem.offerId}`,
                                            points: 10,
                                            offerId: qItem.offerId,
                                            hash: qItem.hash,
                                            kind: "desktop_app",
                                            destination: qItem.destination || qItem.href || "",
                                            url: "https://rewards.bing.com/earn"
                                        });
                                    }
                                } catch (_) {}
                            }
                        }
                    }
                } catch (eQuest) {
                    Utils.log("🟡", `桌面应用专属任务解析跳过: ${eQuest.message}`);
                }

            return cards;
        },

        async getNextActionHash(html) {
            let cached = RewardsAuto._nextAction || GM_getValue("Config.nextAction", "707e6eb15bdfdd5fba193f0a77e934f7018faf87ce");
            if (html && html.includes("_next/static/chunks/")) {
                const scriptSrcs = [...new Set(html.match(/\/_next\/static\/chunks\/[a-z0-9_\-]+\.js\?dpl=[^"]+/g) || [])];
                for (const src of scriptSrcs) {
                    try {
                        const chunkText = await Utils.xhr({ url: "https://rewards.bing.com" + src });
                        const match = chunkText.match(/createServerReference\)\("([a-f0-9]{40,44})"[^)]*"reportActivity"\)/);
                        if (match && match[1]) {
                            cached = match[1];
                            RewardsAuto._nextAction = cached;
                            GM_setValue("Config.nextAction", cached);
                            break;
                        }
                    } catch (_) {}
                }
            }
            return cached;
        },

        /** 领取单张卡片（统一入口：先 DAPI → 再网页通道 → 一律用 DAPI 复核是否真的加分）。
         *  服务端可能要 1~3 分钟才把上报记入 progress，单次失败不等于真失败，故做多轮重试。
         */
        async claimCard(card, opts = {}) {
            const offerId = card.offerId;
            const name = card.title || offerId;
            const attempts = opts.attempts || 3;
            const backoffs = opts.backoffs || [[8000, 12000], [20000, 30000], [45000, 60000]];
            const diag = [];

            // 0) 服务端已完成：直接认账，避免重复上报触发风控
            if (await this.isOfferComplete(offerId, true) === true) {
                Utils.log("✅", `服务端已确认完成：${name}`);
                return true;
            }

            for (let i = 0; i < attempts; i++) {
                if (i > 0) {
                    const [lo, hi] = backoffs[Math.min(i - 1, backoffs.length - 1)];
                    Utils.log("⏳", `等待 ${Math.round(lo / 1000)}~${Math.round(hi / 1000)} 秒后重试（第 ${i + 1}/${attempts} 次）：${name}`);
                    await Utils.randomDelay(lo, hi);
                }
                const ok = await this._claimCardOnce(card, { skipWeb: i === 0, diag });
                if (ok) return true;
            }

            Utils.log("🟡", `卡片领取未确认（已重试 ${attempts} 次）：${name} [${diag.join(" ")}]`);
            return false;
        },

        // 单次领取尝试：访问目的地（urlreward 产生进度的真实机制）→ DAPI 上报 → 服务端复核
        async _claimCardOnce(card, { skipWeb = false, diag = [] } = {}) {
            const offerId = card.offerId;
            const name = card.title || offerId;

            if (await this.isOfferComplete(offerId, false) === true) {
                Utils.log("✅", `服务端已确认完成：${name}`);
                return true;
            }

            if (card.destination && /^https?:/i.test(card.destination)) {
                try {
                    await Utils.xhr({
                        url: card.destination,
                        headers: { "user-agent": RewardsAuto.ua.pc, "referer": "https://rewards.bing.com/earn" }
                    });
                    diag.push("visit(ok)");
                } catch (e) {
                    diag.push(`visit(${e.message})`);
                }
                await Utils.randomDelay(1500, 3000);
            }

            // 首选 DAPI 通道（Bearer Token 鉴权，不使用浏览器 Cookie，跨浏览器一致）
            const appRes = await this.appActivity(101, offerId);
            if (appRes) {
                diag.push(`dapi(p=${appRes.points}${appRes.isDuplicate ? ",dup" : ""})`);
                if (appRes.points > 0) {
                    Utils.log("🟢", `DAPI 领取成功 +${appRes.points} 分：${name}`);
                    return true;
                }
            } else {
                diag.push("dapi(请求失败)");
            }
            await Utils.randomDelay(1500, 3000);
            if (await this.isOfferComplete(offerId, true) === true) {
                Utils.log("🟢", `DAPI 上报已生效：${name}`);
                return true;
            }

            if (skipWeb) return false;

            // 网页通道（Server Action / api/reportactivity / 目的地访问）
            let webAccepted = false;
            try {
                webAccepted = await this.claimCardWeb(card);
            } catch (e) {
                diag.push(`web(${e.message})`);
            }
            if (webAccepted) {
                await Utils.randomDelay(2500, 5000);
                if (await this.isOfferComplete(offerId, true) === true) {
                    Utils.log("🟢", `网页通道领取成功：${name}`);
                    return true;
                }
                diag.push("web(已发出但服务端未生效)");
            } else {
                diag.push("web(请求未被接受)");
            }
            return false;
        },

        // 网页通道（Edge 与 Chrome/Firefox 差异所在）：返回 true 仅表示请求被接受，真实加分由 claimCard() 用 DAPI 复核
        async claimCardWeb(card) {
            const url = card.url || "https://rewards.bing.com/earn";
            const referer = card.url || "https://rewards.bing.com/earn";
            let nextAction = RewardsAuto._nextAction || GM_getValue("Config.nextAction", "707e6eb15bdfdd5fba193f0a77e934f7018faf87ce");

            // 策略 1: Next.js Server Action (最稳妥、官方核心)
            try {
                const res = await Utils.xhr({
                    method: "POST", url,
                    headers: {
                        "content-type": "text/plain;charset=UTF-8",
                        "next-action": nextAction,
                        "referer": referer,
                        ...(card.kind === "desktop_app" ? RewardsAuto.desktopAppHeaders : {})
                    },
                    data: JSON.stringify([card.hash, 11, { offerid: card.offerId, isPromotional: "$undefined", timezoneOffset: "-480" }])
                });
                if (res && (res.includes("true") || res.includes('"i":false') || res.includes('"a":'))) {
                    return true;
                }
            } catch (e2) {
                if (e2.message.includes("404")) {
                    Utils.log("🟡", "Server Action ID 可能已更新，尝试动态探测...");
                    try {
                        const earnHtml = await Utils.xhr({ url: "https://rewards.bing.com/earn" });
                        nextAction = await this.getNextActionHash(earnHtml);
                        const retryRes = await Utils.xhr({
                            method: "POST", url,
                            headers: { "content-type": "text/plain;charset=UTF-8", "next-action": nextAction, referer },
                            data: JSON.stringify([card.hash, 11, { offerid: card.offerId, isPromotional: "$undefined", timezoneOffset: "-480" }])
                        });
                        if (retryRes) return true;
                    } catch (_) {}
                }
            }

            // 策略 2: 目标链接如果是搜索页，模拟执行每日活动上报
            if (card.destination && card.destination.startsWith("http")) {
                try {
                    await this.reportDailyActivity(card.destination);
                    return true;
                } catch (_) {}
            }

            // 策略 3: 老版 reportactivity
            try {
                const token = await this.getRewardsToken();
                if (token) {
                    await Utils.xhr({
                        method: "POST",
                        url: "https://rewards.bing.com/api/reportactivity?X-Requested-With=XMLHttpRequest",
                        headers: {
                            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                            "user-agent": RewardsAuto.ua.pc,
                            "referer": referer,
                            "origin": "https://rewards.bing.com",
                            "x-requested-with": "XMLHttpRequest"
                        },
                        data: new URLSearchParams({
                            id: card.offerId, hash: card.hash, timeZone: 480,
                            activityAmount: 1, dbs: 0, form: "", type: "",
                            __RequestVerificationToken: token
                        }).toString()
                    });
                    return true;
                }
            } catch (_) {}

            Utils.log("🟡", `卡片领取未确认(${card.offerId})`);
            return false;
        },

        /* 从搜索结果页里取服务器给这次搜索分配的 IG（交互 ID）。
         * 真实浏览器是拿着 SERP 里的 IG 去上报的；以前一直用本地随机 UUID，
         * 服务端认不出这是哪一次搜索，记账就时有时无（这是「第一轮给得多、
         * 之后每轮只给一点」的疑点之一）。取不到才退回随机值。 */
        extractIG(html) {
            if (!html) return "";
            const patterns = [
                /IG:"([0-9A-F]{16,40})"/i,
                /"IG"\s*:\s*"([0-9A-F]{16,40})"/i,
                /[?&]IG=([0-9A-F]{16,40})/i,
            ];
            for (const re of patterns) {
                const m = html.match(re);
                if (m && m[1]) return m[1].toUpperCase();
            }
            return "";
        },

        async getSearchPage(query, isMobile = false) {
            const mkt = GM_getValue("Config.lock", true) ? "&mkt=zh-CN" : "";
            const deviceType = isMobile ? "m" : "d";
            return Utils.xhr({
                url: `https://${RewardsAuto.state.host}/search?q=${encodeURIComponent(query)}&form=QBLH${mkt}`,
                headers: {
                    "user-agent": isMobile ? RewardsAuto.ua.mobile : RewardsAuto.ua.pc,
                    "cookie": `_Rwho=u=${deviceType}&ts=${RewardsAuto.state.dateNowStr}`,
                    "referer": `https://${RewardsAuto.state.host}/?form=QBLH`,
                    // 一次搜索必须真的打到服务器：命中缓存的话服务端根本看不到这次搜索
                    "cache-control": "no-cache",
                    "pragma": "no-cache"
                }
            });
        },

        async reportSearch(html, query, isMobile = false) {
            try {
                const ig = this.extractIG(html) || Utils.getRandomUUID();
                const mkt = GM_getValue("Config.lock", true) ? "&mkt=zh-CN" : "";
                const params = `q=${encodeURIComponent(query)}&form=QBLH${mkt}`;
                const deviceType = isMobile ? "m" : "d";
                const headers = {
                    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "user-agent": isMobile ? RewardsAuto.ua.mobile : RewardsAuto.ua.pc,
                    "referer": `https://${RewardsAuto.state.host}/?form=QBLH`,
                    "cookie": `_Rwho=u=${deviceType}&ts=${RewardsAuto.state.dateNowStr}`
                };
                await Utils.xhr({
                    method: "POST",
                    url: `https://${RewardsAuto.state.host}/rewardsapp/ncheader?ver=88888888&IID=SERP.5047&IG=${ig}&ajaxreq=1`,
                    headers, data: "wb=1%3bi%3d1%3bv%3d1"
                });
                await Utils.xhr({
                    method: "POST",
                    url: `https://${RewardsAuto.state.host}/rewardsapp/reportActivity?IG=${ig}&IID=SERP.5047&${params}&ajaxreq=1`,
                    headers,
                    data: `url=${encodeURIComponent(`https://${RewardsAuto.state.host}/search?${params}`)}&V=web`
                });
                return true;
            } catch (e) {
                Utils.log("🟡", `搜索上报失败: ${e.message}`);
                return false;
            }
        },

        /* 地区闸门：真正的判断在 RegionGuard（多路探测 + 缓存），这里只做「能不能继续」的收敛。
         * 保留旧名字，runAll / 诊断脚本都不用改调用方式。 */
        async checkRegion() {
            if (!RegionGuard.enabled()) return true;
            const v = await RegionGuard.check({ fresh: true });
            if (v.ok) return true;
            // 拦截时补一份国内视角的 IP 归属，日志/通知里能直接看出「出口在哪」
            if (!v.ipInfo) await this.getIPInfo();
            return false;
        },

        async getIPInfo() {
            try {
                const qryResult = await Utils.xhr({
                    url: "https://disp-qryapi.3g.qq.com/v1/dispatch",
                    headers: { "referer": "https://3g.qq.com/" }
                });
                if (qryResult && Utils.isJSON(qryResult)) {
                    const resJSON = JSON.parse(qryResult);
                    RewardsAuto.state.ip = (resJSON.code == 0 && resJSON.extra && resJSON.extra.ip) ? resJSON.extra.ip : "";
                    let rawInfo = (resJSON.code == 0 && resJSON.ipInfo) ? String(resJSON.ipInfo) : "";
                    rawInfo = rawInfo.replace(/[#*]+/g, " ").trim();
                    RewardsAuto.state.ipInfo = rawInfo ? `🌏所在地区：${rawInfo}` : "";
                }
            } catch {
                console.debug("获取附加 IP 信息失败");
            }
        },

        async getHotSearchWord() {
            const keywords = ["天气预报", "今日新闻", "体育赛事", "股票行情", "电影推荐", "科技资讯", "美食食谱", "旅游攻略", "历史上的今天", "健康常识"];
            const baseWord = keywords[Utils.randomRange(0, keywords.length - 1)];
            const randomSuffix = Math.random().toString(36).slice(2, 6);
            let sentence = `${baseWord} ${randomSuffix}`;
            if (RewardsAuto.apiConfig.mode !== "offline") {
                if (RewardsAuto.apiConfig.wordIndex < 1 || RewardsAuto.apiConfig.wordList.length < 1) {
                    const apiArr = RewardsAuto.apiConfig.arr;
                    const lastApiIndex = parseInt(GM_getValue("Config.apiIndex", -1));
                    const filteredArr = apiArr.filter((_, index) => index !== lastApiIndex);
                    const randomIndex = Utils.randomRange(0, filteredArr.length - 1);
                    GM_setValue("Config.apiIndex", randomIndex);
                    const [apiName, apiConfig] = filteredArr[randomIndex];
                    RewardsAuto.apiConfig.url = apiConfig.url;
                    RewardsAuto.apiConfig.hot = apiConfig.hot;
                    try {
                        const hotSource = RewardsAuto.apiConfig.hot[Utils.randomRange(0, RewardsAuto.apiConfig.hot.length - 1)];
                        const result = await Utils.xhr({ url: RewardsAuto.apiConfig.url + hotSource });
                        if (result && Utils.isJSON(result)) {
                            const res = JSON.parse(result);
                            if (res.code == 200) {
                                RewardsAuto.apiConfig.wordIndex = 1;
                                RewardsAuto.apiConfig.wordList = [];
                                for (let i = 0; i < res.data.length; i++) {
                                    RewardsAuto.apiConfig.wordList.push(res.data[i].title);
                                }
                                RewardsAuto.apiConfig.wordList.sort(() => Math.random() - 0.5);
                                sentence = RewardsAuto.apiConfig.wordList[RewardsAuto.apiConfig.wordIndex];
                                sentence = sentence.substring(0, Utils.randomRange(20, 32));
                                return sentence;
                            }
                        }
                    } catch (e) {
                        Utils.log("🟡", `热搜词获取失败: ${e.message}`);
                    }
                } else {
                    RewardsAuto.apiConfig.wordIndex++;
                    if (RewardsAuto.apiConfig.wordIndex > RewardsAuto.apiConfig.wordList.length - 1) {
                        RewardsAuto.apiConfig.wordIndex = 0;
                    }
                    sentence = RewardsAuto.apiConfig.wordList[RewardsAuto.apiConfig.wordIndex];
                    sentence = sentence.substring(0, Utils.randomRange(20, 32));
                    return sentence;
                }
                Utils.log("🟡", "热搜词接口异常，已使用随机搜索词");
            }
            return sentence;
        },

        async checkSearchRestricted() {
            const info = await this.getRewardsInfo();
            const currentTotal = info ? info.pc.progress : RewardsAuto.state.pcProgress;
            const lastTotal = RewardsAuto.state.lastSearchProgress;
            if (lastTotal !== -1) {
                if (currentTotal === lastTotal && currentTotal < RewardsAuto.state.pcMax) {
                    RewardsAuto.state.restrictedTimes++;
                } else {
                    RewardsAuto.state.restrictedTimes = 0;
                }
            }
            RewardsAuto.state.lastSearchProgress = currentTotal;
            GM_setValue("Config.lastSearchProgress", currentTotal);
            GM_setValue("Config.restrictedTimes", RewardsAuto.state.restrictedTimes);
            if (RewardsAuto.state.restrictedTimes >= 3) {
                Utils.log("🔴", "搜索受限或账号异常，已中断今日搜索！", true);
                return true;
            }
            return false;
        }
    };

    /* ===== Edge 浏览连签（状态机 + 节拍器） =====
     * 迁移自老脚本的 taskEdgeBrowsing()，但按 main.js 的常驻调度重写过：
     *  - 老脚本的 service worker 活不过 30 分钟，只能「每次 cron 报 1 次」，20 分钟一轮要凑 2 小时；
     *  - main.js 的 Sched 每 20 秒做一次 GM 读写给 MV3 续命，所以这里做成节拍器：
     *    状态全量持久化到 Config.edge，只要还有一个上下文活着，就按 report_per_minutes
     *    的节奏接着报，30~40 分钟记满；上下文被打断也能从持久化状态续上。
     *  - 判重靠服务端：isDuplicate=true 时不计次，但仍要记 last（否则会连发、被一路判重）。
     *  - 完成与否以服务端 promotion.attributes.complete 为准，本地只做缓存和去重通知。
     */
    const EdgeStreak = {
        _running: false,

        state() {
            const raw = GM_getValue("Config.edge", null);
            const st = (raw && typeof raw === "object") ? raw : {};
            const today = Utils.getTodayNum();
            const base = {
                date: today, count: 0, last: 0, complete: false, activated: false,
                notified: false, extra: 0, total: 0, intervalMin: 5, offerid: "", type: "714", sync: 0,
                giveUp: false
            };
            if (st.date !== today) return base;   // 跨日重置（连签是每天的任务）
            return {
                ...base,
                count: Number(st.count) || 0,
                last: Number(st.last) || 0,
                complete: !!st.complete,
                activated: !!st.activated,
                notified: !!st.notified,
                extra: Number(st.extra) || 0,
                total: Number(st.total) || 0,
                intervalMin: Number(st.intervalMin) || 5,
                offerid: String(st.offerid || ""),
                type: String(st.type || "714"),
                sync: Number(st.sync) || 0,
                giveUp: !!st.giveUp,
            };
        },

        save(st) {
            GM_setValue("Config.edge", st);
        },

        // 上报间隔（分钟）：服务端给的 report_per_minutes，异常值一律按 5 分钟
        intervalOf(attr) {
            const n = Number(attr && attr.report_per_minutes);
            return (Number.isFinite(n) && n >= 1 && n <= 30) ? n : 5;
        },

        // 上报类型：服务端给的 report_offer_type，非纯数字一律按 714（浏览活动）
        typeOf(attr) {
            const t = String((attr && attr.report_offer_type) || "").trim();
            return /^\d+$/.test(t) ? t : "714";
        },

        // 找 Edge 连签 promotion：老名字之外还要认新版变体，否则 Edge 一升级就永远找不到
        findPromotion(profile) {
            const list = (profile && Array.isArray(profile.promotions)) ? profile.promotions : [];
            if (list.length === 0) return null;
            const exact = list.find(p => p && p.name === EDGE.PROMO_NAME);
            if (exact) return exact;
            // 同名前缀的新变体（edge_browsing_streak_flight_v2 之类）：名字认得出就是它，
            // 不要求 attributes，缺字段交给后面统一提示
            const variant = list.find(p => p && EDGE.PROMO_PREFIX.test(String(p.name || "")));
            if (variant) return variant;
            // 名字完全改了：退回按 Edge 活动特征认（带 offerid + report_offer_type 的 edge 项）
            return list.find(p => p && p.attributes
                && /edge/i.test(String(p.name || ""))
                && !!(p.attributes.offerid && p.attributes.report_offer_type)) || null;
        },

        notifyDone(st) {
            if (st.notified) return;
            st.notified = true;
            this.save(st);
            Utils.log("🌐", `Edge 浏览连签任务已完成！（今日 ${EDGE.TARGET_MINUTES} 分钟浏览已记账）`, true);
        },

        /* 推进一步：可能什么都不做（间隔没到 / 已完成）。
         * 返回 { done, count, total, waitMs } 给节拍器排下一次。 */
        async step() {
            const st = this.state();
            const totalOf = () => st.total || Math.ceil(EDGE.TARGET_MINUTES / Math.max(1, st.intervalMin));

            // 今日已判定做不了（账号不支持 / 数据缺失 / 重来轮次用尽）：不再打扰服务端，
            // 也不让常驻调度为了它空转一整天
            if (st.giveUp) {
                return { done: false, skipped: true, count: st.count, total: totalOf(), waitMs: 6 * 60 * 60 * 1000 };
            }
            // 已完成：每 2 小时跟服务端对一次账（防换账号继承了上一个账号的完成标记），平时不打扰
            if (st.complete && Date.now() - st.sync < 2 * 60 * 60 * 1000) {
                return { done: true, count: st.count || totalOf(), total: totalOf(), waitMs: 30 * 60 * 1000 };
            }
            // 还没到一个计费窗口：直接等，连查询都不发（别让 20 秒心跳把接口打成刷子）
            if (!st.complete && st.count > 0 && st.last && Date.now() - st.last < st.intervalMin * 60 * 1000) {
                return {
                    done: false, count: st.count, total: totalOf(),
                    waitMs: st.last + st.intervalMin * 60 * 1000 - Date.now()
                };
            }
            if (!RewardsAuto.state.token) {
                const ok = await API.renewToken();
                if (!ok || !RewardsAuto.state.token) {
                    Utils.log("🟡", "Edge 浏览连签：暂无可用 Token，跳过（先完成授权）");
                    return { done: false, count: st.count, total: totalOf(), waitMs: 5 * 60 * 1000 };
                }
            }
            const region = API.edgeRegion();
            let profile = await API.getEdgeProfile(region);
            if (!profile) return { done: false, count: st.count, total: totalOf(), waitMs: 5 * 60 * 1000 };
            let promo = this.findPromotion(profile);

            // 没找到活动项：多半是新账号/新周期还没激活，一天只尝试一次
            if (!promo && !st.activated) {
                st.activated = true;
                this.save(st);
                const res = await API.activateEdgeBrowsing();
                if (res === "absent") {
                    st.giveUp = true;
                    this.save(st);
                    Utils.log("🟡", "Edge 浏览连签：当前账号没有这个活动（地区/账号不支持），今日跳过");
                    return { done: false, skipped: true, count: st.count, total: totalOf(), waitMs: 6 * 60 * 60 * 1000 };
                }
                Utils.log(res === "already" ? "🟢" : "🟡",
                    `Edge 浏览连签：活动${res === "activated" ? "已激活" : res === "already" ? "此前已激活" : "激活失败"}（${res}）`);
                await Utils.delay(Utils.randomRange(3000, 6000));
                profile = await API.getEdgeProfile(region);
                promo = profile ? this.findPromotion(profile) : null;
            }
            if (!promo) {
                Utils.log("🟡", "Edge 浏览连签：暂未找到活动项，可先在 Edge 里打开 rewards.bing.com/earn?section=streaks 手动开启");
                return { done: false, count: st.count, total: totalOf(), waitMs: 60 * 60 * 1000 };
            }

            const attr = promo.attributes || {};
            st.intervalMin = this.intervalOf(attr);
            st.total = Math.ceil(EDGE.TARGET_MINUTES / st.intervalMin);
            st.offerid = String(attr.offerid || "").trim();
            st.type = this.typeOf(attr);
            const total = st.total;

            if (String(attr.complete).toLowerCase() === "true") {
                st.complete = true;
                st.sync = Date.now();
                st.count = total;
                this.save(st);
                this.notifyDone(st);
                return { done: true, count: total, total, waitMs: 30 * 60 * 1000 };
            }
            // 本地记着完成、服务端却不认（换账号 / 服务端回滚）：清标记重新累计
            if (st.complete) {
                Utils.log("🟡", "Edge 浏览连签：本地标记已完成但服务端未确认，重新累计");
                st.complete = false; st.count = 0; st.last = 0; st.extra = 0; st.notified = false;
                this.save(st);
            }
            if (!st.offerid) {
                st.giveUp = true;
                this.save(st);
                Utils.log("🟡", "Edge 浏览连签：活动项缺少 offerid，无法上报，今日跳过");
                return { done: false, skipped: true, count: st.count, total, waitMs: 6 * 60 * 60 * 1000 };
            }
            if (st.count >= total) {
                // 次数报够了但服务端还没确认：先给它落库时间，仍然不认就整体重来
                if (Date.now() - st.last < 10 * 60 * 1000) {
                    return { done: false, count: st.count, total, waitMs: 10 * 60 * 1000 };
                }
                if (st.extra >= EDGE.MAX_EXTRA_ROUNDS) {
                    st.giveUp = true;
                    this.save(st);
                    Utils.log("🟡", `Edge 浏览连签：已上报 ${st.count}/${total} 次仍未确认完成，今日暂停（明日自动重试）`);
                    return { done: false, skipped: true, count: st.count, total, waitMs: 6 * 60 * 60 * 1000 };
                }
                st.extra++;
                st.count = 0;
                st.last = 0;
                this.save(st);
                Utils.log("🟡", `Edge 浏览连签：服务端未确认完成，第 ${st.extra}/${EDGE.MAX_EXTRA_ROUNDS} 轮重新累计`);
                return { done: false, count: 0, total, waitMs: 0 };
            }

            const res = await API.reportEdgeActivity({ offerid: st.offerid, type: st.type, region });
            const code = (res && typeof res.code === "number") ? res.code : -1;
            if (code !== 0) {
                Utils.log("🟡", `Edge 浏览连签：第 ${Math.min(st.count + 1, total)}/${total} 次上报失败（code=${code}），稍后重试`);
                return { done: false, count: st.count, total, waitMs: 5 * 60 * 1000 };
            }
            const dup = !!(res.response && res.response.isDuplicate === true);
            st.last = Date.now();
            st.sync = Date.now();
            if (!dup) st.count = Math.min(st.count + 1, total);
            this.save(st);
            Utils.log(dup ? "🟡" : "🟢",
                `Edge 浏览连签：第 ${st.count}/${total} 次上报${dup ? "（被判重，未记账）" : "已记账"}`);

            // 上报后稍等再复核：累计满 30 分钟这一刻服务端才把 complete 翻成 true
            await Utils.delay(Utils.randomRange(2000, 4000));
            const after = await API.getEdgeProfile(region);
            const afterPromo = after ? this.findPromotion(after) : null;
            if (afterPromo && String((afterPromo.attributes || {}).complete).toLowerCase() === "true") {
                st.complete = true;
                st.sync = Date.now();
                st.count = total;
                this.save(st);
                this.notifyDone(st);
                return { done: true, count: total, total, waitMs: 30 * 60 * 1000 };
            }
            return {
                done: false, count: st.count, total,
                waitMs: dup ? Math.max(60 * 1000, st.intervalMin * 60 * 1000) : st.intervalMin * 60 * 1000
            };
        },

        // 对外一步：加锁防多上下文重复上报（页面与后台会同时被调度/心跳唤醒）
        async run() {
            if (!GM_getValue("Tasks.edge", true)) return null;
            if (!GM_getValue("Config.token", false)) return null;   // 没授权就不用试
            if (this._running) return null;
            if (!Utils.acquireLock("Config.edgeLock", 3 * 60 * 1000)) return null;
            this._running = true;
            try {
                return await this.step();
            } catch (e) {
                Utils.log("🟡", `Edge 浏览连签异常: ${e.message}`);
                return null;
            } finally {
                this._running = false;
                Utils.releaseLock("Config.edgeLock");
            }
        },

        // 汇总行数据：给 runAll 的日报用
        summary() {
            if (!GM_getValue("Tasks.edge", true)) return null;
            const st = this.state();
            const total = st.total || Math.ceil(EDGE.TARGET_MINUTES / Math.max(1, st.intervalMin));
            const count = Math.min(st.count, total);
            return { done: st.complete, skipped: st.giveUp && !st.complete, count, total, text: `${count}/${total}` };
        }
    };

    /* Edge 连签节拍器：挂在常驻调度的心跳里（Sched.tick 每 ≤20 秒一次），
     * 但只有「距上次上报满一个计费窗口」时才真的发请求，所以心跳不会把接口打爆。
     * 这样 30 分钟的累计在 30~40 分钟内记完，而不是被 20 分钟一轮的 cron 拖成 2 小时。 */
    const EDGE_PACE_TICK = 30 * 1000;   // 两次「是否需要上报」判断之间的最小间隔

    const EdgePacer = {
        busy: false,
        nextAt: 0,

        async maybeReport() {
            if (this.busy) return null;
            if (Date.now() < this.nextAt) return null;
            // 出口闸门：心跳每 20 秒跑一次，这里是唯一会在「一轮任务之外」发微软请求的入口
            if (!(await RegionGuard.allow())) {
                this.nextAt = Date.now() + 5 * 60 * 1000;   // 出口异常：退避 5 分钟再试
                return null;
            }
            this.busy = true;
            try {
                const r = await EdgeStreak.run();
                if (!r) {
                    this.nextAt = Date.now() + 5 * 60 * 1000;   // 未启用/失败：退避 5 分钟
                } else {
                    const wait = r.done ? 30 * 60 * 1000 : (r.waitMs || 0);
                    this.nextAt = Date.now() + Math.max(EDGE_PACE_TICK, wait);
                }
                return r;
            } catch (_) {
                this.nextAt = Date.now() + 5 * 60 * 1000;
                return null;
            } finally {
                this.busy = false;
            }
        }
    };

    /* ===== PC 搜索节拍器 =====
     * 现象：第一轮还能拿几分，之后每轮只拿一点，几十轮才凑满。
     * 两层原因：
     *   1) 服务端记账是「窗口式」的：短时间连着搜，只有前几次真给分，剩下的要等下一个窗口。
     *      这是服务端的策略，脚本改不了，只能顺着它攒；
     *   2) 脚本把「没记账」一律当成「该更慢了」，节拍一路放大到 5 分钟，还持久化给下一轮，
     *      于是一轮 20 分钟只搜得到四五次 —— 后面每一轮自然就只拿一点。这一层是可以修的。
     * 现在：
     *   1) 每轮都从用户设的最小间隔（Config.span）起步，不继承上一轮被放大的节拍；
     *   2) 记账成功立刻回到最小间隔；没记账才按倍数放慢，软上限 3 分钟
     *      （再慢不如结束本轮交给调度，别在一轮里干等）；
     *   3) 不再「连续 6 次没记账就收手」：改成「连续 10 分钟一次都没记账」才收手，
     *      这样能把「服务端记账延迟几十秒」和「真的被限流」分开；
     *   4) 一轮内一直搜到配额满或预算用完，尝试次数按剩余配额动态算，不再固定 40。
     */
    const SEARCH_PACER = {
        MIN_MS: 30 * 1000,          // 绝对下限：再顺也不会比 Config.span 更快（默认 30 秒）
        MAX_MS: 3 * 60 * 1000,      // 没记账时最多退到这个节拍，再慢就交给下一轮
        OBSERVE_MIN: 8 * 1000,      // 搜索后留给服务端记账的观察窗（随机，避免固定秒数）
        OBSERVE_MAX: 16 * 1000,
        MAX_ATTEMPTS: 60,           // 一轮内的尝试上限（兜底）
        NO_CREDIT_LIMIT: 10 * 60 * 1000,  // 连续这么久一次都没记账 → 本轮收手
        RECENT_CREDIT: 5 * 60 * 1000,     // 预算用完后，最近这么久还有记账就继续把这轮补满
        MIN_ATTEMPTS_BEFORE_GIVEUP: 8,    // 但至少先试够这么多次，别被两次记账延迟骗了
        GROW: 1.5,                  // 没记账：节拍放大倍数
        RETRY_GAP: 5 * 60 * 1000,   // 搜索没满时，下一轮提前多少毫秒续做

        // 下限 = 用户设的最小间隔（Config.span）；脚本只会比它慢，绝不会比它快
        minMs() {
            const span = Number(GM_getValue("Config.span", 30)) || 30;
            return Math.min(this.MAX_MS, Math.max(this.MIN_MS, Math.max(30, span) * 1000));
        },
        /* 每轮的起始节拍：永远是用户设的最小间隔。
         * 上一轮被限流学到的大节拍只留作日志，不再拖住下一轮 —— 限流窗口是分钟级的，
         * 拿一整天的节奏去还债，正是「后面每轮只拿一点」的由来。 */
        startGap() { return this.minMs(); },
        /* 只在 Config.span 之上加，绝不往下减：用户设 30 秒，就一定不会快于 30 秒。
         * 额外加 0~35% 随机量，间隔不会总落在整秒整分上，看起来不像定时器。 */
        jitter(ms) {
            const v = ms * (1 + Math.random() * 0.35);
            return Math.max(5 * 1000, Math.round(v / 1000) * 1000);
        },
        // 只存「上一轮最高节拍」用于诊断；跨天自动失效
        saveGap(ms) {
            GM_setValue("Config.searchGap", { date: Utils.getTodayNum(), ms: Math.round(ms) });
        },
        loadGapPeak() {
            const saved = GM_getValue("Config.searchGap", null);
            if (!saved || typeof saved !== "object" || saved.date !== Utils.getTodayNum()) return 0;
            const ms = Number(saved.ms) || 0;
            return (ms <= 0 || ms > this.MAX_MS) ? 0 : ms;
        },
        // 上一轮的统计（尝试几次/记账几次/最高节拍）；落盘保存，刷新页面后诊断菜单还看得到
        setLast(stat) {
            GM_setValue("Config.searchLast", stat ? { date: Utils.getTodayNum(), ...stat } : null);
        },
        getLast() {
            const l = GM_getValue("Config.searchLast", null);
            if (!l || typeof l !== "object" || l.date !== Utils.getTodayNum()) return null;
            return { attempts: Number(l.attempts) || 0, credits: Number(l.credits) || 0, peak: Number(l.peak) || 0, at: Number(l.at) || 0 };
        },
        // 「本轮没搜满」标记：带日期，跨天自动失效，不会让昨天的残留把今天的轮次一直拉快
        setPending(v) {
            GM_setValue("Config.searchPending", v ? { date: Utils.getTodayNum() } : null);
        },
        isPending() {
            const p = GM_getValue("Config.searchPending", null);
            return !!(p && typeof p === "object" && p.date === Utils.getTodayNum());
        },
        summary() {
            const min = Math.round(this.minMs() / 1000);
            return {
                gap: min, min,
                peak: Math.round(this.loadGapPeak() / 1000),
                pending: this.isPending(),
                last: this.getLast()
            };
        }
    };

    const TaskManager = {
        signDate: 0, readDate: 0, promosDate: 0, searchDate: 0, streakDays: 0,
        signPoint: -1, signTimes: 0, readTimes: 0, promosTimes: 0,
        // running 只是本上下文的防重入标记；后台沙盒被冻结时 finally 可能跑不到，
        // 所以配一个 runningSince，超过 RUN_STALE 就当作残留标记自动清理
        running: false, runningSince: 0,

        init() {
            RewardsAuto.state.dateNowNum = Utils.getTodayNum();
            RewardsAuto.state.dateNowStr = Utils.getTodayStr();
            const tasks = GM_getValue("Config.tasks", {});
            this.signDate = tasks.sign || 0;
            this.readDate = tasks.read || 0;
            this.promosDate = tasks.promos || 0;
            this.searchDate = tasks.search || 0;
            this.streakDays = tasks.streakDays || 0;
            this.signPoint = GM_getValue("Config.signPoint", -1);
        },

        save() {
            GM_setValue("Config.tasks", {
                sign: this.signDate, read: this.readDate,
                promos: this.promosDate, search: this.searchDate,
                streakDays: this.streakDays
            });
        },

        async doSign() {
            if (!GM_getValue("Tasks.sign", true) || this.signTimes > 2) return;
            if (this.signPoint >= 0 && this.signDate === RewardsAuto.state.dateNowNum) {
                Utils.log("✅", `签入已完成(${this.signPoint}积分)`);
                return;
            }
            await RegionGuard.guard("签入");
            await Utils.randomDelay();
            let totalPoint = 0;
            let signOk = false;
            const appPoint = await API.signApp();
            if (appPoint >= 0) {
                signOk = true;
                if (appPoint > 0) {
                    GM_log(`📱 App签入静默成功 +${appPoint}积分`);
                    totalPoint += appPoint;
                } else {
                    GM_log("📱 App签入已确认，无新增积分");
                }
            }
            await Utils.randomDelay(3000, 8000);
            const pcPoint = await API.signPC();
            if (pcPoint >= 0) {
                signOk = true;
                Utils.log("💻", `PC签入成功！+${pcPoint}积分`);
                totalPoint += pcPoint;
            }
            if (signOk) {
                this.signPoint = totalPoint;
                this.signDate = RewardsAuto.state.dateNowNum;
                GM_setValue("Config.signPoint", totalPoint);
                this.save();
                Utils.log("🔵", `签入任务完成！总积分 +${totalPoint}`, true);
            } else {
                this.signTimes++;
                Utils.log("🟡", `签入失败，稍后重试`);
            }
        },

        async doRead() {
            if (!GM_getValue("Tasks.read", true) || this.readTimes > 2) return;
            if (this.readDate === RewardsAuto.state.dateNowNum) {
                const verifyProgress = await API.getReadProgress();
                if (verifyProgress && verifyProgress.progress >= verifyProgress.max) {
                    Utils.log("✅", `阅读任务已完成（已验证 ${verifyProgress.progress}/${verifyProgress.max}）`);
                    return;
                } else if (verifyProgress) {
                    Utils.log("🟡", `阅读标记有误（${verifyProgress.progress}/${verifyProgress.max}），重置并继续`);
                    this.readDate = 0;
                    this.save();
                } else {
                    Utils.log("🟡", "无法验证阅读进度，跳过");
                    return;
                }
            }
            const progress = await this.readProgressWithRetry();
            if (!progress) {
                this.readTimes++;
                Utils.log("🟡", "无法获取阅读进度，稍后重试");
                return;
            }
            let cur = progress.progress;
            let max = progress.max;
            Utils.log("📖", `阅读进度: ${cur}/${max}`);
            if (cur >= max) {
                this.readDate = RewardsAuto.state.dateNowNum;
                this.save();
                Utils.log("✅", "阅读任务已完成");
                return;
            }
            // 该活动：读 10 篇文章，每篇约 3 分，共 30 分；
            // progress/max 的单位是「积分」，activityprogress/activitymax 才是「篇数」。
            const pointsPerArticle = 3;
            const maxPerDay = 10;
            const target = Math.min(Math.max(Math.ceil((max - cur) / pointsPerArticle), 1), maxPerDay);
            Utils.log("📖", `今日还可阅读 ${target} 篇（上限 ${maxPerDay} 篇/天，每篇约 ${pointsPerArticle} 分）`);
            let successCount = 0;
            let stagnant = 0;
            for (let i = 0; i < target; i++) {
                await RegionGuard.guard("阅读");
                const result = await API.doRead();
                await Utils.randomDelay(3000, 8000);
                // 任务已满时该接口依然返回 200 + p:0 + isDuplicate:false，
                // 所以不能只看返回值，必须用服务端进度增量判断这一篇是否真的计入。
                const after = await API.getReadProgress();
                if (after) {
                    const gained = after.progress - cur;
                    max = after.max;
                    if (gained > 0) {
                        successCount++;
                        stagnant = 0;
                        cur = after.progress;
                        Utils.log("📖", `阅读文章 ${i + 1}/${target} +${gained}积分（${cur}/${max}）`);
                    } else {
                        stagnant++;
                        Utils.log("🟡", `阅读文章 ${i + 1}/${target} 未计入进度（${after.progress}/${after.max}）`);
                    }
                } else if (result && result.points > 0) {
                    successCount++;
                    stagnant = 0;
                    cur += result.points;
                    Utils.log("📖", `阅读文章 ${i + 1}/${target} +${result.points}积分（进度查询失败，按返回值统计）`);
                } else {
                    stagnant++;
                    if (!result) {
                        Utils.log("🟡", `阅读第 ${i + 1} 篇请求失败`);
                    } else {
                        Utils.log("🟡", `阅读第 ${i + 1} 篇无新增积分（返回 p:${result.points}，isDuplicate:${result.isDuplicate}）`);
                    }
                }
                if (cur >= max) {
                    Utils.log("📖", `阅读进度已满（${cur}/${max}），提前结束`);
                    break;
                }
                if (stagnant >= 3) {
                    Utils.log("🟡", "连续 3 篇未计入进度，停止本轮阅读上报");
                    break;
                }
            }
            if (successCount === 0) {
                this.readTimes++;
                Utils.log("🟡", "本轮阅读未产生积分，稍后重试");
                return;
            }
            const verify = await API.getReadProgress();
            if (verify && verify.progress >= verify.max) {
                this.readDate = RewardsAuto.state.dateNowNum;
                this.save();
                Utils.log("🔵", `阅读任务完成！共 ${successCount} 篇`, true);
            } else {
                this.readTimes++;
                Utils.log("🟡", `阅读已执行但未完成（${verify ? `${verify.progress}/${verify.max}` : "进度未知"}），下次继续`);
            }
        },

        /** 读取阅读任务进度并带重试：后台 DAPI 偶发失败，一次失败不应放弃整个阅读任务 */
        async readProgressWithRetry(attempts = 3) {
            for (let i = 1; i <= attempts; i++) {
                const p = await API.getReadProgress();
                if (p) return p;
                if (i < attempts) {
                    Utils.log("🟡", `阅读进度读取失败，${i}/${attempts} 次重试`);
                    await Utils.delay(3210);
                }
            }
            return false;
        },

        async doPromos() {
            if (!GM_getValue("Tasks.promos", true) || this.promosTimes > 2) return true;
            if (this.promosDate === RewardsAuto.state.dateNowNum) {
                Utils.log("✅", "活动卡片已完成");
                return true;
            }
            Utils.log("🧩", "扫描活动卡片...");
            const cards = await API.discoverCards();
            if (cards.length === 0) {
                // 今天压根没有待办卡片（常见的全领完/当天没放卡）：这就是「已完成」，必须落日期。
                // 否则 promosDate 一直停在昨天，keep=false 时 isAllDone 永远为假，会无限空转。
                Utils.log("✅", "未发现待处理活动卡片");
                this.promosDate = RewardsAuto.state.dateNowNum;
                this.save();
                return true;
            }
            Utils.log("🧩", `发现 ${cards.length} 个卡片`);
            // 用户关掉 Quiz 时，Quiz 卡片本轮本来就不处理，判定「是否还有未完成」时也不该算它，
            // 否则这类卡片会让当天永远无法判定完成。
            const shouldSkip = (card) => card.kind === "quiz" && !GM_getValue("Tasks.quiz", true);
            let ok = 0, fail = 0;
            for (const card of cards) {
                await RegionGuard.guard("活动卡片");
                Utils.log("  ", `[${card.kind}] ${card.title} +${card.points}p`);
                if (shouldSkip(card)) continue;
                await Utils.randomDelay(3000, 8000);
                const result = await API.claimCard(card, { attempts: 2 });
                result ? ok++ : fail++;
            }
            // 以服务端状态为准：仍有未完成卡片时不标记当天完成，下次运行会继续重试
            let pending = 0;
            try {
                const map = await API.getPromotionMap(true);
                if (map) pending = cards.filter(c => !shouldSkip(c) && map.has(c.offerId) && !map.get(c.offerId).complete).length;
            } catch (_) {}
            if (pending === 0) {
                this.promosDate = RewardsAuto.state.dateNowNum;
                this.save();
            }
            Utils.log(pending === 0 ? "🔵" : "🟡",
                `活动完成: ${ok}成功/${fail}失败${pending > 0 ? `，仍剩 ${pending} 张未完成` : ""}（服务端已确认）`,
                pending === 0 && ok > 0);
            return pending === 0;
        },

        async doSearch() {
            if (!GM_getValue("Tasks.search", true)) return;
            const info = await API.getRewardsInfo();
            if (!info) { Utils.log("🔴", "无法获取积分信息"); return; }
            let progress = info.pc.progress;
            let max = info.pc.max;
            RewardsAuto.state.pcProgress = progress;
            RewardsAuto.state.pcMax = max;
            Utils.log("🔍", `搜索配额: PC ${progress}/${max}`);

            const markDone = () => {
                this.searchDate = RewardsAuto.state.dateNowNum;
                this.save();
                SEARCH_PACER.setPending(false);
                RewardsAuto.state.restrictedTimes = 0;
                GM_setValue("Config.restrictedTimes", 0);
                GM_setValue("Config.lastSearchProgress", -1);
            };

            if (progress >= max) {
                markDone();
                Utils.log("✅", `搜索配额已满 PC: ${progress}/${max}`);
                return;
            }
            if (this.searchDate === RewardsAuto.state.dateNowNum) {
                Utils.log("🟡", "搜索配额未满，继续执行搜索任务");
                this.searchDate = 0;
            }
            if (await API.checkSearchRestricted()) {
                // 被判定受限：只打上今天已处理，别清受限计数，否则下一轮又从 0 开始数
                this.searchDate = RewardsAuto.state.dateNowNum;
                this.save();
                SEARCH_PACER.setPending(false);
                return;
            }

            // 单轮搜索预算固定 20 分钟：原来的「单轮搜索最长时间（分钟）」调整框已从设置里移除，
            // 值不再可调，但预算、软/硬截止时间的计算与之前保持一致。
            const budgetMin = 20;
            const startedAt = Date.now();
            // 预算内正常搜；预算用完时只要还在持续记账就继续把这轮补满，最多熬到 hardDeadline。
            // 目的是「一轮尽量做满」，而不是到点就交班。
            const softDeadline = startedAt + budgetMin * 60 * 1000;
            const hardMin = Math.max(budgetMin, Math.min(45, budgetMin * 2 + 10));
            const hardDeadline = startedAt + hardMin * 60 * 1000;
            // 每轮都从最小间隔起步，绝不继承上一轮被放大的节拍
            let gap = SEARCH_PACER.startGap();
            let peakGap = gap;
            // 还差多少分、按每次 3 分估算还要搜几次，留一倍余量（记账会漏，得补搜）
            const needed = Math.max(1, Math.ceil((max - progress) / 3));
            const attemptCap = Math.min(SEARCH_PACER.MAX_ATTEMPTS, Math.max(12, needed * 2));
            let attempts = 0, credits = 0, sinceCredit = 0, verifyFails = 0;
            // 最近一次「真正记账」的时刻：判限流用它，而不是用连续未记账的次数
            let lastCreditAt = startedAt;
            // 本轮用过的搜索词，避免重复词被服务端忽略
            const usedQueries = new Set();
            const pickPoolWord = () => RewardsAuto.searchPool[Utils.randomRange(0, RewardsAuto.searchPool.length - 1)];

            Utils.log("🔍", `单轮预算 ${budgetMin} 分钟（还在记账就最多延到 ${Math.round(hardMin)} 分钟），起始节拍 ${Math.round(gap / 1000)} 秒，还差 ${Math.max(0, max - progress)} 分（约 ${needed} 次搜索）`);

            while (attempts < attemptCap && Date.now() < hardDeadline) {
                // 单轮可能跑十几分钟，顺手给运行锁和运行阶段续约，避免被别的上下文判成「已经挂了」
                Utils.refreshLock("Config.runLock");
                try { Sched.state("running"); } catch (_) {}

                // 出口闸门：单轮可能跑十几分钟，中途开梯子要能被拦下（有缓存，不会每次都真探测）
                await RegionGuard.guard("PC 搜索");

                attempts++;
                const iterStart = Date.now();
                let query;
                try {
                    query = RewardsAuto.apiConfig.mode !== "offline"
                        ? await API.getHotSearchWord()
                        : "";
                } catch (_) {
                    query = "";
                }
                if (!query) query = pickPoolWord();
                // 同一轮里尽量不复用同一个搜索词：重复词服务端大概率不记账，白白拉长节拍
                for (let i = 0; i < 5 && query && usedQueries.has(query); i++) query = pickPoolWord();
                if (query) usedQueries.add(query);
                Utils.log("🔍", `[PC] 第 ${attempts} 次搜索（记账 ${progress}/${max}，节拍 ${Math.round(gap / 1000)}s）：${query}`);

                try {
                    const html = await API.getSearchPage(query, false);
                    if (html) await API.reportSearch(html, query, false);
                } catch (e) {
                    if (e && e.regionBlocked) throw e;
                    Utils.log("🟡", `搜索失败: ${e.message}`);
                }

                // 观察窗：先给服务端记账的时间，再用轻量接口核对真实进度
                // 观察窗长度也随机，别每次都精确 12 秒
                await Utils.delay(Utils.randomRange(SEARCH_PACER.OBSERVE_MIN, SEARCH_PACER.OBSERVE_MAX));
                const before = progress;
                let quota = await API.getPcQuota();
                // 记账常常有几秒延迟：第一次没变化再看一眼，别把「延迟」误判成「没记账」白退让
                if (quota && quota.progress <= before) {
                    await Utils.delay(Utils.randomRange(8000, 14000));
                    const again = await API.getPcQuota();
                    if (again) quota = again;
                }
                if (quota) {
                    verifyFails = 0;
                    if (quota.max > 0) max = quota.max;
                    if (quota.progress > before) {
                        progress = quota.progress;
                        credits++;
                        sinceCredit = 0;
                        lastCreditAt = Date.now();
                        // 记账顺利就直接回到用户设的最小间隔，不再一级一级衰减
                        gap = SEARCH_PACER.minMs();
                        Utils.log("✅", `记账成功 +${progress - before}（${progress}/${max}），节拍回到 ${Math.round(gap / 1000)} 秒`);
                    } else {
                        progress = Math.max(progress, quota.progress);
                        sinceCredit++;
                        gap = Math.min(SEARCH_PACER.MAX_MS, Math.round(gap * SEARCH_PACER.GROW));
                        peakGap = Math.max(peakGap, gap);
                        Utils.log("🟡", `本次未记账（${progress}/${max}，连续 ${sinceCredit} 次），节拍放慢到 ${Math.round(gap / 1000)} 秒`);
                    }
                } else {
                    // 核对接口不可用：按每搜 3 分乐观推进，避免原地死循环；后续核对成功会自动校正回来
                    verifyFails++;
                    sinceCredit++;
                    progress = Math.min(max, progress + 3);
                    gap = Math.min(SEARCH_PACER.MAX_MS, Math.round(gap * SEARCH_PACER.GROW));
                    peakGap = Math.max(peakGap, gap);
                }
                RewardsAuto.state.pcProgress = progress;

                if (progress >= max) break;
                /* 判定限流只看「多久没有真正记账」，不看连续几次没记账：
                 * 服务端记账延迟几十秒很常见，按次数判会把每轮都判成限流。 */
                const noCreditMs = Date.now() - lastCreditAt;
                if (noCreditMs >= SEARCH_PACER.NO_CREDIT_LIMIT && attempts >= SEARCH_PACER.MIN_ATTEMPTS_BEFORE_GIVEUP) {
                    Utils.log("🟡", `连续 ${Math.round(noCreditMs / 60000)} 分钟没有任何记账（本轮 ${attempts} 次搜索），判定被限流，本轮收手（已记 ${progress}/${max}）`);
                    break;
                }
                if (verifyFails >= 6) {
                    Utils.log("🟡", `记账核对连续失败 ${verifyFails} 次，本轮按乐观估计结束（已记 ${progress}/${max}），下一轮用真实进度校正`);
                    break;
                }
                if (Date.now() + gap > hardDeadline) {
                    Utils.log("🟡", `已到本轮硬上限（${Math.round(hardMin)} 分钟），剩下的 ${Math.max(0, max - progress)} 分交给下一轮`);
                    break;
                }
                // 预算用完之后，只有「最近还在持续记账」才继续熬，否则交班，别白耗
                if (Date.now() + gap > softDeadline && Date.now() - lastCreditAt > SEARCH_PACER.RECENT_CREDIT) {
                    Utils.log("🟡", `本轮预算（${budgetMin} 分钟）已用完且最近 ${Math.round(SEARCH_PACER.RECENT_CREDIT / 60000)} 分钟没有新记账，剩下的 ${Math.max(0, max - progress)} 分交给下一轮`);
                    break;
                }
                // 节拍按「这一次搜索 → 下一次搜索」算：搜索本身、观察窗、二次核对花掉的时间
                // 都已经算在 gap 里了，所以日志里的「等待 N 秒」可能很短（7 秒也正常），
                // 真正两次搜索之间仍然隔着 gap 那么久，不会更密
                const cycle = SEARCH_PACER.jitter(gap);
                let wait = Math.max(5000, cycle - (Date.now() - iterStart));
                if (attempts % 5 === 0) wait += Utils.randomRange(20000, 60000);
                // 偶尔停下来「看一会儿结果」，整段时间里别只有等间隔的搜索
                else if (Math.random() < 0.08) wait += Utils.randomRange(60000, 150000);
                const aparts = Math.round((Date.now() - iterStart + wait) / 1000);
                Utils.log("⏳", `等待 ${(wait / 1000).toFixed(0)} 秒（两次搜索相隔约 ${aparts} 秒，含观察与核对）`);
                await Utils.delay(wait);
            }

            SEARCH_PACER.setLast({ attempts, credits, peak: Math.round(peakGap / 1000), at: Date.now() });
            SEARCH_PACER.saveGap(peakGap);
            const elapsed = Math.round((Date.now() - startedAt) / 1000);
            const finalInfo = await API.getRewardsInfo();
            if (finalInfo) {
                progress = finalInfo.pc.progress;
                max = finalInfo.pc.max || max;
                RewardsAuto.state.pcProgress = progress;
                RewardsAuto.state.pcMax = max;
            }
            const hitRate = attempts > 0 ? Math.round((credits / attempts) * 100) : 0;
            // 只有拿到服务端最终确认才算完成；核对接口全挂时按乐观估计算出的「满」不算数，
            // 留给下一轮用真实进度校正，免得把没记上的分当成已完成再也不搜
            if (finalInfo && progress >= max) {
                markDone();
                Utils.log("🔵",
                    `🔍 搜索任务完成！PC: ${progress}/${max}（本轮 ${attempts} 次搜索、记账 ${credits} 次，用时 ${elapsed}s，最高节拍 ${Math.round(peakGap / 1000)}s）`, true);
            } else {
                // 没满就把「提前续做」的标记立起来，调度下一轮 5 分钟后就来，不再干等 20 分钟
                SEARCH_PACER.setPending(true);
                Utils.log("🟡",
                    `搜索未满 PC: ${progress}/${max}，本轮 ${attempts} 次搜索、记账 ${credits} 次（${hitRate}%），用时 ${elapsed}s，最高节拍 ${Math.round(peakGap / 1000)}s，已安排提前续做`);
                this.save();
            }
        },

        async doDailySet() {
            const today = Utils.getTodayNum();
            const todayStr = Utils.getTodayStr();
            const processedKey = "Config.dailySetProcessed";
            let processed = GM_getValue(processedKey, []);
            if (!Array.isArray(processed) || processed[0]?.date !== today) processed = [];
            // 只信任「已被服务端确认完成」的卡片，避免假成功把当天卡片永久标记为已完成
            const doneIds = new Set(processed.filter(p => p && p.ok).map(p => p.offerId));

            const maxRounds = 3;
            let totalOk = 0, totalFail = 0, remain = -1;

            // 服务端记账有延迟且偶发限流，单轮容易「一张没完成」，故多轮：发现 → 领取 → 复核
            for (let round = 1; round <= maxRounds; round++) {
                await RegionGuard.guard("每日活动");
                Utils.log("📅", `第 ${round}/${maxRounds} 轮每日活动（服务端已确认 ${doneIds.size} 张）...`);
                await Utils.randomDelay(2000, 5000);

                let cards = [];
                let dapiOk = false;
                try {
                    // 优先用 DAPI 权威发现：不依赖页面 HTML，也不依赖浏览器 Cookie
                    const map = await API.getPromotionMap(true);
                    dapiOk = !!map;
                    cards = await API.discoverDailySetCards(map);
                    Utils.log("📅", `DAPI 发现 ${cards.length} 张未完成的日常活动卡片`);
                } catch (e) {
                    Utils.log("🟡", `DAPI 发现失败，回退网页解析: ${e.message}`);
                }
                // 只有 DAPI 不可用时才回退网页解析（DAPI 说「没有待办」就是真的没有）
                if (cards.length === 0 && !dapiOk) {
                    try {
                        const allCards = await API.discoverCards();
                        cards = allCards.filter(c => (c.kind === "daily" || c.offerId.includes("DailySet")) && !doneIds.has(c.offerId));
                    } catch (e) {
                        Utils.log("🟡", `网页卡片解析失败: ${e.message}`);
                    }
                }

                for (const card of cards) {
                    if (doneIds.has(card.offerId)) continue;
                    await RegionGuard.guard("每日活动领取");
                    Utils.log("📅", `领取每日活动: ${card.title} +${card.points}p`);
                    await Utils.randomDelay(3000, 6000);
                    const res = await API.claimCard(card, round === 1 ? { attempts: 2 } : {});
                    if (res) { totalOk++; doneIds.add(card.offerId); } else { totalFail++; }
                }

                // 每轮结束都以 DAPI 复核，只有真正完成的卡片才留在记录里
                remain = -1;
                try {
                    const map = await API.getPromotionMap(true);
                    if (map) {
                        const todays = [...map.values()].filter(i =>
                            (i.offerId.includes(RewardsAuto.appConfig.offerIds.dailySetPrefix) || i.dailySetDate === todayStr)
                            && (i.dailySetDate === todayStr || i.offerId.includes(String(today))));
                        remain = todays.filter(i => !i.complete).length;
                        for (const i of todays) {
                            if (i.complete) doneIds.add(i.offerId);
                            else doneIds.delete(i.offerId);
                        }
                    }
                } catch (_) {}
                GM_setValue(processedKey, [...doneIds].map(id => ({ date: today, offerId: id, ok: true })));

                if (remain === 0) break;
                if (cards.length === 0) break;          // 本轮无卡可领：交给下次运行，不空转等待
                if (round < maxRounds) {
                    const wait = Utils.randomRange(20000, 35000);
                    Utils.log("⏳", `仍有 ${remain < 0 ? "未知数量" : remain} 张未完成，${Math.round(wait / 1000)} 秒后进入下一轮`);
                    await Utils.randomDelay(wait, wait);
                }
            }

            // 服务端确认今天没有剩余卡片时落一个「今日已完成」标记：
            // 卡片可能早就被别的设备领完了，此时 processed 是空的，只认 processed 会让 keep=false 永远停不下来。
            if (remain === 0) GM_setValue("Config.dailySetDoneDate", today);
            else if (remain > 0) GM_setValue("Config.dailySetDoneDate", 0);

            if (totalOk > 0 || totalFail > 0 || remain > 0) {
                Utils.log(remain === 0 ? "🔵" : "🟡",
                    `每日活动完成: ${totalOk}成功/${totalFail}失败${remain > 0 ? `，仍剩 ${remain} 张未完成` : ""}（服务端已确认）`,
                    remain === 0);
            } else if (remain === 0) {
                Utils.log("✅", "每日活动已全部完成（服务端已确认）");
            }
            // 返回状态供 runAll 的 withRetry 判断：未完成则 60 秒后整体重试
            this.dailySetSummary = remain >= 0
                ? `${doneIds.size} 张已完成${remain > 0 ? `，剩 ${remain} 张` : ""}`
                : `${doneIds.size} 张已完成（服务端状态未知）`;
            if (remain < 0) return true;   // DAPI 不可用，重试也没有意义
            return remain === 0;
        },

        /** 只是读一下 dashboard 上「可领取」的积分并提示手动领取：
         *  纯读操作，不写任何任务日期，也不参与 isAllDone 的完成判定 ——
         *  这些积分无论领没领，都不影响「今日任务已全部完成、停止检测」的判断。 */
        async doClaimPoints() {
            await RegionGuard.guard("领取积分");
            try {
                const dashboardHtml = await Utils.xhr({ url: "https://rewards.bing.com/dashboard" });
                if (!dashboardHtml) {
                    Utils.log("✅", "无法获取 dashboard 页面");
                    return;
                }
                const claimableMatch = dashboardHtml.match(/alt="可领取"[^>]*>[\s\S]*?(\d[\d,]*)/i);
                if (!claimableMatch) {
                    Utils.log("✅", "无可领取积分");
                    return;
                }
                const amount = parseInt(claimableMatch[1].replace(/,/g, '')) || 0;
                if (amount > 0) {
                    Utils.log("🎁", `发现 ${amount} 积分待领取（请手动前往 dashboard 领取）`, true);
                } else {
                    Utils.log("✅", "可领取积分为 0");
                }
            } catch (e) {
                Utils.log("🟡", `检测可领取积分失败: ${e.message}`);
            }
        },

        async doStreak() {
            await RegionGuard.guard("连签检测");
            Utils.log("📅", "开始检测连签任务...");
            // 先用 DAPI 读取权威状态（不依赖页面 DOM / 浏览器 Cookie）
            try {
                const map = await API.getPromotionMap(true);
                if (map) {
                    const streak = map.get(RewardsAuto.appConfig.offerIds.streakCounter);
                    if (streak && streak.progress > 0) {
                        this.streakDays = streak.progress;
                        Utils.log("📅", `每日连续打卡：${this.streakDays} 天（DAPI 权威值）`);
                    }
                    const todayStr = Utils.getTodayStr();
                    const children = [...map.values()].filter(i =>
                        i.offerId.includes(RewardsAuto.appConfig.offerIds.dailySetPrefix) && i.dailySetDate === todayStr);
                    if (children.length > 0) {
                        const done = children.filter(i => i.complete).length;
                        Utils.log(done >= children.length ? "✅" : "📅", `每日连续打卡活动：${done}/${children.length} 张已完成`);
                    }
                }
            } catch (_) {}
            try {
                const earnHtml = await Utils.xhr({ url: "https://rewards.bing.com/earn" });
                if (!earnHtml) { Utils.log("🟡", "无法获取 earn 页面"); return; }
                const text = earnHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
                const streakDaysMatch = text.match(/每日连续打卡\s*(\d+)/);
                if (streakDaysMatch) {
                    this.streakDays = parseInt(streakDaysMatch[1]) || 0;
                    Utils.log("📅", `每日连续打卡：${this.streakDays} 天`);
                }
                const taskPatterns = [
                    { name: "必应搜索连续打卡", pattern: /必应搜索连续打卡[\s\S]*?搜索:\s*(\d+)\/(\d+)/ },
                    { name: "每日连续打卡活动", pattern: /每日连续打卡活动[\s\S]*?活动:\s*(\d+)\/(\d+)/ },
                    { name: "必应应用连续打卡", pattern: /必应应用连续打卡[\s\S]*?签到:\s*(\d+)\/(\d+)/ },
                    { name: "视觉搜索连续打卡", pattern: /视觉搜索连续打卡[\s\S]*?活动:\s*(\d+)\/(\d+)/ },
                ];
                let visualSearchDone = true;
                for (const { name, pattern } of taskPatterns) {
                    const m = text.match(pattern);
                    if (m) {
                        const cur = parseInt(m[1]), max = parseInt(m[2]);
                        const done = cur >= max;
                        Utils.log(done ? "✅" : "📅", `${name}: ${cur}/${max}${done ? " 已完成" : ""}`);
                        if (name === "视觉搜索连续打卡" && !done) visualSearchDone = false;
                    }
                }
                if (!visualSearchDone) {
                    Utils.log("📅", "视觉搜索未完成，尝试后台打卡...");
                    try {
                        await Utils.xhr({
                            url: "https://www.bing.com/?features=vsstreak,vstooltip&form=ML2XES",
                            headers: {
                                "user-agent": RewardsAuto.ua.pc,
                                "referer": "https://www.bing.com/"
                            }
                        });
                        Utils.log("✅", "视觉搜索打卡请求已发送（后台）");
                        await Utils.randomDelay(3000, 5000);
                    } catch (e) {
                        Utils.log("🟡", `视觉搜索打卡失败: ${e.message}`);
                    }
                }
                const stampMatch = text.match(/(\d+)\s*个印章/) || text.match(/印章\s*(\d+)/);
                if (stampMatch) {
                    Utils.log("📅", `连签奖励印章进度: ${stampMatch[1]}/12`);
                }
                Utils.log("📅", "连签任务检测完成，未完成任务将由活动卡片模块处理");
            } catch (e) {
                Utils.log("🔴", `连签任务异常: ${e.message}`);
            }
        },

        async runAll() {
            if (this.running && Date.now() - (this.runningSince || 0) < RUN_STALE) {
                Utils.log("🟡", "任务正在运行中，请勿重复触发");
                return;
            }
            if (this.running) {
                // 上一轮在后台沙盒里被冻结，finally 没跑到，标记残留在内存里；
                // 不清理的话之后每一轮都会在这里被挡掉，只能靠手动「立即运行」。
                Utils.log("🟡", "上一轮的运行标记是残留的（上下文被冻结过），清理后继续");
                this.running = false;
            }
            Utils.log("▶️", `本轮进入执行流程（${Utils.hasDOM() ? "页面" : "后台"}上下文）`);
            // 跨上下文互斥：后台实例与 rewards 标签页会同时跑，并发会重复上报并互相踢 Token
            if (!Utils.acquireLock("Config.runLock", 45 * 60 * 1000)) {
                Utils.log("⏳", "另一个上下文正在运行任务，本次跳过（避免并发重复上报）");
                return;
            }
            this.running = true;
            this.runningSince = Date.now();
            Sched.state("running");
            try {
                // 后台常驻实例会跨轮次复用，这几个「本轮重试次数」必须每轮归零，
                // 否则累计到 3 次失败后就再也不重试（旧版 @crontab 每轮新实例，天然为 0）。
                this.signTimes = 0;
                this.readTimes = 0;
                this.promosTimes = 0;
                RewardsAuto.state.startTime = Utils.getTimestamp();
                Utils.log("🚀", "启动全能自动化任务...");
                this.init();
                // 先验出口、再碰任何微软接口：原来先 getBalance 再 checkRegion，
                // 等于「出口还没确认就先给 rewards 打了一枪」，正好是最该避免的那一下。
                if (!(await API.checkRegion())) {
                    Utils.log("🛑", "出口检测未通过：本轮不发任何微软请求，关掉 VPN/梯子（或恢复直连）后会自动恢复");
                    return;
                }
                const startBalance = await API.getBalance();
                Utils.log("📊", `初始积分: ${startBalance}`);
                let isTokenOK = await API.renewToken();
                if (!isTokenOK) Utils.log("🟡", "Token失败，跳过签入/阅读", true);
                const retryDelay = 60000;
                const maxRetries = 2;
                const withRetry = async (taskFn, taskName, retries = 0) => {
                    Utils.refreshLock("Config.runLock");   // 长任务期间持续续约，避免锁过期被别人抢走
                    try {
                        const result = await taskFn();
                        if (result === false && retries < maxRetries) {
                            Utils.log("🟡", `${taskName} 失败，${retryDelay/1000}秒后重试 (${retries + 1}/${maxRetries})`);
                            await Utils.delay(retryDelay);
                            return withRetry(taskFn, taskName, retries + 1);
                        }
                        return result;
                    } catch (e) {
                        // 出口被拦截：整轮立刻收手，重试只会多发几次请求
                        if (e && e.regionBlocked) throw e;
                        if (retries < maxRetries) {
                            Utils.log("🟡", `${taskName} 异常: ${e.message}，${retryDelay/1000}秒后重试`);
                            await Utils.delay(retryDelay);
                            return withRetry(taskFn, taskName, retries + 1);
                        }
                        Utils.log("🔴", `${taskName} 失败: ${e.message}`);
                        return false;
                    }
                };
                if (isTokenOK) {
                    await withRetry(() => this.doSign(), "签到");
                    await Utils.randomDelay();
                    // 阅读走 App/DAPI 通道（Bearer Token），与 PC 会话 Cookie 无关：
                    // 后台上下文里 PC 通道必然 401，不能用它来把关阅读任务。
                    if (RewardsAuto.state.pc401) {
                        Utils.log("🟡", "PC 会话不可用（只影响 PC 通道任务），阅读改用 App 通道继续执行");
                    }
                    await withRetry(() => this.doRead(), "阅读");
                    await Utils.randomDelay();
                } else {
                    await withRetry(() => this.doSign(), "签到");
                    await Utils.randomDelay();
                }
                await withRetry(() => this.doPromos(), "活动卡片");
                await Utils.randomDelay();
                await withRetry(() => this.doSearch(), "搜索");
                await withRetry(() => this.doStreak(), "连签检测");
                await Utils.randomDelay();
                Utils.log("📅", "开始执行每日活动任务...");
                await Utils.randomDelay();
                const dailySetRes = await withRetry(() => this.doDailySet(), "每日活动");
                try {
                    await this.doClaimPoints();
                } catch (e) {
                    if (e && e.regionBlocked) throw e;
                    Utils.log("🟡", `领取积分执行异常: ${e.message}`);
                }
                Utils.log("🔄", "二次扫描：检查是否有新解锁的卡片...");
                await Utils.randomDelay(3000, 8000);
                const newCards = await API.discoverCards();
                if (newCards.length > 0) {
                    Utils.log("🧩", `二次扫描发现 ${newCards.length} 个新卡片`);
                    let ok = 0, fail = 0;
                    for (const card of newCards) {
                        await RegionGuard.guard("二次扫描");
                        Utils.log("  ", `[${card.kind}] ${card.title} +${card.points}p`);
                        if (card.kind === "quiz" && !GM_getValue("Tasks.quiz", true)) continue;
                        await Utils.randomDelay(3000, 8000);
                        const result = await API.claimCard(card);
                        result ? ok++ : fail++;
                    }
                    Utils.log("🔵", `二次扫描完成: ${ok}成功/${fail}失败`);
                } else {
                    Utils.log("✅", "二次扫描：无新卡片");
                }
                // Edge 浏览连签：后台累计 30 分钟才记账，这里每轮至少推进一次
                //（常驻调度的心跳里还有节拍器按 report_per_minutes 的节奏续报）
                Utils.log("🌐", "检查 Edge 浏览连签进度...");
                await EdgePacer.maybeReport();
                const endTime = Utils.getTimestamp();
                const totalTime = ((endTime - RewardsAuto.state.startTime) / 1000).toFixed(1);
                const endBalance = await API.getBalance();
                const earned = (startBalance > 0 && endBalance > 0) ? (endBalance - startBalance) : 0;
                const info = await API.getRewardsInfo();
                if (info) {
                    const signOk = this.signDate === RewardsAuto.state.dateNowNum;
                    const readOk = this.readDate === RewardsAuto.state.dateNowNum;
                    const searchOk = info.pc.progress >= info.pc.max;
                    const promosOk = this.promosDate === RewardsAuto.state.dateNowNum;
                    let logMsg = `签到\t\t${signOk ? '✅' : '❌'}\n`;
                    const readProg = info.readProgress ?? RewardsAuto.state.readProgress ?? 0;
                    const readMaxProg = info.readMax ?? RewardsAuto.state.readMax ?? 30;
                    logMsg += `阅读\t\t${readOk ? '✅' : '❌'} ${readProg}/${readMaxProg}\n`;
                    // 搜索没跑满时把「当前节拍」一起报出来，方便判断是被限流还是单纯没搜完
                    const pacer = SEARCH_PACER.summary();
                    logMsg += `PC 搜索\t${searchOk ? '✅' : '⏳'} ${info.pc.progress}/${info.pc.max}${searchOk ? '' : `（每轮从 ${pacer.min}s 起步${pacer.last ? `，上轮 ${pacer.last.attempts} 搜/${pacer.last.credits} 记` : ''}）`}\n`;
                    logMsg += `活动卡片\t${promosOk ? '✅' : '❌'}\n`;
                    logMsg += `每日活动\t${dailySetRes ? '✅' : '❌'} ${this.dailySetSummary || ''}\n`;
                    logMsg += `连签\t\t${this.streakDays || 0} 天\n`;
                    const edge = EdgeStreak.summary();
                    if (edge) logMsg += `Edge连签\t${edge.done ? '✅' : edge.skipped ? '⏭️' : '⏳'} ${edge.text}\n`;
                    logMsg += `今日获取\t+${earned}\n`;
                    logMsg += `总积分\t\t${info.balance || endBalance}`;
                    RewardsAuto.state.sendMSG = logMsg;
                    Utils.log("📊", logMsg, true);
                } else {
                    Utils.log("🎉", `任务执行完成！用时 ${totalTime} 秒`, true);
                }
                // 关掉「持续检测」时：这一轮结束如果已经全部完成就当场收工，
                // 不必等 20 分钟后下一轮再来判定（否则会白跑一轮空任务）。
                if (!GM_getValue("Config.keep", true) && isDayComplete()) markDayComplete();
            } catch (e) {
                if (e && e.regionBlocked) {
                    // 出口被拦截：本轮已发的请求到此为止，20 分钟后再看一次出口
                    Utils.log("🛑", `本轮已中止：${e.message}`);
                } else {
                    Utils.log("🔴", `本轮任务异常终止: ${e.message}`);
                }
            } finally {
                Utils.releaseLock("Config.runLock");
                this.running = false;
                this.runningSince = 0;
                Sched.state("done");   // 拿到锁的那一轮才走到这里，可以放心把阶段标成结束
            }
        }
    };

    GM_registerMenuCommand("🔑 手动授权", () => {
        try {
            GM_openInTab(Auth.authUrl, { active: true });
            Utils.log("🟡", "已打开微软授权页：登录后会自动捕获授权码并换取 Token（无需手动复制）");
        } catch (e) {
            Utils.uiAlert(`❌ 无法打开授权页：${e.message}\n\n请手动访问：\n${Auth.authUrl}`);
        }
    });

    // 后台 service_worker 没有 prompt，统一走 Utils.uiPrompt（无 DOM 时打开页面弹输入框）
    GM_registerMenuCommand("📋 粘贴授权码", () => { Auth.pasteFlow().catch(e => Utils.log("🔴", `粘贴授权码失败：${e.message}`)); });

    GM_registerMenuCommand("📊 Token状态", () => {
        const token = GM_getValue("Config.token", false);
        const time = Number(GM_getValue("Config.tokenTime", 0)) || 0;
        let ageStr = "未知";
        if (time > 0) {
            const diff = Utils.getTimestamp() - time;
            const days = Math.floor(diff / 86400000);
            const hours = Math.floor((diff % 86400000) / 3600000);
            const minutes = Math.floor((diff % 3600000) / 60000);
            const parts = [];
            if (days > 0) parts.push(`${days}天`);
            if (hours > 0) parts.push(`${hours}小时`);
            parts.push(`${minutes}分钟`);
            ageStr = parts.join("");
        }
        const tokenDate = time > 0 ? new Date(time).toLocaleString("zh-CN") : "未知";
        const rawCode = GM_getValue("Config.code", "");
        const parsed = rawCode ? Auth.parseCode(rawCode) : null;
        const codeUsed = !!(parsed && Auth.used(parsed));
        const codeStr = !rawCode
            ? "无"
            : (!parsed
                ? `有但无法解析（长度 ${String(rawCode).length}）`
                : `有（${Auth.preview(parsed)}${codeUsed ? "，已兑换为 Token，保留中" : "，尚未兑换"}）`);
        Utils.uiAlert(
            `Token: ${token ? "已保存" : "无"}\n` +
            `获取时间: ${tokenDate}\n` +
            `已过: ${ageStr}\n` +
            `授权码: ${codeStr}`
        );
    });

    // 原「🌐 Edge 连签状态」菜单已移除：不再注册菜单按钮、不再弹窗，逻辑照旧（仍会立刻推进一次上报），
    // 需要看这段状态文本时在控制台调用 __MPDiagnostics.edgeStreak()。
    const diagEdgeStreak = () => {
        const enabled = GM_getValue("Tasks.edge", true);
        const st = EdgeStreak.state();
        const total = st.total || Math.ceil(EDGE.TARGET_MINUTES / Math.max(1, st.intervalMin));
        const waitMs = (!st.complete && st.count > 0 && st.last)
            ? Math.max(0, st.last + st.intervalMin * 60000 - Date.now()) : 0;
        let text = "🌐 Edge 浏览连签\n\n";
        text += `任务开关：${enabled ? "开启" : "关闭"}\n`;
        text += `上报进度：${Math.min(st.count, total)}/${total} 次（每次覆盖 ${st.intervalMin} 分钟，满 ${EDGE.TARGET_MINUTES} 分钟记账）\n`;
        text += `服务端状态：${st.complete ? "✅ 已完成" : (st.giveUp ? "⏭️ 今日已跳过" : "⏳ 未完成")}\n`;
        text += `上次上报：${st.last ? new Date(st.last).toLocaleString("zh-CN") : "无"}\n`;
        if (waitMs > 0) text += `下次上报：约 ${Math.ceil(waitMs / 60000)} 分钟后\n`;
        text += `活动激活：${st.activated ? "已尝试" : "未尝试"}${st.extra ? `（已重来 ${st.extra}/${EDGE.MAX_EXTRA_ROUNDS} 轮）` : ""}\n`;
        text += `客户端：${RewardsAuto.ua.edge}\n\n`;
        text += "现在立刻推进一次（不足一个计费窗口会自动跳过，不刷接口）。";
        EdgePacer.nextAt = 0;
        EdgePacer.maybeReport().catch(e => Utils.log("🟡", `Edge 连签手动推进失败：${e.message}`));
        return text;
    };

    // 原「🔍 PC 搜索诊断」菜单已移除：不再注册菜单按钮、不再弹窗，逻辑照旧（仍会立刻单独跑一次 PC 搜索），
    // 需要看这段状态文本时在控制台调用 __MPDiagnostics.pcSearch()。
    const diagPcSearch = async () => {
        const pacer = SEARCH_PACER.summary();
        const restricted = Number(GM_getValue("Config.restrictedTimes", 0)) || 0;
        let text = "🔍 PC 搜索诊断\n\n";
        text += `任务开关：${GM_getValue("Tasks.search", true) ? "开启" : "关闭"}\n`;
        text += `最小间隔：${pacer.min} 秒（Config.span，两次搜索之间不会快于它，只会更慢）\n`;
        text += `每轮起始节拍：${pacer.min} 秒（每轮重置，不继承上一轮被放大的节拍）\n`;
        text += `单轮内退让上限：${SEARCH_PACER.MAX_MS / 1000} 秒；连续 ${SEARCH_PACER.NO_CREDIT_LIMIT / 60000} 分钟没记账则本轮收手\n`;
        if (pacer.last) {
            text += `上一轮：${pacer.last.attempts} 次搜索 / 记账 ${pacer.last.credits} 次（最高节拍 ${pacer.last.peak} 秒）\n`;
        } else {
            text += `上一轮：还没有记录\n`;
        }
        text += `单轮预算：20 分钟（固定，不可调）\n`;
        text += `提前续做：${pacer.pending ? "已排程（本轮没搜满）" : "无"}\n`;
        text += `限流计数：${restricted}/3\n`;
        text += `任务标记：${TaskManager.searchDate === RewardsAuto.state.dateNowNum ? "今日已完成" : "今日未完成"}\n\n`;
        const info = await API.getRewardsInfo();
        if (info) text += `服务端配额：PC ${info.pc.progress}/${info.pc.max}\n`;
        else text += "服务端配额：读取失败\n";
        text += "\n调用后会立刻单独跑一次 PC 搜索（日志里能看到每次是否真的记账）。";
        // 和常驻调度共用一把锁，避免诊断和正式那一轮同时搜
        if (!Utils.acquireLock("Config.runLock", 45 * 60 * 1000)) {
            Utils.log("🟡", "已有一轮任务在跑，搜索诊断跳过");
            return;
        }
        Promise.resolve()
            .then(() => TaskManager.doSearch())
            .catch(e => Utils.log("🔴", `搜索异常：${e && e.message ? e.message : e}`))
            .finally(() => Utils.releaseLock("Config.runLock"));
        return text;
    };

    GM_registerMenuCommand("🚀 立即运行", () => {
        Utils.log("🚀", "手动触发：立即运行一轮");
        Promise.resolve()
            .then(() => TaskManager.runAll())
            .catch(e => Utils.log("🔴", `本轮任务异常：${e && e.message ? e.message : e}`))
            .finally(() => Sched.finish(true));   // 手动跑过的这一轮也算数，顺延到下一次计划
    });

    GM_registerMenuCommand("🔔 配置通知接口", async () => {
        const configNames = [
            { key: "Notice.wework", name: "企业微信 Webhook", hint: "群机器人webhook key" },
            { key: "Notice.dingding", name: "钉钉机器人 Access Token", hint: "不加签，关键词需包含 #" },
            { key: "Notice.feishu", name: "飞书机器人 Webhook", hint: "不加签，关键词需包含 #" },
            { key: "Notice.pushme", name: "PushMe Key", hint: "push.i-i.me 推送key" },
            { key: "Notice.bark", name: "Bark Key", hint: "bark.day.app 推送key" }
        ];
        let configStr = "🔔 通知接口配置\n==================\n\n";
        configNames.forEach((item, index) => {
            const saved = GM_getValue(item.key, "");
            configStr += `${index + 1}. ${item.name}\n   状态: ${saved ? "✅ 已配置" : "❌ 未配置"}\n   说明: ${item.hint}\n\n`;
        });
        configStr += "请输入要配置的编号 (1-5)，或输入 0 清除所有配置：";
        const choice = await Utils.uiPrompt(configStr);
        if (!choice) return;
        const num = parseInt(choice);
        if (num === 0) {
            if (Utils.uiConfirm("确定要清除所有通知接口配置吗？")) {
                configNames.forEach(item => GM_setValue(item.key, ""));
                Utils.uiAlert("所有通知接口配置已清除！");
            }
            return;
        }
        if (num >= 1 && num <= 5) {
            const selected = configNames[num - 1];
            const current = GM_getValue(selected.key, "");
            const newValue = await Utils.uiPrompt(`配置 ${selected.name}\n\n当前值: ${current || "(空)"}\n\n请输入新的值：`, current);
            if (newValue !== null) {
                GM_setValue(selected.key, newValue.trim());
                Utils.uiAlert(`${selected.name} 已${newValue.trim() ? "配置" : "清除"}！`);
            }
        } else {
            Utils.uiAlert("无效的编号！");
        }
    });

    GM_registerMenuCommand("📢 测试通知", () => {
        RewardsAuto.state.sendMSG = "🧪 这是一条测试消息\n如果你看到这条消息，说明通知接口配置成功！";
        Utils.log("📢", "测试通知已发送", true);
        Utils.uiAlert("测试消息已发送，请检查各通知渠道！");
    });

    const updateBroMenu = () => {
        const enabled = GM_getValue("Notice.bro", true);
        return enabled ? "🔕 关闭浏览器通知" : "🔔 开启浏览器通知";
    };
    GM_registerMenuCommand(updateBroMenu(), () => {
        const current = GM_getValue("Notice.bro", true);
        GM_setValue("Notice.bro", !current);
        Utils.uiAlert(`浏览器通知已${!current ? "开启" : "关闭"}`);
        try { if (Utils.hasDOM()) location.reload(); } catch (_) {}
    });

    GM_registerMenuCommand("📋 查看通知状态", () => {
        const wework = GM_getValue("Notice.wework", "");
        const dingding = GM_getValue("Notice.dingding", "");
        const feishu = GM_getValue("Notice.feishu", "");
        const pushme = GM_getValue("Notice.pushme", "");
        const bark = GM_getValue("Notice.bark", "");
        let status = "📊 通知接口配置状态：\n\n";
        status += `企业微信: ${wework ? "✅ 已配置" : "❌ 未配置"}\n`;
        status += `钉钉: ${dingding ? "✅ 已配置" : "❌ 未配置"}\n`;
        status += `飞书: ${feishu ? "✅ 已配置" : "❌ 未配置"}\n`;
        status += `PushMe: ${pushme ? "✅ 已配置" : "❌ 未配置"}\n`;
        status += `Bark: ${bark ? "✅ 已配置" : "❌ 未配置"}\n`;
        Utils.uiAlert(status);
    });

    // 「🌍 网络出口检测」菜单已移除：不再注册菜单按钮、不再弹窗，检测逻辑照旧（每个任务/心跳都会走闸门）。
    // 需要看这段状态文本时在控制台调用 __MPDiagnostics.region()。
    const diagRegion = async () => {
        const v = await RegionGuard.check({ fresh: true });
        let text = "🌍 网络出口检测\n\n";
        if (v.skipped) {
            text += "「锁定国区」已关闭：不做出口限制，也不拦代理。\n\n";
        } else {
            text += `结论：${v.ok ? "✅ 出口在大陆，可以继续" : "⛔ 已拦截，任务不会上报"}\n`;
            if (v.reasons.length) text += `原因：${v.reasons.join("；")}\n`;
        }
        text += `出口 IP：${v.ip || "未知"}\n`;
        if (v.ipInfo) text += `${v.ipInfo}\n`;
        // 分组显示：真正要紧的是「微软看到的出口」，第三方只是旁证
        const msSignals = v.signals.filter(s => /^bing=/.test(s));
        const otherSignals = v.signals.filter(s => !/^bing=/.test(s));
        text += `\n各路信号：\n`;
        text += `  微软侧（bing.com）：${msSignals.length ? msSignals.join(" ") : "（无）"}\n`;
        text += `  第三方/国内视角：${otherSignals.length ? otherSignals.join(" ") : "（无）"}\n`;
        if (v.failed && v.failed.length) text += `\n探测失败：\n${v.failed.map(s => `  ${s}`).join("\n")}\n`;
        text += "\n探测源：bing.com（不带 Cookie）/ cloudflare / ipinfo.io / api.ip.sb / 腾讯 IP 库\n";
        text += `结论缓存：通过 ${RegionGuard.TTL_OK / 1000} 秒、拦截 ${RegionGuard.TTL_BLOCK / 1000} 秒\n`;
        text += `「锁定国区」：${RegionGuard.enabled() ? "开启（非大陆出口、机房/代理 IP、WARP 都会停）" : "关闭"}`;
        if (!v.skipped && v.ok) {
            text += "\n\n规则模式提示：只有「微软侧」才是风控依据。bing.com 判定为 CN 就代表微软把你看成大陆；"
                + "若第三方也全 CN，说明梯子的规则没接管微软域名 —— 这正是最安全的用法。"
                + "想确认业务域名有没有漏走代理，去客户端「连接/日志」里搜 "
                + "rewards.bing.com、prod.rewardsplatform.microsoft.com、login.live.com，应显示 DIRECT。";
        }
        return text;
    };

    /* ===== 常驻调度 =====
     * 之前用 setInterval 每 60 秒检查一次，但 @background 的脚本跑在 ScriptCat 的沙盒里：
     * MV3 浏览器空闲约 30 秒就会回收 service worker / 冻结沙盒，里面的定时器跟着一起丢失，
     * 于是「跑完第一轮就再也没有日志」。现在五件事一起做：
     *   1) 心跳：每 20 秒做一次 GM 存储读写，持续给扩展续命，避免空闲回收；
     *   2) 自校正：每次都按「计划时间」重算下一次触发，不用 setInterval，不漂移也不堆积；
     *   3) 计划持久化：下次该跑的时间写进 Config.cronNextRun，任何新上下文（沙盒重建、
     *      页面加载、脚本重载）读到后——过期就立刻补一轮，没过期就接着等，节奏仍是 20 分钟；
     *   4) 认领 + 看门狗：触发时先记一个「认领」，真正跑起来（或整轮结束）才推进计划；
     *      认领后 CRON_STALL 内没跑起来，说明那个上下文被打断了，立刻补跑，不会白等一轮；
     *   5) 普通页面也参与调度，页面一刷新就能把停摆的调度救回来；真正的执行由
     *      TaskManager 的 Config.runLock 互斥，多个上下文同时到点也只会跑一轮。
     */
    const CRON_PERIOD = 20 * 60 * 1000;        // 一轮的间隔：保持原来的 20 分钟
    const CRON_HEARTBEAT = 20 * 1000;          // 心跳粒度，同时也是自校正的最大等待步长
    const CRON_FIRST_DELAY = 5 * 1000;         // 没有任何历史计划时，启动后多久跑第一轮
    const CRON_HEARTBEAT_LOG = 10 * 60 * 1000; // 心跳日志的最小间隔，避免刷屏
    const CRON_HEARTBEAT_LOG_IDLE = 60 * 60 * 1000; // 今日已完成、检测已停止时的心跳日志间隔（只用来续命，1 小时一条足够）
    const CRON_STALL = 3 * 60 * 1000;          // 触发之后迟迟没真正开始执行，超过这个时间就判定「这次触发丢了」
    const RUN_STALE = 40 * 60 * 1000;          // 运行标记超过这个时间还没释放，判定为残留（上下文被冻结过）

    const Sched = {
        timer: null,
        started: false,
        startedAt: 0,
        lastHbLog: 0,
        task: null,

        fmt(ts) {
            if (!ts) return "未知";
            const d = new Date(ts);
            const p = n => String(n).padStart(2, "0");
            return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        },

        lastRun() { return Number(GM_getValue("Config.cronLastRun", 0)) || 0; },

        // 下次该跑的时间：持久化的计划 > 上次运行时间 + 周期 > 启动后几秒
        plan(now = Date.now()) {
            const next = Number(GM_getValue("Config.cronNextRun", 0)) || 0;
            if (next) return next;
            const last = this.lastRun();
            return last ? last + CRON_PERIOD : now + CRON_FIRST_DELAY;
        },

        saveNext(ts) { GM_setValue("Config.cronNextRun", ts); },

        ctxName() { return Utils.hasDOM() ? "页面" : "后台"; },

        /* 触发先「认领」再执行，真正跑起来之前不推进计划。
         * 以前是触发瞬间就把 cronNextRun 推到 20 分钟后，那个上下文一旦被打断
         * （沙盒冻结、标签页被关），这一轮就白扔了，只能手动点「立即运行」。 */
        getClaim() {
            const c = GM_getValue("Config.cronClaim", null);
            return c && typeof c === "object" ? c : null;
        },
        claim() { GM_setValue("Config.cronClaim", { at: Date.now(), ctx: this.ctxName(), id: Utils.lockId() }); },
        clearClaim() { GM_setValue("Config.cronClaim", null); },

        /* 运行阶段也持久化：claimed → waiting → running → done。
         * 出问题时看日志或菜单就能分清是「没触发」「触发了但没跑起来」「正在跑」还是「跑完了」。 */
        state(phase, extra) {
            GM_setValue("Config.runState", Object.assign({ phase, at: Date.now(), ctx: this.ctxName() }, extra || {}));
        },
        getState() {
            const s = GM_getValue("Config.runState", null);
            return s && typeof s === "object" ? s : null;
        },

        // 是否真的有一轮在跑：以持久化的 running 阶段 + 超时为准，不用内存布尔值
        isBusy(now = Date.now()) {
            const s = this.getState();
            return !!(s && s.phase === "running" && now - (s.at || 0) < RUN_STALE);
        },

        // 一轮结束：认领作废 + 推进计划（推进计划只在这里做）
        finish(ok) {
            const now = Date.now();
            const claim = this.getClaim();
            // 这次触发是别的上下文认领的（自己只是被锁挡下来的那一方）：
            // 交给它那一轮结束时统一推进，别把节奏改乱
            if (claim && claim.id && claim.id !== Utils.lockId()) return;
            // 下一次按「这一轮被触发的时刻」往后推，保持原来 20 分钟一轮的节奏，
            // 不会因为每轮跑多久就把节奏越拖越长；跑超时了就 1 分钟后重来
            const base = (claim && claim.at) || now;
            this.clearClaim();
            GM_setValue("Config.cronLastRun", now);
            const next = base + CRON_PERIOD;
            let plan = next > now + 60 * 1000 ? next : now + 60 * 1000;
            // PC 搜索是唯一「一次只能记一点」的任务：没跑满就别干等 20 分钟，
            // 提前 5 分钟回来续做（搜索跑满后 doSearch 会把这个标记清掉）
            if (GM_getValue("Tasks.search", true) && SEARCH_PACER.isPending()) {
                const sooner = now + SEARCH_PACER.RETRY_GAP;
                if (sooner < plan) {
                    plan = sooner;
                    Utils.log("🔍", `PC 搜索未满，${Math.round(SEARCH_PACER.RETRY_GAP / 60000)} 分钟后提前续做`);
                }
            }
            this.saveNext(plan);
            this.state(ok ? "done" : "idle");
            if (ok) Utils.log("🕒", `本轮结束，下一轮 ${this.fmt(this.plan(now))}`);
        },

        start(task) {
            if (this.started) return;
            this.started = true;
            this.startedAt = Date.now();
            this.task = task;

            // 上一次留在（可能已经消失的）上下文里的认领，启动时直接作废并补跑；
            // 新鲜的认领说明还有个活着的上下文正在处理，别去抢
            const claim = this.getClaim();
            if (claim && claim.at) {
                const age = this.startedAt - claim.at;
                if (age > CRON_STALL) {
                    Utils.log("♻️", `上次触发（${claim.ctx || "未知"}）已过去 ${Math.round(age / 60000)} 分钟仍没跑完，重新补跑`);
                    this.clearClaim();
                }
            }

            const next = this.plan(this.startedAt);
            if (next > this.startedAt) this.saveNext(next);
            Utils.log("🕒", `常驻调度已启动（${this.ctxName()}上下文）：每 ${CRON_PERIOD / 60000} 分钟一轮，下一轮 ${this.fmt(next)}`);
            this.arm(true);   // 计划已经过期的话，这一次直接补跑
        },

        /* 重排下一次检查：正常情况下按「离计划还有多久」算，最长 CRON_HEARTBEAT（顺带续命）。
         * 计划已经过期时不能给 0 延时死等，否则 tick 会原地空转把 CPU 打满：
         * 只有刚启动、确实该立刻补跑的那一次才用 0，其余按心跳步长轮询。 */
        arm(immediate) {
            if (this.timer) clearTimeout(this.timer);
            const now = Date.now();
            const next = this.plan(now);
            let wait;
            if (next > now) wait = Math.min(next - now, CRON_HEARTBEAT);
            else if (immediate) wait = 0;
            else wait = CRON_HEARTBEAT;
            this.timer = setTimeout(() => this.tick(), wait);
        },

        /* 已经触发、却迟迟没真正开始执行（认领它的页面被关、沙盒被冻结、延时器丢了）：
         * 把这次认领作废并立刻补跑，不让一轮 20 分钟白白浪费。 */
        watchdog(now) {
            const claim = this.getClaim();
            if (!claim || !claim.at) return;
            if (this.isBusy(now)) return;              // 真的在跑，别打扰
            if (now - claim.at <= CRON_STALL) return;  // 还在容忍期内，再等等
            Utils.log("♻️", `上次触发（${claim.ctx || "未知"}）${Math.round((now - claim.at) / 60000)} 分钟内没有真正开始执行，现在补跑`);
            this.clearClaim();
            this.fire(now);
        },

        tick() {
            this.timer = null;
            try {
                const now = Date.now();
                // 这一行 GM 读本身就是一次扩展调用，能重置 MV3 的空闲计时，沙盒就不会被回收
                const next = this.plan(now);
                this.watchdog(now);
                // Edge 连签节拍器：借这次心跳顺带推进（内部有「计费窗口未到就不发请求」的判断）
                EdgePacer.maybeReport().catch(() => {});
                // 关掉持续检测（keep=false）且今日已全部完成：不再触发新一轮，
                // 只保留心跳（心跳本身是 MV3 续命用的 GM 读，跨到明天会自动恢复跑任务）。
                const stopped = !GM_getValue("Config.keep", true)
                    && (Number(GM_getValue("Config.doneDate", 0)) || 0) === Utils.getTodayNum();
                if (!stopped && now >= next && !this.getClaim()) {
                    this.fire(now);
                } else if (now - this.lastHbLog >= (stopped ? CRON_HEARTBEAT_LOG_IDLE : CRON_HEARTBEAT_LOG)) {
                    // 平时每 10 分钟留一条心跳日志，方便确认「还在持续检测」；已停止检测时改成 1 小时一条，只用来续命
                    this.lastHbLog = now;
                    GM_setValue("Config.heartbeatAt", now);
                    const tip = stopped
                        ? "，今日任务已全部完成、检测已停止，明天自动恢复"
                        : this.getClaim() ? "，本轮已触发，正在等它跑起来" : `，约 ${Math.round((next - now) / 60000)} 分钟后进入下一轮`;
                    Utils.log("💓", `常驻调度心跳：本次已运行 ${Math.round((now - this.startedAt) / 60000)} 分钟${tip}`);
                }
            } catch (e) {
                Utils.log("🔴", `常驻调度异常：${e && e.message ? e.message : e}`);
            }
            this.arm(false);
        },

        fire(now) {
            if (this.isBusy(now)) {
                // 真有一轮在跑：先排到 5 分钟后复查（别每 20 秒刷一条跳过日志），
                // 等那一轮结束时 finish() 会把计划覆盖成正常节奏
                this.saveNext(now + 5 * 60 * 1000);
                Utils.log("🟡", "上一轮任务还在执行中，本次触发跳过");
                return;
            }
            this.claim();
            this.state("claimed");
            Utils.log("⏰", `常驻调度：开始本轮任务（${this.ctxName()}上下文）`);
            try {
                this.task();
            } catch (e) {
                Utils.log("🔴", `本轮任务启动失败：${e && e.message ? e.message : e}`);
                this.clearClaim();
                this.saveNext(now + CRON_PERIOD);   // 别在失败里空转，等下一轮
            }
        }
    };

    // 上下文启动动作（读偏好、处理待粘贴的授权码），只做一次；与「跑任务」解耦，
    // 页面加载不再无条件跑一轮，什么时候跑交给下面的常驻调度决定。
    let bootstrapped = false;
    const bootstrap = () => {
        if (bootstrapped) return;
        bootstrapped = true;
        TaskManager.init();

        // 后台点「📋 粘贴授权码」时会置 Config.pendingPaste 并打开页面，
        // 页面侧在加载 / 获得焦点时把输入框补弹出来。
        const consumePendingPaste = () => {
            if (!GM_getValue("Config.pendingPaste", false) || !Utils.hasDOM()) return false;
            GM_setValue("Config.pendingPaste", false);
            // document-start 时页面还没渲染完，等 body 就绪再弹，否则原生 prompt 会被浏览器吞掉
            Utils.waitForBody().then(ok => {
                if (!ok) return;
                setTimeout(() => {
                    Auth.pasteFlow().catch(e => Utils.log("🔴", `粘贴授权码失败：${e.message}`));
                }, 500);
            });
            return true;
        };
        if (!consumePendingPaste() && Utils.hasDOM()) {
            window.addEventListener("focus", () => {
                setTimeout(() => consumePendingPaste(), 300);
            }, { once: false });
        }
    };

    /** 「今日任务是否全部完成」的唯一判定：keep=false 时用它决定是否彻底停止检测。
     *  - 只看各任务自己落下的完成日期，以及服务端确认过的标记；
     *  - 「🎁 可领取积分」只是读 dashboard 的提示，不参与判定（领不领都不影响停检测）；
     *  - 每次都重新读一遍今天的日期和任务日期：后台上下文会跨零点常驻，不刷新就会拿昨天的日期比较。
     */
    const isDayComplete = () => {
        TaskManager.init();
        const today = RewardsAuto.state.dateNowNum;
        const checkDone = (enabled, date) => !enabled || date === today;
        // 每日活动两个来源都算完成：(1) 今日确实领过卡片（processed 非空）；
        // (2) DAPI 复核确认「今天没有剩余卡片」时记下的 dailySetDoneDate ——
        //     卡片早就在别的设备领完时 processed 是空的，只认 (1) 永远停不下来。
        const processed = GM_getValue("Config.dailySetProcessed", []);
        const dailySetDone = (Array.isArray(processed) && processed.length > 0 && processed[0]?.date === today)
            || (Number(GM_getValue("Config.dailySetDoneDate", 0)) || 0) === today;
        // Edge 浏览连签要靠「分次上报」累计 30 分钟，没确认完成前不能算今日已完成，
        // 否则 keep=false 时其它任务一跑完调度就停，它永远凑不满
        const edgeDone = !GM_getValue("Tasks.edge", true)
            || !GM_getValue("Config.token", false)   // 没授权时它本来也跑不了，别让调度空转
            || (() => { const st = EdgeStreak.state(); return st.complete || st.giveUp; })();
        return checkDone(GM_getValue("Tasks.sign"), TaskManager.signDate) &&
               checkDone(GM_getValue("Tasks.read"), TaskManager.readDate) &&
               checkDone(GM_getValue("Tasks.promos"), TaskManager.promosDate) &&
               checkDone(GM_getValue("Tasks.search"), TaskManager.searchDate) &&
               dailySetDone &&
               edgeDone;
    };

    /** 落「今日已完成」标记（Sched.tick 看到它就不再触发新一轮），只打一次日志，不刷屏 */
    const markDayComplete = () => {
        const today = RewardsAuto.state.dateNowNum;
        const prev = Number(GM_getValue("Config.doneDate", 0)) || 0;
        GM_setValue("Config.doneDate", today);
        if (prev !== today) Utils.log("💤", "今日任务已全部完成，已停止检测（明天自动恢复）", true);
    };

    const init = () => {
        bootstrap();

        const isKeep = GM_getValue("Config.keep", true);
        if (!isKeep && isDayComplete()) {
            // 关掉持续检测后：今日任务全部完成就彻底停止跑任务，只留调度心跳跨到明天自动恢复。
            markDayComplete();
            Sched.finish(false);   // 这一轮什么都没做也要推进计划，否则会每 20 秒重试一次
            return;
        }
        // 延时只用来错开多个上下文、别和人工操作撞车：越短越不容易被冻结/关页打断
        const delay = Utils.randomRange(3000, 12000);
        Utils.log("⏳", `${(delay / 1000).toFixed(1)} 秒后启动...`);
        Sched.state("waiting", { runAt: Date.now() + delay });
        setTimeout(() => {
            // runAll 内部抛错会变成 unhandled rejection 直接逃出定时器回调，
            // 之后就整轮没日志了，这里兜一下；结束时（成功/跳过/异常）统一推进到下一轮
            Promise.resolve()
                .then(() => TaskManager.runAll())
                .catch(e => Utils.log("🔴", `本轮任务异常：${e && e.message ? e.message : e}`))
                .finally(() => Sched.finish(true));
        }, delay);
    };

    // 已移除删除 _EDGE_S Cookie 的逻辑：那是 Edge 专属积分标识，且缺少 GM_cookie 时会抛错中断初始化

    const isBingSearchPage = typeof location !== "undefined"
        && location.hostname
        && (location.hostname === "www.bing.com" || location.hostname === "cn.bing.com");

    if (IS_OAUTH_CALLBACK) {
        // 授权回调页：捕获 code → 立刻换 Token → 提示并关闭页面
        Auth.handleCallback().catch(e => Utils.log("🔴", `授权回调处理失败：${e.message}`));
        return;
    }

    // Bing 搜索页是脚本自己打开的：既不初始化，也不参与调度，免得开出一堆标签页
    if (isBingSearchPage) {
        GM_log("⏭️ 当前为 Bing 搜索页，跳过脚本初始化（防止重复执行/打开多余页面）");
        return;
    }

    // 先做一次启动动作（读偏好、处理待粘贴授权码，幂等），再交给常驻调度决定何时跑任务
    bootstrap();
    Sched.start(init);

    // 原「🕒 查看调度状态」菜单已移除：不再注册菜单按钮、不再弹窗，
    // 需要看这段状态文本时在控制台调用 __MPDiagnostics.schedule()。
    const diagSchedStatus = () => {
        const now = Date.now();
        const next = Sched.plan(now);
        const last = Sched.lastRun();
        const st = Sched.getState();
        const claim = Sched.getClaim();
        const phaseText = { claimed: "已触发，等待执行", waiting: "等待延时结束", running: "正在执行", done: "上一轮已完成", idle: "空闲" };
        let text = "🕒 常驻调度状态\n\n";
        text += `调度间隔：${CRON_PERIOD / 60000} 分钟\n`;
        text += `最近结束：${Sched.fmt(last)}\n`;
        text += `下次触发：${Sched.fmt(next)}（约 ${Math.max(0, Math.ceil((next - now) / 60000))} 分钟后）\n`;
        text += `运行阶段：${st ? (phaseText[st.phase] || st.phase) : "未知"}${st && st.ctx ? `（${st.ctx}，${Sched.fmt(st.at)}）` : ""}\n`;
        if (claim) text += `当前认领：${claim.ctx || "未知"}，${Sched.fmt(claim.at)}\n`;
        text += `本次上下文：${Sched.ctxName()}（已运行 ${Math.round((now - Sched.startedAt) / 60000)} 分钟）\n\n`;
        text += "「运行阶段」一直停在「已触发」或「等待延时结束」，说明触发它的上下文被打断了，\n调度会自动补跑；也可以打开任意 rewards.bing.com 页面立刻救一轮。";
        return text;
    };

    // 原「🧹 重置调度计划」菜单已移除：不再注册菜单按钮，
    // 需要重置时在控制台调用 __MPDiagnostics.resetSchedule()。
    const diagResetSchedule = () => {
        Sched.clearClaim();
        GM_setValue("Config.runState", null);
        GM_setValue("Config.cronNextRun", null);
        Utils.log("🧹", "调度计划已重置，下一轮将立刻开始");
        Sched.arm(true);
    };

    // 原五个诊断/操作菜单（Edge 连签状态、PC 搜索诊断、查看调度状态、重置调度计划、网络出口检测）
    // 已从右键菜单移除。逻辑原样保留在这里，不再弹出任何提示框：需要时在控制台（脚本管理器或
    // rewards.bing.com 页面）调用 __MPDiagnostics.edgeStreak() / pcSearch() / region() / schedule() /
    // resetSchedule()，前四个的返回值就是原来弹窗里的那段文本。
    try {
        const host = (typeof unsafeWindow !== "undefined" && unsafeWindow) ? unsafeWindow : globalThis;
        host.__MPDiagnostics = {
            edgeStreak: diagEdgeStreak,
            pcSearch: diagPcSearch,
            region: diagRegion,
            schedule: diagSchedStatus,
            resetSchedule: diagResetSchedule
        };
    } catch (_) {}

    if (!Utils.hasDOM()) {
        // 判定后台脚本是否还在跑，否则调度器还在转、管理页却显示「停止」。
        return new Promise(() => {});
    }
})();

// 把后台分支的 pending Promise 原样返回给 ScriptCat，使 runStatus 保持 running。
// 页面上下文与授权回调返回的不是 Promise，不会触发下面的 return。
if (__scBgKeepAlive && typeof __scBgKeepAlive.then === "function") {
    return __scBgKeepAlive;
}
