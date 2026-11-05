// ==UserScript==
// @name         微软积分（优化版）
// @namespace    https://rewards.bing.com/
// @version      1.6.1
// @description  每天在后台自动完成 Microsoft Rewards 任务获取积分奖励，✅签入(PC+App静默)、✅阅读、✅活动、✅搜索、✅Quiz、✅拼图、✅热搜API、✅二次扫描、✅积分通知、✅自动领取待领积分、✅连签任务检测、✅每日活动自动上报、✅桌面应用每周专属任务、✅Edge 浏览连签、✅出口检测（非大陆 IP 直接停手）、✅月度打卡
// @icon         https://bing.com/th?id=OMR.icon-96.png&pid=Rewards
// @license      MIT
// @background
// 保持后台常驻：关闭所有页面后依然会按 Sched 定时跑。
//
// 【关于必应 server action 的 500 风控页】
// 交卷/领取这类 server action，服务端只认 Origin === https://rewards.bing.com。
// 从扩展后台（service worker / offscreen）发出时 Origin 是 chrome-extension://<id>，恒回 500。
// 可用的发送方只有两种，脚本已全部内置并按 local → page → proxy → xhr 依次尝试：
//   local : 脚本被注入到 rewards 页面里时，用页面原生 fetch（Origin 同源）——最稳
//   page  : 借 CDP 调试端口，在真实 rewards 页面里发（需 --remote-debugging-port 启动浏览器）
//   proxy : 借同源页面里驻留的代发服务中转
//   xhr   : 扩展后台直发，Origin 是扩展源，必应常回 500，仅作兜底
// 想不配 CDP 也能做这三类任务，唯一途径是让脚本能注入 rewards 页（改普通脚本或配 CDP）。
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
// @connect      127.0.0.1
// @connect      localhost
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
// @grant        GM_closeTab
// @grant        GM_info
// @grant        GM_log
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_registerMenuCommand
// @storageName  BingRewardsAuto_Shared
// @tips         此脚本为开源免费使用，请勿购买
// ==/UserScript==

/* global GM_cookie, GM_getValue, GM_setValue, GM_xmlhttpRequest, GM_log, GM_info, GM_notification, GM_openInTab, GM_addValueChangeListener, GM_removeValueChangeListener */

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
        title: 动作最小间隔（秒，搜索/阅读/卡片共用，脚本只会更慢不会更快）
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
    autoAuth:
        title: 自动检测授权码(手动运行一次，token状态无则手动授权)
        type: checkbox
        default: true
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
    desktopWeekly:
        title: 桌面应用每周专属任务（每轮检测，按星期逐日解锁）
        type: checkbox
        default: true
    claimPoints:
        title: 自动领取待领积分（搜索打卡/每日活动的奖励需点一次才入账）
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

    const IS_OAUTH_CALLBACK = location.hostname === "login.live.com"
        && location.pathname === "/oauth20_desktop.srf";

    const OAUTH_WITNESS = (() => {
        const snapshot = { at: Date.now(), href: "", referrer: "", name: "", urls: [] };
        const seen = new Set();
        const maybeRecord = url => {
            if (!url) return;
            const s = String(url);
            if (!/code=/i.test(s) || seen.has(s)) return;
            seen.add(s);
            snapshot.urls.push(s);
            if (snapshot.urls.length > 12) snapshot.urls.shift();
        };
        try {
            snapshot.href = String(location.href || "");
            maybeRecord(snapshot.href);
        } catch (_) {}
        try {
            snapshot.referrer = String((typeof document !== "undefined" && document && document.referrer) || "");
            maybeRecord(snapshot.referrer);
        } catch (_) {}
        try {
            snapshot.name = String((typeof window !== "undefined" && window && window.name) || "");
            maybeRecord(snapshot.name);
        } catch (_) {}
        try {
            const host = (typeof unsafeWindow !== "undefined" && unsafeWindow)
                ? unsafeWindow
                : (typeof window !== "undefined" ? window : null);
            if (host && host.location && host.location.hostname === "login.live.com" && host.history) {
                ["pushState", "replaceState"].forEach(fnName => {
                    const orig = host.history[fnName];
                    if (typeof orig !== "function" || orig.__mpWitness) return;
                    const wrapped = function (state, title, url) {
                        try {
                            maybeRecord(url ? new URL(String(url), host.location.href).href : host.location.href);
                        } catch (_) {
                            maybeRecord(url);
                        }
                        return orig.apply(this, arguments);
                    };
                    wrapped.__mpWitness = true;
                    try { host.history[fnName] = wrapped; } catch (_) {}
                });
            }
        } catch (_) {}
        return snapshot;
    })();

    const RewardsAuto = {
        get ua() { return UA.all(); },

        get desktopAppHeaders() {
            return {
                "user-agent": UA.all().rewardsApp,
                "x-rewards-source": "msrewards-desktop"
            };
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

        region(fallback = "us") {
            if (GM_getValue("Config.lock", true)) return "cn";
            const r = String(this.state.region || "").toLowerCase().trim();
            return r || fallback;
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
            "set goal",
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
            lockedCount: 0,
            lockedPoints: 0,
            lockedTitles: [],
            weeklyQuestLeft: [],
            weeklyQuestUnknown: 0,
            weeklyQuestScanned: false,
            webNoAuth: false,
            webFailStreak: 0,
        }
    };

    const CLAIM_ONCE_TIMEOUT = 150 * 1000;
    const NEXT_ACTION_SCAN_MAX = 8;
    const NEXT_ACTION_SCAN_BUDGET = 45 * 1000;
    const WEB_FAIL_LIMIT = 3;
    const ACTION_SCAN_MAX = 24;
    const ACTION_SCAN_BUDGET = 60 * 1000;

    const CardLock = {
        fields(item) {
            if (!item || typeof item !== "object") return {};
            const pick = (...keys) => {
                for (const k of keys) {
                    if (item[k] !== undefined && item[k] !== null) return item[k];
                }
                return undefined;
            };
            const rawUnlock = pick("unlockCriteria", "unlockcriteria");
            return {
                isLocked: pick("isLocked", "islocked"),
                isUnlocked: pick("isUnlocked", "isunlocked"),
                isDisabled: pick("isDisabled", "isdisabled"),
                isHidden: pick("isHidden", "ishidden", "hidden"),
                unlockCriteria: rawUnlock === "$undefined" ? undefined : rawUnlock,
                state: String(pick("state", "State") || ""),
                offerId: String(pick("offerId", "offerid", "name") || ""),
                title: String(pick("title", "name", "description") || "")
            };
        },

        hasExplicitState(item) {
            const f = this.fields(item);
            return f.isLocked !== undefined || f.isUnlocked !== undefined
                || f.isDisabled !== undefined || f.unlockCriteria !== undefined;
        },

        textLocked(text) {
            const s = String(text || "");
            return /offer is locked|available tomorrow|earn -1 points|明天再来|明天可用|已锁定|在必应应用|必应\s*app|仅限.*应用|需在应用/i.test(s);
        },

        probe(item) {
            const f = this.fields(item);
            const appExclusive = /Moreactivities_RewardsApp/i.test(f.offerId)
                || String(f.unlockCriteria || "").toLowerCase() === "rewardsapp";

            const levelGated = /locked_level2|newLevel2/i.test(f.offerId)
                || String(f.unlockCriteria || "").toLowerCase() === "newlevel2";
            const keep = (reason) => ({ locked: false, appExclusive, appOnly: appExclusive, levelGated, reason });
            const skip = (reason) => ({ locked: true, appExclusive, appOnly: false, levelGated, reason });
            const appTry = (reason) => ({ locked: false, appExclusive, appOnly: true, levelGated, reason });

            if (!this.hasExplicitState(item)) {
                const text = `${f.title} ${f.offerId} ${f.state}`;
                if (!this.textLocked(text)) {
                    return keep(levelGated ? "等级门槛卡(无锁态字段,按可尝试处理)" : "");
                }
                if (/在必应应用|必应\s*app|仅限.*应用|需在应用|bing\s*app|mobile\s*app/i.test(text)) {
                    return appTry("文案指向 App 通道");
                }
                return skip("仅有锁态文案");
            }
            if (f.isDisabled === true) return skip("isDisabled=true");
            if (f.isLocked === false) return keep(appExclusive ? "rewardsApp(已解锁)" : "");
            if (f.isUnlocked === true) return keep(appExclusive ? "rewardsApp(已解锁)" : "");
            if (appExclusive) return appTry(f.isLocked === true ? "isLocked=true(App 专属→App UA)" : "rewardsApp");
            if (f.isLocked === true) return skip("isLocked=true");
            if (f.isUnlocked === false) return skip("isUnlocked=false");
            if (f.unlockCriteria !== undefined && f.unlockCriteria !== "") {
                return skip(`unlockCriteria=${f.unlockCriteria}`);
            }
            if (f.state && this.textLocked(f.state)) return skip(`state=${f.state}`);
            return keep("");
        },

        claimable(item) {
            const lock = this.probe(item);
            if (lock.locked) return false;
            const f = this.fields(item);
            if (f.isHidden === true) return false;
            return true;
        }
    };

    const UA = {

        FALLBACK_CHROME: "156.0.0.0",
        FALLBACK_EDGE: "156.0.4314.50",

        REWARDS_APP_VER: "1.13.0",
        DESKTOP: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
        ANDROID: "Mozilla/5.0 (Linux; Android 16; Redmi K20 Pro Build/BP4A.251205.006; ) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Mobile Safari/537.36",
        _cache: null,
        _cacheAt: 0,

        navigatorUA() {
            try {
                return (typeof navigator !== "undefined" && navigator && navigator.userAgent)
                    ? String(navigator.userAgent) : "";
            } catch (_) {
                return "";
            }
        },

        remember(ua) {
            if (!/Edg\/\d/.test(ua)) return;
            try {
                if (GM_getValue("Config.uaEdge", "") !== ua) GM_setValue("Config.uaEdge", ua);
            } catch (_) { }
        },

        all() {
            const now = Date.now();
            if (this._cache && now - this._cacheAt < 60000) return this._cache;
            const real = this.navigatorUA();
            this.remember(real);
            const saved = String(GM_getValue("Config.uaEdge", "") || "");
            const edgeUA = [real, saved].find(s => /Edg\/\d/.test(s))
                || (() => {
                    const ver = [real, saved]
                        .map(s => (String(s).match(/Chrome\/([\d.]+)/) || [])[1])
                        .find(Boolean);
                    if (ver) return `${this.DESKTOP} Chrome/${ver} Safari/537.36 Edg/${ver}`;
                    return `${this.DESKTOP} Chrome/${this.FALLBACK_CHROME} Safari/537.36 Edg/${this.FALLBACK_EDGE}`;
                })();
            this._cache = {
                pc: /Edg\//.test(real) ? real : edgeUA,
                edge: edgeUA,
                mobile: `${this.ANDROID} EdgA/144.0.0.0`,
                app: `${this.ANDROID} BingSapphire/32.6.2110003560`,
                rewardsApp: (() => {
                    const ver = [real, saved]
                        .map(s => (String(s).match(/Chrome\/([\d.]+)/) || [])[1])
                        .find(Boolean) || this.FALLBACK_CHROME;
                    return `${this.DESKTOP} Chrome/${ver} Safari/537.36 Edg/${ver} MSRewards/Desktop/${this.REWARDS_APP_VER}`;
                })(),
            };
            this._cacheAt = now;
            return this._cache;
        }
    };

    const EDGE = {
        PROMO_NAME: "edge_browsing_streak_flight",
        PROMO_PREFIX: /^edge_browsing_streak/i,
        ACTIVATION_OFFER: "edge_flight_1_ww_treatment_eligible",
        TARGET_MINUTES: 30,
        MAX_EXTRA_ROUNDS: 3,
    };

    const WEBHOOK_PLATFORMS = [
        { name: "企业微信", url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=", config: "Notice.wework",
            body: (time, text) => ({ "msgtype": "text", "text": { "content": `> ${time}\n\n ## ${GM_info.script.name}\n ${text}` } }) },
        { name: "钉钉", url: "https://oapi.dingtalk.com/robot/send?access_token=", config: "Notice.dingding",
            body: (time, text) => ({ "msgtype": "markdown", "markdown": { "title": GM_info.script.name, "text": `> ${time}\n ### ${GM_info.script.name}\n ${text}` } }) },
        { name: "飞书", url: "https://open.feishu.cn/open-apis/bot/v2/hook/", config: "Notice.feishu",
            body: (time, text) => ({
                "msg_type": "interactive",
                "card": {
                    "schema": "2.0",
                    "header": { "title": { "tag": "plain_text", "content": GM_info.script.name }, "template": "orange" },
                    "body": { "elements": [{ "tag": "markdown", "text_align": "center", "content": `#### ${time}\n ${text}` }] }
                }
            }) },
        { name: "PushMe", url: "https://push.i-i.me/?push_key=", config: "Notice.pushme",
            body: (time, text) => ({ "type": "markdown", "title": `${GM_info.script.name}[#rewards!https://rewards.bing.com/rewards.png]`, "content": `\n ${text}` }) },
        { name: "Bark", url: "https://api.day.app/", config: "Notice.bark",
            body: (time, text) => ({ "group": "rewards", "icon": "https://rewards.bing.com/rewards.png", "title": GM_info.script.name, "markdown": `\n ${text}` }) },
    ];

    const Webhooks = WEBHOOK_PLATFORMS.map(p => ({
        name: p.name,
        url: p.url,
        key: GM_getValue(p.config, false),
        get msg() { return p.body(new Date().toLocaleString(), RewardsAuto.state.sendMSG); }
    }));

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

        // 环境/配置类提示专用：CDP 未连接、通道不可用、Origin 说明这一类「装好就没有」的固定信息，
        // 只写日志，永不推送。推送通道只留给「任务结果」和「需要你立刻处理的事」。
        logQuiet(icon, msg) {
            this.log(icon, msg, false);
        },

        // 同一类提示在冷却期内只推一次（浏览器通知 + Webhook 一起压住）。
        // 常驻调度是 20 分钟一轮，同一个失败不压的话一天能推几十条。
        notifyKeyed(key, icon, msg, cooldownMs = 6 * 3600 * 1000) {
            const now = Date.now();
            let seen = {};
            try {
                const raw = GM_getValue("Config.noticeSeen", null);
                seen = (raw && typeof raw === "object") ? raw : {};
            } catch (_) { seen = {}; }
            for (const k of Object.keys(seen)) {
                const at = Number((seen[k] || {}).at || 0);
                if (!at || now - at > 7 * 24 * 3600 * 1000) delete seen[k];
            }
            const rec = seen[key];
            if (rec && now - (rec.at || 0) < cooldownMs) {
                const ago = Math.max(1, Math.round((now - rec.at) / 60000));
                const left = Math.max(1, Math.round((cooldownMs - (now - rec.at)) / 60000));
                GM_setValue("Config.noticeSeen", seen);
                this.log(icon, `${msg}（同类提示 ${ago} 分钟前已推过，${left} 分钟内不再重复通知）`);
                return false;
            }
            seen[key] = { at: now, msg: String(msg).slice(0, 160) };
            GM_setValue("Config.noticeSeen", seen);
            this.log(icon, msg, true);
            return true;
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

        xhrFull(options) {
            return new Promise((resolve, reject) => {
                const start = Date.now();
                GM_xmlhttpRequest({
                    ...options,
                    timeout: Number(options && options.timeout) || 15000,
                    onload: (res) => {
                        const cost = ((Date.now() - start) / 1000).toFixed(2);
                        if (res.status >= 200 && res.status < 300) {
                            resolve({ text: res.responseText, finalUrl: res.finalUrl || "", status: res.status });
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

        xhr(options) {
            return new Promise((resolve, reject) => {
                const start = Date.now();

                const url = String((options && options.url) || "");
                const hdr = Object.assign({}, (options && options.headers) || {});
                const needCookie = /(^|\.)(bing\.com|live\.com|microsoft\.com|microsoftonline\.com)\//i.test(url);
                const hasCookie = Object.keys(hdr).some(k => k.toLowerCase() === "cookie");
                if (needCookie && !hasCookie && this._ckReady) {
                    const ck = this._ckReady();
                    if (ck) hdr["cookie"] = ck;
                }
                GM_xmlhttpRequest({
                    ...options,
                    headers: hdr,
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

        routerStateTree(segment = "earn") {
            const refreshFlag = 4096;
            const tree = ["", {
                children: ["(nav)", {
                    children: [segment, { children: ["PAGE", {}, null, null, refreshFlag] }, null, null, refreshFlag]
                }, null, null, refreshFlag]
            }, null, null, refreshFlag + 16];
            return encodeURIComponent(JSON.stringify(tree));
        },
        getRandomUUID() { return crypto.randomUUID().replace(/-/g, "").toUpperCase(); },

        questRouterStateTree(parentOfferId) {
            const tree = ["", {
                children: ["(nav)", {
                    children: ["earn", {
                        children: ["quest", {
                            children: [
                                ["questId", String(parentOfferId), "d", null],
                                { children: ["__PAGE__", {}, null, null, 0] },
                                null, null, 0
                            ]
                        }, null, null, 0]
                    }, null, null, 0]
                }, null, null, 0]
            }, null, "refetch", 16];
            return encodeURIComponent(JSON.stringify(tree));
        },

        async probeCookiePermission() {
            const probed = GM_getValue("Config.cookieProbed", false);
            if (probed) return;

            if (typeof GM_cookie === "undefined" || !GM_cookie || typeof GM_cookie.list !== "function") {
                GM_setValue("Config.cookieProbed", true);
                Utils.log("🔑", "当前脚本管理器不支持 GM_cookie（读不到登录态，但不影响任务执行）");
                return;
            }

            Utils.log("🔑", "首次运行：请求 Cookie 读取权限（若弹出授权框请点「允许」）", true);
            const r = await this.loginCookies();
            GM_setValue("Config.cookieProbed", true);

            if (r === null) {
                Utils.log("🟡", "Cookie 读取被拒绝或超时：脚本仍可正常运行，只是读不到登录态诊断。"
                    + "如需放权，去脚本管理器的「脚本详情 → 权限」里允许 Cookie 访问，然后重新运行。", true);
            } else if (r.hasSession) {
                Utils.log("🔑", "Cookie 权限正常，已登录：" + (r.names || []).slice(0, 6).join(","), false);
            } else {
                Utils.log("🔑", "Cookie 权限正常，但读出的是未登录状态（请确认已在该浏览器登录 rewards）");
            }
        },

        async loginCookies() {

            if (GM_getValue("Config.cookieDenied", false)) return null;
            if (typeof GM_cookie === "undefined" || !GM_cookie || typeof GM_cookie.list !== "function") return null;
            const read = (filter) => new Promise(resolve => {
                let settled = false;
                const done = v => { if (!settled) { settled = true; resolve(v); } };
                setTimeout(() => done(null), 2500);
                try {
                    GM_cookie.list(filter, cookies => done(Array.isArray(cookies) ? cookies : []));
                } catch (_) {
                    done(null);
                }
            });
            const [byDomain, byUrl] = await Promise.all([
                read({ domain: "bing.com" }),
                read({ url: "https://rewards.bing.com/" })
            ]);
            if (byDomain === null && byUrl === null) { GM_setValue("Config.cookieDenied", true); return null; }
            const all = [...(byDomain || []), ...(byUrl || [])];
            const found = new Set(all.map(c => String((c && c.name) || "")));
            const hasMuid = found.has("MUID") || found.has("MUIDB");
            const bingMarks = ["_EDGE_S", "_EDGE_V", "SRCHHPGUSR", "MSCC", "BID", "USRLOC"];
            const bingReady = bingMarks.some(n => found.has(n));
            const hasSession = hasMuid || bingReady;
            return { hasMuid, hasSession, names: [...found].slice(0, 20) };
        },

        async getCookieHeader(force = false) {
            const now = Date.now();
            if (!force && this._ckCache && now - this._ckAt < 5 * 60 * 1000) return this._ckCache;
            if (typeof GM_cookie === "undefined" || !GM_cookie) return "";
            const read = (filter) => new Promise(resolve => {
                let settled = false;
                const done = v => { if (!settled) { settled = true; resolve(v); } };
                setTimeout(() => done(null), 3000);
                try {
                    if (typeof GM_cookie.list === "function") {
                        GM_cookie.list(filter, cookies => done(Array.isArray(cookies) ? cookies : []));
                    } else done(null);
                } catch (_) { done(null); }
            });

            const groups = await Promise.all([
                read({}),
                read({ domain: "bing.com" }),
                read({ url: "https://rewards.bing.com/" })
            ]);
            const seen = new Map();
            for (const g of groups) {
                for (const c of (g || [])) {
                    const n = String((c && c.name) || "");
                    const dom = String((c && c.domain) || "");
                    if (!n || seen.has(n)) continue;
                    if (!c.value) continue;
                    if (!/bing\.com|live\.com|microsoft\.com/i.test(dom)) continue;
                    seen.set(n, String(c.value));
                }
            }
            const header = [...seen.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
            this._ckCache = header;
            this._ckAt = now;
            Utils._ckReady = () => header;

            const hasSession = ["MSPAuth", "MSPProf", "WLSSC", "NAP"].some(n => seen.has(n));
            if (header) {
                Utils.log(hasSession ? "🔑" : "🟡",
                    `已读取 ${seen.size} 个 cookie${hasSession ? "（含登录会话）" : "（缺少会话 cookie，可能未登录）"}`
                    + `，将用于给后台请求补登录态`);
            } else {
                Utils.log("🟡", "读不到任何 cookie：后台请求将没有登录态（GM_cookie 是否已授权？）");
            }
            return header;
        },

        isJSON(s) {
            try {
                const j = JSON.parse(s);
                return Array.isArray(j) || (typeof j === "object" && j !== null);
            } catch (_) { return false; }
        },

        parseJSON(s) {
            if (typeof s !== "string" || !s) return null;
            try {
                const j = JSON.parse(s);
                return (typeof j === "object" && j !== null) ? j : null;
            } catch { return null; }
        },

        appHeaders(token, { kind = "app", country, extra } = {}) {
            const cc = country || RewardsAuto.region();
            const base = kind === "edge" ? {
                "accept": "*/*",
                "content-type": "application/json; charset=UTF-8",
                "user-agent": RewardsAuto.ua.edge,
                "authorization": `Bearer ${token}`,
                "x-rewards-appid": "EdgeDesktop",
                "x-rewards-partnerid": "EdgeHub",
                "x-rewards-country": cc,
                "x-rewards-language": cc === "cn" ? "zh-CN" : "en-US",
            } : {
                "content-type": "application/json; charset=UTF-8",
                "user-agent": RewardsAuto.ua.app,
                "authorization": `Bearer ${token}`,
                "x-rewards-appid": RewardsAuto.appConfig.rewardsAppId,
                "x-rewards-ismobile": "true",
                "x-rewards-country": cc,
                "x-rewards-language": "zh",
            };
            return extra ? Object.assign(base, extra) : base;
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

    class RegionBlockedError extends Error {
        constructor(message) {
            super(message);
            this.name = "RegionBlockedError";
            this.regionBlocked = true;
        }
    }

    const RegionGuard = {
        _cache: null,
        _inflight: null,
        _lastState: "",
        _lastNotifyAt: 0,
        TTL_OK: 120 * 1000,
        TTL_BLOCK: 45 * 1000,
        /* 关掉「锁定国区」时只做参考用的地区探测，缓存久一点，别为选市场每轮发五次请求 */
        TTL_ADVISORY: 10 * 60 * 1000,
        PROBE_TIMEOUT: 8000,
        NOTIFY_GAP: 10 * 60 * 1000,

        enabled() {
            return !!GM_getValue("Config.lock", true);
        },

        HOSTING_RE: /cloudflare|digitalocean|vultr|linode|akamai|fastly|amazon|aws|google\s*cloud|azure|alibaba|aliyun|alicloud|tencent\s*cloud|qcloud|huawei\s*cloud|hetzner|ovh|leaseweb|contabo|hostwinds|hostinger|racknerd|colocrossing|sharktech|psychz|choopa|m247|datacamp|zenlayer|layerstack|gcore|oracle\s*cloud|\bvpn\b|\bproxy\b|tor\s*exit|ipvanish|nordvpn|expressvpn|surfshark|mullvad/i,

        CN_PAGE_RE: /cn\.bing\.com|京ICP备|beian\.miit\.gov\.cn|国内版<\/a>|国内版/,

        PROBES: [
            {
                src: "bing",
                url: () => `https://www.bing.com/?_=${Date.now()}`,
                headers: { "accept-language": "zh-CN,zh;q=0.9", "cache-control": "no-cache" },
                parse: (txt, g) => {
                    const text = String(txt || "");
                    const flat = text.replace(/\s/g, "");
                    const ipcc = flat.match(/RevIpCC:"([A-Za-z]{2})"/);
                    const region = flat.match(/Region:"([A-Za-z]{2})"/);
                    let cc = ipcc ? ipcc[1] : (region ? region[1] : "");
                    if (!cc && g.CN_PAGE_RE.test(text)) cc = "CN";
                    if (!cc) throw new Error("首页未返回地区标记");
                    return { cc: cc.toUpperCase(), ip: "", org: "" };
                }
            },
            {
                src: "cloudflare",
                url: () => `https://www.cloudflare.com/cdn-cgi/trace?_=${Date.now()}`,
                parse: txt => {
                    const kv = {};
                    String(txt || "").split("\n").forEach(line => {
                        const i = line.indexOf("=");
                        if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
                    });
                    if (!kv.loc) throw new Error("trace 格式异常");
                    return { cc: String(kv.loc).toUpperCase(), ip: kv.ip || "", org: "", warp: kv.warp === "on" };
                }
            },
            {
                src: "ipinfo",
                url: () => `https://ipinfo.io/json?_=${Date.now()}`,
                parse: txt => {
                    const d = JSON.parse(txt);
                    if (!d || !d.country) throw new Error(String((d && (d.error || d.message)) || "无 country 字段"));
                    return { cc: String(d.country).toUpperCase(), ip: d.ip || "", org: d.org || "" };
                }
            },
            {
                src: "ip.sb",
                url: () => `https://api.ip.sb/geoip?_=${Date.now()}`,
                parse: txt => {
                    const d = JSON.parse(txt);
                    if (!d || !d.country_code) throw new Error("无 country_code 字段");
                    return {
                        cc: String(d.country_code).toUpperCase(),
                        ip: d.ip || "",
                        org: [d.isp, d.organization, d.asn_organization].filter(Boolean).join(" ")
                    };
                }
            },
            {
                src: "tencent",
                url: () => "https://disp-qryapi.3g.qq.com/v1/dispatch",
                headers: { referer: "https://3g.qq.com/" },
                parse: txt => {
                    const d = JSON.parse(txt);
                    if (!d || d.code != 0) throw new Error("dispatch 返回异常");
                    return {
                        cc: "",
                        ip: (d.extra && d.extra.ip) || "",
                        org: "",
                        cnText: String(d.ipInfo || "").replace(/[#*]+/g, " ").trim()
                    };
                }
            },
        ],

        async _probeAll() {
            return await Promise.all(this.PROBES.map(async p => {
                try {
                    const txt = await Utils.xhr({
                        url: p.url(),
                        headers: p.headers,
                        anonymous: p.anonymous !== false,
                        timeout: this.PROBE_TIMEOUT
                    });
                    return Object.assign({ src: p.src, cc: "", ip: "", org: "" }, p.parse(txt, this));
                } catch (e) {
                    return { src: p.src, error: e instanceof Error ? e : new Error(String(e)), cc: "", ip: "", org: "" };
                }
            }));
        },

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
                /* 真实出口国家（取第一个拿到国家码的探测源）——
                   关掉「锁定国区」时也要用它来选市场，不能一律按 cn 发 */
                cc: (coded[0] && coded[0].cc) || "",
                ip: (ipHolder && ipHolder.ip) || "",
                ipInfo: cnText ? `🌏所在地区：${cnText}` : "",
                coded: coded.length,
                known: coded.length + (cnText ? 1 : 0),
                probes: probes.length,
                failed: probes.filter(p => p.error).map(p => `${p.src}: ${p.error.message}`)
            };
        },

        async check({ fresh = false, quiet = false } = {}) {
            const enabled = this.enabled();
            const now = Date.now();
            /* 关闭「锁定国区」时仍然探测一次，但只看地区、不拦截：
               dapi 的 country / mkt 要靠它，否则一律按 cn 市场发，挂梯子时反而不记账。
               为了少发请求，这种「参考用」探测缓存久一点。 */
            const ttl = enabled
                ? (this._cache && this._cache.ok ? this.TTL_OK : this.TTL_BLOCK)
                : this.TTL_ADVISORY;
            if (!fresh && this._cache && (now - this._cache.at) < ttl) {
                /* 关掉锁国区时，缓存里可能还留着「上一次开启时判定的拦截结论」，
                   这里必须改成放行，否则关掉开关还会被旧缓存拦住。 */
                return enabled ? this._cache
                    : Object.assign({}, this._cache, { ok: true, reasons: [], advisory: true });
            }
            if (this._inflight) return this._inflight;

            this._inflight = (async () => {
                let raw = await this._probeAll();
                let verdict = this._judge(raw);
                for (const wait of [2000, 5000]) {
                    if (verdict.known > 0) break;
                    if (!quiet) Utils.log("🟡", `出口检测没拿到任何结果，${wait / 1000} 秒后再试一次`);
                    await Utils.delay(wait);
                    raw = raw.concat(await this._probeAll());
                    verdict = this._judge(raw);
                }
                if (verdict.known === 0 && enabled) {
                    verdict.ok = false;
                    verdict.reasons.unshift("无法确认出口地区（所有探测都失败）");
                }
                if (!enabled) {
                    /* 关掉锁定国区 = 不拦代理：结论一律放行，只留下地区信息 */
                    verdict.ok = true;
                    verdict.reasons = [];
                    verdict.advisory = true;
                }
                verdict.at = Date.now();
                this._cache = verdict;

                if (!enabled) {
                    if (verdict.cc) RewardsAuto.state.region = verdict.cc;
                    if (verdict.ip) RewardsAuto.state.ip = verdict.ip;
                    return verdict;
                }

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

        async guard(where = "任务") {
            const v = await this.check();
            /* 开关在运行中被关掉、或缓存/并发里带着旧结论时，一律放行 */
            if (!this.enabled()) return v;
            if (!v.ok) throw new RegionBlockedError(`出口异常（${where}）：${v.reasons[0] || "未知原因"}`);
            return v;
        },

        async allow() {
            const v = await this.check();
            return !this.enabled() || v.ok;
        }
    };

    const CLIENT_ID = "0000000040170455";
    const REDIRECT_URI = "https://login.live.com/oauth20_desktop.srf";
    const TOKEN_SCOPE = "service::prod.rewardsplatform.microsoft.com::MBI_SSL";

    const Auth = {
        authUrl: `https://login.live.com/oauth20_authorize.srf?client_id=${CLIENT_ID}&response_type=code&scope=${TOKEN_SCOPE}&redirect_uri=${REDIRECT_URI}`,

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

            const m = s.match(/[?&#;\s]code=([^&\s"'<>\\]+)/i) || s.match(/^code=([^&\s"'<>\\]+)/i);
            if (m) {
                const c = this.normalize(this.decode(m[1]));
                if (c) return c;
            }
            const bare = s.match(/M\.[A-Za-z0-9._*!$%~-]{20,}/);
            if (bare) return this.normalize(this.decode(bare[0]));
            const t = s.replace(/^[\s"'`<\[(]+/, "").replace(/[\s"'`>\])]+$/, "");
            if (/^[A-Za-z0-9._*!$%~-]{40,}$/.test(t)) return this.normalize(this.decode(t));
            return null;
        },

        preview(code) {
            if (!code) return "(空)";
            return `${code.slice(0, 12)}…${code.slice(-6)}（${code.length} 字符）`;
        },

        pick(list) {
            for (const item of list) {
                if (!item || !item.value) continue;
                const code = this.parseCode(item.value);
                if (code) return { code, source: item.source, raw: String(item.value) };
            }
            return null;
        },

        candidates(deep) {
            const list = [];
            const add = (source, value) => { if (value) list.push({ source, value: String(value) }); };
            try { add("地址栏", location.href); } catch (_) {}
            try { add("地址栏参数", `${location.search || ""}${location.hash || ""}`); } catch (_) {}

            try { add("document.referrer", typeof document !== "undefined" && document ? document.referrer : ""); } catch (_) {}
            try {
                const nav = (typeof performance !== "undefined" && performance.getEntriesByType)
                    ? performance.getEntriesByType("navigation") : null;
                if (nav && nav[0] && nav[0].name) add("navigation", nav[0].name);
            } catch (_) {}
            try { add("window.name", typeof window !== "undefined" ? window.name : ""); } catch (_) {}
            if (OAUTH_WITNESS) {
                add("启动快照(地址栏)", OAUTH_WITNESS.href);
                add("启动快照(referrer)", OAUTH_WITNESS.referrer);
                add("启动快照(window.name)", OAUTH_WITNESS.name);
                (OAUTH_WITNESS.urls || []).forEach((u, i) => add(`历史 URL#${i + 1}`, u));
            }
            if (!deep) return list;
            try {
                const html = (typeof document !== "undefined" && document && document.documentElement)
                    ? String(document.documentElement.outerHTML || "") : "";
                const m = html.match(/[^\s"'<>\\]{0,160}code=[A-Za-z0-9._~%*!$-]{20,120}[^\s"'<>\\]{0,32}/i);
                if (m) add("页面内容", m[0]);
            } catch (_) {}
            for (const storeName of ["sessionStorage", "localStorage"]) {
                try {
                    const store = (typeof window !== "undefined" && window) ? window[storeName] : null;
                    if (!store) continue;
                    for (let i = 0; i < store.length && i < 40; i++) {
                        const key = store.key(i);
                        if (key == null) continue;
                        const val = store.getItem(key);
                        if (val && val.length < 4000 && /code=/i.test(val)) add(`${storeName}.${key}`, val);
                    }
                } catch (_) {}
            }
            return list;
        },

        collectCode(deep = false) {
            return this.pick(this.candidates(deep));
        },

        async waitForAnyCode(timeoutMs = 12000, stepMs = 500) {
            const t0 = Date.now();
            for (let tick = 0; Date.now() - t0 < timeoutMs; tick++) {
                const hit = this.collectCode(tick === 0 || tick % 4 === 0);
                if (hit) return hit;
                await Utils.delay(stepMs);
            }
            return this.collectCode(true);
        },

        used(code) {
            if (!GM_getValue("Config.codeUsed", false)) return false;
            const fp = String(GM_getValue("Config.codeFingerprint", ""));
            return !fp || fp === String(code || "").slice(-32);
        },

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
            if (this.used(code)) return null;
            return code;
        },

        save(raw) {
            const code = this.parseCode(raw);
            GM_setValue("Config.code", String(raw).trim());
            GM_setValue("Config.codeTime", Utils.getTimestamp());
            GM_setValue("Config.codeUsed", false);
            GM_setValue("Config.codeFingerprint", code ? code.slice(-32) : "");
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

        async fetchViaXhr() {
            let res;
            try {
                res = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "GET",
                        url: this.authUrl,
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
            const finalUrl = res.finalUrl || res.responseURL || "";
            if (/removed=true/i.test(finalUrl)) {
                Utils.log("🟡", `静默通道被微软跳到了 ?removed=true（code 已被抹掉），改走页面 Referer 通道`);
                return null;
            }
            Utils.log("🟡", `静默通道没拿到授权码（HTTP ${res.status}，最终地址 ${finalUrl || "未知"}）`);
            return null;
        },

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
                    await Utils.delay(2500);
                    if (freshToken()) return { tokenReady: true };
                    return { code };
                }
                if (freshToken()) return { tokenReady: true };
            }
            return {};
        },

        async autoFetch(reason) {
            if (!GM_getValue("Config.autoAuth", true)) {
                Utils.log("🔴", `${reason}，且配置里已关闭「自动检测授权码」：请点菜单「🔑 手动授权」，登录后把跳转地址粘贴到「📋 粘贴授权码」。`);
                return {};
            }
            Utils.log("🟡", `${reason}，后台静默尝试捕获授权码（不打开标签页）...`);
            const viaXhr = await this.fetchViaXhr();
            if (viaXhr) {
                Utils.log("🟢", "自动获取授权码成功（静默通道）");
                return { code: viaXhr };
            }
            Utils.log("🔴", "静默捕获授权码失败，不自动打开授权页。请点菜单「🔑 手动授权」登录：页面跳到 oauth20_desktop.srf 时脚本会自动从 Referer 捕获授权码并换 Token；也可以 F12 → 网络 → oauth20_desktop.srf?removed=true → 标头 → 请求标头 → 复制 Referer，再用「📋 粘贴授权码」粘贴。");
            return {};
        },

        async handleCallback() {
            const params = new URLSearchParams(location.search);
            const err = params.get("error");
            if (err) {
                const desc = params.get("error_description") || "";
                Utils.log("🔴", `授权页返回错误：${err} - ${desc}`, true);
                try { GM_notification({ title: "🔴 授权失败", text: `${err}：${desc}`, timeout: 0 }); } catch (_) {}
                return;
            }
            if (!params.get("code")) {
                Utils.log("🟡", `回调地址里没有 code（${location.search || "无参数"}），改从 Referer / 启动快照里找...`);
            }
            const hit = this.collectCode(false) || await this.waitForAnyCode(12000);
            if (!hit) {
                Utils.log("🔴", "自动捕获授权码失败：地址栏、document.referrer、启动快照里都没有 code", true);
                try {
                    GM_notification({
                        title: "🔴 自动捕获授权码失败",
                        text: "F12 → 网络 → 点 oauth20_desktop.srf?removed=true → 标头 → 请求标头 → 复制 Referer 右侧完整链接，再用「📋 粘贴授权码」",
                        timeout: 0
                    });
                } catch (_) {}
                return;
            }
            const code = hit.code;
            Utils.log("🟢", `已捕获授权码（来源：${hit.source}，${this.preview(code)}），正在换取 Token...`);
            this.save(hit.raw || code);
            const ok = await this.exchange(code);
            if (ok) {
                try { GM_notification({ title: "🟢 授权成功", text: "Token 已保存，可以关闭此页了", timeout: 6000 }); } catch (_) {}
                setTimeout(() => { try { window.close(); } catch (_) {} }, 2000);
            } else {
                try { GM_notification({ title: "🔴 授权失败", text: "授权码换取 Token 失败，请查看脚本日志后重新授权", timeout: 0 }); } catch (_) {}
            }
        },

        async recoverFromPage() {
            const hit = this.collectCode(true) || await this.waitForAnyCode(6000);
            if (!hit) {
                Utils.uiAlert(
                    "🕵️ 没有在 Referer / 地址栏 / 页面内容里找到授权码。\n\n" +
                    "请确认当前页就是授权跳转后的那一个（地址形如 /oauth20_desktop.srf?removed=true）。\n" +
                    "若仍失败，按 F12 → 网络 → 点 oauth20_desktop.srf?removed=true → 标头 → 请求标头 →\n" +
                    "复制 Referer 右侧的完整链接，再用「📋 粘贴授权码」粘贴。"
                );
                return false;
            }
            Utils.log("🟢", `从页面捕获授权码（来源：${hit.source}，${this.preview(hit.code)}），正在换取 Token...`);
            this.save(hit.raw || hit.code);
            const ok = await this.exchange(hit.code);
            Utils.uiAlert(ok
                ? "✅ 已用捕获到的授权码换取 Token 并保存。"
                : "⚠️ 捕获到授权码，但换取 Token 失败（多半已过期或已被用过）。请重新「🔑 手动授权」。");
            return ok;
        },

        async pasteFlow(input) {
            let raw = input;
            if (raw == null) {
                raw = await Utils.uiPrompt(
                    "粘贴授权页跳转后的完整地址：\n" +
                    "形如 https://login.live.com/oauth20_desktop.srf?code=M.C561_BAY...&lc=2052\n\n" +
                    "如果手速不够快，地址栏发生了变化(没有code=M...=2052):\n" +
                    "方案1：再次点击手动授权(看准时机复制地址栏内容)\n"+
                    "方案2：手动授权 → F12 → 网络(Network) → oauth20_desktop.srf?removed=true → 标头(Headers) → 请求标头(Request headers) → Referer → 复制右侧完整链接\n"

                );
                if (raw == null) return false;
            }
            const code = this.save(raw);
            if (!code) {
                Utils.uiAlert("❌ 没能从粘贴内容里解析出授权码。\n\n请确认复制的是授权页跳转后的完整地址（里面要带 code=），然后重新粘贴。形如:\nhttps://login.live.com/oauth20_desktop.srf?code=M.C561_BAY...&lc=2052");
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

    const CDP = {
        _ws: null,
        _id: 0,
        _pending: null,
        _warnedAt: 0,
        WARN_GAP: 30 * 60 * 1000,

        base() {
            const p = Number(GM_getValue("Config.cdpPort", 9224)) || 9224;
            return "http://127.0.0.1:" + p;
        },

        launchCommand() {
            const port = Number(GM_getValue("Config.cdpPort", 9224)) || 9224;
            const profile = String(GM_getValue("Config.cdpProfileDir", "") || "%LOCALAPPDATA%\\Microsoft\\Edge\\CDPUserData");
            const profDir = String(GM_getValue("Config.cdpProfileName", "") || "Profile 6");
            return "& \"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe\""
                + " --remote-debugging-port=" + port
                + " --remote-allow-origins=* --user-data-dir=\""
                + profile
                + "\" --profile-directory=\""
                + profDir
                + "\"";
        },

        warn(reason) {
            /* 只写后台日志，不推送（通知/webhook）：CDP 没连上是常态，不该占用推送通道。
               仍然保留 30 分钟节流，避免每一轮都往控制台刷一屏启用方法。 */
            const now = Date.now();
            const first = !this._warnedAt || now - this._warnedAt > this.WARN_GAP;
            if (!first) {
                Utils.logQuiet("🟡", "CDP 仍未连接：" + reason + "（30 分钟内不再重复提示）");
                return;
            }
            this._warnedAt = now;
            const msg = [
                "CDP 未连接：" + reason,
                "应用内搜索型卡片（带锁标识）需要浏览器级真实点击才能记账。",
                "页面内 JS 模拟点击无效 —— isTrusted=false 时浏览器直接拒绝导航，这是安全边界。",
                "",
                "【启用方法】用桌面上的「Rewards Edge」快捷方式启动（或粘下面这条命令）：",
                this.launchCommand(),
                "",
                "它会在一个独立小窗口打开（不影响你平时的 Edge）。首次需要在该窗口登录 rewards.bing.com。"
            ].join(String.fromCharCode(10));
            Utils.logQuiet("🔴", msg);
        },

        async available() {
            if (typeof WebSocket === "undefined") return false;
            try {
                const r = await Utils.xhr({ url: this.base() + "/json/version", timeout: 3000 });
                return !!(r && String(r).indexOf("Browser") >= 0);
            } catch (_) {
                return false;
            }
        },

        async targets() {
            try {
                const txt = await Utils.xhr({ url: this.base() + "/json/list", timeout: 4000 });
                return JSON.parse(txt);
            } catch (_) {
                return null;
            }
        },

        async earnPage() {
            const list = await this.targets();
            if (!list) return null;
            const hit = list.find(t => t.type === "page" && t.url && t.url.indexOf("https://rewards.bing.com/earn") === 0);
            if (hit) return hit;
            // 【已禁用自动开标签】只使用当前已开着的 rewards 页面，不再新开浏览器标签。
            return null;
        },
        async connect(wsUrl) {
            if (this._ws) {
                try { this._ws.close(); } catch (_) {}
                this._ws = null;
            }
            this._pending = new Map();
            this._id = 0;
            const ws = new WebSocket(wsUrl);
            await new Promise((resolve, reject) => {
                const t = setTimeout(() => reject(new Error("ws timeout")), 6000);
                ws.onopen = () => { clearTimeout(t); resolve(); };
                ws.onerror = () => { clearTimeout(t); reject(new Error("ws error")); };
            });
            ws.onmessage = ev => {
                let m;
                try { m = JSON.parse(ev.data); } catch (_) { return; }
                const p = this._pending && this._pending.get(m.id);
                if (!p) return;
                this._pending.delete(m.id);
                if (m.error) p.reject(new Error(JSON.stringify(m.error)));
                else p.resolve(m.result);
            };
            this._ws = ws;
            return ws;
        },

        send(method, params) {
            if (!this._ws) return Promise.reject(new Error("ws not connected"));
            const mid = ++this._id;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    if (this._pending) this._pending.delete(mid);
                    reject(new Error("cdp timeout: " + method));
                }, 10000);
                this._pending.set(mid, {
                    resolve: v => { clearTimeout(timer); resolve(v); },
                    reject: e => { clearTimeout(timer); reject(e); }
                });
                try { this._ws.send(JSON.stringify({ id: mid, method: method, params: params || {} })); }
                catch (e) { clearTimeout(timer); reject(e); }
            });
        },

        close() {
            try { if (this._ws) this._ws.close(); } catch (_) {}
            this._ws = null;
            this._pending = null;
        },

        async evaluate(expression) {
            const r = await this.send("Runtime.evaluate", { expression: expression, returnByValue: true, userGesture: true });
            return r && r.result ? r.result.value : undefined;
        },

        async fetchPageText(url, { noCache = false } = {}) {
            // noCache：待领池状态必须读最新的，命中浏览器 HTTP 缓存会把「已经领完」读成「还有分」。
            const opts = `{ credentials: "include", redirect: "follow"${noCache ? ', cache: "reload"' : ""} }`;
            const expr = `(async function(){
                try {
                    var r = await fetch(${JSON.stringify(url)}, ${opts});
                    var t = await r.text();
                    return JSON.stringify({ ok: r.ok, status: r.status, text: t.slice(0, 900000) });
                } catch (e) {
                    return JSON.stringify({ ok: false, status: 0, text: String(e && e.message || e) });
                }
            })()`;
            let raw;
            try {
                const r = await this.send("Runtime.evaluate", {
                    expression: expr, awaitPromise: true, returnByValue: true, userGesture: true
                });
                raw = r && r.result ? r.result.value : "";
            } catch (e) {
                return null;
            }
            try {
                const j = JSON.parse(raw || "{}");
                if (!j.ok || !j.text) return null;
                return String(j.text);
            } catch (_) { return null; }
        },

        async claimInPage(pageUrl, headers, body) {
            const expr = `(async function(){
                try {
                    var r = await fetch(${JSON.stringify(pageUrl)}, {
                        method: "POST",
                        credentials: "include",
                        headers: ${JSON.stringify(headers)},
                        body: ${JSON.stringify(body)}
                    });
                    var t = await r.text();
                    return JSON.stringify({ ok: true, status: r.status, text: t.slice(0, 2000) });
                } catch (e) {
                    return JSON.stringify({ ok: false, status: 0, text: String(e && e.message || e) });
                }
            })()`;

            let raw;
            try {
                const r = await this.send("Runtime.evaluate", {
                    expression: expr,
                    awaitPromise: true,
                    returnByValue: true,
                    userGesture: true
                });
                raw = r && r.result ? r.result.value : "";
            } catch (e) {
                return { accepted: false, status: 0, text: `CDP 求值失败：${e.message}` };
            }
            try {
                const j = JSON.parse(raw || "{}");
                return { accepted: j.ok && j.status >= 200 && j.status < 300, status: j.status || 0, text: String(j.text || "") };
            } catch (_) {
                return { accepted: false, status: 0, text: String(raw || "页面无返回") };
            }
        },

        async pendingCards() {
            const expr = [
                "(function(){",
                "  var out = [];",
                "  var sel = 'a[href*=\"PUBL=RewardsDO\"], a[href*=\"form=ML2\"]';",
                "  var nodes = document.querySelectorAll(sel);",
                "  for (var i = 0; i < nodes.length; i++) {",
                "    var a = nodes[i];",
                "    var txt = (a.innerText || '').replace(/\\s+/g, ' ').trim();",
                "    if (/已完成/.test(txt)) continue;",
                "    if (!/bing\\.com\\/search/i.test(a.href)) continue;",
                "    out.push({ title: (txt.split(' ')[0] || txt).slice(0, 20), href: a.href });",
                "  }",
                "  return JSON.stringify(out);",
                "})()"
            ].join("\n");
            const raw = await this.evaluate(expr);
            try { return JSON.parse(raw || "[]"); } catch (_) { return []; }
        },

        async clickCard(href) {
            const h = JSON.stringify(href);
            const posExpr = [
                "(function(){",
                "  var sel = 'a[href*=\"PUBL=RewardsDO\"], a[href*=\"form=ML2\"]';",
                "  var nodes = document.querySelectorAll(sel);",
                "  var target = null;",
                "  for (var i = 0; i < nodes.length; i++) { if (nodes[i].href === " + h + ") { target = nodes[i]; break; } }",
                "  if (!target) return 'nf';",
                "  target.scrollIntoView({ block: 'center' });",
                "  var r = target.getBoundingClientRect();",
                "  return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });",
                "})()"
            ].join("\n");
            let pos = await this.evaluate(posExpr);
            if (pos === "nf") return false;
            await Utils.delay(900);
            pos = await this.evaluate(posExpr);
            if (pos === "nf") return false;
            let pt = null;
            try { pt = JSON.parse(pos); } catch (_) { return false; }
            await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y, button: "none" });
            await Utils.delay(250);
            await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", buttons: 1, clickCount: 1 });
            await Utils.delay(250);
            await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", buttons: 0, clickCount: 1 });
            return true;
        },

        async progress() {
            const expr = [
                "(function(){",
                "  var done = 0, total = 0;",
                "  var sel = 'a[href*=\"PUBL=RewardsDO\"], a[href*=\"form=ML2\"]';",
                "  var nodes = document.querySelectorAll(sel);",
                "  for (var i = 0; i < nodes.length; i++) {",
                "    total++;",
                "    if (/已完成/.test(nodes[i].innerText || '')) done++;",
                "  }",
                "  return JSON.stringify({ done: done, total: total });",
                "})()"
            ].join("\n");
            const raw = await this.evaluate(expr);
            try { return JSON.parse(raw || "{}"); } catch (_) { return { done: 0, total: 0 }; }
        },

        async claimAll(maxCards) {
            const cap = Number(maxCards) || 6;
            if (!(await this.available())) {
                const reason = "端口 " + (Number(GM_getValue("Config.cdpPort", 9224)) || 9224) + " 上没有调试服务";
                this.warn(reason);
                return { ok: false, reason: reason };
            }
            let page = await this.earnPage();
            if (!page) {
                this.warn("能连上端口，但打不开 earn 页");
                return { ok: false, reason: "打不开 earn 页" };
            }
            const result = { ok: true, handled: 0, done: 0, total: 0 };
            try {
                await this.connect(page.webSocketDebuggerUrl);
                const before = await this.progress();
                result.done = before.done || 0;
                result.total = before.total || 0;

                const logged = await this.evaluate("document.cookie.indexOf('MUID') >= 0");
                if (!logged) {
                    this.warn("窗口里没有登录 rewards（该配置目录需要单独登录一次）");
                    return { ok: false, reason: "CDP 窗口未登录" };
                }

                Utils.log("🖱️", "CDP 已连接：当前已完成 " + before.done + "/" + before.total);
                const cards = await this.pendingCards();
                if (cards.length === 0) {
                    Utils.log("✅", "CDP：没有待处理的应用搜索卡");
                    return result;
                }
                Utils.log("🖱️", "CDP：发现 " + cards.length + " 张待处理卡（用真实点击完成）");

                for (const card of cards.slice(0, cap)) {
                    page = await this.earnPage();
                    if (!page) break;
                    if (!this._ws || this._ws.readyState !== 1) {
                        await this.connect(page.webSocketDebuggerUrl);
                    }
                    const ok = await this.clickCard(card.href);
                    if (ok) {
                        result.handled++;
                        Utils.log("🖱️", "  已点击：" + card.title);
                    }
                    await Utils.delay(8000);
                }

                for (let i = 0; i < 12; i++) {
                    await Utils.delay(10000);
                    const pg = await this.earnPage();
                    if (!pg) break;
                    if (!this._ws || this._ws.readyState !== 1) await this.connect(pg.webSocketDebuggerUrl);
                    const now = await this.progress();
                    result.done = now.done || 0;
                    result.total = now.total || 0;
                    if (result.handled > 0 && result.done >= result.total) break;
                }
                return result;
            } catch (e) {
                return { ok: false, reason: e.message };
            } finally {
                this.close();
            }
        }
    };

    const BrowserEnv = {
        _cache: null,
        info() {
            if (this._cache) return this._cache;
            let ua = "";
            try {
                ua = (typeof navigator !== "undefined" && navigator && navigator.userAgent) ? String(navigator.userAgent) : "";
            } catch (_) { ua = ""; }
            if (!ua) {
                try {
                    const saved = String(GM_getValue("Config.uaEdge", "") || "");
                    if (saved) ua = saved;
                } catch (_) {}
            }
            let name = "未知";
            if (/Edg\//.test(ua)) name = "Edge";
            else if (/EdgA\//.test(ua)) name = "Edge(App)";
            else if (/OPR\//.test(ua)) name = "Opera";
            else if (/Firefox\/|FxiOS\//.test(ua)) name = "Firefox";
            else if (/Chrome\//.test(ua)) name = "Chrome";
            else if (/Safari\//.test(ua)) name = "Safari";
            const vm = ua.match(/(?:Edg|EdgA|Chrome|Firefox)\/(\d+)/);
            const major = vm ? Number(vm[1]) : 0;
            const extOriginRisky = name === "Edge" && major >= 152;
            this._cache = { ua, name, major, extOriginRisky };
            return this._cache;
        },

        channelOrder() {
            // local：脚本自己就在 rewards 页面里 → 页面原生 fetch（最稳，Origin 同源）
            // page ：借 CDP 调试端口在真实页面里发（需 --remote-debugging-port）
            // proxy：借同源页面驻留的代发服务中转（需页面注入）
            // xhr  ：扩展后台直发，Origin 是 chrome-extension://<id>，必应常回 500，仅作兜底
            const order = [];
            try {
                if (Utils.hasDOM() && typeof location !== "undefined"
                    && new RegExp("(^|\\.)rewards\\.bing\\.com$", "i").test(String(location.hostname || ""))) {
                    order.push("local");
                }
            } catch (_) {}
            order.push("page", "proxy", "xhr");
            return order;
        },
        summary() {
            const i = this.info();
            return `${i.name}${i.major ? " " + i.major : ""}`;
        }
    };

    const ActionMap = {
        KEY_MAP: "Config.actionMap",
        KEY_BUILD: "Config.actionBuild",
        KEY_DPL: "Config.actionDpl",
        FALLBACK: {
            reportActivity: "707e6eb15bdfdd5fba193f0a77e934f7018faf87ce",
            reportClaimAllPoints: "00491296f1d668ad46b65342c95cb9d72a62c1fa9d"
        },
        REQUIRED: ["reportActivity"],

        _cachedDpl() { return String(GM_getValue("Config.dpl", "") || ""); },

        _readMap() {
            const raw = GM_getValue(this.KEY_MAP, "");
            if (!raw) return {};
            try {
                const j = JSON.parse(raw);
                return (j && typeof j === "object") ? j : {};
            } catch (_) { return {}; }
        },

        clear() {
            GM_setValue(this.KEY_MAP, "");
            GM_setValue(this.KEY_BUILD, "");
            GM_setValue(this.KEY_DPL, "");
        },

        get(name) {
            const map = this._readMap();
            const cached = map[name];
            return cached || this.FALLBACK[name] || "";
        },

        async ensure(pages, opts = {}) {
            const dplNow = this._cachedDpl();
            const cachedMap = this._readMap();
            const cachedDpl = GM_getValue(this.KEY_DPL, "");
            if (this.REQUIRED.every(k => cachedMap[k]) && cachedDpl && (!dplNow || cachedDpl === dplNow)) {
                return { ids: cachedMap, dpl: cachedDpl, fresh: false };
            }
            const budgetMs = Number(opts.budgetMs) || ACTION_SCAN_BUDGET;
            const maxFetch = Number(opts.maxFetch) || ACTION_SCAN_MAX;
            const deadline = Date.now() + budgetMs;

            let combined = (pages || []).filter(Boolean).join("\n");
            if (!combined) {
                try {
                    combined = [(await Utils.xhr({ url: "https://rewards.bing.com/dashboard" })),
                        (await Utils.xhr({ url: "https://rewards.bing.com/earn" }))]
                        .filter(Boolean).join("\n");
                } catch (_) { combined = ""; }
            }
            if (!combined) {
                const ids = Object.assign({}, this.FALLBACK, cachedMap);
                return { ids, dpl: cachedDpl, fresh: false };
            }
            const dpl = dplNow || (combined.match(/[?&](?:amp;)?dpl=([A-Za-z0-9._-]+)/i) || [])[1] || "";

            const queue = [];
            const seen = new Set();
            const push = p => { if (p && !seen.has(p)) { seen.add(p); queue.push(p); } };
            const rel = new Set();
            for (const m of combined.matchAll(/(?:\/_next\/)?(static\/(?:chunks|immutable|media)\/[^\s"'\\]+?\.js)/g)) {
                rel.add("/_next/" + m[1]);
            }
            [...rel].sort((a, b) => ((/(dashboard|earn|page|layout)/i.test(a) ? 0 : 1) - (/(dashboard|earn|page|layout)/i.test(b) ? 0 : 1)))
                .forEach(push);
            const addDynamic = text => {
                for (const m of String(text || "").matchAll(/\b(\d{2,6}):"([a-z0-9_-]{8,})"/g)) {
                    push(`/_next/static/chunks/${m[1]}-${m[2]}.js`);
                    push(`/_next/static/chunks/${m[1]}.${m[2]}.js`);
                }
            };
            addDynamic(combined);

            const hex = "[a-f0-9]{40,64}";

            const q = '\\\\?"';
            const reCreate = new RegExp(`createServerReference\\s*\\)?\\s*\\(\\s*${q}(${hex})${q}([\\s\\S]{0,800}?)\\)`, "g");
            const reRegister = new RegExp(`registerServerReference\\s*\\)?\\s*\\([^,]+,\\s*${q}(${hex})${q}([\\s\\S]{0,800}?)\\)`, "g");
            const SKIP = ["callServer", "findSourceMapURL", "encodeFormAction", "default"];
            const reName = new RegExp(`${q}([A-Za-z_$][\\w$]*)${q}`, "g");
            const scan = (js, map) => {
                for (const re of [reCreate, reRegister]) {
                    re.lastIndex = 0;
                    let m;
                    while ((m = re.exec(js)) !== null) {
                        const names = [...(m[2] || "").matchAll(reName)];
                        const list = names.map(x => x[1]).filter(n => n.length > 3 && !SKIP.includes(n));
                        const name = list[list.length - 1];
                        if (name && !map[name]) map[name] = m[1];
                    }
                }
            };

            const map = Object.assign({}, cachedMap);
            let fetched = 0;
            while (queue.length && fetched < maxFetch && Date.now() < deadline) {
                const path = queue.shift();
                fetched++;
                try {
                    const js = await Utils.xhr({ url: "https://rewards.bing.com" + path, timeout: 8000 });
                    if (!js) continue;
                    scan(js, map);
                    if (!this.REQUIRED.every(k => map[k])) addDynamic(js);
                    if (this.REQUIRED.every(k => map[k]) && map.reportClaimAllPoints) break;
                } catch (_) {}
            }

            const merged = Object.assign({}, this.FALLBACK, map);
            const ok = Object.keys(map).length > 0;
            if (ok) {
                GM_setValue(this.KEY_MAP, JSON.stringify(map));
                GM_setValue(this.KEY_DPL, dpl || dplNow || "");
                GM_setValue(this.KEY_BUILD, dpl || "");
                Utils.log("🧩", `服务端标识表已更新（部署 ${dpl || "未知"}，动作 ${Object.keys(map).length} 个`
                    + `${map.reportClaimAllPoints ? "，含领取" : "，缺领取用兜底"}）`);
                return { ids: merged, dpl: dpl || dplNow, fresh: true };
            }
            Utils.log("🟡", `未能从页面分包中提取服务端标识（扫了 ${fetched} 个），使用缓存/兜底标识`);
            return { ids: merged, dpl: dpl || dplNow, fresh: false };
        }
    };

    const ClaimPoints = {
        KEY_VARIANT: "Config.claimVariant",
        KEY_EMPTY_AT: "Config.claimEmptyAt",
        EMPTY_TTL: 15 * 60 * 1000,

        parse(html) {
            const raw = String(html || "");
            if (!raw) return { known: false, has: false, amount: 0, source: "empty-html" };
            const clean = raw.replace(/\\"/g, '"');
            const m = clean.match(/"pointClaim"\s*:\s*(null|\{|\[)/i);
            if (m) {
                // null / [] / {} 都是「池子空」的明确写法，不能当成「有分可领」
                if (m[1] === "null") return { known: true, has: false, amount: 0, source: "pointClaim" };
                const rest = clean.slice(m.index + m[0].length);
                if (m[1] === "[" && /^\s*\]/.test(rest)) return { known: true, has: false, amount: 0, source: "pointClaim" };
                if (m[1] === "{" && /^\s*\}/.test(rest)) return { known: true, has: false, amount: 0, source: "pointClaim" };
                // 非 null ≠ 有分：只认「真正读到的数字」。读不到数字就是未知，宁可这轮不动手，也不误报失败。
                const amount = this._amount(clean);
                if (amount !== null) return { known: true, has: amount > 0, amount, source: "pointClaim" };
                const badge = this._badgeAmount(clean);
                if (badge !== null) return { known: true, has: badge > 0, amount: badge, source: "badge" };
                return { known: false, has: false, amount: 0, source: "pointClaim" };
            }
            const badge = this._badgeAmount(clean);
            if (badge !== null) return { known: true, has: badge > 0, amount: badge, source: "badge" };
            return { known: false, has: false, amount: 0, source: "none" };
        },

        _balance(html) {
            const clean = String(html || "").replace(/\\"/g, '"');
            const m = clean.match(/"balance"\s*:\s*(\d+)/i);
            return m ? (parseInt(m[1], 10) || 0) : 0;
        },

        // 返回 null 表示「这个字段没读到」，0 才表示「确实读到 0 分」。两者必须区分，否则空池会被当成有分。
        _amount(html) {
            const clean = String(html || "").replace(/\\"/g, '"');
            const at = clean.search(/"pointClaim"/i);
            if (at < 0) return null;
            const win = clean.slice(at, at + 1200);
            const m = win.match(/"(?:points|amount|availablePoints|totalPoints)"\s*:\s*(-?\d+)/i);
            if (!m) return null;
            return Math.max(0, parseInt(m[1], 10) || 0);
        },

        _badgeAmount(html) {
            const alt = String(html || "").match(/alt="可领取"[^>]*>[\s\S]*?(\d[\d,]*)/i);
            if (!alt) return null;
            return parseInt(String(alt[1]).replace(/,/g, ""), 10) || 0;
        },

        _request(actionMap) {
            const id = (actionMap && actionMap.reportClaimAllPoints) || ActionMap.FALLBACK.reportClaimAllPoints;
            const dpl = (actionMap && actionMap.dpl) || RewardsAuto._dpl || GM_getValue("Config.dpl", "");
            return {
                url: "https://rewards.bing.com/earn",
                headers: {
                    "content-type": "text/plain;charset=UTF-8",
                    "next-action": id,
                    "next-router-state-tree": Utils.routerStateTree("earn"),
                    "referer": "https://rewards.bing.com/earn",
                    "accept": "text/x-component",
                    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
                    "origin": "https://rewards.bing.com",
                    ...(dpl ? { "x-deployment-id": dpl } : {}),
                    "user-agent": RewardsAuto.ua.pc
                },
                body: "[]"
            };
        },

        async _sendOnce(req) {
            return await API.postAction(
                { url: req.url, headers: req.headers, data: req.body },
                { savedKey: this.KEY_VARIANT }
            );
        },

        async _cdpPage() {
            return await API._anyRewardsPage();
        },

        async run({ name = "领取积分" } = {}) {
            const out = { claimed: 0, before: 0, after: 0, empty: false, unknown: false, settled: false, variant: "", reason: "" };
            let dashHtml = "";
            try {
                if (await CDP.available()) {
                    const page = await this._cdpPage();
                    if (page) {
                        if (!CDP._ws || CDP._ws.readyState !== 1) await CDP.connect(page.webSocketDebuggerUrl);
                        dashHtml = await CDP.fetchPageText("https://rewards.bing.com/dashboard", { noCache: true }) || "";
                    }
                }
            } catch (_) { dashHtml = ""; }
            if (!dashHtml) {
                try { dashHtml = await Utils.xhr({ url: "https://rewards.bing.com/dashboard" }); } catch (_) { dashHtml = ""; }
            }

            const pool = this.parse(dashHtml);
            out.before = this._balance(dashHtml);
            if (!pool.known) {
                out.unknown = true;
                out.reason = "读不到待领池标记（页面可能是登录页或结构已变）";
                return out;
            }
            if (!pool.has) {
                const last = Number(GM_getValue(this.KEY_EMPTY_AT, 0)) || 0;
                if (Date.now() - last < this.EMPTY_TTL && !pool.amount) {
                    out.empty = true;
                    out.reason = "待领池为空（15 分钟内已确认过）";
                    return out;
                }
                GM_setValue(this.KEY_EMPTY_AT, Date.now());
                out.empty = true;
                out.reason = "待领池为空";
                return out;
            }
            GM_setValue(this.KEY_EMPTY_AT, 0);

            const actionMap = await ActionMap.ensure([dashHtml]);
            const req = this._request(actionMap);
            const accepted = await this._sendOnce(req);
            out.variant = accepted.ok ? accepted.variant : "";
            out.reason = accepted.ok
                ? ""
                : `三种通道都没受理（${(accepted.tried || []).join(" ")}）`;
            if (!accepted.ok) return out;

            await Utils.delay(1200);
            let afterHtml = "";
            try {
                if (accepted.variant === "page") {
                    const page = await this._cdpPage();
                    if (page) afterHtml = await CDP.fetchPageText("https://rewards.bing.com/earn", { noCache: true }) || "";
                }
                if (!afterHtml) afterHtml = await Utils.xhr({ url: "https://rewards.bing.com/earn" });
            } catch (_) { afterHtml = ""; }
            out.after = this._balance(afterHtml);
            out.claimed = (out.before > 0 && out.after > out.before) ? (out.after - out.before) : 0;

            if (out.claimed <= 0) {
                await Utils.delay(2500);
                try {
                    let again = "";
                    if (accepted.variant === "page") {
                        const page = await this._cdpPage();
                        if (page) again = await CDP.fetchPageText("https://rewards.bing.com/dashboard", { noCache: true }) || "";
                    }
                    if (!again) again = await Utils.xhr({ url: "https://rewards.bing.com/dashboard" });
                    const later = this._balance(again);
                    if (out.before > 0 && later > out.before) {
                        out.after = later;
                        out.claimed = later - out.before;
                    }
                    const poolAgain = this.parse(again);
                    if (out.claimed <= 0 && poolAgain.known && !poolAgain.has) {
                        out.settled = true;
                        out.reason = "已受理，池子已清空（余额差读不到，按已领取处理）";
                        out.claimed = Math.max(0, pool.amount || 0);
                    }
                } catch (_) {}
            }
            if (out.claimed <= 0 && !out.settled) {
                out.reason = `已受理但余额未变（页面可领取 ${pool.amount}）`;
            }
            return out;
        }
    };

    const API = {

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
                const latest = GM_getValue("Config.token", false);
                if (latest && latest !== refreshToken) {
                    Utils.log("🟡", "检测到其它上下文已更新 refresh_token，改用新值重试");
                    const r2 = await this.refreshWithToken(latest);
                    if (r2.ok) { this.applyToken(r2.json); return true; }
                }
                if (r.error !== "invalid_grant") {
                    return false;
                }
                Utils.log("🟡", "refresh_token 已失效，需要重新授权");
                GM_setValue("Config.token", false);
                GM_setValue("Config.tokenTime", 0);
            }

            const storedCode = Auth.stored();
            if (storedCode) {
                Utils.log("🟡", "发现已保存的授权码，尝试用它换取 Token...");
                if (await Auth.exchange(storedCode)) return true;
            }

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
            const region = RewardsAuto.region();
            try {
                const res = await this.withTokenRetry(token => Utils.xhr({
                    method: "POST",
                    url: "https://prod.rewardsplatform.microsoft.com/dapi/me/activities",
                    headers: Utils.appHeaders(token, {
                        country: region,
                        extra: { "x-rewards-partnerid": "startapp", "x-rewards-flights": "rwgobig" }
                    }),
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
                headers, data: params.toString()
            });
        },

        async reportDailyActivity(searchUrl) {
            const rawUrl = String(searchUrl || "").trim();
            if (!rawUrl) return false;

            if (!(await CDP.available())) {
                CDP.warn("端口 " + (Number(GM_getValue("Config.cdpPort", 9224)) || 9224) + " 上没有调试服务");
                return false;
            }
            return true;
        },

        _xhrFull(options) { return Utils.xhrFull(options); },

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
            const region = RewardsAuto.region();
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
                    headers: Utils.appHeaders(token, { country: region }),
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
                    headers: Utils.appHeaders(token, { country: RewardsAuto.region() })
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

        edgeRegion() {
            return RewardsAuto.region("us");
        },

        _edgeHeaders(region, token) {
            return Utils.appHeaders(token, { kind: "edge", country: region || this.edgeRegion() });
        },

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

        async activateEdgeBrowsing() {
            const earnUrl = "https://rewards.bing.com/earn";
            try {
                let html = "";
                try {
                    html = await Utils.xhr({
                        url: `${earnUrl}?section=streaks`,
                        headers: { "user-agent": RewardsAuto.ua.pc, "referer": earnUrl }
                    });
                } catch (_) { }
                if (!html || !String(html).includes("edge_flight")) {
                    try {
                        html = await Utils.xhr({
                            url: earnUrl,
                            headers: { "user-agent": RewardsAuto.ua.pc, "referer": earnUrl }
                        });
                    } catch (_) { }
                }
                if (!html) return "failed";
                const clean = String(html).replace(/\\"/g, '"');
                const ids = [...clean.matchAll(/"activationOfferId":"(edge_flight[^"]*)"/g)].map(m => m[1]);
                if (ids.length === 0) {
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

        _promoCache: null,

        async getAppPromotions(force = false) {
            const now = Date.now();
            if (!force && this._promoCache && now - this._promoCache.ts < 15000) return this._promoCache.list;
            try {
                const res = await this.withTokenRetry(token => Utils.xhr({
                    url: RewardsAuto.appConfig.dapiMeUrl,
                    headers: Utils.appHeaders(token, { country: RewardsAuto.region() })
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
                const offerId = a.offerid || a.offerId || p.name;
                if (!offerId) continue;
                const max = parseInt(a.max ?? a.activitymax ?? 0, 10) || 0;
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
                    isLocked: a.isLocked ?? a.islocked,
                    isUnlocked: a.isUnlocked ?? a.isunlocked,
                    unlockCriteria: a.unlockCriteria ?? a.unlockcriteria,
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
            if (!item) return null;
            return item.complete;
        },

        _webCompleteCache: null,

        async isOfferCompleteWeb(offerId, force = false) {
            if (!offerId) return null;
            const now = Date.now();
            if (!force && this._webCompleteCache && now - this._webCompleteCache.ts < 20000) {
                const cached = this._webCompleteCache.map;
                if (cached.has(offerId)) return cached.get(offerId);
            }
            try {
                const html = await Utils.xhr({ url: "https://rewards.bing.com/earn" });
                if (!html) return null;
                const map = new Map();
                for (const item of this._flightItems(this._flightText(html))) {
                    const id = item.offerId || item.offerid;
                    if (!id) continue;
                    const cur = Number(item.pointProgress || 0);
                    const max = Number(item.pointProgressMax || 0);
                    const done = item.isCompleted === true || item.complete === true || (max > 0 && cur >= max);
                    if (done || !map.has(id)) map.set(id, !!done);
                }
                this._webCompleteCache = { ts: now, map };
                return map.has(offerId) ? map.get(offerId) : null;
            } catch (_) {
                return null;
            }
        },

        async isOfferCompleteAny(offerId, force = false) {
            const viaApp = await this.isOfferComplete(offerId, force);
            if (viaApp !== null) return viaApp;
            return await this.isOfferCompleteWeb(offerId, false);
        },

        _unofferableKey(offerId) {
            return `Config.unofferable.${Utils.getTodayNum()}.${offerId}`;
        },

        _markUnoffered(offerId) {
            if (!offerId) return;
            try { GM_setValue(this._unofferableKey(offerId), true); } catch (_) {}
        },

        isUnoffered(offerId) {
            if (!offerId) return false;
            try { return GM_getValue(this._unofferableKey(offerId), false) === true; } catch (_) { return false; }
        },

        _manualKey(offerId) {
            return `Config.manualCard.${Utils.getTodayNum()}.${offerId}`;
        },

        _markManualCard(offerId, name) {
            if (!offerId) return;
            try {
                GM_setValue(this._manualKey(offerId), true);
                RewardsAuto.state.manualCards = RewardsAuto.state.manualCards || [];
                if (!RewardsAuto.state.manualCards.some(x => x.offerId === offerId)) {
                    RewardsAuto.state.manualCards.push({ offerId, name: name || offerId });
                }
            } catch (_) {}
        },

        isManualCard(offerId) {
            if (!offerId) return false;
            try { return GM_getValue(this._manualKey(offerId), false) === true; } catch (_) { return false; }
        },

        async discoverDailySetCards(preMap = null) {
            const todayStr = Utils.getTodayStr();
            const todayNum = String(Utils.getTodayNum());
            const map = preMap || await this.getPromotionMap(true);
            if (!map) return [];
            const cards = [];
            let lockedCount = 0, lockedPoints = 0;
            for (const item of map.values()) {
                const isDailySet = item.offerId.includes(RewardsAuto.appConfig.offerIds.dailySetPrefix)
                    || (item.type === "urlreward" && item.dailySetDate === todayStr);
                if (!isDailySet) continue;
                const scheduledToday = item.dailySetDate === todayStr || item.offerId.includes(todayNum);
                if (!scheduledToday) continue;
                if (item.complete) continue;
                if (item.hidden) continue;
                const lock = CardLock.probe(item);
                if (lock.locked) {
                    lockedCount++;
                    lockedPoints += item.max || 0;
                    RewardsAuto.state.lockedTitles = [...new Set([
                        ...(RewardsAuto.state.lockedTitles || []),
                        String(item.title || item.offerId)
                    ])];
                    Utils.log("🔒", `锁卡跳过（需在必应 App 完成）：${item.title || item.offerId} +${item.max || 0}p [${lock.reason}]`);
                    continue;
                }
                cards.push({
                    title: item.title || item.offerId,
                    points: item.max || 10,
                    offerId: item.offerId,
                    hash: "",
                    kind: "daily",
                    url: "https://rewards.bing.com/earn",
                    destination: item.destination || "",
                    source: "dapi",
                    ...(lock.appOnly ? { appOnly: true } : {}),
                    ...(lock.levelGated ? { levelGated: true } : {})
                });
            }
            if (lockedCount > 0) {
                RewardsAuto.state.lockedCount = Math.max(RewardsAuto.state.lockedCount, lockedCount);
                RewardsAuto.state.lockedPoints = Math.max(RewardsAuto.state.lockedPoints, lockedPoints);
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
                    headers: Utils.appHeaders(token, { country: RewardsAuto.region() })
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
                    headers: Utils.appHeaders(token, { country: RewardsAuto.region() })
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
            const region = RewardsAuto.region();
            try {
                const id = Utils.getRandomUUID().replace(/-/g, '') + Utils.getRandomUUID().replace(/-/g, '').slice(0, 24);
                const res = await this.withTokenRetry(token => Utils.xhr({
                    method: "POST",
                    url: "https://prod.rewardsplatform.microsoft.com/dapi/me/activities",
                    headers: Utils.appHeaders(token, { country: region }),
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

        _flightText(html) {
            const chunks = [];
            const pushRegex = /self\.__next_f\.push\(\[\d+,\s*"(.*?)"\]\)/gs;
            let m;
            while ((m = pushRegex.exec(html)) !== null) {
                try { chunks.push(JSON.parse(`"${m[1]}"`)); } catch (_) {}
            }
            return chunks.length > 0 ? chunks.join("") : String(html).replace(/\\"/g, '"');
        },

        _flightItems(text, idPattern = "[^\"]+") {
            const items = [];
            const re = new RegExp('\\{[^{}]*?"offerId"\\s*:\\s*"' + idPattern + '"[^{}]*?\\}', "g");
            let m;
            while ((m = re.exec(text)) !== null) {
                try {
                    items.push(JSON.parse(m[0].replace(/:\$undefined/g, ":null").replace(/:\$D[^\",}]+/g, ":null")));
                } catch (_) {}
            }
            return items;
        },

        async discoverCards() {
            const cards = [];
            const seenCardKeys = new Set();
            let earnHtml = "";
            const lockStat = { count: 0, points: 0, app: 0, titles: [] };

            const classify = (item, points = 0) => {
                const lock = CardLock.probe(item);
                if (lock.locked) {
                    lockStat.count++;
                    lockStat.points += Number(points) || 0;
                    lockStat.titles.push(String(item.title || item.name || item.offerId || "活动卡片"));
                    Utils.log("🔒", `跳过锁卡：${item.title || item.name || item.offerId || "活动卡片"} +${points}p [${lock.reason}]`);
                    return { skip: true, appOnly: false, levelGated: false };
                }
                if (lock.appOnly) {
                    lockStat.app++;
                    Utils.log("🔓", `带锁徽标的 App 卡，改用 Rewards 应用通道：${item.title || item.name || item.offerId} +${points}p [${lock.reason}]`);
                    return { skip: false, appOnly: true, levelGated: !!lock.levelGated };
                }
                if (lock.levelGated) {
                    Utils.log("🔓", `等级门槛卡（已解锁），领取时先走应用内搜索上报：${item.title || item.name || item.offerId} +${points}p [${lock.reason || "已解锁"}]`);
                    return { skip: false, appOnly: false, levelGated: true };
                }
                return { skip: false, appOnly: false, levelGated: false };
            };
            try {
                const html = await Utils.xhr({ url: "https://rewards.bing.com/earn" });
                if (!html) { Utils.log("🔴", "earn 页面返回空"); return cards; }
                earnHtml = html;
                const clean = html.replace(/\\"/g, '"');

                const dplMatch = clean.match(/[?&](?:amp;)?dpl=([A-Za-z0-9._-]+)/i);
                if (dplMatch) {
                    RewardsAuto._dpl = dplMatch[1];
                    GM_setValue("Config.dpl", dplMatch[1]);
                }

                const pushCard = (card) => {
                    if (!card || !card.offerId || !card.hash || card.points <= 0) return;
                    const key = `${card.offerId}:${card.hash}`;
                    if (seenCardKeys.has(key)) return;
                    seenCardKeys.add(key);
                    cards.push(card);
                };

                const pushWithLock = (item, card, points) => {
                    if (!card) return false;
                    const verdict = classify(item, points);
                    if (verdict.skip) return false;
                    const marked = {
                        ...card,
                        ...(verdict.appOnly ? { appOnly: true } : {}),
                        ...(verdict.levelGated ? { levelGated: true } : {})
                    };
                    pushCard(marked);
                    return true;
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

                try {
                    const userInfo = await Utils.xhr({
                        url: `https://rewards.bing.com/api/getuserinfo?type=1&X-Requested-With=XMLHttpRequest&_=${Date.now()}`,
                        headers: { "user-agent": RewardsAuto.ua.pc, "referer": "https://rewards.bing.com/", "x-requested-with": "XMLHttpRequest" },
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
                            return { title, points, offerId, hash, kind: kind || inferKind(offerId, title), source: "getuserinfo", url: "https://rewards.bing.com/dashboard", destination: item.destinationUrl || "" };
                        };

                        const dailySetPromotions = dashboard.dailySetPromotions || {};
                        for (const dateKey of todayKeys) {
                            const dailyItems = dailySetPromotions[dateKey];
                            if (Array.isArray(dailyItems)) {
                                for (const item of dailyItems) {
                                    const card = normalizeDashboardCard(item, "daily");
                                    if (card) pushWithLock(item, card, card.points);
                                }
                            }
                        }
                        const morePromotions = dashboard.morePromotions || dashboard.promotions || [];
                        if (Array.isArray(morePromotions)) {
                            for (const item of morePromotions) {
                                const card = normalizeDashboardCard(item);
                                if (card) pushWithLock(item, card, card.points);
                            }
                        }
                    }
                } catch (e) {

                    const noCookie = /\b(401|403)\b/.test(String(e.message));
                    Utils.log("🟡", `${noCookie ? "getuserinfo 无会话（不影响 Server Action 交卷）" : "getuserinfo 活动解析跳过"}: ${e.message}`);
                }

                try {
                    for (const item of this._flightItems(this._flightText(html))) {
                        if (!item.offerId || !item.hash) continue;
                        if (item.isCompleted === true || item.hidden === true) continue;
                        const points = Number(item.points || 0);
                        if (points <= 0 && !item.offerId.includes("DailySet")) continue;
                        pushWithLock(item, {
                            title: item.title || item.name || item.offerId,
                            points: points || 10,
                            offerId: item.offerId,
                            hash: item.hash,
                            kind: inferKind(item.offerId, item.title || ""),
                            destination: item.destination || item.destinationUrl || "",
                            url: "https://rewards.bing.com/earn"
                        }, points);
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

            if (lockStat.count > 0 || lockStat.app > 0) {
                RewardsAuto.state.lockedCount = Math.max(RewardsAuto.state.lockedCount, lockStat.count);
                RewardsAuto.state.lockedPoints = Math.max(RewardsAuto.state.lockedPoints, lockStat.points);
                // 记住是哪几张（排障用；播报只报张数与分值，不列名字）
                RewardsAuto.state.lockedTitles = [...new Set([
                    ...(RewardsAuto.state.lockedTitles || []),
                    ...lockStat.titles
                ])];
                if (lockStat.count > 0) {
                    Utils.log("🔒", `锁卡汇总：${lockStat.count} 张（${lockStat.points} 分）今天做不了，已跳过`);
                }
                if (lockStat.app > 0) {
                    Utils.log("🔓", `App 卡汇总：${lockStat.app} 张带锁徽标，已改走 Rewards 应用通道交卷`);
                }
            }

            return cards;
        },

        async getNextActionHash(html) {
            let cached = RewardsAuto._nextAction || GM_getValue("Config.nextAction", ActionMap.FALLBACK.reportActivity);
            try {
                const fromTable = ActionMap.get("reportActivity");
                if (fromTable && fromTable !== cached) {
                    cached = fromTable;
                    RewardsAuto._nextAction = cached;
                    GM_setValue("Config.nextAction", cached);
                }
            } catch (_) {}
            const lastScan = Number(GM_getValue("Config.nextActionScanAt", 0)) || 0;
            const cooled = Date.now() - lastScan < 10 * 60 * 1000;
            if (html && html.includes("_next/static/chunks/") && !cooled) {
                const scriptSrcs = [...new Set(html.match(/\/_next\/static\/chunks\/[a-z0-9_\-]+\.js\?dpl=[^"]+/g) || [])]
                    .slice(0, NEXT_ACTION_SCAN_MAX);
                const deadline = Date.now() + NEXT_ACTION_SCAN_BUDGET;
                let scanned = 0;
                for (const src of scriptSrcs) {
                    if (Date.now() > deadline) break;
                    scanned++;
                    try {
                        const chunkText = await Utils.xhr({ url: "https://rewards.bing.com" + src, timeout: 8000 });
                        const match = chunkText.match(/createServerReference\)\("([a-f0-9]{40,44})"[^)]*"reportActivity"\)/);
                        if (match && match[1]) {
                            cached = match[1];
                            RewardsAuto._nextAction = cached;
                            GM_setValue("Config.nextAction", cached);
                            return cached;
                        }
                    } catch (_) {}
                }
                GM_setValue("Config.nextActionScanAt", Date.now());
                Utils.log("🟡", `Server Action ID 探测未命中（扫了 ${scanned} 个 chunk），10 分钟内不再探测，先用现有 ID 继续`);
            }
            return cached;
        },

        _isAppSearchCard(card) {
            const dest = String((card && card.destination) || "");
            if (!dest) return false;
            const q = dest.includes("?") ? dest.slice(dest.indexOf("?") + 1) : "";
            if (!q) return false;
            const isBingSearch = /bing\.com\/search/i.test(dest);
            const hasSign = /(^|&)(form=ML2W4J|form=ML2Y2H|PUBL=RewardsDO)/i.test(q);
            return isBingSearch && hasSign;
        },

        // 应用内搜索上报（首页待领取 / 等级门槛卡用）。
        //
        // 【不再打开标签、不再导航】旧实现为了在 bing 域内发 /rewardsapp/* 请求，
        // 会把浏览器导航到搜索结果页再跳回来，每张卡来回两次，标签刷屏。
        // 实测结论（_probe/test-tree-matrix.mjs + 实际跑批）：
        //   · punchcard 子卡：直接交卷就能记账，根本不需要这条上报；
        //   · 这条上报只对首页「等级门槛卡」有意义，而它在后台直发也常被拒，
        //     所以这里退回「尽力而为」的后台直发，不再动用户的标签页。
        // 返回 true 只代表请求发出去了，不代表记账成功 —— 记账仍由调用方复核。
        async reportAppSearchForCard(href) {
            const raw = String(href || "").trim();
            if (!/bing\.com\/search/i.test(raw)) return false;
            let u;
            try { u = new URL(raw); } catch (_) { return false; }
            if (!u || !u.origin) return false;

            const query = u.origin + u.pathname + u.search;
            const params = u.search.replace(/^\?/, "");
            const p2 = n => String(n).padStart(2, "0");
            const today = new Date();
            const rwho = `_Rwho=u=d&ts=${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`;
            const appUA = RewardsAuto.desktopAppHeaders["user-agent"];

            let ig = "";
            try {
                const serp = await Utils.xhr({ url: query, headers: { "user-agent": appUA, "cookie": rwho } });
                const flat = String(serp || "").replace(/\s/g, "");
                const m = flat.match(/,IG:"([^"]+)"/);
                if (m) ig = m[1];
            } catch (_) {}
            if (!ig) ig = Utils.getRandomUUID();

            const hdr = {
                "user-agent": appUA,
                "cookie": rwho,
                "referer": query,
                "content-type": "application/x-www-form-urlencoded"
            };
            let sent = 0;
            try {
                await Utils.xhr({
                    method: "POST",
                    url: `${u.origin}/rewardsapp/ncheader?ver=88888888&IID=SERP.5047&IG=${ig}&ajaxreq=1`,
                    headers: hdr,
                    data: "wb=1%3bi%3d1%3bv%3d1"
                });
                sent++;
            } catch (_) {}
            try {
                await Utils.xhr({
                    method: "POST",
                    url: `${u.origin}/rewardsapp/reportActivity?IG=${ig}&IID=SERP.5047&${params}&ajaxreq=1`,
                    headers: hdr,
                    data: `url=${encodeURIComponent(query)}&V=web`
                });
                sent++;
            } catch (_) {}

            if (!sent) return false;
            if (GM_getValue("Config.debugDAPI", false)) {
                Utils.log("🔬", `应用搜索上报（后台直发，不保证记账）：${query.slice(0, 80)}`);
            }
            return true;
        },
        async _claimLevelGatedViaAppSearch(card, { diag = [], name = "" } = {}) {
            const label = name || card.title || card.offerId;
            const offerId = card.offerId;
            const href = String(card.destination || "");
            if (!href || !/bing\.com\/search/i.test(href)) {
                diag.push("lev2search(无搜索href)");
                return false;
            }
            let searched = false;
            try {
                searched = await this.reportAppSearchForCard(href);
                diag.push(searched ? "lev2search(已上报)" : "lev2search(上报失败)");
            } catch (e) {
                diag.push(`lev2search(${e.message})`);
            }
            if (!searched) return false;
            Utils.log("🔎", `等级门槛卡已按应用内搜索签名上报：${label}`);

            await Utils.randomDelay(2000, 4000);
            if (card.hash) {
                try {
                    const accepted = await this.claimCardWeb(card);
                    diag.push(accepted ? "lev2search(已交卷)" : "lev2search(交卷未受理)");
                } catch (e) {
                    diag.push(`lev2search(交卷 ${e.message})`);
                }
            } else {
                diag.push("lev2search(无hash跳过交卷)");
            }

            const deadline = Date.now() + 25 * 1000;
            while (Date.now() < deadline) {
                const st = await this.isOfferCompleteAny(offerId, true);
                if (st === true) {
                    Utils.log("🟢", `等级门槛卡完成（应用内搜索通道）：${label}`);
                    return true;
                }
                await Utils.delay(5000);
            }
            diag.push("lev2search(未标记完成)");
            Utils.log("🟡", `等级门槛卡：应用内搜索通道未记账，改走 CDP 通道：${label}`);
            return false;
        },

        async claimCard(card, opts = {}) {
            const offerId = card.offerId;
            const name = card.title || offerId;
            const attempts = opts.attempts || 3;
            const backoffs = opts.backoffs || [[8000, 12000], [20000, 30000], [45000, 60000]];
            const diag = [];

            if (this.isManualCard(offerId)) {
                Utils.log("🖐️", `已自动上报搜索，完成状态需手动点击确认：${name}`);
                return false;
            }

            if (this.isUnoffered(offerId)) {
                Utils.log("🔒", `今日已确认做不了，跳过：${name}`);
                return false;
            }

            if (await this.isOfferCompleteAny(offerId, true) === true) {
                Utils.log("✅", `服务端已确认完成：${name}`);
                return true;
            }

            for (let i = 0; i < attempts; i++) {
                if (i > 0) {
                    const [lo, hi] = backoffs[Math.min(i - 1, backoffs.length - 1)];
                    Utils.log("⏳", `等待 ${Math.round(lo / 1000)}~${Math.round(hi / 1000)} 秒后重试（第 ${i + 1}/${attempts} 次）：${name}`);
                    await Utils.randomDelay(lo, hi);
                }
                const ok = await this._claimCardOnceWithTimeout(card, { diag, name, attempt: i + 1 });
                if (ok) return true;
            }

            Utils.log("🟡", `卡片领取未确认（已重试 ${attempts} 次）：${name} [${diag.join(" ")}]`);
            return false;
        },

        async _claimCardOnceWithTimeout(card, { diag = [], name = "", attempt = 1 } = {}) {
            const label = name || card.title || card.offerId;
            let timer = null;
            const timeout = new Promise(resolve => {
                timer = setTimeout(() => {
                    diag.push(`timeout(${CLAIM_ONCE_TIMEOUT / 1000}s)`);
                    Utils.log("🔴", `单卡处理超时（第 ${attempt} 次尝试，${CLAIM_ONCE_TIMEOUT / 1000} 秒）：${label}，放弃这次尝试`);
                    resolve(false);
                }, CLAIM_ONCE_TIMEOUT);
            });
            try {
                return await Promise.race([this._claimCardOnce(card, { diag }), timeout]);
            } finally {
                if (timer) clearTimeout(timer);
            }
        },

        async _claimCardOnce(card, { skipWeb = false, diag = [] } = {}) {
            const offerId = card.offerId;
            const name = card.title || offerId;

            if (await this.isOfferCompleteAny(offerId, false) === true) {
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

            if (!skipWeb && card.levelGated && !card.appOnly) {
                const viaSearch = await this._claimLevelGatedViaAppSearch(card, { diag, name });
                if (viaSearch) return true;
            }

            if (!skipWeb && this._isAppSearchCard(card)) {

                const searchOk = await this.reportDailyActivity(card.destination);
                diag.push(searchOk ? "search(CDP已点击)" : "search(未处理)");
                if (searchOk) {
                    const deadline = Date.now() + 25 * 1000;
                    while (Date.now() < deadline) {
                        if (await this.isOfferCompleteAny(offerId, true) === true) {
                            Utils.log("🟢", "应用搜索领取成功：" + name);
                            return true;
                        }
                        await Utils.delay(5000);
                    }
                    diag.push("search(已点击未标记完成)");
                }
                this._markManualCard(offerId, name);
            } else if (!skipWeb && !card.hash) {
                diag.push("web(无hash)");
            } else if (!skipWeb && card.appOnly) {
                await this._claimViaAppChannel(card, { diag, name });
                if (await this.isOfferCompleteAny(offerId, true) === true) return true;
            } else if (!skipWeb && RewardsAuto.state.webNoAuth) {
                diag.push("web(未登录跳过)");
            } else if (!skipWeb && RewardsAuto.state.webFailStreak >= WEB_FAIL_LIMIT) {
                diag.push("web(本轮已熔断)");
            } else if (!skipWeb) {
                let webAccepted = false;
                let webErr = null;
                try {
                    webAccepted = await this.claimCardWeb(card);
                } catch (e) {
                    webErr = e;
                    diag.push(`web(${e.message})`);
                    if (/\b(401|403)\b/.test(String(e.message)) && !RewardsAuto.state.webNoAuth) {
                        RewardsAuto.state.webNoAuth = true;
                        Utils.log("🟡", `网页通道未登录或无权限（${e.message}），后续卡片改用 DAPI 通道`);
                    }
                }
                if (webAccepted) {
                    RewardsAuto.state.webFailStreak = 0;
                    await Utils.randomDelay(2000, 4000);
                    if (await this.isOfferCompleteAny(offerId, true) === true) {
                        Utils.log("🟢", `网页通道领取成功：${name}`);
                        return true;
                    }
                    diag.push("web(已发出但服务端未生效)");
                } else {
                    diag.push("web(请求未被接受)");
                    if (!RewardsAuto.state.webNoAuth) {
                        RewardsAuto.state.webFailStreak += 1;
                        Utils.log("🟠", `网页通道未成功（${name}）：${webErr ? webErr.message : "请求未被接受"}`
                            + `（连续 ${RewardsAuto.state.webFailStreak}/${WEB_FAIL_LIMIT} 次，超限后本轮改用 DAPI）`);
                    }
                }
            }

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
            if (await this.isOfferCompleteAny(offerId, true) === true) {
                Utils.log("🟢", `DAPI 上报已生效：${name}`);
                return true;
            }
            return false;
        },

        PAGE_BOX: {
            req: "Config.pageReq",
            res: "Config.pageRes",
            alive: "Config.pageAlive"
        },

        async pageServeOnce() {
            const req = GM_getValue(this.PAGE_BOX.req, null);
            if (!req || !req.id || req.done) return false;
            GM_setValue(this.PAGE_BOX.req, { id: req.id, url: req.url, headers: req.headers, body: req.body, at: req.at, done: true });
            const out = { id: req.id, at: Date.now(), status: 0, text: "", error: "" };
            try {
                const r = await fetch(req.url, {
                    method: "POST",
                    headers: req.headers || {},
                    body: req.body,
                    credentials: "include",
                    redirect: "follow"
                });
                out.status = r.status;
                out.text = String(await r.text()).slice(0, 4000);
            } catch (e) {
                out.error = String((e && e.message) || e);
            }
            GM_setValue(this.PAGE_BOX.res, out);
            return true;
        },

        startPageServer() {
            if (typeof GM_getValue !== "function") return;
            if (this._pageServerStarted) return;
            if (GM_getValue("Config.pageServerOff", false)) return;
            this._pageServerStarted = true;
            const tick = async () => {
                try {
                    if (GM_getValue("Config.pageServerOff", false)) { this._pageServerStarted = false; return; }
                    GM_setValue(this.PAGE_BOX.alive, Date.now());
                    await this.pageServeOnce();
                } catch (_) {}
                this._pageServerTimer = setTimeout(tick, 1500);
                if (this._pageServerTimer && typeof this._pageServerTimer.unref === "function") {
                    this._pageServerTimer.unref();
                }
            };
            this._pageServerTimer = setTimeout(tick, 600);
            if (this._pageServerTimer && typeof this._pageServerTimer.unref === "function") {
                this._pageServerTimer.unref();
            }
        },

        _pageChannelAlive() {
            const at = Number(GM_getValue(this.PAGE_BOX.alive, 0)) || 0;
            return at > 0 && (Date.now() - at) < 40 * 1000;
        },

        // 【已禁用自动开标签】页面代发通道改为「只借用已存在的 rewards 页面」。
        // 原来这里会用 GM_openInTab 自动开一个临时 rewards 页来代发请求，
        // 每轮都可能弹一个标签，很扰人。现在只认已经开着的页面：
        // 没有就返回 null，调用方会自然退回 xhr 通道（脚本仍能正常跑）。
        async _ensurePageChannel() {
            return null;
        },

        async viaPageChannel(url, headers, body, timeoutMs = 15000) {
            const id = Date.now() + "-" + Math.floor(Math.random() * 1e6);
            GM_setValue(this.PAGE_BOX.res, null);
            GM_setValue(this.PAGE_BOX.req, { id, url, headers, body, at: Date.now() });

            const pack = (res) => ({
                ok: res.status >= 200 && res.status < 300,
                status: res.status,
                text: res.text || "",
                error: res.error || ""
            });

            let listenerId = null;
            let settled = false;
            let result = null;

            if (typeof GM_addValueChangeListener !== "undefined") {
                try {
                    listenerId = GM_addValueChangeListener(this.PAGE_BOX.res, (name, oldV, newV) => {
                        if (settled || !newV || typeof newV !== "object") return;
                        if (newV.id !== id) return;
                        settled = true;
                        result = pack(newV);
                    });
                } catch (_) { listenerId = null; }
            }

            const deadline = Date.now() + timeoutMs;
            try {
                while (!settled && Date.now() < deadline) {
                    await Utils.delay(600);
                    const res = GM_getValue(this.PAGE_BOX.res, null);
                    if (res && res.id === id) {
                        settled = true;
                        result = pack(res);
                        break;
                    }
                }
            } finally {
                if (listenerId != null && typeof GM_removeValueChangeListener === "function") {
                    try { GM_removeValueChangeListener(listenerId); } catch (_) {}
                }
            }

            GM_setValue(this.PAGE_BOX.req, null);
            return settled ? result : null;
        },

        _actionLooksAccepted(res) {
            const text = String(res || "");
            if (!text) return false;
            if (/(?:^|\n)[0-9a-f]+:E\{/i.test(text) || /"digest"\s*:/.test(text)) return false;
            if (/^\s*<!doctype\s+html/i.test(text) || /<html[\s>]/i.test(text)) return false;

            const verdicts = [...text.matchAll(/\d+:(true|false)(?![\w{])/g)];
            if (verdicts.length > 0) {
                return verdicts[verdicts.length - 1][1] === "true";
            }
            return text.includes('"ok":true');
        },

        QUESTS: {
            // 桌面奖励应用「每周专属」（8 张子卡，按星期逐日解锁）
            weeklyPrefix: /WW_pcparent_RewardsApp_weekly_Exclusive/i,
            // 月度打卡（如 ENWW_pcparent_FY27_BingMonthlyPC_Nov_punchcard），前缀各月/各区不统一，
            // 所以只按 punchcard 这个特征识别，再排除掉已由 weeklyPrefix 负责的那些。
            monthlyHint: /punchcard/i,
            monthlyExclude: /RewardsApp_weekly_Exclusive/i
        },

        // 把 earn 页上识别出的 quest 入口分成两类：weekly（周专属）与 monthly（其它 punchcard）
        _classifyQuests(ids) {
            const weekly = [], monthly = [];
            for (const id of ids || []) {
                if (this.QUESTS.weeklyPrefix.test(id)) weekly.push(id);
                else if (this.QUESTS.monthlyHint.test(id) && !this.QUESTS.monthlyExclude.test(id)) monthly.push(id);
            }
            return { weekly, monthly };
        },

        _questLinksFromEarn(earnHtml) {

            const raw = String(earnHtml || "");
            const cleanEarn = raw.replace(/\\"/g, '"');
            const found = new Map();
            const add = (id) => {
                let q = String(id || "").split("?")[0].split("#")[0];
                try { q = decodeURIComponent(q); } catch (_) {}
                if (q && /punchcard/i.test(q) && !found.has(q)) found.set(q, q);
            };

            const text = this._flightText(raw);
            const reFlight = /\/earn\/quest\/([A-Za-z0-9_%.\-]+punchcard[A-Za-z0-9_%.\-]*)/g;
            let m;
            while ((m = reFlight.exec(text)) !== null) add(m[1]);

            const reOffer = /"offerId"\s*:\s*"([^"]*punchcard[^"]*)"/g;
            while ((m = reOffer.exec(cleanEarn)) !== null) add(m[1]);

            const reHref = /"href"\s*:\s*"(\/earn\/quest\/[^"]+)"/g;
            while ((m = reHref.exec(cleanEarn)) !== null) add(m[1].split("/").pop());

            const reHrefHtml = /href="(\/earn\/quest\/[^"]+)"/g;
            while ((m = reHrefHtml.exec(cleanEarn)) !== null) add(m[1].split("/").pop());

            const reEscaped = /\\"href\\":\\"(\/earn\/quest\/[^\\"]+)/g;
            while ((m = reEscaped.exec(raw)) !== null) add(m[1].split("/").pop());

            return [...found.keys()];
        },

        // ============================================================
        // quest 详情页真实状态解析（唯一可信来源）
        //
        // 实测结论（见 _probe/ 下的探针脚本）：
        //   ① 服务端只把「未完成」的子卡放进 RSC payload（带 offerId/hash/PUBL）。
        //      已完成的子卡会被整段省略（连 offerId 都没有）。
        //      所以「解析到 0 张卡」绝不能当成「全部完成」——旧代码正是这样报假成功的。
        //   ② 页面顶部有权威计数器「状态: N/M 个任务」，只有 N===M 才算真的做完。
        //   ③ 每张卡的图标（实测）：
        //        已完成  = 图标容器带 bg-statusSuccessRewardsBg（里面是对勾 path m1.147 2.919）
        //        未解锁  = 行内显式 "isLocked":true，图标是空圈 border-ctrlChoiceBaseStrokeRest
        //        可领取  = 空圈但**没有** isLocked，且带 offerId + hash
        //   ④ 坑：CTA 按钮上的 "M6.25 4.5A1.75" 是「外链箭头」不是锁，
        //      拿它判锁会把每张卡都当成锁定（1.4.0 备份里就是这么写的）。
        // ============================================================
        _questCheckIcon: /bg-statusSuccessRewardsBg/,
        _questLockRing: /border-ctrlChoiceBaseStrokeRest/,

        _parseQuestState(html) {
            const raw = String(html || "");
            const flat = this._flightText(raw);
            const out = {
                progress: "", done: 0, total: 0, allDone: false,
                unavailable: false, signedOut: false, rows: [], htmlLen: raw.length
            };

            out.signedOut = /<title>登录<\/title>|Sign in to your account|oauth20_authorize/i.test(flat);
            out.unavailable = /此优惠对你不可用/.test(flat);

            const pm = flat.match(/状态:[\s\S]{0,240}?(\d+)\s*\/\s*(\d+)\s*个任务/);
            if (pm) {
                out.done = Number(pm[1]);
                out.total = Number(pm[2]);
                out.progress = out.done + "/" + out.total;
            }

            // 每张卡 = 一个 "flex flex-row gap-2" 行容器；用行起点切片，避免跨行串味。
            const MARK = "\"className\":\"flex flex-row gap-2";
            const starts = [];
            let at = 0;
            while ((at = flat.indexOf(MARK, at)) !== -1) {
                starts.push(at);
                at += MARK.length;
            }
            for (let i = 0; i < starts.length; i++) {
                const seg = flat.slice(starts[i],
                    i + 1 < starts.length ? starts[i + 1] : starts[i] + 20000);
                const tm = seg.match(/"h3",null,\{"className":"[^"]*","children":"((?:[^"\\]|\\.)*)"/);
                if (!tm) continue;
                let title = tm[1];
                try { title = JSON.parse("\"" + title + "\""); } catch (_) {}

                const icon = seg.slice(0, 900);
                const isCompleted = this._questCheckIcon.test(icon);
                const explicitLock = /"isLocked":true/.test(seg);
                const isLocked = !isCompleted && (explicitLock || !this._questLockRing.test(icon));

                const offerId = (seg.match(/"offerId":"([^"]+)"/) || [])[1] || "";
                const hash = (seg.match(/"hash":"([^"]+)"/) || [])[1] || "";
                let href = (seg.match(/"href":"((?:[^"\\]|\\.)*)"/) || [])[1] || "";
                try { href = JSON.parse("\"" + href + "\""); } catch (_) {}

                out.rows.push({
                    title: title, offerId: offerId, hash: hash, href: href,
                    isCompleted: isCompleted, isLocked: isLocked,
                    // 只要服务端下发了 offerId + hash，就具备交卷条件。
                    // 页面上的「锁定」只是显示态，不构成交卷障碍（实测锁定的卡也能交卷，
                    // 是否真记账由交卷后的进度复核决定），所以这里不再用 isLocked 卡住。
                    claimable: !isCompleted && !!offerId && !!hash
                });
            }

            // 只有「计数器满」且「所有行都显示对勾」才算全部完成；
            // 解析不到任何行时，只要计数器不满就绝不算完成。
            out.allDone = out.total > 0 && out.done >= out.total
                && out.rows.every(r => r.isCompleted);
            return out;
        },


        // 读一次 quest 页的权威状态。优先用 CDP 页面同源 fetch（带登录态、同 Origin），
        // 失败再退回后台 GM_xmlhttpRequest。
        async fetchQuestState(parentId) {
            const url = "https://rewards.bing.com/earn/quest/" + encodeURIComponent(parentId);
            let html = "", via = "";

            if (GM_getValue("Config.questViaCdp", true) && typeof WebSocket !== "undefined") {
                try {
                    if (await CDP.available()) {
                        const page = await CDP.earnPage();
                        if (page && page.webSocketDebuggerUrl) {
                            if (!CDP._ws || CDP._ws.readyState !== 1) {
                                await CDP.connect(page.webSocketDebuggerUrl);
                            }
                            const got = await CDP.fetchPageText(url);
                            if (got) { html = got; via = "cdp"; }
                        }
                    }
                } catch (_) {}
            }
            if (!html) {
                try {
                    html = await Utils.xhr({ url, headers: RewardsAuto.desktopAppHeaders });
                    via = "xhr";
                } catch (_) {}
            }
            if (!html) {
                return { parentId, url, via: via || "none", ok: false, html: "",
                    progress: "", done: 0, total: 0, allDone: false,
                    unavailable: false, signedOut: false, rows: [] };
            }

            const st = this._parseQuestState(html);
            return Object.assign({ parentId, url, via, ok: true, html }, st);
        },




        async _rawXhr(options) {
            const start = Date.now();
            // 先试同源原生 fetch：脚本在 rewards 页面里时，浏览器会把 Origin 写成
            // https://rewards.bing.com，server action 才会被受理（后台直发恒 500）。
            if (this._sameOriginNow && this._sameOriginNow() && /^https:\/\/rewards\.bing\.com\//i.test(String(options && options.url || ""))) {
                try {
                    const r = await this._sameOriginFetch(options.url, options.headers, options.data);
                    if (r.status > 0) {
                        return { status: r.status, text: r.text, headers: "", cost: (Date.now() - start) / 1000, via: "local" };
                    }
                } catch (_) {}
            }
            return await new Promise((resolve) => {
                try {
                    GM_xmlhttpRequest({

                        ...options,
                        timeout: Number(options && options.timeout) || 15000,
                        onload: (res) => resolve({
                            status: res.status,
                            text: String(res.responseText || ""),
                            headers: res.responseHeaders || "",
                            cost: (Date.now() - start) / 1000
                        }),
                        onerror: (err) => resolve({
                            status: 0,
                            text: String((err && err.error) || "网络错误"),
                            headers: "",
                            cost: (Date.now() - start) / 1000
                        }),
                        ontimeout: () => resolve({
                            status: -1,
                            text: "请求超时",
                            headers: "",
                            cost: (Date.now() - start) / 1000
                        })
                    });
                } catch (e) {
                    resolve({ status: 0, text: String(e.message), headers: "", cost: 0 });
                }
            });
        },

        _questSubmitVariants() {
            const SRC = "https://rewards.bing.com";
            return [
                { name: "earn页+origin", toEarn: true, headers: { origin: SRC } },
                { name: "quest页+origin", toEarn: false, headers: { origin: SRC } },
                { name: "earn页+普通UA", toEarn: true, headers: { origin: SRC }, plainIdentity: true }
            ];
        },

        async _probeQuestVariant(pageUrl, parentId, card) {
            const saved = GM_getValue("Config.questVariant", "");
            const all = this._questSubmitVariants();
            const ordered = saved
                ? [...all.filter(v => v.name === saved), ...all.filter(v => v.name !== saved)]
                : all;
            const tried = [];
            let last = null;
            for (const v of ordered) {
                const r = await this._submitQuestOnce(pageUrl, parentId, card, v);
                last = r;
                tried.push(`${v.name}=${r.status}`);
                if (r.accepted) {
                    if (saved !== v.name) {
                        GM_setValue("Config.questVariant", v.name);
                        if (saved) Utils.log("🖥️", `桌面任务交卷形态已切换：${saved} → ${v.name}`);
                    }
                    return { variant: v, result: r, tried };
                }
                if (r.status === 401 || r.status === 403) break;
            }
            return { variant: null, result: last, tried };
        },

        async _submitQuestOnce(pageUrl, parentId, card, variant) {
            const nextAction = RewardsAuto._nextAction || GM_getValue("Config.nextAction", ActionMap.FALLBACK.reportActivity);
            const dpl = RewardsAuto._dpl || GM_getValue("Config.dpl", "");
            const payload = JSON.stringify([card.hash, 11, {
                offerid: card.offerId,
                isPromotional: "$undefined",
                timezoneOffset: "-480"
            }]);
            const target = variant.toEarn ? "https://rewards.bing.com/earn" : pageUrl;
            const headers = {
                "content-type": "text/plain;charset=UTF-8",
                "next-action": nextAction,
                "next-router-state-tree": variant.toEarn
                    ? Utils.routerStateTree("earn")
                    : Utils.questRouterStateTree(parentId),
                "referer": target,
                "accept": "text/x-component",
                "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
                ...(dpl ? { "x-deployment-id": dpl } : {})
            };
            if (!variant.plainIdentity) Object.assign(headers, RewardsAuto.desktopAppHeaders);
            else headers["user-agent"] = RewardsAuto.ua.pc;
            Object.assign(headers, variant.headers);

            const res = await this._rawXhr({ method: "POST", url: target, headers, data: payload });
            return {
                status: res.status,
                accepted: res.status >= 200 && res.status < 300 && this._actionLooksAccepted(res.text),
                text: res.text,
                cost: res.cost,
                variant: variant.name
            };
        },

        _questDiag(res) {
            const t = String((res && res.text) || "");
            const st = res ? res.status : 0;
            if (st === 0) {
                return `请求未发出（${t.slice(0, 80) || "无响应"}）—— 多半是 XHR 层拒绝了禁改头或缺 @connect 权限`;
            }
            if (st === -1) return "请求超时";
            let kind = "未知";
            if (/login\.live\.com|oauth20_authorize|<title>登录<\/title>|Sign in to/i.test(t)) kind = "登录页";
            else if (/<title>Bing<\/title>|sc_error|class="panda"/i.test(t)) kind = "必应风控页";
            else if (/[0-9a-f]+:E\{|"digest"\s*:/.test(t)) kind = "Next.js错误帧";
            else if (/<html/i.test(t)) kind = "HTML页面";
            const body = t.replace(/\s+/g, " ").slice(0, 160);
            return `HTTP ${st}（${kind}，${res ? res.cost.toFixed(2) : "?"}秒）${body ? " body=" + body : ""}`;
        },

        // ============================================================
        // 交卷：只有「响应明确 true」+「页面计数器真的 +1」才算成功。
        // 旧代码两层都太松：解析到 0 张卡当完成、只看 accepted 不看进度变化。
        // ============================================================
        async submitQuestCard(parentId, card) {
            const pageUrl = "https://rewards.bing.com/earn/quest/" + encodeURIComponent(parentId);
            const nextAction = RewardsAuto._nextAction || GM_getValue("Config.nextAction", ActionMap.FALLBACK.reportActivity);
            const dpl = RewardsAuto._dpl || GM_getValue("Config.dpl", "");
            const tz = String(new Date().getTimezoneOffset());
            const payload = JSON.stringify([card.hash, 11, {
                offerid: card.offerId,
                isPromotional: "$undefined",
                timezoneOffset: tz
            }]);
            const baseHeaders = {
                "content-type": "text/plain;charset=UTF-8",
                "next-action": nextAction,
                "next-router-state-tree": Utils.questRouterStateTree(parentId),
                "referer": pageUrl,
                "accept": "text/x-component",
                "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
                ...(dpl ? { "x-deployment-id": dpl } : {}),
                ...RewardsAuto.desktopAppHeaders
            };

            // 交卷前先记下计数器，事后用它判断「服务端到底有没有记账」
            let before = null;
            try { before = await this.fetchQuestState(parentId); } catch (_) {}

            const tries = [];
            const attempt = async (label, runner) => {
                let r;
                try {
                    r = await runner();
                } catch (e) {
                    r = { accepted: false, status: 0, text: String((e && e.message) || e) };
                }
                tries.push(`${label}=${r.status}${r.accepted ? "✓" : "✗"}`);
                return r;
            };

            let hit = null;

            // ① CDP 页面通道（Origin 同源，最稳）
            if (GM_getValue("Config.questViaCdp", true) && typeof WebSocket !== "undefined") {
                const r = await attempt("cdp", async () => {
                    if (!(await CDP.available())) return { accepted: false, status: 0, text: "CDP 不可用" };
                    const page = await CDP.earnPage();
                    if (!page || !page.webSocketDebuggerUrl) return { accepted: false, status: 0, text: "没有 rewards 页面" };
                    if (!CDP._ws || CDP._ws.readyState !== 1) await CDP.connect(page.webSocketDebuggerUrl);
                    const res = await CDP.claimInPage(pageUrl, baseHeaders, payload);
                    return {
                        accepted: res.status >= 200 && res.status < 300 && this._actionLooksAccepted(res.text),
                        status: res.status, text: res.text
                    };
                });
                if (r.accepted) hit = Object.assign({ variant: "CDP页面通道" }, r);
                // 这里不能 CDP.close()：后面还要用它做「进度复核」，
                // 关掉连接会让之后所有 fetchPageText 静默失败（旧版就踩过这个坑）。
            }

            // ② 页面代发服务
            if (!hit && GM_getValue("Config.usePageChannel", false)) {
                const r = await attempt("proxy", async () => {
                    if (!this._pageChannelAlive()) return { accepted: false, status: 0, text: "页面代发不在线" };
                    if (!this._claimPageTab) await this._ensurePageChannel();
                    if (!this._pageChannelAlive()) return { accepted: false, status: 0, text: "页面代发不在线" };
                    const res = await this.viaPageChannel(pageUrl, baseHeaders, payload);
                    if (!res || res.error) return { accepted: false, status: 0, text: String((res && res.error) || "无返回") };
                    return {
                        accepted: res.status >= 200 && res.status < 300 && this._actionLooksAccepted(res.text),
                        status: res.status, text: res.text
                    };
                });
                if (r.accepted) hit = Object.assign({ variant: "页面通道" }, r);
            }

            // ③ 后台直发（Origin 是扩展源，常被 500，仅兜底）
            if (!hit) {
                const variants = this._questSubmitVariants();
                for (const v of variants) {
                    const r = await attempt(v.name, () => this._submitQuestOnce(pageUrl, parentId, card, v));
                    if (r.accepted) { hit = Object.assign({ variant: v.name }, r); break; }
                    if (r.status === 401 || r.status === 403) break;
                }
            }

            if (!hit) {
                const last = tries.length ? tries[tries.length - 1] : "-";
                return { accepted: false, confirmed: false, raw: "", status: 0,
                    tried: tries, diag: `交卷未受理（${last}）` };
            }

            // ★ 复核：必须看到页面计数器比交卷前 +1，才算真的记账
            await Utils.randomDelay(2500, 4000);
            let after = null;
            try { after = await this.fetchQuestState(parentId); } catch (_) {}
            if (!after || !after.ok) {
                return Object.assign({}, hit, {
                    confirmed: false,
                    note: "已受理但复核失败（读不到页面），按待定处理"
                });
            }
            const grew = (before && before.ok) ? after.done > before.done : false;
            const rowNowDone = after.rows.some(r => r.title === card.title && r.isCompleted);
            if (grew || rowNowDone) {
                return Object.assign({}, hit, { confirmed: true, beforeProgress: before && before.progress, afterProgress: after.progress });
            }
            return Object.assign({}, hit, {
                confirmed: false,
                beforeProgress: before && before.progress,
                afterProgress: after.progress,
                note: `交卷返回受理，但账没记上（进度 ${before && before.progress || "?"} → ${after.progress || "?"}）`
            });
        },


        async runDesktopWeeklyQuests() {
            Utils.log("🖥️", "扫描桌面奖励应用专属任务…");

            try { await this.getCookieHeader(); } catch (_) {}
            let encEarn;
            try {

                encEarn = await Utils.xhr({
                    url: "https://rewards.bing.com/earn",

                    headers: {
                        ...RewardsAuto.desktopAppHeaders
                    }
                });
            } catch (eEarn) {
                Utils.log("🔴", `桌面专属任务：拉取 earn 页失败（${eEarn.message}），本轮跳过`);
                RewardsAuto.state.weeklyQuestLeft = [];
                RewardsAuto.state.weeklyQuestUnknown = 1;   // 读不到 → 收尾播报里如实说「状态未知」
                return { found: 0, done: 0, pending: 0 };
            }
            if (!encEarn) {
                Utils.log("🔴", "桌面专属任务：earn 页返回空，本轮跳过");
                RewardsAuto.state.weeklyQuestLeft = [];
                RewardsAuto.state.weeklyQuestUnknown = 1;
                return { found: 0, done: 0, pending: 0 };
            }

            const earnLen = String(encEarn).length;
            const looksLogin = /<title>登录<\/title>|Sign in to your account|oauth20_authorize/i.test(String(encEarn));
            if (looksLogin || earnLen < 60000) {
                Utils.log("🟡", `桌面专属任务：earn 页疑似未登录（长度 ${earnLen}，`
                    + `${looksLogin ? "是登录页" : "比正常页小很多"}）——`
                    + `请检查 GM_cookie 是否授权、账号是否已登录`);
            }

            const allQuestIds = this._questLinksFromEarn(encEarn);
            const { weekly: weeklyIds, monthly: monthlyIds } = this._classifyQuests(allQuestIds);
            const questIds = [...weeklyIds, ...monthlyIds];
            if (questIds.length === 0) {
                Utils.log("🖥️", "本轮没有桌面奖励应用专属任务，也没有月度打卡"
                    + `（earn 页 ${earnLen} 字节，识别到 ${allQuestIds.length} 个 quest 入口`
                    + (allQuestIds.length ? `：${allQuestIds.join("、")}` : "")
                    + "）");
                RewardsAuto.state.weeklyQuestLeft = [];
                RewardsAuto.state.weeklyQuestUnknown = 0;   // 本周确实没有桌面任务 → 不算没完成
                RewardsAuto.state.weeklyQuestScanned = true; // 「确认没有」也是有效结论
                return { found: 0, done: 0, pending: 0 };
            }
            if (weeklyIds.length) {
                Utils.log("🖥️", `发现 ${weeklyIds.length} 个桌面专属任务入口：`
                    + weeklyIds.map(id => id.replace(/^WW_pcparent_RewardsApp_weekly_Exclusive_?/i, "")).join("、"));
            } else {
                Utils.log("🖥️", "本周没有桌面奖励应用专属任务（可能已完成或本周未投放）");
            }
            if (monthlyIds.length) {
                Utils.log("📅", `发现 ${monthlyIds.length} 个月度打卡任务：`
                    + monthlyIds.map(id => id.replace(/_(pcparent|punchcard).*$/i, "")).join("、"));
            }

            let totalDone = 0, totalFound = 0, totalPending = 0, totalFailed = 0;
            // 收尾播报要「逐项点名」，所以这里把没做完的卡（含是否未解锁）收集起来
            const leftAll = [];
            let unknownParents = 0;
            for (const parentId of questIds) {
                let state;
                try {
                    state = await this.fetchQuestState(parentId);
                } catch (eSt) {
                    Utils.log("🔴", `桌面专属任务：读取 ${parentId} 失败（${eSt.message}），跳过这一个`);
                    totalFailed++;
                    continue;
                }
                if (!state || !state.ok) {
                    Utils.log("🔴", `桌面专属任务：${parentId} 页面读不到内容，本轮跳过（不作任何“已完成”判断）`);
                    totalFailed++;
                    continue;
                }
                if (state.signedOut) {
                    Utils.log("🔴", "桌面专属任务：quest 页是登录页，请重新登录后下一轮再试");
                    totalFailed++;
                    continue;
                }
                if (state.unavailable) {
                    Utils.log("🟡", `桌面专属任务：${parentId} 对该账号不可用（页面提示「此优惠对你不可用」），跳过`);
                    continue;
                }

                // 进度必须来自页面计数器；计数器读不到就不能下任何结论
                if (!state.total) {
                    if (state.unavailable || !state.rows.length) {
                        // 页面里既没有卡片、也没有计数器：这个入口当前无活动可做
                        // （实测 WW_pcparent_FY27_Duolingo3M_punchcard 就是这种空壳，直接落地首页）。
                        // 这本身不说明“已完成”，所以绝不写完成日志。
                        Utils.log("🖥️", `桌面专属任务：${parentId} 当前没有活动面板（`
                            + `回包 ${state.html ? state.html.length : 0} 字节，通道 ${state.via}），跳过`);
                        continue;
                    }
                    Utils.log("🟡", `桌面专属任务：${parentId} 读不到「N/M 个任务」计数器`
                        + `（回包 ${state.html ? state.html.length : 0} 字节，通道 ${state.via}），`
                        + `为避免误判，本轮跳过这个入口`);
                    totalFailed++;
                    continue;
                }

                totalFound += state.rows.length;
                Utils.log("🖥️", `桌面专属任务 ${parentId}：进度 ${state.progress}`
                    + `（页面解析 ${state.rows.length} 张，通道 ${state.via}）`);

                if (state.allDone) {
                    Utils.log("✅", `桌面专属任务已全部完成：${state.progress}（${parentId}）`);
                    continue;
                }

                const open = state.rows.filter(r => !r.isCompleted);
                // 【用户要的行为】不要死盯着星期/解锁与否。
                // 服务端只要给了 offerId + hash，就说明这张卡此刻是「可交卷」的，
                // 就去尝试完成它；是否真的记分由交卷后的进度复核来裁决。
                // 这样既不会漏掉同时解锁的多张卡，也不会把「能做的」当「没到日子」跳过。
                const actionable = open.filter(r => !!r.offerId && !!r.hash);
                const lockedOpen = open.filter(r => r.isLocked);
                if (actionable.length === 0) {
                    if (open.length === 0) {
                        Utils.log("✅", `桌面专属任务：当前进度 ${state.progress}，没有待办卡`);
                    } else {
                        Utils.log("🖥️", `桌面专属任务：${open.length} 张待办都没有下发 hash（`
                            + `需在奖励应用内完成，脚本无法直接交卷），本轮不处理`
                            + `：${open.map(r => r.title).join("、")}`);
                    }
                } else {
                    Utils.log("🖥️", `桌面奖励应用专属任务：${actionable.length} 张可交卷（进度 ${state.progress}`
                        + (lockedOpen.length ? `，其中 ${lockedOpen.length} 张页面显示为锁定，照样尝试` : "")
                        + `）（${parentId}）`);
                    for (const c of actionable) {
                        Utils.log("🖥️", `  · [${c.isLocked ? "显示锁定" : "已解锁"}] ${c.title}`);
                    }
                }

                let doneHere = 0, failedHere = 0;
                for (const card of actionable) {
                    if (!card.claimable) {
                        failedHere++;
                        continue;
                    }

                    // 真做不了就不要硬交卷：先确认这张卡此刻仍然可领取
                    let guard;
                    try {
                        guard = await this.fetchQuestState(parentId);
                    } catch (_) {}
                    const fresh = guard && guard.ok ? guard.rows.find(r => r.title === card.title) : null;
                    if (fresh && fresh.isCompleted) {
                        Utils.log("✅", `  该卡已完成，跳过：${card.title}`);
                        continue;
                    }
                    // 【实测结论】这张卡不需要「先打开目标页 / 上报应用搜索」。
                    // 对照实验（_probe/test-tree-matrix.mjs）：
                    //   真正解锁的卡 → 直接交卷回 1:true，进度 0/5 → 1/5，真记账；
                    //   页面显示锁定的卡 → 无论访问 / 上报 / 交卷，进度都不动。
                    // 之前那套「导航到 bing 页再上报」只会让浏览器多开标签、来回跳页，
                    // 对是否记账没有帮助，所以整段移除。
                    // 记账与否仍然只看下面交卷后的进度复核，不做任何假设。

                    Utils.log("🎯", `  交卷：${card.title}（${card.offerId}）`);
                    let r = null;
                    try {
                        r = await this.submitQuestCard(parentId, card);
                    } catch (eSubmit) {
                        r = { accepted: false, confirmed: false, raw: String(eSubmit.message), status: 0 };
                    }

                    if (!r || !r.confirmed) {
                        failedHere++;
                        const why = r && r.note ? r.note
                            : r && r.diag ? r.diag : this._questReason(r && r.raw);
                        Utils.log("🟠", `桌面任务未确认成功：${card.title} → ${why}`);
                        if (r && r.tried && r.tried.length) {
                            Utils.log("🖥️", `  形态尝试：${r.tried.join(" / ")}`);
                        }
                        continue;
                    }

                    doneHere++;
                    Utils.log("🟢", `桌面专属任务完成（服务端已记账）：${card.title}`
                        + (r.beforeProgress ? `　进度 ${r.beforeProgress} → ${r.afterProgress}` : "")
                        + (r.variant ? `　[${r.variant}]` : ""));
                    await Utils.randomDelay(2000, 3500);
                }
                totalDone += doneHere;

                // 收尾用「页面计数器」说话，不再用「解析到 0 张卡」当完成
                let verify = null;
                try { verify = await this.fetchQuestState(parentId); } catch (_) {}
                if (verify && verify.ok && verify.allDone) {
                    Utils.logQuiet("🔵", `桌面应用每周专属任务全部完成：${verify.progress}`
                        + `（本次完成 ${doneHere} 张，失败 ${failedHere} 张）`);
                } else if (verify && verify.ok) {
                    const left = verify.rows.filter(r => !r.isCompleted);
                    const leftLocked = left.filter(r => r.isLocked).length;
                    const leftOpen = left.length - leftLocked;
                    for (const r of left) leftAll.push({ title: r.title, locked: !!r.isLocked });
                    // 只有「确实还有待办」时才提示剩余；不要在同一次里既说失败又说“都处理完了”
                    Utils.log(doneHere > 0 ? "🟢" : (failedHere > 0 ? "🟠" : "🟡"),
                        `桌面应用每周专属任务：本次完成 ${doneHere} 张、失败 ${failedHere} 张，`
                        + `目前进度 ${verify.progress || "?"}`
                        + (leftOpen > 0
                            ? `，仍剩 ${leftOpen} 张未完成（${left.filter(r => !r.isLocked).map(r => r.title).join("、")}）`
                            : "")
                        + (leftLocked > 0
                            ? `（另有 ${leftLocked} 张页面显示未解锁：${left.filter(r => r.isLocked).map(r => r.title).join("、")}）`
                            : "")
                        + (left.length === 0 ? "，已全部完成" : ""));
                } else {
                    unknownParents++;
                    Utils.log("🟡", `桌面应用每周专属任务：本次完成 ${doneHere} 张、失败 ${failedHere} 张`
                        + "，但收尾复核读不到页面，本轮不做最终结论");
                }
            }
            RewardsAuto.state.weeklyQuestLeft = leftAll;
            RewardsAuto.state.weeklyQuestUnknown = totalFailed + unknownParents;
            RewardsAuto.state.weeklyQuestScanned = (totalFailed + unknownParents) === 0;
            if (totalFailed > 0) {
                // 读取失败会每轮复现，压成 6 小时一条，别每轮都推
                Utils.notifyKeyed("desktop-read-fail", "🟠",
                    `桌面专属任务本轮有 ${totalFailed} 个入口读取失败，下一轮会再试`, 6 * 60 * 60 * 1000);
            }
            return { found: totalFound, done: totalDone, pending: totalPending, failed: totalFailed };
        },

        _questReason(raw) {
            const t = String(raw || "");
            if (!t) return "无响应";
            if (/HTTP 500/.test(t)) return "HTTP 500（必应风控拦截，多半是 Origin/UA 特征）";
            if (/\b(401|403)\b/.test(t)) return "未登录或无权限，请检查 Cookie / 登录态";
            if (/HTTP (404|405)/.test(t)) return "接口/路由不存在（action ID 或 quest 页面可能已变更）";
            if (/请求超时|timeout/i.test(t)) return "请求超时";
            return t.replace(/\s+/g, " ").slice(0, 110);
        },

        async postAction(req, { savedKey = "Config.actionVariant" } = {}) {
            const saved = String(GM_getValue(savedKey, "") || "");
            const allowed = BrowserEnv.channelOrder();
            // 「记住的通道」只在它当前仍然可用时才排到最前。
            // 关键：local（页面同源）是唯一稳定不 500 的通道，绝不能被历史记录的 xhr 挤到后面。
            const savedUsable = saved && allowed.includes(saved) && saved !== "xhr";
            const order = savedUsable
                ? [saved, ...allowed.filter(v => v !== saved)]
                : allowed;
            const tried = [];
            let accepted = null;
            let last = null;
            for (const v of order) {
                let r;
                try {
                    r = await this._postVia(v, req);
                } catch (e) {
                    r = { ok: false, status: 0, text: String((e && e.message) || e), variant: v };
                }
                tried.push(`${v}=${r.status}${r.ok ? "✓" : "✗"}`);
                if (r.status > 0) last = r;
                if (r.ok) { accepted = r; break; }
                if (r.status === 401 || r.status === 403) break;
            }
            if (accepted && accepted.variant !== saved) {
                GM_setValue(savedKey, accepted.variant);
                if (saved) Utils.log("🎁", `动作请求通道已切换：${saved} → ${accepted.variant}`);
            }
            return accepted || {
                ok: false,
                status: last ? last.status : 0,
                text: last ? last.text : "",
                variant: last ? last.variant : "",
                tried
            };
        },

        async _postVia(variant, req) {
            if (variant === "page") {
                if (!(await CDP.available())) return { ok: false, status: 0, text: "CDP 不可用", variant };
                const page = await this._anyRewardsPage();
                if (!page) return { ok: false, status: 0, text: "没有可用的 rewards 页面", variant };
                if (!CDP._ws || CDP._ws.readyState !== 1) await CDP.connect(page.webSocketDebuggerUrl);
                const r = await CDP.claimInPage(req.url, req.headers, req.data);
                return {
                    ok: r.status >= 200 && r.status < 300 && this._actionLooksAccepted(r.text),
                    status: r.status, text: r.text, variant
                };
            }
            if (variant === "local") {
                // 脚本自己就跑在 rewards.bing.com 页面里：直接用页面原生 fetch，
                // Origin 由浏览器写成 https://rewards.bing.com —— 与 CDP 通道等价，但不需要调试端口。
                if (!this._sameOriginNow()) {
                    return { ok: false, status: 0, text: "当前不在 rewards 页面", variant };
                }
                const r = await this._sameOriginFetch(req.url, req.headers, req.data);
                return {
                    ok: r.status >= 200 && r.status < 300 && this._actionLooksAccepted(r.text),
                    status: r.status, text: r.text, variant
                };
            }
            if (variant === "proxy") {
                if (!this._pageChannelAlive()) return { ok: false, status: 0, text: "页面代发服务不在线", variant };
                const r = await this.viaPageChannel(req.url, req.headers, req.data, 20000);
                if (!r) return { ok: false, status: 0, text: "页面代发超时", variant };
                return {
                    ok: r.status >= 200 && r.status < 300 && this._actionLooksAccepted(r.text),
                    status: r.status, text: r.text || r.error || "", variant
                };
            }
            const r = await this._rawXhr({ method: "POST", url: req.url, headers: req.headers, data: req.data });
            return {
                ok: r.status >= 200 && r.status < 300 && this._actionLooksAccepted(r.text),
                status: r.status, text: r.text, variant
            };
        },

        // 当前上下文是否就是 rewards.bing.com（脚本以普通脚本注入该页时为真）
        _sameOriginNow() {
            try {
                return Utils.hasDOM()
                    && typeof location !== "undefined"
                    && /^https:/i.test(String(location.protocol))
                    && /(^|\.)rewards\.bing\.com$/i.test(String(location.hostname || ""));
            } catch (_) {
                return false;
            }
        },

        // 在页面上下文用原生 fetch 发同源请求。浏览器会自动补 Origin: https://rewards.bing.com
        async _sameOriginFetch(url, headers, body) {
            try {
                const r = await fetch(url, {
                    method: "POST",
                    headers: headers || {},
                    body: body,
                    credentials: "include",
                    redirect: "follow"
                });
                const text = String(await r.text()).slice(0, 4000);
                return { status: r.status, text };
            } catch (e) {
                return { status: 0, text: String((e && e.message) || e) };
            }
        },

        async _anyRewardsPage() {
            const list = await CDP.targets();
            if (!list) return null;
            const pages = list.filter(t => t.type === "page" && t.url && /^https:\/\/rewards\.bing\.com\//i.test(t.url));
            if (!pages.length) return null;
            return pages.find(t => /\/earn/i.test(t.url)) || pages[0];
        },

        async claimCardWeb(card, { appChannel = false } = {}) {
            const useAppUA = appChannel || card.appOnly === true || card.kind === "desktop_app";
            const isDash = card.kind === "daily" || card.kind === "streak" || card.source === "getuserinfo";
            const pageUrl = card.kind === "desktop_app"
                ? (card.url || "https://rewards.bing.com/earn")
                : (isDash ? "https://rewards.bing.com/dashboard" : "https://rewards.bing.com/earn");
            const referer = card.url || pageUrl;
            const segment = isDash ? "dashboard" : "earn";
            let nextAction = RewardsAuto._nextAction || GM_getValue("Config.nextAction", ActionMap.FALLBACK.reportActivity);

            const extraAppHeaders = card.kind === "desktop_app" ? RewardsAuto.desktopAppHeaders : {};
            const dpl = RewardsAuto._dpl || GM_getValue("Config.dpl", "");
            const buildHeaders = () => ({
                "content-type": "text/plain;charset=UTF-8",
                "next-action": nextAction,
                "referer": referer,

                "next-router-state-tree": Utils.routerStateTree(segment),
                "accept": "text/x-component",
                "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
                ...(dpl ? { "x-deployment-id": dpl } : {}),
                ...extraAppHeaders,
                "user-agent": useAppUA ? RewardsAuto.ua.rewardsApp : RewardsAuto.ua.pc
            });
            const payload = JSON.stringify([card.hash, 11, { offerid: card.offerId, isPromotional: "$undefined", timezoneOffset: "-480" }]);

            try {

                const hit = await this.postAction(
                    { url: pageUrl, headers: buildHeaders(), data: payload },
                    { savedKey: "Config.claimActionVariant" }
                );
                const accepted = !!hit.ok;

                if (!accepted || GM_getValue("Config.debugDAPI", false)) {
                    Utils.log("🔬", `交卷响应(${String(card.offerId).slice(0, 36)})：`
                        + `受理=${accepted} 通道=${hit.variant || "无"}${hit.tried ? `(${hit.tried})` : ""} `
                        + `ua=${useAppUA ? "app" : "pc"} dpl=${dpl || "无"} `
                        + `hash=${String(card.hash || "").slice(0, 20)} appOnly=${!!card.appOnly} `
                        + `src=${card.source || "-"} kind=${card.kind || "-"} `
                        + `body=${JSON.stringify(String(hit.text || "").replace(/\s+/g, " ").slice(0, 240))}`);
                }
                if (accepted) {
                    this._webCompleteCache = null;
                    return true;
                }
                if (hit.status === 401 || hit.status === 403) {
                    if (!RewardsAuto.state.webNoAuth) {
                        RewardsAuto.state.webNoAuth = true;
                        Utils.log("🟡", `网页通道未登录或无权限（HTTP ${hit.status}），后续卡片改用 DAPI 通道`);
                    }
                    return false;
                }
                if (hit.status === 503) return false;
                if (String(hit.text || "").includes("404") || hit.status === 404) {
                    Utils.log("🟡", "Server Action ID 可能已更新，尝试动态探测...");
                    try {
                        ActionMap.clear();
                        const earnHtml = await Utils.xhr({ url: "https://rewards.bing.com/earn" });
                        nextAction = await this.getNextActionHash(earnHtml);
                        const retry = await this.postAction(
                            { url: pageUrl, headers: buildHeaders(), data: payload },
                            { savedKey: "Config.claimActionVariant" }
                        );
                        if (retry.ok) {
                            this._webCompleteCache = null;
                            return true;
                        }
                    } catch (_) {}
                }
            } catch (e2) {

                Utils.log("🔬", `交卷异常(${String(card.offerId).slice(0, 36)})：`
                    + `ua=${useAppUA ? "app" : "pc"} dpl=${dpl || "无"} kind=${card.kind || "-"} `
                    + `err=${e2.message}`);

                if (/HTTP 503/.test(String(e2.message))) {
                    return false;
                }
                if (/\b(401|403)\b/.test(String(e2.message))) {
                    if (!RewardsAuto.state.webNoAuth) {
                        RewardsAuto.state.webNoAuth = true;
                        Utils.log("🟡", `网页通道未登录或无权限（${e2.message}），后续卡片改用 DAPI 通道`);
                    }
                    return false;
                }
                if (e2.message.includes("404")) {
                    Utils.log("🟡", "Server Action ID 可能已更新，尝试动态探测...");
                    try {
                        ActionMap.clear();
                        const earnHtml = await Utils.xhr({ url: "https://rewards.bing.com/earn" });
                        nextAction = await this.getNextActionHash(earnHtml);
                        const retryRes = await Utils.xhr({ method: "POST", url: pageUrl, headers: buildHeaders(), data: payload });
                        if (retryRes) return true;
                    } catch (_) {}
                }
            }

            if (card.destination && card.destination.startsWith("http")) {
                try {
                    await this.reportDailyActivity(card.destination);
                    return true;
                } catch (_) {}
            }

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

        async _claimViaAppChannel(card, { diag = [], name = "" } = {}) {
            const label = name || card.title || card.offerId;
            if (!card.hash) {
                diag.push("app(无hash)");
                return false;
            }
            try {
                const accepted = await this.claimCardWeb(card, { appChannel: true });
                if (!accepted) {
                    diag.push("app(请求未被接受)");
                    return false;
                }
                diag.push("app(已交卷)");
                await Utils.randomDelay(2000, 4000);
                if (await this.isOfferCompleteAny(card.offerId, true) === true) {
                    Utils.log("🟢", `应用通道领取成功：${label}`);
                    return true;
                }
                Utils.log("🟡", `应用通道已交卷，等待服务端记账：${label}`);
                return false;
            } catch (e) {
                diag.push(`app(${e.message})`);
                Utils.log("🟡", `应用通道交卷失败（${label}）：${e.message}`);
                return false;
            }
        },

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
            /* 市场跟着实际出口走：大陆出口用 zh-CN，海外出口交给 bing 默认，别硬塞 cn 市场 */
            const mkt = RewardsAuto.region() === "cn" ? "&mkt=zh-CN" : "";
            const deviceType = isMobile ? "m" : "d";
            return Utils.xhr({
                url: `https://${RewardsAuto.state.host}/search?q=${encodeURIComponent(query)}&form=QBLH${mkt}`,
                headers: {
                    "user-agent": isMobile ? RewardsAuto.ua.mobile : RewardsAuto.ua.pc,
                    "cookie": `_Rwho=u=${deviceType}&ts=${RewardsAuto.state.dateNowStr}`,
                    "referer": `https://${RewardsAuto.state.host}/?form=QBLH`,
                    "cache-control": "no-cache",
                    "pragma": "no-cache"
                }
            });
        },

        async reportSearch(html, query, isMobile = false) {
            try {
                const ig = this.extractIG(html) || Utils.getRandomUUID();
                /* 市场跟着实际出口走：大陆出口用 zh-CN，海外出口交给 bing 默认，别硬塞 cn 市场 */
            const mkt = RewardsAuto.region() === "cn" ? "&mkt=zh-CN" : "";
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

        async checkRegion() {
            /* 关掉「锁定国区」时也要跑一次：结论一律放行，但顺手把真实出口地区记进
               RewardsAuto.state.region，后面的 country / mkt 才不会一律按 cn 发。 */
            const v = await RegionGuard.check({ fresh: true });
            if (v.ok) return true;
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
                Utils.notifyKeyed("search-restricted", "🔴", "搜索受限或账号异常，已中断今日搜索！", 12 * 60 * 60 * 1000);
                return true;
            }
            return false;
        }
    };

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
            if (st.date !== today) return base;
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

        intervalOf(attr) {
            const n = Number(attr && attr.report_per_minutes);
            return (Number.isFinite(n) && n >= 1 && n <= 30) ? n : 5;
        },

        typeOf(attr) {
            const t = String((attr && attr.report_offer_type) || "").trim();
            return /^\d+$/.test(t) ? t : "714";
        },

        findPromotion(profile) {
            const list = (profile && Array.isArray(profile.promotions)) ? profile.promotions : [];
            if (list.length === 0) return null;
            const exact = list.find(p => p && p.name === EDGE.PROMO_NAME);
            if (exact) return exact;
            const variant = list.find(p => p && EDGE.PROMO_PREFIX.test(String(p.name || "")));
            if (variant) return variant;
            return list.find(p => p && p.attributes
                && /edge/i.test(String(p.name || ""))
                && !!(p.attributes.offerid && p.attributes.report_offer_type)) || null;
        },

        notifyDone(st) {
            if (st.notified) return;
            st.notified = true;
            this.save(st);
            Utils.logQuiet("🌐", `Edge 浏览连签任务已完成！（今日 ${EDGE.TARGET_MINUTES} 分钟浏览已记账）`);
        },

        async step() {
            const st = this.state();
            const totalOf = () => st.total || Math.ceil(EDGE.TARGET_MINUTES / Math.max(1, st.intervalMin));

            if (st.giveUp) {
                return { done: false, skipped: true, count: st.count, total: totalOf(), waitMs: 6 * 60 * 60 * 1000 };
            }
            if (st.complete && Date.now() - st.sync < 2 * 60 * 60 * 1000) {
                return { done: true, count: st.count || totalOf(), total: totalOf(), waitMs: 30 * 60 * 1000 };
            }
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

        async run() {
            if (!GM_getValue("Tasks.edge", true)) return null;
            if (!GM_getValue("Config.token", false)) return null;
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

        summary() {
            if (!GM_getValue("Tasks.edge", true)) return null;
            const st = this.state();
            const total = st.total || Math.ceil(EDGE.TARGET_MINUTES / Math.max(1, st.intervalMin));
            const count = Math.min(st.count, total);
            return { done: st.complete, skipped: st.giveUp && !st.complete, count, total, text: `${count}/${total}` };
        }
    };

    const EDGE_PACE_TICK = 30 * 1000;

    const EdgePacer = {
        busy: false,
        nextAt: 0,

        async maybeReport() {
            if (this.busy) return null;
            if (Date.now() < this.nextAt) return null;
            if (!(await RegionGuard.allow())) {
                this.nextAt = Date.now() + 5 * 60 * 1000;
                return null;
            }
            this.busy = true;
            try {
                const r = await EdgeStreak.run();
                if (!r) {
                    this.nextAt = Date.now() + 5 * 60 * 1000;
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

    const ROUND_BUDGET_MS = 20 * 60 * 1000;

    const SEARCH_PACER = {
        MIN_MS: 30 * 1000,
        MAX_MS: 3 * 60 * 1000,
        OBSERVE_MIN: 8 * 1000,
        OBSERVE_MAX: 16 * 1000,
        MAX_ATTEMPTS: 60,
        NO_CREDIT_LIMIT: 10 * 60 * 1000,
        MIN_ATTEMPTS_BEFORE_GIVEUP: 8,
        GROW: 1.5,
        RETRY_GAP: 5 * 60 * 1000,

        minMs() {
            const span = Number(GM_getValue("Config.span", 30)) || 30;
            return Math.min(this.MAX_MS, Math.max(this.MIN_MS, Math.max(30, span) * 1000));
        },

        startGap() { return this.minMs(); },

        jitter(ms) {
            const v = ms * (1 + Math.random() * 0.35);
            return Math.max(5 * 1000, Math.round(v / 1000) * 1000);
        },

        nextGap(gap, progressed) {
            return progressed ? this.startGap() : Math.min(this.MAX_MS, Math.round(gap * this.GROW));
        },

        async beat(gap) {
            await Utils.delay(this.jitter(gap));
        },

        fits(deadline, gap) {
            const d = Number(deadline) || 0;
            if (d <= 0) return true;
            return Date.now() + Math.round(gap * 1.35) <= d;
        },
        saveGap(ms) {
            GM_setValue("Config.searchGap", { date: Utils.getTodayNum(), ms: Math.round(ms) });
        },
        loadGapPeak() {
            const saved = GM_getValue("Config.searchGap", null);
            if (!saved || typeof saved !== "object" || saved.date !== Utils.getTodayNum()) return 0;
            const ms = Number(saved.ms) || 0;
            return (ms <= 0 || ms > this.MAX_MS) ? 0 : ms;
        },
        setLast(stat) {
            GM_setValue("Config.searchLast", stat ? { date: Utils.getTodayNum(), ...stat } : null);
        },
        getLast() {
            const l = GM_getValue("Config.searchLast", null);
            if (!l || typeof l !== "object" || l.date !== Utils.getTodayNum()) return null;
            return { attempts: Number(l.attempts) || 0, credits: Number(l.credits) || 0, peak: Number(l.peak) || 0, at: Number(l.at) || 0 };
        },
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

    try {
        if (Utils.hasDOM() && typeof location !== "undefined"
            && /(^|\.)rewards\.bing\.com$/i.test(String(location.hostname || ""))) {
            API.startPageServer();
            Utils.log("🖥️", `代发服务已启动（页面上下文：${location.hostname}）`);
            Utils.log("🔑", `交卷通道：local（页面同源 fetch，Origin=https://rewards.bing.com）优先`
                + ` → page(CDP) → proxy → xhr(扩展源，仅兜底)`);
        }
    } catch (_) {}

    const TaskManager = {
        signDate: 0, readDate: 0, promosDate: 0, searchDate: 0, streakDays: 0,
        signPoint: -1, signTimes: 0, readTimes: 0, promosTimes: 0,
        claimSummary: "",
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
            this.claimSummary = "";
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
                Utils.logQuiet("🔵", `签入任务完成！总积分 +${totalPoint}`);
            } else {
                this.signTimes++;
                Utils.log("🟡", `签入失败，稍后重试`);
            }
        },

        async doRead(roundDeadline) {
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
            const pointsPerArticle = 3;
            const maxPerDay = 10;
            const target = Math.min(Math.max(Math.ceil((max - cur) / pointsPerArticle), 1), maxPerDay);
            Utils.log("📖", `今日还可阅读 ${target} 篇（上限 ${maxPerDay} 篇/天，每篇约 ${pointsPerArticle} 分）`);
            let gap = SEARCH_PACER.startGap();
            const readCap = Date.now() + 8 * 60 * 1000;
            const readDeadline = (Number(roundDeadline) || 0) > 0 ? Math.min(Number(roundDeadline), readCap) : readCap;
            let successCount = 0;
            let stagnant = 0;
            for (let i = 0; i < target; i++) {
                if (!SEARCH_PACER.fits(readDeadline, gap)) {
                    Utils.log("🟡", `阅读到点交班，还剩 ${target - i} 篇交给下一轮（当前节拍 ${Math.round(gap / 1000)} 秒）`);
                    break;
                }
                await SEARCH_PACER.beat(gap);
                await RegionGuard.guard("阅读");
                const result = await API.doRead();
                await Utils.randomDelay(3000, 8000);
                const after = await API.getReadProgress();
                let advanced = false;
                if (after) {
                    const gained = after.progress - cur;
                    max = after.max;
                    if (gained > 0) {
                        advanced = true;
                        successCount++;
                        stagnant = 0;
                        cur = after.progress;
                        Utils.log("📖", `阅读文章 ${i + 1}/${target} +${gained}积分（${cur}/${max}）`);
                    } else {
                        stagnant++;
                        Utils.log("🟡", `阅读文章 ${i + 1}/${target} 未计入进度（${after.progress}/${after.max}）`);
                    }
                } else if (result && result.points > 0) {
                    advanced = true;
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
                gap = SEARCH_PACER.nextGap(gap, advanced);
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
                Utils.logQuiet("🔵", `阅读任务完成！共 ${successCount} 篇`);
            } else {
                this.readTimes++;
                Utils.log("🟡", `阅读已执行但未完成（${verify ? `${verify.progress}/${verify.max}` : "进度未知"}），下次继续`);
            }
        },

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

        async doDesktopWeekly() {
            if (!GM_getValue("Tasks.desktopWeekly", true)) return true;
            try {
                const weekly = await API.runDesktopWeeklyQuests();
                RewardsAuto.state.weeklyQuestDone = weekly.done || 0;
                RewardsAuto.state.weeklyQuestPending = weekly.pending || 0;
                return true;
            } catch (e) {
                Utils.log("🟡", `桌面专属任务异常：${e && e.message ? e.message : e}`);
                return true;
            }
        },

        async doPromos(roundDeadline) {
            if (!GM_getValue("Tasks.promos", true) || this.promosTimes > 2) return true;
            if (this.promosDate === RewardsAuto.state.dateNowNum) {
                Utils.log("✅", "活动卡片已完成");
                return true;
            }
            Utils.log("🧩", "扫描活动卡片...");
            try { await API.getCookieHeader(); } catch (_) {}
            const cards = await API.discoverCards();

            try {
                const ck = await Utils.loginCookies();
                if (ck === null) {
                } else if (!ck.hasSession) {
                    // Cookie 缺登录标识属于环境问题，每轮都会命中，只记日志不推送
                    Utils.logQuiet("🟡", "Cookie 里没有 Bing 登录标识（MUID=" + ck.hasMuid + "）："
                        + (ck.names.slice(0, 6).join(",") || "空") + "；网页通道可能不记账");
                }
            } catch (_) {}
            if (cards.length === 0) {
                Utils.log("✅", "未发现待处理活动卡片");
                this.promosDate = RewardsAuto.state.dateNowNum;
                this.save();
                return true;
            }
            Utils.log("🧩", `发现 ${cards.length} 个卡片`);

            try {
                const cdp = await CDP.claimAll(6);
                if (cdp.ok && cdp.handled > 0) {
                    Utils.log("🖱️", "CDP 真实点击完成 " + cdp.handled + " 张（当前 " + cdp.done + "/" + cdp.total + " 已完成）");
                } else if (cdp.ok) {
                    Utils.log("🖱️", "CDP 已连接，但没有待处理的应用搜索卡（" + cdp.done + "/" + cdp.total + "）");
                } else {
                    Utils.logQuiet("🔴", "CDP 不可用（" + cdp.reason + "）：应用内搜索型卡本轮跳过，详见上方提示");
                }
            } catch (e) {
                Utils.logQuiet("🔴", "CDP 异常：" + e.message);
            }

            const shouldSkip = (card) => card.kind === "quiz" && !GM_getValue("Tasks.quiz", true);
            let ok = 0, fail = 0;
            let gap = SEARCH_PACER.startGap();
            let outOfTime = false;
            for (const card of cards) {
                await RegionGuard.guard("活动卡片");
                Utils.log("  ", `[${card.kind}] ${card.title} +${card.points}p`);
                if (shouldSkip(card)) continue;
                if (!SEARCH_PACER.fits(roundDeadline, gap)) {
                    Utils.log("🟡", `卡片到点交班，剩下的 ${cards.length} 张里有未处理的留给下一轮（当前节拍 ${Math.round(gap / 1000)} 秒）`);
                    outOfTime = true;
                    break;
                }
                await SEARCH_PACER.beat(gap);
                const result = await API.claimCard(card, { attempts: 2 });
                result ? ok++ : fail++;
                gap = SEARCH_PACER.nextGap(gap, !!result);
            }
            let pending = 0;
            let lockedNow = 0;
            try {
                const map = await API.getPromotionMap(true);
                if (map) {
                    for (const c of cards) {
                        if (shouldSkip(c) || !map.has(c.offerId)) continue;
                        const item = map.get(c.offerId);
                        if (item.complete) continue;
                        if (CardLock.claimable(item) && !API.isUnoffered(c.offerId) && !API.isManualCard(c.offerId)) pending++;
                        else lockedNow++;
                    }
                }
            } catch (_) {}
            if (pending === 0) {
                this.promosDate = RewardsAuto.state.dateNowNum;
                this.save();
            }
            const manualCards = (RewardsAuto.state.manualCards || []);
            if (manualCards.length > 0) {
                Utils.log("🖐️", "以下 " + manualCards.length + " 张卡已自动上报搜索，请在 earn 页手动点一次："
                    + manualCards.map(m => m.name).join("、"), true);
            }
            if (lockedNow > 0) {
                Utils.log("🔒", `另有 ${lockedNow} 张卡片处于锁定状态，不计入剩余量（满足条件后会自动重试）`);
            }
            Utils.log(pending === 0 ? "🔵" : "🟡",
                `活动完成: ${ok}成功/${fail}失败${pending > 0 ? `，仍剩 ${pending} 张未完成` : ""}（服务端已确认）${outOfTime ? "；本轮到点，剩余卡片下一轮继续" : ""}`,
                pending === 0 && ok > 0);
            return pending === 0;
        },

        async doSearch(roundDeadline) {
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
                this.searchDate = RewardsAuto.state.dateNowNum;
                this.save();
                SEARCH_PACER.setPending(false);
                return;
            }

            const budgetMin = 20;
            const startedAt = Date.now();
            const budgetDeadline = startedAt + budgetMin * 60 * 1000;
            const roundLimit = Number(roundDeadline) || 0;
            const softDeadline = roundLimit > 0 ? Math.min(budgetDeadline, roundLimit) : budgetDeadline;
            const hardDeadline = softDeadline;
            const deadlineMin = Math.max(0, Math.round((softDeadline - startedAt) / 60000));
            let gap = SEARCH_PACER.startGap();
            let peakGap = gap;
            const needed = Math.max(1, Math.ceil((max - progress) / 3));
            const attemptCap = Math.min(SEARCH_PACER.MAX_ATTEMPTS, Math.max(12, needed * 2));
            let attempts = 0, credits = 0, sinceCredit = 0, verifyFails = 0;
            let lastCreditAt = startedAt;
            const usedQueries = new Set();
            const pickPoolWord = () => RewardsAuto.searchPool[Utils.randomRange(0, RewardsAuto.searchPool.length - 1)];

            Utils.log("🔍", `单轮搜索最多 ${deadlineMin} 分钟（到点交班，未满的配额下一轮提前续做），起始节拍 ${Math.round(gap / 1000)} 秒，还差 ${Math.max(0, max - progress)} 分（约 ${needed} 次搜索）`);

            while (attempts < attemptCap && Date.now() < hardDeadline) {
                Utils.refreshLock("Config.runLock");
                try { Sched.state("running"); } catch (_) {}

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

                await Utils.delay(Utils.randomRange(SEARCH_PACER.OBSERVE_MIN, SEARCH_PACER.OBSERVE_MAX));
                const before = progress;
                let quota = await API.getPcQuota();
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
                    verifyFails++;
                    sinceCredit++;
                    progress = Math.min(max, progress + 3);
                    gap = Math.min(SEARCH_PACER.MAX_MS, Math.round(gap * SEARCH_PACER.GROW));
                    peakGap = Math.max(peakGap, gap);
                }
                RewardsAuto.state.pcProgress = progress;

                if (progress >= max) break;

                const noCreditMs = Date.now() - lastCreditAt;
                if (noCreditMs >= SEARCH_PACER.NO_CREDIT_LIMIT && attempts >= SEARCH_PACER.MIN_ATTEMPTS_BEFORE_GIVEUP) {
                    Utils.log("🟡", `连续 ${Math.round(noCreditMs / 60000)} 分钟没有任何记账（本轮 ${attempts} 次搜索），判定被限流，本轮收手（已记 ${progress}/${max}）`);
                    break;
                }
                if (verifyFails >= 6) {
                    Utils.log("🟡", `记账核对连续失败 ${verifyFails} 次，本轮按乐观估计结束（已记 ${progress}/${max}），下一轮用真实进度校正`);
                    break;
                }
                if (Date.now() + gap > softDeadline) {
                    Utils.log("🟡", `已到本轮上限（${deadlineMin} 分钟），剩下的 ${Math.max(0, max - progress)} 分交给下一轮`);
                    break;
                }
                const cycle = SEARCH_PACER.jitter(gap);
                let wait = Math.max(5000, cycle - (Date.now() - iterStart));
                if (attempts % 5 === 0) wait += Utils.randomRange(20000, 60000);
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
            if (finalInfo && progress >= max) {
                markDone();
                Utils.log("🔵",
                    `🔍 搜索任务完成！PC: ${progress}/${max}（本轮 ${attempts} 次搜索、记账 ${credits} 次，用时 ${elapsed}s，最高节拍 ${Math.round(peakGap / 1000)}s）`, true);
            } else {
                SEARCH_PACER.setPending(true);
                Utils.log("🟡",
                    `搜索未满 PC: ${progress}/${max}，本轮 ${attempts} 次搜索、记账 ${credits} 次（${hitRate}%），用时 ${elapsed}s，最高节拍 ${Math.round(peakGap / 1000)}s，已安排提前续做`);
                this.save();
            }
        },

        async doDailySet(roundDeadline) {
            const today = Utils.getTodayNum();
            const todayStr = Utils.getTodayStr();
            const processedKey = "Config.dailySetProcessed";
            let processed = GM_getValue(processedKey, []);
            if (!Array.isArray(processed) || processed[0]?.date !== today) processed = [];
            const doneIds = new Set(processed.filter(p => p && p.ok).map(p => p.offerId));

            const maxRounds = 3;
            let totalOk = 0, totalFail = 0, remain = -1;
            let gap = SEARCH_PACER.startGap();
            let outOfTime = false;

            for (let round = 1; round <= maxRounds; round++) {
                if (!SEARCH_PACER.fits(roundDeadline, gap)) {
                    Utils.log("🟡", `每日活动到点交班，剩下的卡片留给下一轮（当前节拍 ${Math.round(gap / 1000)} 秒）`);
                    outOfTime = true;
                    break;
                }
                await RegionGuard.guard("每日活动");
                Utils.log("📅", `第 ${round}/${maxRounds} 轮每日活动（服务端已确认 ${doneIds.size} 张）...`);
                await Utils.randomDelay(2000, 5000);

                let cards = [];
                let dapiOk = false;
                try {
                    const map = await API.getPromotionMap(true);
                    dapiOk = !!map;
                    cards = await API.discoverDailySetCards(map);
                    Utils.log("📅", `DAPI 发现 ${cards.length} 张未完成的日常活动卡片`);
                } catch (e) {
                    Utils.log("🟡", `DAPI 发现失败，回退网页解析: ${e.message}`);
                }
                if (cards.length === 0 && !dapiOk) {
                    try {
                        const allCards = await API.discoverCards();
                        cards = allCards.filter(c => (c.kind === "daily" || c.offerId.includes("DailySet")) && !doneIds.has(c.offerId));
                    } catch (e) {
                        Utils.log("🟡", `网页卡片解析失败: ${e.message}`);
                    }
                }

                if (round === 1 && cards.length > 0 && cards.some(c => !c.hash)) {
                    try {
                        const webCards = (await API.discoverCards()).filter(c => c.hash && (c.kind === "daily" || c.offerId.includes("DailySet")));
                        if (webCards.length > 0) {
                            const byId = new Map(webCards.map(c => [c.offerId, c]));
                            cards = cards.map(c => {
                                const w = byId.get(c.offerId);
                                if (!w) return c;
                                return {
                                    ...c,
                                    hash: w.hash,
                                    url: w.url || c.url,
                                    destination: c.destination || w.destination || "",
                                    ...(w.appOnly || c.appOnly ? { appOnly: true } : {}),
                                    ...(w.levelGated || c.levelGated ? { levelGated: true } : {})
                                };
                            });
                            const enriched = cards.filter(c => c.hash).length;
                            if (enriched > 0) Utils.log("🧩", `已为 ${enriched} 张日常卡补上网页交卷标识（hash）`);
                        }
                    } catch (e) {
                        Utils.log("🟡", `网页日常卡解析跳过: ${e.message}`);
                    }
                }

                let roundOutOfTime = false;
                for (const card of cards) {
                    if (doneIds.has(card.offerId)) continue;
                    await RegionGuard.guard("每日活动领取");
                    Utils.log("📅", `领取每日活动: ${card.title} +${card.points}p`);
                    if (!SEARCH_PACER.fits(roundDeadline, gap)) {
                        Utils.log("🟡", `每日活动到点交班，剩余卡片留给下一轮（当前节拍 ${Math.round(gap / 1000)} 秒）`);
                        roundOutOfTime = true;
                        break;
                    }
                    await SEARCH_PACER.beat(gap);
                    const res = await API.claimCard(card, round === 1 ? { attempts: 2 } : {});
                    if (res) { totalOk++; doneIds.add(card.offerId); } else { totalFail++; }
                    gap = SEARCH_PACER.nextGap(gap, !!res);
                }
                if (roundOutOfTime) {
                    outOfTime = true;
                    break;
                }

                remain = -1;
                try {
                    const map = await API.getPromotionMap(true);
                    if (map) {
                        const todays = [...map.values()].filter(i =>
                            (i.offerId.includes(RewardsAuto.appConfig.offerIds.dailySetPrefix) || i.dailySetDate === todayStr)
                            && (i.dailySetDate === todayStr || i.offerId.includes(String(today))));
                        const openable = todays.filter(i => CardLock.claimable(i));
                        const lockedNow = todays.length - openable.length;
                        remain = openable.filter(i => !i.complete).length;
                        if (lockedNow > 0) {
                            Utils.log("🔒", `${lockedNow} 张日常活动卡处于锁定状态，不计入剩余量`);
                        }
                        for (const i of todays) {
                            if (i.complete) doneIds.add(i.offerId);
                            else doneIds.delete(i.offerId);
                        }
                    }
                } catch (_) {}
                GM_setValue(processedKey, [...doneIds].map(id => ({ date: today, offerId: id, ok: true })));

                if (remain === 0) break;
                if (cards.length === 0) break;
                if (round < maxRounds) {
                    const wait = Utils.randomRange(20000, 35000);
                    Utils.log("⏳", `仍有 ${remain < 0 ? "未知数量" : remain} 张未完成，${Math.round(wait / 1000)} 秒后进入下一轮`);
                    await Utils.randomDelay(wait, wait);
                }
            }

            if (remain === 0) GM_setValue("Config.dailySetDoneDate", today);
            else if (remain > 0) GM_setValue("Config.dailySetDoneDate", 0);

            if (totalOk > 0 || totalFail > 0 || remain > 0) {
                Utils.log(remain === 0 ? "🔵" : "🟡",
                    `每日活动完成: ${totalOk}成功/${totalFail}失败${remain > 0 ? `，仍剩 ${remain} 张未完成` : ""}（服务端已确认）${outOfTime ? "；本轮到点，剩余卡片下一轮继续" : ""}`,
                    remain === 0);
            } else if (remain === 0) {
                Utils.log("✅", "每日活动已全部完成（服务端已确认）");
            }
            this.dailySetSummary = remain >= 0
                ? `${doneIds.size} 张已完成${remain > 0 ? `，剩 ${remain} 张` : ""}`
                : `${doneIds.size} 张已完成（服务端状态未知）`;
            if (remain < 0) return true;
            return remain === 0;
        },

        async doClaimPoints() {
            await RegionGuard.guard("领取积分");
            if (!GM_getValue("Tasks.claimPoints", true)) {
                this.claimSummary = "⏭️ 已关闭";
                Utils.log("✅", "自动领取待领积分已关闭（Config：Tasks.claimPoints）");
                return;
            }
            const skipUntil = Number(GM_getValue("Config.claimSkipUntil", 0)) || 0;
            if (skipUntil > Date.now()) {
                const mins = Math.max(1, Math.ceil((skipUntil - Date.now()) / 60000));
                this.claimSummary = `⏳ 通道冷却 ${mins} 分钟`;
                Utils.log("⏳", `领取通道上次连续不受理，冷却中（${mins} 分钟后自动再试，待领积分不会丢）`);
                return;
            }
            try {
                try { await API.getCookieHeader(); } catch (_) {}
                const res = await ClaimPoints.run();
                if (res.empty) {
                    this.claimSummary = "✅ 无可领";
                    GM_setValue("Config.claimFailStreak", 0);
                    GM_setValue("Config.claimSkipUntil", 0);
                    Utils.log("✅", `无可领取积分（${res.reason}）`);
                    return;
                }
                if (res.claimed > 0) {
                    this.claimSummary = `✅ +${res.claimed}（余额 ${res.after}）`;
                    GM_setValue("Config.claimFailStreak", 0);
                    GM_setValue("Config.claimSkipUntil", 0);
                    Utils.logQuiet("🎁", `已自动领取 ${res.claimed} 积分（当前余额：${res.after}）`);
                } else if (res.settled) {
                    this.claimSummary = "✅ 已领取（池已清空）";
                    GM_setValue("Config.claimFailStreak", 0);
                    GM_setValue("Config.claimSkipUntil", 0);
                    Utils.log("🎁", `待领积分已入账（余额差读不到，但待领池已清空）`);
                } else if (res.variant) {
                    this.claimSummary = "⏳ 已受理待复核";
                    Utils.log("🟡", `积分领取请求已受理，但余额没有变化（${res.reason}）；下一轮再复核`);
                } else if (res.unknown) {
                    // 读不到待领池：既不重试通道，也不推通知，只在日志里留一句，等下一轮再说
                    this.claimSummary = "⏳ 待领状态未知";
                    Utils.log("🟡", `待领积分状态读不出来，本轮跳过（${res.reason}）`);
                } else {
                    const streak = (Number(GM_getValue("Config.claimFailStreak", 0)) || 0) + 1;
                    GM_setValue("Config.claimFailStreak", streak);
                    this.claimSummary = `⏳ 未成功（连续 ${streak} 次）`;
                    if (this._calmClaimFailure(res.reason)) {
                        // 通道全都没连上（0✗）或全被风控（500✗）：这是「环境没配好」，不是任务结果，
                        // 和 CDP 未连接属于同一类，只写日志不推送。
                        Utils.logQuiet("🟡", `待领积分没领成：${res.reason}（通道不可用，本轮不推送通知）`);
                        this._explainClaimChannels();
                    } else {
                        // 真·服务端拒绝（401/403/404 等）才值得打扰用户，且同类提示 6 小时内只推一次
                        const pushed = Utils.notifyKeyed(
                            "claim-fail", "🟡",
                            `待领积分自动领取未成功：${res.reason}`,
                            6 * 60 * 60 * 1000
                        );
                        if (pushed) this._explainClaimChannels();
                    }
                    if (streak >= 2) {
                        const until = Date.now() + 90 * 60 * 1000;
                        GM_setValue("Config.claimSkipUntil", until);
                        Utils.log("⏳", `领取通道连续 ${streak} 次不受理，先冷却 90 分钟再试（别每轮都去撞风控）`);
                    }
                }
            } catch (e) {
                this.claimSummary = "⏳ 异常";
                Utils.log("🟡", `领取积分执行异常: ${e.message}`);
            }
        },

        // 通道失败原因属于「环境没配好」而不是「服务端拒绝」时返回 true。
        // 判据：每条通道的结果都是 0（没连上）或 500（Origin 被风控）。
        // 这种提示跟「CDP 未连接」是一回事，只写日志，不推通知也不发 Webhook。
        _calmClaimFailure(reason) {
            const parts = [...String(reason || "").matchAll(/([a-z]+)=(\d+)✗/g)];
            if (!parts.length) return false;
            return parts.every(m => m[2] === "0" || m[2] === "500");
        },

        _explainClaimChannels() {
            const env = BrowserEnv.info();
            const lines = [`当前浏览器：${BrowserEnv.summary()}；后台直发请求的 Origin 是扩展源`];
            if (env.extOriginRisky) {
                lines.push(`Edge ${env.major} 对扩展源 origin 的 server action 会回 500 —— 这不是脚本参数错了，是浏览器强制的头。`);
            }
            const cdpPort = Number(GM_getValue("Config.cdpPort", 9224)) || 9224;
            lines.push(`① CDP 同源通道：用桌面「Rewards Edge」快捷方式启动（端口 ${cdpPort}），并留一个 rewards 页面开着；`);
            lines.push(`② 页面代发通道：在 rewards.bing.com 页面里跑过一次脚本后自动可用（Config.usePageChannel 打开）；`);
            lines.push(`③ 后台直发：Chrome / 旧版 Edge 上通常能过，新版 Edge 上常被拒。`);
            Utils.logQuiet("🟡", lines.join("\n"));
        },

        async doStreak() {
            await RegionGuard.guard("连签检测");
            Utils.log("📅", "开始检测连签任务...");
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

        /* 统一收尾播报：一天里只在这一处决定要不要推送。
           规则：
           ① 核心任务（签到/阅读/PC搜索/活动卡片/每日活动/Edge 连签）全部完成，才播报；
           ② 允许「桌面专属任务 / 带锁的日常任务 / 首页待领取」三类留空，播报里要逐项说明是哪一类、还剩多少
              （带锁的日常任务只报张数与分值，不列卡片名）；
           ③ 核心任务没做完 → 只写日志，不推送（避免一天几十条「还差 N 项」）。
           去重：同一天 + 同样的结论（全部完成 / 同样的遗留项）只推一次；遗留项变了才再推。 */
        _notifyDailyDigest({ coreOn, corePending, soft, extraDone, earned, totalTime, balance }) {
            const today = RewardsAuto.state.dateNowNum;
            if (!coreOn || coreOn.length === 0) return false;
            if (corePending.length > 0) {
                Utils.log("📊", `核心任务还有 ${corePending.length} 项没完成`
                    + `（${corePending.map(i => i.label).join("、")}），本轮不推送`);
                return false;
            }
            const sig = soft.length ? "SOFT:" + soft.map(i => i.text).join("|") : "ALL";
            const key = `${today}|${sig}`;
            if (String(GM_getValue("Config.digestKey", "")) === key) return false;

            const sentDate = Number(GM_getValue("Config.digestDate", 0)) || 0;
            const sentCount = sentDate === today ? (Number(GM_getValue("Config.digestCount", 0)) || 0) : 0;
            if (sentCount >= 4) {
                Utils.log("📊", "今天的收尾播报已发过 4 条，之后只写日志（避免反复打扰）");
                return false;
            }

            const coreLine = "已完成：" + coreOn.map(i => i.label).join(" ✅ · ") + " ✅";
            const lines = [];
            if (soft.length === 0) {
                lines.push("🎉 今日任务已全部完成");
                lines.push("");
                for (const i of coreOn) {
                    lines.push(`${i.label} · ✅${i.detail ? " " + i.detail : ""}`);
                }
                for (const line of (extraDone || [])) lines.push(line);
            } else {
                lines.push(`✅ 其它任务已全部完成，还剩 ${soft.length} 项没做完`);
                lines.push("");
                for (const i of soft) lines.push(i.text);
                lines.push("");
                /* 这三类的共同点：都得靠「浏览器级」通道才能自动完成 ——
                   锁卡要真实点击（isTrusted），待领取要走同源 server action，普通扩展后台做不到。
                   紧跟在遗留项后面，避免长通知被系统截断后看不到这句；不带括号补充，省地方。 */
                lines.push("💡 这几项要自动完成：用 Chrome 跑脚本，或配好 CDP 通道");
                lines.push("");
                lines.push(coreLine);
            }
            lines.push(`💰 今日 +${earned} · 总积分 ${balance}`);
            lines.push(`⏱️ 本轮用时 ${totalTime} 秒`);

            GM_setValue("Config.digestKey", key);
            GM_setValue("Config.digestDate", today);
            GM_setValue("Config.digestCount", sentCount + 1);
            Utils.log(soft.length === 0 ? "🎉" : "✅", lines.join("\n"), true);
            return true;
        },

        /* 收工判定：每轮结束调一次，决定今天还要不要继续检测。
           ① 核心任务没做完 → 什么都不做，交给常驻调度跑下一轮；
           ② 核心做完、三项也了结 → 关掉「持续检测」就收工，开着则继续（保持原语义）；
           ③ 核心做完、三项还剩 → 再给 SOFT_SETTLE_ROUNDS 轮机会（三项本来就得靠 CDP/Chrome
              才做得了，没配好就一直做不了），试满仍遗留就今天收工，明天自动恢复。
           三项只看「本轮还剩几项」，不区分它究竟能不能做成。 */
        _settleToday(softLeft) {
            softRounds.setLast(softLeft);
            if (!isDayComplete()) return;
            /* 今天已经收工过就不再重复判定（浏览器重启后可能还会走到这里） */
            if ((Number(GM_getValue("Config.doneDate", 0)) || 0) === RewardsAuto.state.dateNowNum) return;
            const isKeep = GM_getValue("Config.keep", true);
            if (softLeft === 0) {
                softRounds.reset();
                if (!isKeep) markDayComplete();
                return;
            }
            const n = softRounds.bump();
            if (n >= SOFT_SETTLE_ROUNDS) {
                markDayComplete(`三项还剩 ${softLeft} 项没做完（已连试 ${n} 轮），今天先收工，明天自动恢复`, "soft");
            } else {
                Utils.log("⏳", `核心任务已完成，三项还剩 ${softLeft} 项 —— 再试 ${SOFT_SETTLE_ROUNDS - n} 轮`
                    + `（已试 ${n}/${SOFT_SETTLE_ROUNDS}），仍不行今天收工`);
            }
        },

        async runAll() {
            if (this.running && Date.now() - (this.runningSince || 0) < RUN_STALE) {
                Utils.log("🟡", "任务正在运行中，请勿重复触发");
                return;
            }
            if (this.running) {
                Utils.log("🟡", "上一轮的运行标记是残留的（上下文被冻结过），清理后继续");
                this.running = false;
            }
            Utils.log("▶️", `本轮进入执行流程（${Utils.hasDOM() ? "页面" : "后台"}上下文）`);
            if (!Utils.acquireLock("Config.runLock", 45 * 60 * 1000)) {
                Utils.log("⏳", "另一个上下文正在运行任务，本次跳过（避免并发重复上报）");
                return;
            }
            this.running = true;
            this.runningSince = Date.now();
            Sched.state("running");
            const roundDeadline = this.runningSince + ROUND_BUDGET_MS;
            try {
                this.signTimes = 0;
                this.readTimes = 0;
                this.promosTimes = 0;
                RewardsAuto.state.lockedCount = 0;
                RewardsAuto.state.lockedPoints = 0;
                RewardsAuto.state.lockedTitles = [];
                RewardsAuto.state.weeklyQuestLeft = [];
                RewardsAuto.state.weeklyQuestUnknown = 0;
                RewardsAuto.state.weeklyQuestScanned = false;
                RewardsAuto.state.webNoAuth = false;
                RewardsAuto.state.webFailStreak = 0;
                RewardsAuto.state.startTime = Utils.getTimestamp();
                Utils.log("🚀", "启动全能自动化任务...");
                this.init();
                if (!(await API.checkRegion())) {
                    Utils.log("🛑", "出口检测未通过：本轮不发任何微软请求，关掉 VPN/梯子（或恢复直连）后会自动恢复");
                    return;
                }
                const startBalance = await API.getBalance();
                Utils.log("📊", `初始积分: ${startBalance}`);
                let isTokenOK = await API.renewToken();
                if (!isTokenOK) Utils.notifyKeyed("token-fail", "🟡", "Token失败，跳过签入/阅读", 6 * 60 * 60 * 1000);
                const retryDelay = 60000;
                const maxRetries = 2;
                const withRetry = async (taskFn, taskName, retries = 0) => {
                    Utils.refreshLock("Config.runLock");
                    try {
                        const result = await taskFn();
                        if (result === false && retries < maxRetries) {
                            Utils.log("🟡", `${taskName} 失败，${retryDelay/1000}秒后重试 (${retries + 1}/${maxRetries})`);
                            await Utils.delay(retryDelay);
                            return withRetry(taskFn, taskName, retries + 1);
                        }
                        return result;
                    } catch (e) {
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
                await withRetry(() => this.doSign(), "签到");
                await Utils.randomDelay();
                if (isTokenOK) {
                    if (RewardsAuto.state.pc401) {
                        Utils.log("🟡", "PC 会话不可用（只影响 PC 通道任务），阅读改用 App 通道继续执行");
                    }
                    await withRetry(() => this.doRead(roundDeadline), "阅读");
                    await Utils.randomDelay();
                }

                await this.doDesktopWeekly();
                await Utils.randomDelay();
                await withRetry(() => this.doPromos(roundDeadline), "活动卡片");
                await Utils.randomDelay();
                await withRetry(() => this.doSearch(roundDeadline), "搜索");
                await withRetry(() => this.doStreak(), "连签检测");
                const roundExpired = () => Date.now() > roundDeadline;
                const skipByDeadline = name => Utils.log("🟡", `本轮已到 ${ROUND_BUDGET_MS / 60000} 分钟上限，${name}交给下一轮`);
                await Utils.randomDelay();
                let dailySetRes = null;
                if (roundExpired()) {
                    skipByDeadline("每日活动");
                } else {
                    Utils.log("📅", "开始执行每日活动任务...");
                    await Utils.randomDelay();
                    dailySetRes = await withRetry(() => this.doDailySet(roundDeadline), "每日活动");
                }
                try {
                    await this.doClaimPoints();
                } catch (e) {
                    if (e && e.regionBlocked) throw e;
                    Utils.log("🟡", `领取积分执行异常: ${e.message}`);
                }
                if (roundExpired()) {
                    skipByDeadline("二次扫描");
                } else {
                    Utils.log("🔄", "二次扫描：检查是否有新解锁的卡片...");
                    await Utils.randomDelay(3000, 8000);
                    const newCards = await API.discoverCards();
                    if (newCards.length > 0) {
                        Utils.log("🧩", `二次扫描发现 ${newCards.length} 个新卡片`);
                        let ok = 0, fail = 0;
                        let rescanGap = SEARCH_PACER.startGap();
                        for (const card of newCards) {
                            await RegionGuard.guard("二次扫描");
                            Utils.log("  ", `[${card.kind}] ${card.title} +${card.points}p`);
                            if (card.kind === "quiz" && !GM_getValue("Tasks.quiz", true)) continue;
                            if (!SEARCH_PACER.fits(roundDeadline, rescanGap)) {
                                Utils.log("🟡", `二次扫描到点交班，剩余卡片留给下一轮（当前节拍 ${Math.round(rescanGap / 1000)} 秒）`);
                                break;
                            }
                            await SEARCH_PACER.beat(rescanGap);
                            const result = await API.claimCard(card);
                            result ? ok++ : fail++;
                            rescanGap = SEARCH_PACER.nextGap(rescanGap, !!result);
                        }
                        Utils.log("🔵", `二次扫描完成: ${ok}成功/${fail}失败`);
                    } else {
                        Utils.log("✅", "二次扫描：无新卡片");
                    }
                }
                Utils.log("🌐", "检查 Edge 浏览连签进度...");
                await EdgePacer.maybeReport();
                const endTime = Utils.getTimestamp();
                const totalTime = ((endTime - RewardsAuto.state.startTime) / 1000).toFixed(1);
                const endBalance = await API.getBalance();
                const earned = (startBalance > 0 && endBalance > 0) ? (endBalance - startBalance) : 0;
                const info = await API.getRewardsInfo();
                if (info) {
                    /* 汇总的图标约定：一枚图标只表达一件事
                       🌐 Edge 浏览连签  🧩 活动卡片  ✨ 每日活动  📅 签到  📋 阅读
                       🔍 PC 搜索  📱 手机搜索  🔒 锁卡  🎁 领取积分  💰 积分总账
                       ✅ 达标  ⏳ 未达标/进行中  ⏭️ 今日已跳过 */
                    const today = RewardsAuto.state.dateNowNum;
                    const readProg = info.readProgress ?? RewardsAuto.state.readProgress ?? 0;
                    const readMaxProg = info.readMax ?? RewardsAuto.state.readMax ?? 30;
                    const signOk = this.signDate === today;
                    /* 进度已满也算达标：标记位可能因刷新/跨实例丢失，服务端进度才是事实 */
                    const readOk = this.readDate === today || (readMaxProg > 0 && readProg >= readMaxProg);
                    const searchOk = info.pc.progress >= info.pc.max;
                    const promosOk = this.promosDate === today;
                    const dailyOk = !!dailySetRes;
                    const edge = EdgeStreak.summary();
                    const edgeOk = !edge || edge.done || edge.skipped;
                    const mob = info.mobile || {};
                    const mobOk = !mob.max || mob.progress >= mob.max;
                    const tick = ok => (ok ? '✅' : '⏳');

                    /* 只把「开启的任务」计入达标分母，关掉的项不该被算成差一项 */
                    const on = key => GM_getValue(key, true);
                    const signOn = on("Tasks.sign"), readOn = on("Tasks.read");
                    const searchOn = on("Tasks.search"), promosOn = on("Tasks.promos");

                    /* 核心任务：只有它们全部完成，才算「今天做完了」 */
                    const core = [
                        { key: "edge", label: "🌐 Edge 浏览连签", enabled: !!edge, done: edgeOk, detail: edge ? edge.text : "" },
                        { key: "promos", label: "🧩 活动卡片", enabled: promosOn, done: promosOk, detail: "" },
                        { key: "daily", label: "✨ 每日活动", enabled: true, done: dailyOk, detail: this.dailySetSummary || "" },
                        { key: "sign", label: "📅 签到", enabled: signOn, done: signOk, detail: this.streakDays > 0 ? "连签 " + this.streakDays + " 天" : "" },
                        { key: "read", label: "📋 阅读", enabled: readOn, done: readOk, detail: readProg + "/" + readMaxProg },
                        { key: "search", label: "🔍 PC 搜索", enabled: searchOn, done: searchOk, detail: info.pc.progress + "/" + info.pc.max },
                    ];
                    const coreOn = core.filter(i => i.enabled);
                    const corePending = coreOn.filter(i => !i.done);
                    const doneCount = coreOn.length - corePending.length;
                    const allDone = coreOn.length > 0 && corePending.length === 0;

                    /* 允许留空的三类：桌面专属任务 / 带锁的日常任务 / 首页待领取。
                       它们没做完不影响「其它都做完了」这个结论，但播报里必须逐项点名。 */
                    const soft = [];
                    if (on("Tasks.desktopWeekly")) {
                        const leftQ = Array.isArray(RewardsAuto.state.weeklyQuestLeft) ? RewardsAuto.state.weeklyQuestLeft : [];
                        const unknownQ = Number(RewardsAuto.state.weeklyQuestUnknown) || 0;
                        if (leftQ.length > 0) {
                            const names = leftQ.slice(0, 8).map(q => q.title + (q.locked ? "（未到解锁日）" : "")).join("、");
                            soft.push({ key: "desktop",
                                text: `🖥️ 桌面专属任务 · ⏳ 剩 ${leftQ.length} 张：${names}${leftQ.length > 8 ? " 等" : ""}（需在奖励应用内完成）` });
                        } else if (unknownQ > 0) {
                            soft.push({ key: "desktop", text: `🖥️ 桌面专属任务 · ⏳ ${unknownQ} 个入口读不到状态，未能确认是否完成` });
                        }
                    }
                    const lockN = Number(RewardsAuto.state.lockedCount) || 0;
                    if (lockN > 0) {
                        /* 只报数量与分值：卡片名和处理方式不进播报（明细见日志），避免一行太长 */
                        soft.push({ key: "locked",
                            text: `🔒 带锁的日常任务 · ⏳ ${lockN} 张（${Number(RewardsAuto.state.lockedPoints) || 0} 分）` });
                    }
                    if (on("Tasks.claimPoints")) {
                        const cs = String(this.claimSummary || "");
                        if (!/^✅/.test(cs)) {
                            /* 摘要里的「连续 N 次」「冷却 N 分钟」每轮都在变，
                               直接拿来当播报文本会让去重失效（每轮都算新状态），所以统一归到固定说法。 */
                            const why = /通道冷却/.test(cs) ? "通道冷却中，稍后自动重试"
                                : /未成功/.test(cs) ? "通道未受理"
                                : /已受理/.test(cs) ? "已受理，等待余额确认"
                                : /状态未知/.test(cs) ? "待领状态读不出来"
                                : (cs.replace(/^[⏳🟡]\s*/, "") || "本轮未执行");
                            soft.push({ key: "claim", text: `🎁 首页待领取 · ⏳ ${why}` });
                        }
                    }

                    /* 关掉的项要写「已关闭」：显示 ⏳ 0/90 会让人误以为没做完 */
                    const rows = [];
                    const row = (label, enabled, ok, detail) => rows.push(
                        label + " · " + (!enabled ? "⏭️ 已关闭" : tick(ok) + (detail ? " " + detail : "")));

                    rows.push("🌐 Edge 浏览连签 · " + (edge
                        ? (edge.done ? "✅" : edge.skipped ? "⏭️" : "⏳") + " " + edge.text
                        : "⏭️ 已关闭"));
                    row("🧩 活动卡片", promosOn, promosOk, "");
                    row("✨ 每日活动", true, dailyOk, this.dailySetSummary || "");
                    row("📅 签到", signOn, signOk, this.streakDays > 0 ? "连签 " + this.streakDays + " 天" : "");
                    row("📋 阅读", readOn, readOk, readProg + "/" + readMaxProg);
                    row("🔍 PC 搜索", searchOn, searchOk, info.pc.progress + "/" + info.pc.max);
                    if (mob.max > 0) rows.push("📱 手机搜索 · " + tick(mobOk) + " " + mob.progress + "/" + mob.max);
                    if (RewardsAuto.state.lockedCount > 0) {
                        rows.push("🔒 锁卡 · " + RewardsAuto.state.lockedCount + " 张（" + RewardsAuto.state.lockedPoints + " 分）");
                    }
                    if (this.claimSummary) rows.push("🎁 领取积分 · " + this.claimSummary);
                    rows.push("💰 今日获取 +" + earned + " · 总积分 " + (info.balance || endBalance));

                    /* 标题不带图标：推送图标由 Utils.log 第一参数统一加，
                       否则会拼成「🎉 🎉 今日任务已全部完成！」 */
                    const head = allDone
                        ? (soft.length ? "核心任务已全部完成，仍有 " + soft.length + " 项待处理" : "今日任务已全部完成！")
                        : "本轮结果 · 还差 " + corePending.length + " 项";
                    const logMsg = head + "\n\n" + rows.join("\n")
                        + "\n\n✅ 达标 " + doneCount + "/" + coreOn.length + " · ⏱️ 用时 " + totalTime + " 秒";
                    // 明细只进日志；要不要推送由 _notifyDailyDigest 统一裁决（一天最多一条结论）
                    Utils.log(allDone && soft.length === 0 ? "🎉" : "📊", logMsg);
                    /* 「全部完成」时要顺带交代桌面任务和待领取这两项，
                       否则只看核心 6 项会以为脚本把别的漏掉了 */
                    const extraDone = [];
                    if (on("Tasks.desktopWeekly") && RewardsAuto.state.weeklyQuestScanned && !soft.some(i => i.key === "desktop")) {
                        extraDone.push("🖥️ 桌面专属任务 · ✅");
                    }
                    if (on("Tasks.claimPoints") && !soft.some(i => i.key === "claim")) {
                        extraDone.push("🎁 首页待领取 · " + (this.claimSummary || "✅"));
                    }
                    this._notifyDailyDigest({
                        coreOn, corePending, soft, extraDone,
                        earned, totalTime, balance: info.balance || endBalance
                    });
                    this._settleToday(soft.length);
                } else {
                    Utils.log("📊", ("本轮执行完成 · ⏱️ 用时 " + totalTime + " 秒（服务端状态读取失败，明细见日志）"));
                    if (!GM_getValue("Config.keep", true) && isDayComplete() && softRounds.last() <= 0) markDayComplete();
                }
            } catch (e) {
                if (e && e.regionBlocked) {
                    Utils.log("🛑", `本轮已中止：${e.message}`);
                } else {
                    Utils.log("🔴", `本轮任务异常终止: ${e.message}`);
                }
            } finally {
                Utils.releaseLock("Config.runLock");
                this.running = false;
                this.runningSince = 0;
                Sched.state("done");
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

    const diagClaim = async () => {
        const env = BrowserEnv.info();
        const saved = String(GM_getValue("Config.claimVariant", "") || "");
        const cdpPort = Number(GM_getValue("Config.cdpPort", 9224)) || 9224;
        let text = "🎁 待领积分 / 领取通道诊断\n\n";
        text += `任务开关：${GM_getValue("Tasks.claimPoints", true) ? "开启" : "关闭"}\n`;
        text += `当前浏览器：${BrowserEnv.summary()}${env.extOriginRisky ? "（新版本，后台直发大概率被拒）" : ""}\n`;
        text += `已记住通道：${saved || "未记录（会按 page → proxy → xhr 逐个试）"}\n`;
        text += `CDP 调试端口 ${cdpPort}：${(await CDP.available()) ? "✅ 可连" : "❌ 不可连"}\n`;
        text += `页面代发服务：${API._pageChannelAlive() ? "✅ 在线" : "❌ 不在线"}\n`;
        const table = ActionMap._readMap();
        text += `标识表：${Object.keys(table).length ? `已缓存 ${Object.keys(table).length} 个（部署 ${GM_getValue("Config.actionDpl", "未知")}）` : "空（用已知兜底标识）"}\n`;
        text += `领取标识：${ActionMap.get("reportClaimAllPoints").slice(0, 12)}…\n\n`;
        const pool = await ClaimPoints.run();
        text += `待领状态：${pool.empty ? "空池（无需领取）"
            : pool.unknown ? "读不出来（页面结构/登录态问题，本轮不动作）"
            : pool.variant ? `已受理（${pool.variant}）` : "确有可领，但通道未受理"}\n`;
        text += `本次结果：${pool.claimed > 0 ? `+${pool.claimed} 分（余额 ${pool.before} → ${pool.after}）` : (pool.reason || "—")}\n`;
        if (!pool.variant && !pool.empty && !pool.unknown) {
            text += `\n提示：新版 Edge 请用桌面「Rewards Edge」快捷方式启动（端口 ${cdpPort}）并留一个 rewards 页面，`
                + "这样领取会走页面同源请求；Chrome 上后台直发通常也能过。";
        }
        if (pool.claimed > 0) {
            GM_setValue("Config.claimFailStreak", 0);
            GM_setValue("Config.claimSkipUntil", 0);
            Utils.log("🎁", `诊断中已自动领取 ${pool.claimed} 积分`, true);
        }
        return text;
    };

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

    const diagPcSearch = async () => {
        const pacer = SEARCH_PACER.summary();
        const restricted = Number(GM_getValue("Config.restrictedTimes", 0)) || 0;
        let text = "🔍 PC 搜索诊断\n\n";
        text += `任务开关：${GM_getValue("Tasks.search", true) ? "开启" : "关闭"}\n`;
        text += `最小间隔：${pacer.min} 秒（Config.span，搜索/阅读/卡片共用，不会快于它，只会更慢）\n`;
        text += `每轮起始节拍：${pacer.min} 秒（每轮重置，不继承上一轮被放大的节拍）\n`;
        text += `单轮内退让上限：${SEARCH_PACER.MAX_MS / 1000} 秒；连续 ${SEARCH_PACER.NO_CREDIT_LIMIT / 60000} 分钟没记账则本轮收手\n`;
        text += `阅读/卡片节拍：复用同一套（起步 ${pacer.min} 秒，没进展放慢到 ${SEARCH_PACER.MAX_MS / 1000} 秒，带动随机抖动）\n`;
        if (pacer.last) {
            text += `上一轮：${pacer.last.attempts} 次搜索 / 记账 ${pacer.last.credits} 次（最高节拍 ${pacer.last.peak} 秒）\n`;
        } else {
            text += `上一轮：还没有记录\n`;
        }
        text += `单轮搜索上限：20 分钟（到点交班，未满的配额 5 分钟后提前续做）\n`;
        text += `整轮墙钟预算：20 分钟（到点不再开新阶段，剩余任务交给下一轮）\n`;
        text += `提前续做：${pacer.pending ? "已排程（本轮没搜满）" : "无"}\n`;
        text += `限流计数：${restricted}/3\n`;
        text += `任务标记：${TaskManager.searchDate === RewardsAuto.state.dateNowNum ? "今日已完成" : "今日未完成"}\n\n`;
        const info = await API.getRewardsInfo();
        if (info) text += `服务端配额：PC ${info.pc.progress}/${info.pc.max}\n`;
        else text += "服务端配额：读取失败\n";
        text += "\n调用后会立刻单独跑一次 PC 搜索（日志里能看到每次是否真的记账）。";
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
            .finally(() => Sched.finish(true));
    });

    const diagReleaseLock = () => {
        try { Utils.releaseLock("Config.runLock"); } catch (_) {}
        try { Sched.clearClaim(); } catch (_) {}
        GM_setValue("Config.runState", null);
        TaskManager.running = false;
        TaskManager.runningSince = 0;
        Utils.log("🔓", "已强制释放运行锁并清理运行状态，下一轮可正常触发");
    };

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

    const diagRegion = async () => {
        const v = await RegionGuard.check({ fresh: true });
        const enabled = RegionGuard.enabled();
        let text = "🌍 网络出口检测\n\n";
        if (!enabled) {
            text += "「锁定国区」已关闭：不做出口限制，也不拦代理。\n";
            text += `当前出口地区：${(v.cc || RewardsAuto.region("?")).toUpperCase()}`
                + `（市场按它走，dapi 用 country=${RewardsAuto.region("us")}）\n\n`;
        } else {
            text += `结论：${v.ok ? "✅ 出口在大陆，可以继续" : "⛔ 已拦截，任务不会上报"}\n`;
            if (v.reasons.length) text += `原因：${v.reasons.join("；")}\n`;
        }
        text += `出口 IP：${v.ip || "未知"}\n`;
        if (v.ipInfo) text += `${v.ipInfo}\n`;
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

    const CRON_PERIOD = 20 * 60 * 1000;
    const CRON_HEARTBEAT = 20 * 1000;
    const CRON_FIRST_DELAY = 5 * 1000;
    const CRON_HEARTBEAT_LOG = 10 * 60 * 1000;
    const CRON_HEARTBEAT_LOG_IDLE = 60 * 60 * 1000;
    const CRON_STALL = 3 * 60 * 1000;
    const RUN_STALE = 40 * 60 * 1000;

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

        plan(now = Date.now()) {
            const next = Number(GM_getValue("Config.cronNextRun", 0)) || 0;
            if (next) return next;
            const last = this.lastRun();
            return last ? last + CRON_PERIOD : now + CRON_FIRST_DELAY;
        },

        saveNext(ts) { GM_setValue("Config.cronNextRun", ts); },

        ctxName() { return Utils.hasDOM() ? "页面" : "后台"; },

        getClaim() {
            const c = GM_getValue("Config.cronClaim", null);
            return c && typeof c === "object" ? c : null;
        },
        claim() { GM_setValue("Config.cronClaim", { at: Date.now(), ctx: this.ctxName(), id: Utils.lockId() }); },
        clearClaim() { GM_setValue("Config.cronClaim", null); },

        state(phase, extra) {
            GM_setValue("Config.runState", Object.assign({ phase, at: Date.now(), ctx: this.ctxName() }, extra || {}));
        },
        getState() {
            const s = GM_getValue("Config.runState", null);
            return s && typeof s === "object" ? s : null;
        },

        isBusy(now = Date.now()) {
            const s = this.getState();
            return !!(s && s.phase === "running" && now - (s.at || 0) < RUN_STALE);
        },

        finish(ok) {
            const now = Date.now();
            const claim = this.getClaim();
            if (claim && claim.id && claim.id !== Utils.lockId()) return;
            const base = (claim && claim.at) || now;
            this.clearClaim();
            GM_setValue("Config.cronLastRun", now);
            const next = base + CRON_PERIOD;
            let plan = next > now + 60 * 1000 ? next : now + 60 * 1000;
            if (GM_getValue("Tasks.search", true) && SEARCH_PACER.isPending()) {
                const sooner = now + SEARCH_PACER.RETRY_GAP;
                if (sooner < plan) {
                    plan = sooner;
                    Utils.log("🔍", `PC 搜索未满，${Math.round(SEARCH_PACER.RETRY_GAP / 60000)} 分钟后提前续做`);
                }
            }
            this.saveNext(plan);
            this.state(ok ? "done" : "idle");
            if (ok) Utils.log("🕒", `本轮结束（用时 ${Math.max(0, Math.round((now - base) / 60000))} 分钟，上限 ${ROUND_BUDGET_MS / 60000} 分钟），下一轮 ${this.fmt(this.plan(now))}`);
        },

        start(task) {
            if (this.started) return;
            this.started = true;
            this.startedAt = Date.now();
            this.task = task;

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
            this.arm(true);
        },

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

        watchdog(now) {
            const claim = this.getClaim();
            if (!claim || !claim.at) return;
            if (this.isBusy(now)) return;
            if (now - claim.at <= CRON_STALL) return;
            Utils.log("♻️", `上次触发（${claim.ctx || "未知"}）${Math.round((now - claim.at) / 60000)} 分钟内没有真正开始执行，现在补跑`);
            this.clearClaim();
            this.fire(now);
        },

        tick() {
            this.timer = null;
            try {
                const now = Date.now();
                const next = this.plan(now);
                this.watchdog(now);
                EdgePacer.maybeReport().catch(() => {});
                /* 收工后不再触发：关掉「持续检测」时核心做完就收工；
                   开着时只有「三项试满轮数先收工」（doneReason=soft）才停。 */
                const softSettle = GM_getValue("Config.doneReason", "") === "soft";
                const stopped = (Number(GM_getValue("Config.doneDate", 0)) || 0) === Utils.getTodayNum()
                    && (!GM_getValue("Config.keep", true) || softSettle);
                if (!stopped && now >= next && !this.getClaim()) {
                    this.fire(now);
                } else if (now - this.lastHbLog >= (stopped ? CRON_HEARTBEAT_LOG_IDLE : CRON_HEARTBEAT_LOG)) {
                    this.lastHbLog = now;
                    GM_setValue("Config.heartbeatAt", now);
                    const tip = stopped
                        ? (softSettle
                            ? "，核心任务已完成、三项试满轮数先收工，明天自动恢复"
                            : "，今日任务已全部完成、检测已停止，明天自动恢复")
                        : this.isBusy(now)
                            ? `，本轮正在执行中（已 ${Math.round((now - ((this.getState() || {}).at || now)) / 60000)} 分钟）`
                            : this.getClaim() ? "，本轮已触发，正在等它跑起来" : `，约 ${Math.round((next - now) / 60000)} 分钟后进入下一轮`;
                    Utils.log("💓", `常驻调度心跳：后台实例已存活 ${Math.round((now - this.startedAt) / 60000)} 分钟${tip}`);
                }
            } catch (e) {
                Utils.log("🔴", `常驻调度异常：${e && e.message ? e.message : e}`);
            }
            this.arm(false);
        },

        fire(now) {
            if (this.isBusy(now)) {
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
                this.saveNext(now + CRON_PERIOD);
            }
        }
    };

    let bootstrapped = false;
    const bootstrap = () => {
        if (bootstrapped) return;
        bootstrapped = true;
        TaskManager.init();

        Utils.probeCookiePermission().catch(() => {});

        const consumePendingPaste = () => {
            if (!GM_getValue("Config.pendingPaste", false) || !Utils.hasDOM()) return false;
            GM_setValue("Config.pendingPaste", false);
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

    const isDayComplete = () => {
        TaskManager.init();
        const today = RewardsAuto.state.dateNowNum;
        const checkDone = (enabled, date) => !enabled || date === today;
        const processed = GM_getValue("Config.dailySetProcessed", []);
        const dailySetDone = (Array.isArray(processed) && processed.length > 0 && processed[0]?.date === today)
            || (Number(GM_getValue("Config.dailySetDoneDate", 0)) || 0) === today;
        const edgeDone = !GM_getValue("Tasks.edge", true)
            || !GM_getValue("Config.token", false)
            || (() => { const st = EdgeStreak.state(); return st.complete || st.giveUp; })();
        return checkDone(GM_getValue("Tasks.sign"), TaskManager.signDate) &&
            checkDone(GM_getValue("Tasks.read"), TaskManager.readDate) &&
            checkDone(GM_getValue("Tasks.promos"), TaskManager.promosDate) &&
            checkDone(GM_getValue("Tasks.search"), TaskManager.searchDate) &&
            dailySetDone &&
            edgeDone;
    };

    /* 核心任务做完后，三项（桌面专属 / 锁卡 / 待领取）再试几轮 ——
       它们本来就得靠 CDP/Chrome 才做得了，没配好时一直轮询没有意义。
       3 轮 ≈ 1 小时（常驻调度 20 分钟一轮）。 */
    const SOFT_SETTLE_ROUNDS = 3;

    /* 当天已经「带遗留项」试过的轮数 + 上一轮三项还剩几项。
       都按日期存，跨天自动归零，浏览器重启也不丢。 */
    const softRounds = {
        count() {
            const today = RewardsAuto.state.dateNowNum;
            return (Number(GM_getValue("Config.softSettleDate", 0)) || 0) === today
                ? (Number(GM_getValue("Config.softSettleRounds", 0)) || 0) : 0;
        },
        bump() {
            const n = this.count() + 1;
            GM_setValue("Config.softSettleDate", RewardsAuto.state.dateNowNum);
            GM_setValue("Config.softSettleRounds", n);
            return n;
        },
        reset() {
            GM_setValue("Config.softSettleDate", RewardsAuto.state.dateNowNum);
            GM_setValue("Config.softSettleRounds", 0);
        },
        /* 上一轮三项还剩几项；-1 表示今天还没跑过（状态未知） */
        last() {
            const today = RewardsAuto.state.dateNowNum;
            return (Number(GM_getValue("Config.softLastDate", 0)) || 0) === today
                ? (Number(GM_getValue("Config.softLast", -1))) : -1;
        },
        setLast(n) {
            GM_setValue("Config.softLastDate", RewardsAuto.state.dateNowNum);
            GM_setValue("Config.softLast", Number(n) || 0);
        }
    };

    const markDayComplete = (reason, kind) => {
        const today = RewardsAuto.state.dateNowNum;
        const prev = Number(GM_getValue("Config.doneDate", 0)) || 0;
        GM_setValue("Config.doneDate", today);
        /* kind="soft"：核心做完、三项试满轮数先收工 —— 这种「收工」在开着持续检测时也要停，
           因为它不属于「全部完成」（全部完成才会按 Config.keep 继续）。 */
        GM_setValue("Config.doneReason", kind || "");
        if (prev !== today) {
            Utils.logQuiet("💤", reason || "今日任务已全部完成，已停止检测（明天自动恢复）");
        }
    };

    const init = () => {
        bootstrap();

        const isKeep = GM_getValue("Config.keep", true);
        const doneToday = (Number(GM_getValue("Config.doneDate", 0)) || 0) === RewardsAuto.state.dateNowNum;
        /* 关掉「持续检测」时，核心任务做完就能收工 —— 但三项还得再试几轮：
           上一轮已确认三项都了结，或已经试满 SOFT_SETTLE_ROUNDS 轮，才允许直接停下。 */
        const settled = softRounds.last() === 0 || softRounds.count() >= SOFT_SETTLE_ROUNDS;
        const stopNow = (doneToday && (!isKeep || GM_getValue("Config.doneReason", "") === "soft"))
            || (!isKeep && isDayComplete() && settled);
        if (stopNow) {
            if (!doneToday) markDayComplete();
            Sched.finish(false);
            return;
        }
        const delay = Utils.randomRange(3000, 12000);
        Utils.log("⏳", `${(delay / 1000).toFixed(1)} 秒后启动...`);
        Sched.state("waiting", { runAt: Date.now() + delay });
        setTimeout(() => {
            Promise.resolve()
                .then(() => TaskManager.runAll())
                .catch(e => Utils.log("🔴", `本轮任务异常：${e && e.message ? e.message : e}`))
                .finally(() => Sched.finish(true));
        }, delay);
    };

    const isBingSearchPage = typeof location !== "undefined"
        && location.hostname
        && (location.hostname === "www.bing.com" || location.hostname === "cn.bing.com");

    if (IS_OAUTH_CALLBACK) {
        Auth.handleCallback().catch(e => Utils.log("🔴", `授权回调处理失败：${e.message}`));
        return;
    }

    if (isBingSearchPage) {

        const sp = (() => { try { return new URLSearchParams(location.search); } catch (_) { return new URLSearchParams(); } })();
        const isRewardSearch = /^(ML2W4J|ML2Y2H)$/i.test(sp.get("form") || "")
            || (sp.get("PUBL") || "").toUpperCase() === "REWARDSDO";

        if (isRewardSearch) {
            Promise.resolve().then(async () => {
                try {
                    const host = (typeof unsafeWindow !== "undefined" && unsafeWindow) ? unsafeWindow : window;
                    let ready = false;
                    for (let i = 0; i < 24; i++) {
                        await Utils.delay(500);
                        if (typeof host.sj_rra === "function" && typeof host.sj_gx === "function") { ready = true; break; }
                    }
                    if (!ready) {
                        GM_log("🎯 奖励搜索页：页面未提供 sj_rra（非 Bing 奖励页或模块未加载）");
                        return;
                    }
                    const href = String(location.href || "");
                    const rdrig = sp.get("rdrig") || "";
                    const ig = String((host._G && host._G.IG) || "");
                    host.sj_rra(href);
                    GM_log(`🎯 奖励搜索页：已调用 sj_rra（IG=${ig.slice(0,12)||"无"} rdrig=${rdrig ? rdrig.slice(0,8) : "无"}）`);
                    GM_setValue("Config.rewardSearchSeenAt", Date.now());

                    GM_log("🎯 注意：sj_rra 已尽力上报；若卡片仍显示未完成，需在 earn 页手动点一次该卡");
                } catch (e) {
                    GM_log(`🎯 奖励搜索页处理异常：${e.message}`);
                }
            });
        }
        GM_log("⏭️ 当前为 Bing 搜索页，跳过脚本初始化（防止重复执行/打开多余页面）");
        return;
    }

    // @background 下这里通常不会到达（后台上下文没有 DOM，末尾的 hasDOM 判断会先 return）。
    // 但保留这段：若用户改用普通脚本 / 或脚本被注入到 rewards 页，页面分支会在这里接管。
    const isRewardsPage = typeof location !== "undefined"
        && /(^|\.)rewards\.bing\.com$/i.test(String(location.hostname || ""));

    if (!isRewardsPage) {
        bootstrap();
        Utils.log("⏭️", `当前页面（${location.hostname}）不是 rewards.bing.com，不启动任务调度`);
        return;
    }

    bootstrap();
    Sched.start(init);

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

    const diagResetSchedule = () => {
        Sched.clearClaim();
        GM_setValue("Config.runState", null);
        GM_setValue("Config.cronNextRun", null);
        Utils.log("🧹", "调度计划已重置，下一轮将立刻开始");
        Sched.arm(true);
    };

    try {
        const host = (typeof unsafeWindow !== "undefined" && unsafeWindow) ? unsafeWindow : globalThis;
        host.__MPDiagnostics = {
            edgeStreak: diagEdgeStreak,
            pcSearch: diagPcSearch,
            region: diagRegion,
            schedule: diagSchedStatus,
            resetSchedule: diagResetSchedule,
            releaseLock: diagReleaseLock,
            claim: diagClaim
        };
    } catch (_) {}

    if (typeof __MP_TEST_HOOK__ === "function") {
        try {
            __MP_TEST_HOOK__({ Utils, API, RewardsAuto, RegionGuard, Webhooks, Sched, TaskManager, Auth,
                CardLock, SEARCH_PACER, EdgeStreak, EdgePacer, UA, EDGE, CDP,
                BrowserEnv, ActionMap, ClaimPoints });
        } catch (_) {}
    }

    if (!Utils.hasDOM()) {
        return new Promise(() => {});
    }
})();

if (__scBgKeepAlive && typeof __scBgKeepAlive.then === "function") {
    return __scBgKeepAlive;
}
