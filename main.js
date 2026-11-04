// ==UserScript==
// @name         微软积分（优化版）
// @namespace    https://rewards.bing.com/
// @version      1.10.1
// @description  每天在后台自动完成 Microsoft Rewards 任务获取积分奖励，✅签入(PC+App静默)、✅阅读、✅活动、✅搜索、✅Quiz、✅拼图、✅热搜API、✅二次扫描、✅积分通知、✅自动领取待领积分、✅连签任务检测、✅每日活动自动上报、✅桌面应用每周专属任务（纯 HTTP，一周一次做满 8/8）、✅Edge 浏览连签、✅出口检测（非大陆 IP 直接停手）、✅等级门槛卡（已解锁）优先走应用内搜索上报、失败再走 CDP 真实点击（全程后台运行）、✅同源通道自适应（新版 Edge 可跑）
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

    // 授权回调页：此处只做标记，真正的「捕获授权码 → 换 Token」在脚本末尾的 Auth.handleCallback()
    const IS_OAUTH_CALLBACK = location.hostname === "login.live.com"
        && location.pathname === "/oauth20_desktop.srf";

    /* ===== 授权码「早鸟快照」=====
     * 微软现在的授权回调分成两跳：
     *   ① GET /oauth20_desktop.srf?code=M.C5xx…&lc=2052   →  302（不是文档，脚本不会在这里执行）
     *   ② GET /oauth20_desktop.srf?removed=true           ←  code 只留在这一跳的 Referer 请求头里
     * 能加载脚本的只有第 ② 跳，而它的地址栏已经被换成 removed=true —— 这就是「自动捕获老是
     * 捕不到」的根因：code 不在 location 里，只在 document.referrer（同主机所以 Referer 带完整
     * query）。于是在 document-start 的最早时刻，把所有可能残留 code 的位置抄一份；再给
     * history.pushState/replaceState 挂钩，页面若用 JS 洗地址也能留下痕迹。 */
    const OAUTH_WITNESS = (() => {
        const snapshot = { at: Date.now(), href: "", referrer: "", name: "", urls: [] };
        const seen = new Set();
        const maybeRecord = url => {
            if (!url) return;
            const s = String(url);
            if (!/code=/i.test(s) || seen.has(s)) return;
            seen.add(s);
            snapshot.urls.push(s);
            if (snapshot.urls.length > 12) snapshot.urls.shift();   // 只留最近 12 条，别把存储撑大
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
        // 挂钩子只在 login.live.com 上做，rewards/bing 页面一点多余动作都没有
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
        // UA 不再写死版本：旧版固定 "Chrome/131 ... Edg/131.0.0.0"，用户把 Edge 升到 15x
        // 之后，脚本发出的请求特征反而变成「一年前的浏览器」，Edge 通道的请求也和真机对不上。
        // 现在每次访问都按当前浏览器动态生成，见下面的 UA 模块。
        get ua() { return UA.all(); },
        /* Rewards 桌面应用（WebView2 / Tauri）通道的请求头。
         *
         * 2026-11-03 用 CDP 挂进真实应用（Microsoft.24183918CCDA 1.13.0）逐项抓包，
         * 应用真正发出的头是这些，旧版三行全是错的：
         *   1) UA 必须是 **Windows + Edg/** 结尾再拼 `MSRewards/Desktop/<版本>`；
         *      应用源码里就是 `MSRewards/MSRewards/Desktop/` + 版本号拼接，
         *      而且页面脚本用 navigator.userAgent.includes("MSRewards/Desktop/") 判断
         *      「我是不是在奖励应用里」。旧版用 Macintosh + Safari 的 UA，
         *      既不是 WebView2，也过不了这个判断 —— 服务端和页面都不认。
         *   2) X-MSRewards-App 应用根本不发（抓包 33 个请求里一次都没出现），
         *      旧版写死的 "1" 是凭空发明的。
         *   3) 真正决定「这是应用请求」的是小写头 `x-rewards-source: msrewards-desktop`。
         *
         * 这里的 UA 版本号跟随真实浏览器主版本（与 UA.all().rewardsApp 同源），
         * 避免长期停在一年前的客户端版本上。 */
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
        /* 请求头里该带哪个地区：锁定国区时恒为 cn，未锁定时用出口检测出来的地区。
         * 以前这行判断在 5 个请求里各写一遍，口径一改就得改 5 处。 */
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
            // 锁态文案（"Available tomorrow" / "Offer is Locked" / "Earn -1 points"）不再用字符串粗筛：
            // 已解锁的 WW_Rewards_locked_level2_* 每日优惠卡也会带这类文案，粗筛会把它们一起误杀。
            // 是否锁卡改由 CardLock 依据 isLocked / isUnlocked / unlockCriteria 判断（见下方 CardLock）。
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
            // 本轮扫描到的真锁卡数量/分数（需在必应 App 完成），只用于汇总日志
            lockedCount: 0,
            lockedPoints: 0,
            // 网页通道确认「未登录/无 Cookie」后置真：当轮剩余卡片直接走 DAPI，避免白发请求
            webNoAuth: false,
            // 网页通道连续失败计数：连续失败到阈值后本轮不再试网页，避免一串超时把整轮拖住
            webFailStreak: 0,
        }
    };

    /* ===== 防「卡住」预算（网页优先改造后新增） =====
     * 网页通道每一步都是网络请求：Server Action POST、404 后探测 action id、目的地访问。
     * 没有上限的话，某个接口一直超时就会让整轮长时间没有日志，看起来像卡死。 */
    const CLAIM_ONCE_TIMEOUT = 150 * 1000;        // 单张卡单次尝试的硬上限：超过就记日志、放弃这次尝试
    const NEXT_ACTION_SCAN_MAX = 8;               // 探测 Server Action ID 时最多扫几个 chunk
    const NEXT_ACTION_SCAN_BUDGET = 45 * 1000;    // 探测 Server Action ID 的总耗时上限
    const WEB_FAIL_LIMIT = 3;                     // 网页通道连续失败几次后，本轮改为只用 DAPI
    const ACTION_SCAN_MAX = 24;                   // 提取 Server Action 标识表时最多抓几个分包
    const ACTION_SCAN_BUDGET = 60 * 1000;         // 提取标识表的总耗时上限（领取标识常在按需分包里）

    /* ===== 卡片锁态语义（从「微软积分商城签到（改进加强版）.user.js」迁移） =====
     * 网页端下发的活动卡片带 isLocked / isUnlocked / unlockCriteria 三个字段，
     * 只有它们确实表示「锁住」时才是真锁卡；只按 "Offer is Locked" / "Available tomorrow"
     * 这类文案做字符串过滤，会把「已解锁、可以在网页完成」的卡一并误杀（原有漏卡原因之一）。
     * 判定与 user.js 完全一致：
     *   - isLocked === false 且 isUnlocked === true  → 已解锁，正常执行；
     *   - isLocked === true / isUnlocked === false / unlockCriteria 有值（且非 $undefined）→ 真锁卡，跳过；
     *   - offerId 含 Moreactivities_RewardsApp 或 unlockCriteria === "rewardsApp" → App 专属卡：
     *     仍然可以尝试（本脚本的 DAPI 通道就是 App 通道），只是日志里单独标注，不计入锁卡。
     * 没有锁态字段的来源（DOM 兜底）才退回文案判断，保证旧页面也不漏判。
     */
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

        // 只给「没有任何锁态字段」的来源兜底：这类文案出现时基本就是锁住/未开放。
        // 中文站点会把这些文案本地化，所以英文之外还得认「明天再来」「在必应应用/必应 App 中完成」。
        textLocked(text) {
            const s = String(text || "");
            return /offer is locked|available tomorrow|earn -1 points|明天再来|明天可用|已锁定|在必应应用|必应\s*app|仅限.*应用|需在应用/i.test(s);
        },

        /* → { locked, appExclusive, appOnly, reason }
         *   locked      : 今天没有任何通道能做（明天才开 / 已禁用 / 纯文案锁）→ 直接跳过，别反复重试
         *   appExclusive: 只能通过 Rewards App 通道完成的卡（Moreactivities_RewardsApp / unlockCriteria=rewardsApp）
         *   appOnly     : 必须走「Rewards 应用 UA」通道 —— 这类卡在普通浏览器 UA 下带锁徽标，
         *                 换 Rewards 应用 UA 后服务端会渲染成 isLocked:false / isUnlocked:true，
         *                 hash / offerId 与网页端完全一致，照样能用同一个 server action 交卷。
         *                 旧版把这类卡当锁卡丢掉，就是「带锁标识的卡一张都做不成」的原因。
         * completed 由调用方按自己的字段判断 */
        probe(item) {
            const f = this.fields(item);
            const appExclusive = /Moreactivities_RewardsApp/i.test(f.offerId)
                || String(f.unlockCriteria || "").toLowerCase() === "rewardsapp";
            /* 等级门槛卡：offerId 形如 WW_Rewards_locked_level2_Nov26w1_off。
             * 这是「需要 Rewards 等级 2」的前置条件卡 —— 等级不够时服务端直接 503 拒绝交卷
             * （实测 0.21 秒返回，是前置校验，不是网络抖动）。
             * 但等级达标后同一张卡是可以完成的（isLocked:false + isUnlocked:true），
             * 所以这里只标记身份，跳不跳过仍由下面的 isLocked/isUnlocked 决定：
             * 按 ID 一律跳过会误杀已解锁的卡（也就是「带锁标识但其实已解锁」那一类）。 */
            const levelGated = /locked_level2|newLevel2/i.test(f.offerId)
                || String(f.unlockCriteria || "").toLowerCase() === "newlevel2";
            const keep = (reason) => ({ locked: false, appExclusive, appOnly: appExclusive, levelGated, reason });
            const skip = (reason) => ({ locked: true, appExclusive, appOnly: false, levelGated, reason });
            const appTry = (reason) => ({ locked: false, appExclusive, appOnly: true, levelGated, reason });

            // 1) 完全没有锁态字段（老页面 / DOM 兜底）：只能看文案
            if (!this.hasExplicitState(item)) {
                const text = `${f.title} ${f.offerId} ${f.state}`;
                if (!this.textLocked(text)) {
                    // 等级门槛卡且页面没给锁态字段：无法确认是否解锁，按「可尝试」处理
                    // （真正的判据是交卷时服务端给不给分，503 会被 claimCard 记为今日不可做）
                    return keep(levelGated ? "等级门槛卡(无锁态字段,按可尝试处理)" : "");
                }
                if (/在必应应用|必应\s*app|仅限.*应用|需在应用|bing\s*app|mobile\s*app/i.test(text)) {
                    return appTry("文案指向 App 通道");
                }
                return skip("仅有锁态文案");
            }
            // isDisabled 是「这张卡今天彻底不可做」的硬信号，优先于任何解锁字段
            if (f.isDisabled === true) return skip("isDisabled=true");
            // isLocked:false 是运行时权威信号（网页上锁徽标已消失）。
            // unlockCriteria 只是「解锁条件的名字」这类元数据，卡解锁后仍留在负载里，
            // 不能再据此判锁，否则刚解锁的卡会被永久挡住。
            if (f.isLocked === false) return keep(appExclusive ? "rewardsApp(已解锁)" : "");
            if (f.isUnlocked === true) return keep(appExclusive ? "rewardsApp(已解锁)" : "");
            // App 专属卡在普通浏览器 UA 下恒为锁态，但换成 Rewards 应用 UA 就是解锁态 → 交给 App 通道
            if (appExclusive) return appTry(f.isLocked === true ? "isLocked=true(App 专属→App UA)" : "rewardsApp");
            if (f.isLocked === true) return skip("isLocked=true");
            if (f.isUnlocked === false) return skip("isUnlocked=false");
            // 剩下的只有「有 unlockCriteria 但没有 isLocked」的未知态：按元数据判锁
            if (f.unlockCriteria !== undefined && f.unlockCriteria !== "") {
                return skip(`unlockCriteria=${f.unlockCriteria}`);
            }
            if (f.state && this.textLocked(f.state)) return skip(`state=${f.state}`);
            return keep("");
        },

        /* 这张卡今天还值不值得上报：真锁卡 / 隐藏 一律不再重试。
         * 以前 doPromos / doDailySet 用「服务端 complete 为假」判断剩余量，
         * 锁着的卡永远 complete=false，于是当天永远判不成完成，整天反复重试同一张卡。 */
        claimable(item) {
            const lock = this.probe(item);
            if (lock.locked) return false;
            const f = this.fields(item);
            if (f.isHidden === true) return false;
            return true;
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
        /* Rewards 桌面应用版本号（拼进 UA 的 MSRewards/Desktop/<ver>）。
         * 2026-11-03 实测装的是 Microsoft.24183918CCDA 1.13.0，抓包 UA 后缀就是 1.13.0。
         * 用户装新版应用后这里可以跟着改，但服务端并不校验它 —— 它只用于
         * 页面脚本的 navigator.userAgent.includes("MSRewards/Desktop/") 判定。 */
        REWARDS_APP_VER: "1.13.0",
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
                // Rewards 桌面应用（WebView2）通道。
                // 2026-11-03 在真实应用（Microsoft.24183918CCDA 1.13.0）里抓包确认的形态是：
                //   原始 WebView2 UA + " MSRewards/Desktop/1.13.0"
                // 应用自己的页面脚本用 navigator.userAgent.includes("MSRewards/Desktop/")
                // 判断「是否运行在奖励应用内」，所以这个后缀必须原样保留；
                // 版本号取真实浏览器主版本，避免长期停留在旧客户端版本上被当成过期端。
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

    /* ===== Edge 浏览连签常量 ===== */
    const EDGE = {
        PROMO_NAME: "edge_browsing_streak_flight",   // 老版本的活动名（仍可用）
        PROMO_PREFIX: /^edge_browsing_streak/i,      // 新版可能改名/加后缀，按前缀兜底匹配
        ACTIVATION_OFFER: "edge_flight_1_ww_treatment_eligible",
        TARGET_MINUTES: 30,                          // 累计满 30 分钟才记账
        MAX_EXTRA_ROUNDS: 3,                         // 次数报够但服务端没确认时，整体重来的轮数上限
    };

    /* 5 个推送平台的差异只有：名字、Webhook 地址、开关键名、请求体结构。
     * 以前是 5 段几乎逐字相同的对象（各带 getter），加一个平台要抄 15 行；
     * 这里只留「平台定义 + body 模板」，msg 改成取值时才拼的 getter，
     * 语义与原来的 getter 完全一致（每次序列化都读最新的时间与结算文本）。 */
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

        /* 与 xhr() 相同的调用方式，但返回完整响应 { text, finalUrl, status }。
         * 「在 Rewards 应用内搜索」这类任务必须拿到**重定向后的最终 URL**：
         * 真实流程是 GET www.bing.com/search?... → 302 到 cn.bing.com/search?...&rdr=1&rdrig=XXXX，
         * 那个 rdrig 是服务端给这次点击分配的标识，reportActivity 靠它认账；
         * 拿不到 rdrig，上报就会被当成「一次普通搜索」，永远不记到这张卡上。 */
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
                /* 微软域名请求自动补 Cookie 头（实测必需，见 API.getCookieHeader 的注释）：
                 * 这个环境里 GM_xmlhttpRequest 后台发请求**不带登录 cookie**，
                 * 服务端当匿名用户处理 —— 表现就是 earn 页拿回登录页、quest 页解析出 0 张子卡、
                 * server action 一律 500。所以对 bing/live/microsoft 域，若调用方没显式给 cookie，
                 * 就用 GM_cookie 读出来的真实 cookie 拼一个。
                 *
                 * 这里不能 await（xhr 是同步建请求的老接口），所以只在「已经缓存过」时补；
                 * 首次请求由调用方先调 API.getCookieHeader() 预热（doPromos/周任务开头都会预热）。 */
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
        /* Next.js Server Action 需要的 next-router-state-tree 头（从 user.js 迁移）。
         * 缺这个头时，新版 earn/dashboard 的 action 端点会直接 500 —— 这也是「已解锁卡交卷失败」的原因之一。 */
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

        /* ===== 桌面奖励应用「每周专属任务」的 quest 路由状态树 =====
         * 2026-11-03 抓包对照：普通卡交卷时 next-router-state-tree 用 routerStateTree("earn")，
         * 但 punchcard 子任务（/earn/quest/<id> 页面上的卡片）**必须**带上 quest 这一段，
         * 否则服务端虽然回 200 且 `1:true`，却根本不记账 —— 这正是「桌面任务提交了但没完成」的原因。
         * 真实应用发出的树形是：
         *   ["",{children:["(nav)",{children:["earn",{children:["quest",{children:[
         *       ["questId","<父任务ID>","d",null], {children:["__PAGE__",{},null,null,0]}, null,null,0
         *   ]},null,null,0]},null,null,0]},null,null,0]},null,null,0]},null,"refetch",16]
         * 注意内层的 refetch 标记是 0，外层是 16 —— 与普通页面正好相反，照抄才不会 500。 */
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

        /* 首次运行时的 GM_cookie 权限探测。
         *
         * GM_cookie 是需要**用户授权**的权限：ScriptCat 第一次真正调用 GM_cookie.list()
         * 时会弹出「是否允许访问 Cookie」的提示。这个弹窗必须由一次真实调用触发 ——
         * 光在脚本头写 `@grant GM_cookie` 不会弹。
         *
         * 以前第一次调用发生在 doPromos 深处（要跑完签到/阅读/搜索才轮到），
         * 用户根本不知道要授权，日志里只留下一句「无法读取 Cookie」，很困惑。
         * 现在挪到启动最前面：一运行就弹窗，用户点「允许」即可。
         *
         * 三种结果：
         *   ok=true  已授权且能读到 Bing cookie → 正常；
         *   ok=false 用户拒绝 / 管理器不支持 → 记下 cookieDenied，后续不再重试（避免刷错误日志）；
         *   读得到但没 Bing cookie → 只是没登录，不影响权限本身。 */
        async probeCookiePermission() {
            // 已经探测过就不再重复（避免每次 reload 都弹一次授权提示）
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

        /* 登录态探测：读 .bing.com / rewards.bing.com 下的 Cookie，回答「网页通道带没带登录态」。
         * 判定依据来自 2026-11-03 的真实抓包（cn.bing.com 的 Cookie 名单）：
         *   MUID, MUIDB, _EDGE_V, MSCC, _clck, _clsk, _EDGE_S, USRLOC, BID, GC, __Host-XY, SRCHHPGUSR
         * 早期版本找的是 ACCS_ / _SS / MSPAuth 这些 login.live.com 的 cookie，
         * 它们在 .bing.com 域下根本不存在，于是永远报「未登录」——那是误报，已修正。
         *
         * 现在只区分两档：有 MUID（= Bing 已识别这个浏览器）算「有会话」；
         * 读不到（无权限/超时）返回 null 表示「不确定」，绝不能当成未登录。 */
        async loginCookies() {
            /* 权限被拒（日志里的 GM_cookie "permission not allowed"）后不再尝试：
             * 每次调用都会刷一条错误日志并白等 2.5 秒，而它只用于诊断，不参与交卷判断。 */
            if (GM_getValue("Config.cookieDenied", false)) return null;
            if (typeof GM_cookie === "undefined" || !GM_cookie || typeof GM_cookie.list !== "function") return null;
            const read = (filter) => new Promise(resolve => {
                let settled = false;
                const done = v => { if (!settled) { settled = true; resolve(v); } };
                // service_worker 里 GM_cookie 的回调可能永远不触发，2.5 秒兜底
                setTimeout(() => done(null), 2500);
                try {
                    GM_cookie.list(filter, cookies => done(Array.isArray(cookies) ? cookies : []));
                } catch (_) {
                    done(null);
                }
            });
            // .bing.com 与 rewards.bing.com 各读一次：登录态可能挂在其中一个域下
            const [byDomain, byUrl] = await Promise.all([
                read({ domain: "bing.com" }),
                read({ url: "https://rewards.bing.com/" })
            ]);
            // 两条路都读不到 → 环境不支持/无权限，返回 null 表示「不确定」，不能当成未登录
            if (byDomain === null && byUrl === null) { GM_setValue("Config.cookieDenied", true); return null; }
            const all = [...(byDomain || []), ...(byUrl || [])];
            const found = new Set(all.map(c => String((c && c.name) || "")));
            const hasMuid = found.has("MUID") || found.has("MUIDB");
            // Bing 系的「已识别浏览器」标记：这些存在就说明 cookie 是完整的（抓包名单为准）
            const bingMarks = ["_EDGE_S", "_EDGE_V", "SRCHHPGUSR", "MSCC", "BID", "USRLOC"];
            const bingReady = bingMarks.some(n => found.has(n));
            const hasSession = hasMuid || bingReady;
            return { hasMuid, hasSession, names: [...found].slice(0, 20) };
        },

        /** 读出真实 cookie 并拼成 Cookie 头 —— 用来解决「后台请求不带登录态」。
         *
         * 2026-11-04 实测：同一个 Edge（页面里 `document.cookie` 有 MUID、页面内 fetch 能拿到
         * earn 页全文），但 `GM_xmlhttpRequest` 直连 rewards.bing.com 拿回来的是 **35k 的登录页**
         * —— 说明后台上下文里请求**没带上登录 cookie**。
         *
         * 这解释了之前所有怪现象：服务端把请求当匿名用户处理，于是 server action 一律 500、
         * quest 页解析不到子卡（`fetchQuestCards` 返回 0 张）。
         * 而 CDP 之所以能成，正是因为它跑在页面上下文里，cookie 天然齐全。
         *
         * 所以这里主动用 GM_cookie 把 cookie 拼出来，交给 GM_xmlhttpRequest 显式带上。
         * 拿到就缓存 5 分钟，避免每次请求都读一遍。
         */
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
            /* 读全量再本地筛选，不用 domain 过滤：
             * 实测必须拿到 HttpOnly 的 `MSPAuth` 才算真正登录（document.cookie 里没有它），
             * 而 `domain:"bing.com"` 这类过滤在不同管理器里语义不一致，容易漏掉
             * `.rewards.bing.com` 下的条目 —— 漏了就等于没登录。 */
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
                    // 只收微软系域，避免把无关站点的同名 cookie 混进来
                    if (!/bing\.com|live\.com|microsoft\.com/i.test(dom)) continue;
                    seen.set(n, String(c.value));
                }
            }
            const header = [...seen.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
            this._ckCache = header;
            this._ckAt = now;
            // 给同步的 Utils.xhr 用的取值器：预热之后所有微软域请求自动带上
            Utils._ckReady = () => header;
            /* 判定「这份 cookie 够不够登录」：光有 MUID 只能说明被识别成浏览器，
             * 真正代表登录的是 HttpOnly 的会话 cookie。实测只有 MSPAuth 之类在场时，
             * 后台请求才会拿回完整 earn 页（35k 登录页 → 380k 真实页）。 */
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

        /* 解析 JSON 字符串，非 JSON / null / 标量一律 null。
         * 以前全脚本 15 处都是「先 isJSON 再 JSON.parse」，同一个判断写两遍。 */
        parseJSON(s) {
            if (typeof s !== "string" || !s) return null;
            try {
                const j = JSON.parse(s);
                return (typeof j === "object" && j !== null) ? j : null;
            } catch { return null; }
        },

        /* DAPI 请求头（App 通道 / Edge 通道）。
         * 以前这套头在 7 个请求里逐字复制，字段一改要改 7 遍才不出错。
         * kind="app"：BingSapphire App 通道；kind="edge"：Edge 桌面通道（appid/partnerid 与语言都不同）。
         * extra 用来追加/覆盖个别请求的额外头（signApp 的 partnerid、flights）。 */
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

        // 只在 cn.bing.com 首页出现的特征：看到它就能断定「微软把我当大陆」。
        // 注意：这里刻意用整个 HTML 而非去空白版，中文标记不能被 \s 吃掉。
        CN_PAGE_RE: /cn\.bing\.com|京ICP备|beian\.miit\.gov\.cn|国内版<\/a>|国内版/,

        /* 5 路探测：微软侧 + 第三方 IP 库。差异只有「地址、请求头、怎么解析」，
         * 骨架统一在 _probeAll（匿名取数、超时、失败兜底），再加一路只要往这里加一条。 */
        PROBES: [
            {   // 微软侧：不带 Cookie，问 Bing「你看到的我是哪国」。大陆出口会被 302 到 cn.bing.com，
                // 那一页没有 RevIpCC，但有只在 cn.bing.com 出现的标记（版本切换、京ICP备号）
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
            {   // 腾讯 IP 库：境内出口一定以「中国」开头，境外是「美国 加利福尼亚 …」这种。
                // 这一路历来不匿名（带 Cookie），与上面几路不同，保持原样
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
                        // 关键：默认不带 Cookie，否则 cc=Cn 会被 Bing 沿用
                        anonymous: p.anonymous !== false,
                        timeout: this.PROBE_TIMEOUT
                    });
                    return Object.assign({ src: p.src, cc: "", ip: "", org: "" }, p.parse(txt, this));
                } catch (e) {
                    return { src: p.src, error: e instanceof Error ? e : new Error(String(e)), cc: "", ip: "", org: "" };
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

        /** 从一串候选字符串里找 code，返回 { code, source, raw }；找不到返回 null */
        pick(list) {
            for (const item of list) {
                if (!item || !item.value) continue;
                const code = this.parseCode(item.value);
                if (code) return { code, source: item.source, raw: String(item.value) };
            }
            return null;
        },

        /** 列出「可能残留 code」的所有位置，顺序即优先级：地址栏 > document.referrer > 启动快照。
         *  deep=true 时才翻页面内容和 sessionStorage/localStorage（开销大，只在没辙时用）。
         *  —— 之所以要这么多处：微软把 code 从地址栏抹成 ?removed=true 后，它只剩在
         *  document.referrer（302 那一跳的 Referer）里，极少数情况下还会被内联进页面/存储。 */
        candidates(deep) {
            const list = [];
            const add = (source, value) => { if (value) list.push({ source, value: String(value) }); };
            try { add("地址栏", location.href); } catch (_) {}
            try { add("地址栏参数", `${location.search || ""}${location.hash || ""}`); } catch (_) {}
            /* 关键通道：302 到 ?removed=true 之后，原始跳转地址只剩在 document.referrer 里 */
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
            // 有些回调页会把跳转地址内联在 HTML / 存储里回显
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

        /** 立刻在所有位置找一次授权码 */
        collectCode(deep = false) {
            return this.pick(this.candidates(deep));
        },

        /** 短轮询兜底：回调页有时先跳 ?removed=true，稍后内容/存储才写出来。
         *  第一拍与每 4 拍做深度检查（HTML、存储），其余只查轻量位置，别把 CPU 烧了。 */
        async waitForAnyCode(timeoutMs = 12000, stepMs = 500) {
            const t0 = Date.now();
            for (let tick = 0; Date.now() - t0 < timeoutMs; tick++) {
                const hit = this.collectCode(tick === 0 || tick % 4 === 0);
                if (hit) return hit;
                await Utils.delay(stepMs);
            }
            return this.collectCode(true);
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
                // 微软现在把 code 直接 302 掉：静默请求只会停在这一跳，拿不到 code，
                // 必须靠页面通道从 Referer 里取（见 Auth.handleCallback）。
                Utils.log("🟡", `静默通道被微软跳到了 ?removed=true（code 已被抹掉），改走页面 Referer 通道`);
                return null;
            }
            Utils.log("🟡", `静默通道没拿到授权码（HTTP ${res.status}，最终地址 ${finalUrl || "未知"}）`);
            return null;
        },

        /** 等待页面捕获授权码（或其它上下文直接换好了 Token）。
         *  原「自动打开授权页 → 在这里等 3 分钟」的逻辑已移除（脚本不再自动开标签页），
         *  这个等待函数保留备查，当前无调用方。 */
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

        /** 后台静默尝试捕获授权码。
         *  无论「自动检测授权码」开关是开是关，都不会自动打开授权页：
         *  开关只决定是否在后台静默发一次 authorize 请求碰碰运气，失败就只记日志（不推送通知），
         *  交给用户点菜单「🔑 手动授权」/「📋 粘贴授权码」处理。 */
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

        /** 授权回调页：捕获 code → 立刻兑换 → 通知并关闭页面。
         *  注意别只看 location：微软会把 code 从地址栏抹成 ?removed=true，
         *  真正的授权码只剩在 document.referrer（上一跳 302 的 Referer）里。 */
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
            // 1) 先同步抓一次（document-start 时最快的通道就是 location 与 document.referrer）
            // 2) 没抓到再短轮询 12 秒，给「先跳 removed=true，稍后才写出内容/存储」留出余量
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

        /** 手动救急：在授权回调页（或任何 login.live.com 页面）当场把 Referer 里的 code
         *  抓出来兑换。原菜单「🕵️ 捕获 Referer 里的授权码」已移除，逻辑保留备查。 */
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

        /** 粘贴流程：解析 → 保存 → 立刻兑换 → 明确告知结果 */
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

    /* ===== CDP 辅助：用真实鼠标事件完成「应用内搜索」型卡片 =====
    /* ===== CDP 辅助：用真实鼠标事件完成「应用内搜索」型卡片 =====
     *
     * 为什么需要它（2026-11-03 在真实 Edge 上做的对照实验）：
     *   · 脚本直接请求搜索 URL        → 302 的 Location 里没有 rdrig → 不记账；
     *   · 页面内 sj_rra(url)          → 有请求，但服务端按普通搜索记账，卡片不翻转；
     *   · 页面内 element.click()      → 不产生 rdrig；
     *   · 页面内派发完整 PointerEvent/MouseEvent 序列 → isTrusted 恒为 false，浏览器
     *     直接拒绝导航（连页面都不打开）；
     *   · CDP Input.dispatchMouseEvent（浏览器级输入）→ isTrusted=true → 产生 rdrig → 卡片完成。
     *
     * 实测：合成事件 isTrusted=false，CDP 事件 isTrusted=true。
     * isTrusted 是只读属性，页面内 JS 无法伪造 —— 所以「模拟点击」只有 CDP 这一条路。
     *
     * 前提（脚本无法自行满足，必须用户启动浏览器时带上）：
     *   Edge 以 --remote-debugging-port=<端口> + 独立 --user-data-dir 启动，并在该窗口登录 rewards。
     * 端口从 Config.cdpPort 读取，默认 9224；连不上就明确提示（不静默），不影响其它任务。
     */
    const CDP = {
        _ws: null,
        _id: 0,
        _pending: null,
        // 每轮只提示一次，避免 20 分钟一轮的调度把日志刷满
        _warnedAt: 0,
        WARN_GAP: 30 * 60 * 1000,

        base() {
            const p = Number(GM_getValue("Config.cdpPort", 9224)) || 9224;
            return "http://127.0.0.1:" + p;
        },

        /* 给用户看的启动命令（照抄即可用）。用 %LOCALAPPDATA% 避免硬编码用户名。 */
        /* 给用户看的启动命令（照抄即可用）。
         * 关键点：必须用 --user-data-dir 指向**独立目录** —— Edge 136+ 禁止对默认配置目录
         * 开远程调试（实测直接加端口不生效，进程起来了但端口不监听）。
         * 独立目录首次需要登录一次微软账号。 */
        launchCommand() {
            const port = Number(GM_getValue("Config.cdpPort", 9224)) || 9224;
            const profile = String(GM_getValue("Config.cdpProfileDir", "") || "%LOCALAPPDATA%\\Microsoft\\Edge\\CDPUserData");
            const profDir = String(GM_getValue("Config.cdpProfileName", "") || "Profile 2");
            return "& \"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe\""
                + " --remote-debugging-port=" + port
                + " --remote-allow-origins=* --user-data-dir=\""
                + profile
                + "\" --profile-directory=\""
                + profDir
                + "\"";
        },

        /* 醒目提示：日志 + 浏览器通知（通知里带命令，方便直接照做） */
        warn(reason) {
            const now = Date.now();
            const first = !this._warnedAt || now - this._warnedAt > this.WARN_GAP;
            const msg = [
                "CDP 未连接：" + reason,
                "应用内搜索型卡片（如「穿上你的舞鞋」「发光真菌」）需要浏览器级真实点击才能记账。",
                "页面内 JS 模拟点击无效 —— isTrusted=false 时浏览器直接拒绝导航，这是安全边界。",
                "",
                "【启用方法】用桌面上的「Rewards Edge」快捷方式启动（或粘下面这条命令）：",
                this.launchCommand(),
                "",
                "它会在一个独立小窗口打开（不影响你平时的 Edge）。首次需要在该窗口登录 rewards.bing.com。"
            ].join(String.fromCharCode(10));
            if (first) {
                this._warnedAt = now;
                Utils.log("🔴", msg, true);   // push=true → 系统通知 + webhook
            } else {
                Utils.log("🟡", "CDP 仍未连接：" + reason + "（30 分钟内不再重复提示）");
            }
        },

        // 探测端口是否可用（独立短超时，避免没开调试时拖慢整轮）
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

        /* 找一个可执行 fetch 的 rewards 页面。
         *
         * 默认**不新开标签页**：用户明确不希望脚本弹标签。
         * 没有已开的 rewards 页面时返回 null，调用方安静降级到后台直发。
         * 想临时允许新开时，把 Config.cdpAllowNewTab 置为 true（默认 false）。 */
        async earnPage() {
            const list = await this.targets();
            if (!list) return null;
            const hit = list.find(t => t.type === "page" && t.url && t.url.indexOf("https://rewards.bing.com/earn") === 0);
            if (hit) return hit;
            if (!GM_getValue("Config.cdpAllowNewTab", false)) return null;
            try {
                const res = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "PUT",
                        url: this.base() + "/json/new?" + encodeURIComponent("https://rewards.bing.com/earn"),
                        onload: r => resolve(r.responseText),
                        onerror: e => reject(new Error((e && e.error) || "new tab failed")),
                        ontimeout: () => reject(new Error("timeout")),
                        timeout: 8000
                    });
                });
                const j = JSON.parse(res);
                await Utils.delay(3000);
                return j;
            } catch (_) {
                return null;
            }
        },

        // 建立到某个 target 的 WebSocket（service worker 里有原生 WebSocket）
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

        /* 在真实 Edge 页面里用原生 fetch 交卷（桌面应用每周专属任务）。
         *
         * 为什么必须走 CDP：server action 的 `Origin` 由浏览器强制注入 ——
         *   · 扩展后台发 GM_xmlhttpRequest → 恒为 `chrome-extension://<id>` → 必应 WAF 直接 500；
         *   · 页面里 fetch → 浏览器自动写 `https://rewards.bing.com` → 200 记账。
         * 这个头脚本改不了，所以只能换发送方。CDP 让我们能在**页面上下文**里执行代码，
         * 等于直接借用页面的 fetch —— 与本机调试时完全一致的通道。
         *
         * 前提：Edge 以 --remote-debugging-port 启动（桌面「Rewards Edge」快捷方式已配好 9224）。
         * 返回 { accepted, status, text }。 */
        /* 在页面上下文里 GET 一个 rewards 页面并返回正文。
         *
         * 为什么要它：后台 `GM_xmlhttpRequest` 在这个环境里**不带登录态**
         * （拿回 35k 的登录页而不是 380k 的真实页），而页面里的 fetch 天然带齐 cookie。
         * 页面上下文因此是「读到真实数据」唯一可靠的来源。
         * CDP 不可用时返回 null，调用方回退到后台请求。 */
        async fetchPageText(url) {
            const expr = `(async function(){
                try {
                    var r = await fetch(${JSON.stringify(url)}, { credentials: "include", redirect: "follow" });
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
            /* 必须 awaitPromise：表达式是 async IIFE，返回的是 Promise 对象。
             * 不设这个标志时 CDP 只能把它序列化成 "[object Object]"，
             * JSON.parse 随即失败，日志就会显示「页面无返回」—— 一个假阴性。 */
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

        /* 列出 earn 页上未完成的「应用内搜索」型卡（必须是 bing 搜索链接） */
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

        /* 对该卡派发真实鼠标事件（唯一能产生 rdrig 的方式） */
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
            pos = await this.evaluate(posExpr);   // 滚动后重取坐标
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

        // 页面上的「已完成 / 总数」
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

        /* 对外主入口：用真实点击完成所有未完成的搜索型卡。
         * 返回 { ok, handled, done, total, reason }。 */
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

                // 页面没登录时（rewards 会重定向到登录页），提前给出明确提示
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
                    await Utils.delay(8000);   // 给新页面跑完自己的记账
                }

                // 轮询等待服务端记账（最多约 2 分钟）
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

    /* ===== 浏览器环境识别（为什么需要它） =====
     * 交卷/领取都是 Next.js Server Action，而 `Origin` 这个头由浏览器强制注入 ——
     * 扩展后台发请求时恒为 `chrome-extension://<扩展ID>`。必应对这类 origin 的 server action
     * 会直接回 500（风控页），而脚本改不了它。不同浏览器/版本对扩展请求的指纹宽容度不一样：
     * 实测在旧版 Edge（≤151）和 Chrome 上后台直发能过，新版 Edge 上就常被拒。
     *
     * 所以脚本不该假设「后台直发一定行」，也不该把版本写死。这里只做两件事：
     *   1) 读出当前浏览器的名字与大版本（供日志/诊断与通道选择参考）；
     *   2) 给出「当前环境最可能可用的发送通道」顺序 —— 页面/CDP 优先，后台直发兜底。
     * 版本号只是证据，不是开关：真正决定走哪条通道的是**请求能不能被受理**（见 ClaimPoints）。 */
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
            // 大版本：Edge 用 Edg/ 的号（与 Chromium 同号），其它用 Chrome/ 的号
            const vm = ua.match(/(?:Edg|EdgA|Chrome|Firefox)\/(\d+)/);
            const major = vm ? Number(vm[1]) : 0;
            // 「后台直发能否过」不看版本号，但版本号够新时先把提示写好，避免用户误以为脚本坏了
            const extOriginRisky = name === "Edge" && major >= 152;
            this._cache = { ua, name, major, extOriginRisky };
            return this._cache;
        },
        /* 发送通道的优先顺序。页面/CDP = 同源请求（Origin 天然正确）；
         * xhr = 扩展后台直发（Origin 是扩展源，风险最高）。
         * 顺序不随浏览器/版本变化：同源通道永远更稳，版本号只用来决定日志怎么提示。 */
        channelOrder() {
            return ["page", "proxy", "xhr"];
        },
        summary() {
            const i = this.info();
            return `${i.name}${i.major ? " " + i.major : ""}`;
        }
    };

    /* ===== Server Action 标识表（从「商城签到加强版」迁移） =====
     * 交卷和领取都是 Next.js Server Action：POST 带 `next-action: <40~64 位 hex>`。
     * 微软**每次重新部署站点都会换这一批 ID**，所以写字面量迟早会 404。
     *
     * 参考脚本的做法：从 rewards.bing.com 引用的 JS 分包里扫
     * `createServerReference("<hex>"…"<函数名>")` / `registerServerReference(…,"<hex>"…"<名>")`，
     * 直接还原出一张「函数名 → ID」的表，还按 dpl（部署号）缓存，部署变了才重扫。
     *
     * 本脚本原本只探测 `reportActivity` 一个 ID（getNextActionHash），够用但不完整：
     * 领取全部待领积分要的是另一个 action（reportClaimAllPoints）。所以这里补一张完整的表：
     *   · 先查缓存（dpl 变了就算过期，因为 ID 与部署一一对应）；
     *   · 没缓存才抓分包，抓取有「个数 + 总耗时」双重上限，不会把一轮拖死；
     *   · 全失败时退回调用方给的已知 ID，并打一条明确日志（不再静默 404）。
     */
    const ActionMap = {
        KEY_MAP: "Config.actionMap",
        KEY_BUILD: "Config.actionBuild",
        KEY_DPL: "Config.actionDpl",
        // 已知兜底标识（参考脚本实测跨部署仍有效，直到微软彻底换掉它们）
        FALLBACK: {
            reportActivity: "707e6eb15bdfdd5fba193f0a77e934f7018faf87ce",
            reportClaimAllPoints: "00491296f1d668ad46b65342c95cb9d72a62c1fa9d"
        },
        // 结果帧/缓存宽松匹配：只要交卷和领取两个都在，就算可用
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

        /* 清缓存：探测到 404 时用（ID 失效说明部署换了，缓存必须一起作废）。 */
        clear() {
            GM_setValue(this.KEY_MAP, "");
            GM_setValue(this.KEY_BUILD, "");
            GM_setValue(this.KEY_DPL, "");
        },

        /* 直接按名字取：缓存命中就返回，没有就用兜底值。
         * 交卷路径全程走这里，保持同步语义（原来 _nextAction 的用法不变）。 */
        get(name) {
            const map = this._readMap();
            const cached = map[name];
            return cached || this.FALLBACK[name] || "";
        },

        /* 扫一张表，找不到就按 dpl 抓分包。返回 { ids, dpl, fresh }。
         * pages 是已抓到的 rewards 页面 HTML（给了就不必重复抓），没给会自己抓 dashboard/earn。 */
        async ensure(pages, opts = {}) {
            const dplNow = this._cachedDpl();
            const cachedMap = this._readMap();
            const cachedDpl = GM_getValue(this.KEY_DPL, "");
            // 部署号一致且关键 action 齐 → 直接复用（避免每轮都抓几十个分包）
            if (this.REQUIRED.every(k => cachedMap[k]) && cachedDpl && (!dplNow || cachedDpl === dplNow)) {
                return { ids: cachedMap, dpl: cachedDpl, fresh: false };
            }
            // 缓存里连交卷都没有：说明从没扫成过，下面走完整扫描
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

            /* 分包候选：① 页面里直接引用的 static/chunks；② webpack 运行时清单里的动态分块
             * （领取组件按需加载，不在初始分包里 —— 这一条正是参考脚本的关键发现）；
             * ③ 已知历史分包兜底（CDN 会保留旧分包，新清单枚举不到时还能从它里面取。 */
            const queue = [];
            const seen = new Set();
            const push = p => { if (p && !seen.has(p)) { seen.add(p); queue.push(p); } };
            const rel = new Set();
            for (const m of combined.matchAll(/(?:\/_next\/)?(static\/(?:chunks|immutable|media)\/[^\s"'\\]+?\.js)/g)) {
                rel.add("/_next/" + m[1]);
            }
            // 页面相关分包优先（dashboard/earn/page/layout/nav 的加载概率最高）
            [...rel].sort((a, b) => ((/(dashboard|earn|page|layout)/i.test(a) ? 0 : 1) - (/(dashboard|earn|page|layout)/i.test(b) ? 0 : 1)))
                .forEach(push);
            const addDynamic = text => {
                // 新版分块哈希已不是纯十六进制（如 4ds1xh5s3），字符集要放宽
                for (const m of String(text || "").matchAll(/\b(\d{2,6}):"([a-z0-9_-]{8,})"/g)) {
                    push(`/_next/static/chunks/${m[1]}-${m[2]}.js`);
                    push(`/_next/static/chunks/${m[1]}.${m[2]}.js`);
                }
            };
            addDynamic(combined);

            const hex = "[a-f0-9]{40,64}";
            /* 分包是独立的 .js，正常形态里没有多余转义；但页面内联/flight 片段里的同一段代码
             * 会多一层 `\"`。两种形态都认，少一类漏抓。 */
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
                        // 标识后面跟着一串字符串字面量，函数名是最后一个（参考脚本的还原方式）
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

    /* ===== 待领积分（自动领取） =====
     * 新版 Rewards 把部分奖励先放进「待领池」，要单独点一次「领取积分」才入账
     * （搜索打卡、每日活动、限时 Quest 的奖励都会先进池子）。脚本原来只读 dashboard
     * 上的「可领取 N 积分」然后提示用户手动去点 —— 这一步现在改成自动完成。
     *
     * 参考脚本（商城签到加强版）的做法已经实测可用：
     *   1) 待领数据标记在页面 flight 负载里：`"pointClaim": null` 表示空池，非 null 才是有得领；
     *   2) 领取是同一个 Server Action 通道：POST https://rewards.bing.com/earn
     *      `next-action: <reportClaimAllPoints>`，body 是 `[]`（空数组，服务端自己知道领哪些）；
     *   3) 领取接口幂等：没有可领的积分时发过去不会有副作用，所以「多发一次」是安全代价。
     *
     * 两个环境差异（就是这轮要解决的「新版 Edge 跑不通」问题）：
     *   · 扩展后台发请求时 `Origin` 由浏览器强制注入成 `chrome-extension://<id>`，
     *     必应 WAF 对这种 origin 的 server action 会直接回 500 —— 且这个头**脚本改不了**；
     *   · 因此在 Edge 上必须优先走「页面上下文同源」通道：CDP（真实浏览器级请求）
     *     → 页面代发服务（页面自己的 fetch）→ 最后才是后台直发（在 Chrome 上通常能过）。
     *   首次成功的方式记在 Config.claimVariant，后续直接复用，不再每次试三种。
     */
    const ClaimPoints = {
        KEY_VARIANT: "Config.claimVariant",
        KEY_EMPTY_AT: "Config.claimEmptyAt",     // 「空池」的负缓存时间戳（省掉每轮一次空转）
        EMPTY_TTL: 15 * 60 * 1000,               // 空池 15 分钟内不再请求（打卡奖励不会这么快又出现）

        /* 从页面 HTML / flight 负载里判断待领池是否为空。
         * 微软在 flight 里把它序列化成 `"pointClaim":null`（空）或 `"pointClaim":{...}` / `[...]`（非空）。
         * 反斜杠转义层数随部署变化，所以两种形态都认。 */
        parse(html) {
            const raw = String(html || "");
            if (!raw) return { known: false, has: false, amount: 0 };
            const clean = raw.replace(/\\"/g, '"');
            // 1) flight 字段（最权威）
            const m = clean.match(/"pointClaim"\s*:\s*(null|\{|\[)/i);
            if (m) {
                const has = m[1] !== "null";
                return { known: true, has, amount: has ? this._amount(clean) : 0, source: "pointClaim" };
            }
            // 2) 页面上的「可领取 N 积分」文案兜底（点不出来但能读到时也认）
            const alt = clean.match(/alt="可领取"[^>]*>[\s\S]*?(\d[\d,]*)/i);
            if (alt) {
                const amount = parseInt(String(alt[1]).replace(/,/g, ""), 10) || 0;
                return { known: true, has: amount > 0, amount, source: "badge" };
            }
            return { known: false, has: false, amount: 0 };
        },

        // 顺带读余额，用来报告「这一下领到了多少」
        _balance(html) {
            const clean = String(html || "").replace(/\\"/g, '"');
            const m = clean.match(/"balance"\s*:\s*(\d+)/i);
            return m ? (parseInt(m[1], 10) || 0) : 0;
        },

        _amount(html) {
            const clean = String(html || "").replace(/\\"/g, '"');
            // pointClaim 结构里有 points/amount/availablePoints 几种写法，取第一个能读到的数字
            const win = clean.slice(Math.max(0, clean.search(/"pointClaim"/i)), clean.search(/"pointClaim"/i) + 1200);
            const m = win.match(/"(?:points|amount|availablePoints|totalPoints)"\s*:\s*(\d+)/i);
            return m ? (parseInt(m[1], 10) || 0) : 0;
        },

        /* 构建领取请求：和交卷一样打 earn 页 + earn 路由树（参考脚本实测形态）。 */
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
                    // 显式同源 origin：后台直发时这个头留不住（浏览器覆盖成扩展源），
                    // 但对页面/CDP 通道有效；API._rawXhr 的说明里写过代价，这里按参考脚本写法保持一致。
                    "origin": "https://rewards.bing.com",
                    ...(dpl ? { "x-deployment-id": dpl } : {}),
                    "user-agent": RewardsAuto.ua.pc
                },
                body: "[]"
            };
        },

        /* 发一次领取。通道选择与「受理判定」完全交给 API.postAction —— 那边是全脚本唯一
         * 的 Server Action 发送层（交卷也用它），这样两条链路的降级行为不会各自跑偏。 */
        async _sendOnce(req) {
            return await API.postAction(
                { url: req.url, headers: req.headers, data: req.body },
                { savedKey: this.KEY_VARIANT }
            );
        },

        /* CDP 页面：优先 earn 页，其次任意 rewards 页（领取对页面没有依赖，任何同源页面都行）。 */
        async _cdpPage() {
            return await API._anyRewardsPage();
        },

        /* 主流程：读池子 → 领取 → 用余额差确认 → （必要时）重扫标识表重试一次。
         * 返回 { claimed, before, after, empty, variant, reason }；claimed 为 0 时也说明原因。 */
        async run({ name = "领取积分" } = {}) {
            const out = { claimed: 0, before: 0, after: 0, empty: false, variant: "", reason: "" };
            // 页面 HTML 优先用 CDP 读：后台 xhr 在部分环境里拿回登录页 / 精简页，读不到 pointClaim
            let dashHtml = "";
            try {
                if (await CDP.available()) {
                    const page = await this._cdpPage();
                    if (page) {
                        if (!CDP._ws || CDP._ws.readyState !== 1) await CDP.connect(page.webSocketDebuggerUrl);
                        dashHtml = await CDP.fetchPageText("https://rewards.bing.com/dashboard") || "";
                    }
                }
            } catch (_) { dashHtml = ""; }
            if (!dashHtml) {
                try { dashHtml = await Utils.xhr({ url: "https://rewards.bing.com/dashboard" }); } catch (_) { dashHtml = ""; }
            }

            const pool = this.parse(dashHtml);
            out.before = this._balance(dashHtml);
            if (!pool.known) {
                out.reason = "读不到待领池标记（页面可能是登录页或结构已变）";
                return out;
            }
            if (!pool.has) {
                // 空池负缓存：连续多轮空池时不必每次都打一次领取请求（接口幂等但没必要刷）
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

            // 受理 ≠ 入账：余额变化才是唯一证据（领取接口不回 JSON，只有页面余额能看）
            await Utils.delay(1200);
            let afterHtml = "";
            try {
                if (accepted.variant === "page") {
                    const page = await this._cdpPage();
                    if (page) afterHtml = await CDP.fetchPageText("https://rewards.bing.com/earn") || "";
                }
                if (!afterHtml) afterHtml = await Utils.xhr({ url: "https://rewards.bing.com/earn" });
            } catch (_) { afterHtml = ""; }
            out.after = this._balance(afterHtml);
            out.claimed = (out.before > 0 && out.after > out.before) ? (out.after - out.before) : 0;
            /* 受理 ≠ 入账。领取接口不回 JSON，唯一证据是余额变化。
             * 受理了但余额没动有两种可能：① 服务端还没算完（分批入账，慢几秒）；
             * ② pointClaim 字段过时（池子其实已经空了）。两种都不该当失败处理，
             * 但也不该假装成功 —— 稍等再读一次余额，仍然没变就写明原因交给下一轮。 */
            if (out.claimed <= 0) {
                await Utils.delay(2500);
                try {
                    let again = "";
                    if (accepted.variant === "page") {
                        const page = await this._cdpPage();
                        if (page) again = await CDP.fetchPageText("https://rewards.bing.com/dashboard") || "";
                    }
                    if (!again) again = await Utils.xhr({ url: "https://rewards.bing.com/dashboard" });
                    const later = this._balance(again);
                    if (out.before > 0 && later > out.before) {
                        out.after = later;
                        out.claimed = later - out.before;
                    }
                    // 再读一次池子：已经空了说明那一笔就是这么领掉的（余额差读不到的账号会遇到）
                    const poolAgain = this.parse(again);
                    if (out.claimed <= 0 && poolAgain.known && !poolAgain.has) {
                        out.reason = "已受理，池子已清空（该账号余额差读不到，按已领取处理）";
                        out.claimed = pool.amount;
                    }
                } catch (_) {}
            }
            if (out.claimed <= 0) {
                out.reason = `已受理但余额未变（页面可领取 ${pool.amount}）`;
            }
            return out;
        }
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

        /* 「在 Rewards 应用内搜索」型卡片（href 带 form=ML2W4J/ML2Y2H 与 PUBL=RewardsDO）。
        /* 「在 Rewards 应用内搜索」型卡片的完成通道。
        /* 「在 Rewards 应用内搜索」型卡片的完成通道。
         *
         * 2026-11-03 在真实 Edge（CDP）里逐项验证：
         *   · 页面内 element.click() / 派发 PointerEvent 序列 → isTrusted=false，浏览器拒绝导航；
         *   · 直接请求搜索 URL → 302 的 Location 里没有 rdrig → 不记账；
         *   · 页面内 sj_rra() → 有请求但按普通搜索记账，卡片不翻转；
         *   · 只有 CDP Input.dispatchMouseEvent（isTrusted=true）会产生 rdrig 并完成卡片。
         *
         * 实际点击由 doPromos 开头的 CDP.claimAll 统一完成（一次遍历所有待办卡），
         * 这里只负责「CDP 在不在」的判定与提示，不再打开任何标签页。
         * 返回 true = CDP 可用（本轮已完成点击），false = CDP 不可用。 */
        async reportDailyActivity(searchUrl) {
            const rawUrl = String(searchUrl || "").trim();
            if (!rawUrl) return false;

            if (!(await CDP.available())) {
                CDP.warn("端口 " + (Number(GM_getValue("Config.cdpPort", 9224)) || 9224) + " 上没有调试服务");
                return false;
            }
            // CDP 可用：点击已在 doPromos 的预扫里做完，这里不再重复遍历
            return true;
        },

        // 小包装：给 reportDailyActivity 用，便于单测里替换
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
                    headers: Utils.appHeaders(token, { country: "cn" })
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
            return RewardsAuto.region("us");
        },

        // 薄封装：Edge 专用头统一由 Utils.appHeaders(kind:"edge") 拼装
        _edgeHeaders(region, token) {
            return Utils.appHeaders(token, { kind: "edge", country: region || this.edgeRegion() });
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
                        // 不设 origin：扩展里会被覆盖成 chrome-extension://，必应 WAF 直接 500
                        // （完整实测见 submitQuestCard 的注释）
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
                    // 这里一直固定按站点默认区（未解锁时 cn，解锁后 us）取，和别的请求用真实出口地区不同，保持原样
                    headers: Utils.appHeaders(token, { country: GM_getValue("Config.lock", true) ? "cn" : "us" })
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
                    // 锁态字段：真锁卡 / 已解锁卡的分流依据（与 user.js 一致）
                    isLocked: a.isLocked ?? a.islocked,
                    isUnlocked: a.isUnlocked ?? a.isunlocked,
                    unlockCriteria: a.unlockCriteria ?? a.unlockcriteria,
                    hidden: String(a.hidden).toLowerCase() === "true"
                });
            }
            return map;
        },

        /* 服务端完成状态的三态查询：true=已完成 / false=确认未完成 / null=查不到。
         * 关键：null 绝不能当 false 用。从网页 HTML（flight 数据）发现的卡，在 DAPI 列表里
         * 可能根本不存在 —— 那样「完成判定」永远为假，claimCard 会把同一张卡无限重试下去。
         * 这类卡交给 isOfferCompleteAny 去网页侧再确认一次。 */
        async isOfferComplete(offerId, force = false) {
            if (!offerId) return null;
            const map = await this.getPromotionMap(force);
            if (!map) return null;
            const item = map.get(offerId);
            if (!item) return null;          // 不在 DAPI 列表 = 状态未知，不是「未完成」
            return item.complete;
        },

        _webCompleteCache: null,

        /* 网页侧完成状态：DAPI 查不到这张卡时用它兜底。
         * earn 页的 flight 数据里同一个 offerId 带 isCompleted，是网页通道唯一的完成凭证。
         * 20 秒内复用同一份解析结果：一轮里复核多张卡不必反复拉整页 HTML。 */
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
                    // 同一 offerId 可能出现多份（不同区块），已完成优先
                    if (done || !map.has(id)) map.set(id, !!done);
                }
                this._webCompleteCache = { ts: now, map };
                return map.has(offerId) ? map.get(offerId) : null;
            } catch (_) {
                return null;
            }
        },

        /* 综合完成判定：DAPI 权威优先，查不到再问网页侧；两边都查不到才是 null。
         * 这样「只在网页侧存在、DAPI 不认识」的卡也能正确判定完成，不会无限重试。
         * 注意：网页侧那一路不吃 force —— claimCard 一次尝试里就有 5 处判定，
         * 3 次重试等于 15 次整页请求，而网页侧的完成状态不会在一秒内变化。
         * 它有自己的 20 秒缓存，force 只用来强制刷新 DAPI（那是权威源）。 */
        async isOfferCompleteAny(offerId, force = false) {
            const viaApp = await this.isOfferComplete(offerId, force);
            if (viaApp !== null) return viaApp;
            return await this.isOfferCompleteWeb(offerId, false);
        },

        /* 「今日不可做」名单：当天不再重试某些确认做不了的卡，跨天自动失效。
         * 这些卡永远 complete=false，每轮都撞既浪费请求，也让 doPromos 的剩余量永远清不掉。
         *
         * 注意：目前**没有任何地方主动调用 _markUnoffered**，这是有意的。
         * 曾经按 offerId 里的 locked_level2 在 503 时拉黑，但用户实测那张卡在网页上是
         * 已解锁状态（银牌满足门槛），拉黑等于把一张本来能完成的卡永久跳过 —— 已撤回。
         * 保留读写两个通道，等有可靠判据（例如服务端明确回「本期已结束」）时再启用。 */
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

        /* 「需手动完成」名单：应用内搜索型卡被脚本上报过、但卡片状态只能靠真实点击翻转。
         * 记下来避免同一张卡在一轮里反复开标签页；跨天自动失效。
         * 注意这不是「不可做」——用户点一下就能完成，所以仍然会在日志里提示。 */
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

        // 通过 DAPI 发现「今日日常活动卡片」，不依赖页面 HTML / Cookie；preMap 可复用已获取的 map
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
                // 语义化的锁卡判定：真锁卡跳过并计数；带锁徽标的 App 卡下发并打 appOnly 标记
                // （DAPI 通道本身就是 App 通道，所以这类卡照常能用 DAPI 交卷）
                const lock = CardLock.probe(item);
                if (lock.locked) {
                    // 用局部计数，最后取最大值写回 state：doDailySet 每轮都会重新发现一遍，直接累加会重复计分
                    lockedCount++;
                    lockedPoints += item.max || 0;
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
                    headers: Utils.appHeaders(token, { country: "cn" })
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
                    headers: Utils.appHeaders(token, { country: "cn" })
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

        /* Next.js RSC 的 flight 数据：页面把 props 切成若干 __next_f.push([n,"…"]) 片段，
         * 拼起来才是完整文本；没有片段时退化成去掉转义的整页 HTML。 */
        _flightText(html) {
            const chunks = [];
            const pushRegex = /self\.__next_f\.push\(\[\d+,\s*"(.*?)"\]\)/gs;
            let m;
            while ((m = pushRegex.exec(html)) !== null) {
                try { chunks.push(JSON.parse(`"${m[1]}"`)); } catch (_) {}
            }
            return chunks.length > 0 ? chunks.join("") : String(html).replace(/\\"/g, '"');
        },

        /* flight 文本里逐个抓 offerId 对象：$undefined / $D… 是 flight 的占位符，
         * 不是合法 JSON，先替换成 null 才能 parse。 */
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
            let earnHtml = ""; // 提升到 try 外：桌面奖励任务解析块需要复用 earn 页 HTML
            // 锁卡统计：单次扫描内汇总，扫描结束写进 state 供结算日志使用
            const lockStat = { count: 0, points: 0, app: 0 };
            /* 判断一张卡要被怎么处理：
             *   null        → 正常卡，走「网页通道 → DAPI」；
             *   skip=true   → 今天真做不了（明天才开 / isDisabled），别放进队列，否则永远判不成完成；
             *   appOnly=true→ 普通 UA 下带锁徽标，必须换 Rewards 应用 UA 交卷（见 claimCardWeb）；
             *   levelGated=true → 等级门槛卡（locked_level2/newLevel2）且**已解锁**：
             *     领取时先走「应用内搜索三步上报」（从商城签到加强版搬来），不行再走 CDP。 */
            const classify = (item, points = 0) => {
                const lock = CardLock.probe(item);
                if (lock.locked) {
                    lockStat.count++;
                    lockStat.points += Number(points) || 0;
                    Utils.log("🔒", `跳过锁卡：${item.title || item.name || item.offerId || "活动卡片"} +${points}p [${lock.reason}]`);
                    return { skip: true, appOnly: false, levelGated: false };
                }
                if (lock.appOnly) {
                    lockStat.app++;
                    Utils.log("🔓", `带锁徽标的 App 卡，改用 Rewards 应用通道：${item.title || item.name || item.offerId} +${points}p [${lock.reason}]`);
                    return { skip: false, appOnly: true, levelGated: !!lock.levelGated };
                }
                // 等级门槛卡走到这里说明页面/服务端已给了解锁态（isLocked:false 或 isUnlocked:true），
                // 但这类卡的服务端交卷常回 503：它的真实完成前奏是「按 href 做一次应用内搜索上报」。
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

                // 记录部署 ID：Server Action 交卷要带 x-deployment-id，缺了会「2xx 但不记账」
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

                // 带锁徽标的卡按 appOnly 标记下发；真锁卡丢弃；等级门槛（已解锁）卡带 levelGated 标记
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
                    /* getuserinfo 的 401 只是「后台 service worker 没带这个接口要的会话 Cookie」，
                     * 和网页 Server Action 的 401/403（cookie 真失效）不是一回事：rewards.bing.com 的
                     * earn/dashboard 页面本身照样能匿名打开，Server Action 也照样能交卷。
                     * 所以这里绝不能置 webNoAuth —— 一旦置了，后续每张卡的网页通道都会被整体跳过，
                     * 普通卡就只剩 dapi(p=0) 一条路，重试多少次都是同一组失败。 */
                    const noCookie = /\b(401|403)\b/.test(String(e.message));
                    Utils.log("🟡", `${noCookie ? "getuserinfo 无会话（不影响 Server Action 交卷）" : "getuserinfo 活动解析跳过"}: ${e.message}`);
                }

                // --- [Next.js Flight Chunks & DAPI parsing] ---
                try {
                    for (const item of this._flightItems(this._flightText(html))) {
                        if (!item.offerId || !item.hash) continue;
                        if (item.isCompleted === true || item.hidden === true) continue;
                        const points = Number(item.points || 0);
                        if (points <= 0 && !item.offerId.includes("DailySet")) continue;
                        // isLocked 不再一刀切：锁态交给 CardLock 语义判定，
                        // 带锁徽标的 App 卡会以 appOnly 下发并用应用 UA 交卷（以前是被直接丢弃）
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

            /* 桌面奖励应用「每周专属任务」不在这里下发卡片。
             * 它的问题不是「锁没锁」，而是「交卷必须打到 quest 页面 + 带 quest 路由状态树」，
             * 混进卡片队列只会被通用通道反复提交却永远不记账（旧版正是这样）。
             * 现在由 API.runDesktopWeeklyQuests 用专用通道整批处理 —— 见 doPromos。 */

            if (lockStat.count > 0 || lockStat.app > 0) {
                RewardsAuto.state.lockedCount = Math.max(RewardsAuto.state.lockedCount, lockStat.count);
                RewardsAuto.state.lockedPoints = Math.max(RewardsAuto.state.lockedPoints, lockStat.points);
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
            // 先问标识表：ActionMap 扫的是**按需分包**（交卷/领取组件常在里面），
            // 且按部署号缓存。缓存命中就直接复用，不必再走下面这套只认 reportActivity 的老探测。
            let cached = RewardsAuto._nextAction || GM_getValue("Config.nextAction", ActionMap.FALLBACK.reportActivity);
            try {
                const fromTable = ActionMap.get("reportActivity");
                if (fromTable && fromTable !== cached) {
                    cached = fromTable;
                    RewardsAuto._nextAction = cached;
                    GM_setValue("Config.nextAction", cached);
                }
            } catch (_) {}
            // 探测有代价：每个 chunk 都是一次 15 秒超时的网络请求，顺序扫几十个 chunk 会让整轮
            // 长时间没有任何日志（看起来就像卡死）。所以这里加三重限制：
            //   1) 最多扫 NEXT_ACTION_SCAN_MAX 个 chunk；
            //   2) 总耗时不超过 NEXT_ACTION_SCAN_BUDGET；
            //   3) 整轮扫完仍没找到，10 分钟内不再扫（负缓存），避免每张卡 404 都重来一遍。
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
                // 没找到：记下时间戳做负缓存，并留一条日志说明「为什么后面不再探测」
                GM_setValue("Config.nextActionScanAt", Date.now());
                Utils.log("🟡", `Server Action ID 探测未命中（扫了 ${scanned} 个 chunk），10 分钟内不再探测，先用现有 ID 继续`);
            }
            return cached;
        },

        /* 判断这张卡是不是「在 Rewards 应用内搜索」型。
         * 判据来自页面真实 href：带 form=ML2W4J / ML2Y2H 与 PUBL=RewardsDO 签名的，
         * 在网页上就是一条普通搜索链接（不是领取按钮），完成方式是「真的搜一次」。
         * 这类卡拿 Server Action 交卷，服务端只会返回 2xx 或 503，但永远不记分 ——
         * 这是「web(已发出但服务端未生效) + dapi(p=0) 反复重试」的根因。 */
        _isAppSearchCard(card) {
            const dest = String((card && card.destination) || "");
            if (!dest) return false;
            const q = dest.includes("?") ? dest.slice(dest.indexOf("?") + 1) : "";
            if (!q) return false;
            // 只认搜索型签名；领取型链接也可能带 PUBL=RewardsDO，故要求同时是 bing 搜索地址
            const isBingSearch = /bing\.com\/search/i.test(dest);
            const hasSign = /(^|&)(form=ML2W4J|form=ML2Y2H|PUBL=RewardsDO)/i.test(q);
            return isBingSearch && hasSign;
        },

        /** 按子卡 href 做「应用内搜索」签名上报 —— 桌面周任务子卡的真实完成前奏。
         *
         * 参考「商城签到改进加强版」的实测结论：这类子卡的 href 是
         * `bing.com/search?q=...&form=ML2Y2H&PUBL=RewardsDO`，**只交卷时服务端看不到那次搜索**，
         * 于是即使返回 `1:true` 也不会记账（日志表现为「已受理但未记账」）。
         * 正确顺序是：先走一遍 SERP → 再打 ncheader → 再打 reportActivity，最后才交卷。
         *
         * 三次请求都是 bing.com 域下的普通接口，不受 server action 的 Origin 限制。
         * 返回 true 表示三步都发出去了（不代表一定记账，记账仍由交卷+复核决定）。
         */
        async reportAppSearchForCard(href) {
            const raw = String(href || "").trim();
            if (!/bing\.com\/search/i.test(raw)) return false;
            const { origin, pathname, search } = (() => {
                try { const u = new URL(raw); return { origin: u.origin, pathname: u.pathname, search: u.search }; }
                catch (_) { return {}; }
            })();
            if (!origin) return false;
            const query = origin + pathname + search;
            const params = search.replace(/^\?/, "");
            const today = new Date();
            const p2 = n => String(n).padStart(2, "0");
            // _Rwho 是 Bing 的「本次搜索来自哪个设备/哪一天」标记，缺了容易被当成复用会话
            const baseHeaders = {
                "user-agent": RewardsAuto.desktopAppHeaders["user-agent"],
                "cookie": `_Rwho=u=d&ts=${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`,
            };

            // 1) 先真的请求 SERP，从响应里取服务端分配的 IG（交互 ID）
            let ig = "";
            try {
                const serp = await Utils.xhr({ url: query, headers: baseHeaders });
                const flat = String(serp || "").replace(/\s/g, "");
                const m = flat.match(/,IG:"([^"]+)"/);
                if (m) ig = m[1];
            } catch (_) {}
            if (!ig) ig = Utils.getRandomUUID();
            const reportHeaders = { ...baseHeaders, "referer": query };

            // 2) ncheader：告诉服务端「这次搜索的上下文」
            try {
                await Utils.xhr({
                    method: "POST",
                    url: `${origin}/rewardsapp/ncheader?ver=88888888&IID=SERP.5047&IG=${ig}&ajaxreq=1`,
                    headers: { ...reportHeaders, "content-type": "application/x-www-form-urlencoded" },
                    data: "wb=1%3bi%3d1%3bv%3d1"
                });
            } catch (_) {}

            // 3) reportActivity：真正记账的那一下，参数要原样带上子卡 href 的签名
            try {
                await Utils.xhr({
                    method: "POST",
                    url: `${origin}/rewardsapp/reportActivity?IG=${ig}&IID=SERP.5047&${params}&ajaxreq=1`,
                    headers: { ...reportHeaders, "content-type": "application/x-www-form-urlencoded" },
                    data: `url=${encodeURIComponent(query)}&V=web`
                });
            } catch (_) {}
            return true;
        },

        /** 等级门槛卡（`WW_Rewards_locked_level2_*` / `unlockCriteria=newLevel2`）且已解锁时，
         * 先走「应用内搜索三步上报」再交卷 —— 这条通道是从「微软积分商城签到（改进加强版）」
         * 的 taskPunchcard 子项处理里搬过来的，原脚本据此把同类子项做通了。
         *
         * 为什么对它优先级最高：这类卡在网页上就是一张「去搜一次」的卡，服务端 503 的
         * 真实含义往往不是「等级不够」，而是「没看到那次应用内搜索」。先按 href 上报，
         * 再交卷，通常就能记账；三步都是 bing.com 域的普通接口，不受 server action 的
         * Origin 限制，也不需要浏览器级输入（所以不必依赖 CDP）。
         *
         * 返回 true = 已通过该通道完成（服务端状态已复核）。false = 没成，调用方继续走
         * 原有的 CDP 通道（不删除、不降级）。
         */
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

            // 上报后给服务端一点时间，再补一次交卷（普通 UA；带 hash 才发）
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

            // 记账可能延迟，短暂轮询（最多 25 秒）确认是否真的完成
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

        /** 领取单张卡片（统一入口：先网页通道 → 网页完成不了再换 DAPI → 一律用服务端状态复核是否真的加分）。
         *  服务端可能要 1~3 分钟才把上报记入 progress，单次失败不等于真失败，故做多轮重试。
         */
        async claimCard(card, opts = {}) {
            const offerId = card.offerId;
            const name = card.title || offerId;
            const attempts = opts.attempts || 3;
            const backoffs = opts.backoffs || [[8000, 12000], [20000, 30000], [45000, 60000]];
            const diag = [];

            /* 应用内搜索型卡已被脚本上报过：卡片状态只能靠真实点击翻转，
             * 再重试只会重复开标签页、白等 25 秒，所以直接跳过并保持提示。 */
            if (this.isManualCard(offerId)) {
                Utils.log("🖐️", `已自动上报搜索，完成状态需手动点击确认：${name}`);
                return false;
            }

            // 今日已被服务端明确拒绝（503 等级门槛）：不再重复撞，直接认输交给下一轮/明天
            if (this.isUnoffered(offerId)) {
                Utils.log("🔒", `今日已确认做不了，跳过：${name}`);
                return false;
            }

            // 0) 服务端已完成：直接认账，避免重复上报触发风控
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
                // 单次尝试加硬超时：某个请求一直不回调时，不让它把整轮任务拖死，
                // 超时后照常进入下一次尝试（或交给 DAPI）。
                const ok = await this._claimCardOnceWithTimeout(card, { diag, name, attempt: i + 1 });
                if (ok) return true;
            }

            Utils.log("🟡", `卡片领取未确认（已重试 ${attempts} 次）：${name} [${diag.join(" ")}]`);
            return false;
        },

        // 单次尝试的硬超时包装：网络请求不回调时，超时后放弃这次尝试并留下日志，
        // 免得一张卡把整轮任务无限期拖住（日志里就能看到「单卡处理超时」）。
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

        // 单次领取尝试：访问目的地（urlreward 产生进度的真实机制）→ 网页通道 → DAPI 兜底 → 服务端复核
        // 通道顺序与 user.js 对齐：网页 Server Action 优先，网页确实完成不了才换 DAPI。
        // 没有 Cookie/未登录时网页通道必然失败（见 claimCardWeb 的 401 快退），会立刻落到 DAPI：
        // DAPI 用 Bearer Token 鉴权，不依赖浏览器 Cookie，所以「没 Cookie 也能完成」。
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

            // ---------- 1) 网页通道（优先） ----------
            /* 等级门槛卡（已解锁）专属前哨：先走「应用内搜索三步上报」（从「微软积分商城签到
             * （改进加强版）」的 taskPunchcard 子项做法搬来）。这类卡的 href 是
             * `bing.com/search?q=..&form=ML2Y2H&PUBL=RewardsDO`，服务端只看到交卷、没看到
             * 那次搜索时就不记账（表现为 503 或「已受理但未生效」）。
             * 顺序按用户要求：新增通道优先，完不成再落到下面原有的 CDP 通道（CDP 不删）。 */
            if (!skipWeb && card.levelGated && !card.appOnly) {
                const viaSearch = await this._claimLevelGatedViaAppSearch(card, { diag, name });
                if (viaSearch) return true;
            }

            /* 分支顺序很重要：搜索型卡靠 destination 完成，不由 hash 驱动，
             * 必须排在「无 hash」分支之前，否则 DAPI 发现的搜索卡会被误判成走 DAPI。 */
            if (!skipWeb && this._isAppSearchCard(card)) {
                /* 「应用内搜索」型卡（href 带 PUBL=RewardsDO / form=ML2W4J|ML2Y2H）。
                 *
                 * 这类卡只有浏览器级真实点击才能完成（isTrusted=true 才产生 rdrig）。
                 * 现在统一交给 CDP：它在已有的 earn 页上派发鼠标事件，**不打开新标签页**。
                 * CDP 不可用时 reportDailyActivity 返回 false 并发一次醒目提示。 */
                const searchOk = await this.reportDailyActivity(card.destination);
                diag.push(searchOk ? "search(CDP已点击)" : "search(未处理)");
                if (searchOk) {
                    // CDP 点完到服务端记账有一小段延迟，短暂轮询即可
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
                // 这类卡重试无意义（CDP 已遍历处理过），标记后交给下一轮/明天
                this._markManualCard(offerId, name);
            } else if (!skipWeb && !card.hash) {
                // DAPI 发现的日常卡没有 hash（网页通道拿不到交卷标识），直接走 DAPI
                diag.push("web(无hash)");
            } else if (!skipWeb && card.appOnly) {
                // 带锁徽标的 App 卡：普通 UA 交卷一定被拒，直接用 Rewards 应用 UA 交卷。
                // 这条分支不受 webNoAuth / webFailStreak 熔断影响 —— 熔断针对「浏览器会话」，
                // 应用通道是另一套身份，被 401 连坐会让这类卡永远做不成。
                await this._claimViaAppChannel(card, { diag, name });
                if (await this.isOfferCompleteAny(offerId, true) === true) return true;
            } else if (!skipWeb && RewardsAuto.state.webNoAuth) {
                diag.push("web(未登录跳过)");
            } else if (!skipWeb && RewardsAuto.state.webFailStreak >= WEB_FAIL_LIMIT) {
                // 熔断：本轮网页通道已连续失败多次（超时/500），再挨张试只会把整轮拖得很久
                diag.push("web(本轮已熔断)");
            } else if (!skipWeb) {
                let webAccepted = false;
                let webErr = null;
                try {
                    webAccepted = await this.claimCardWeb(card);
                } catch (e) {
                    webErr = e;
                    diag.push(`web(${e.message})`);
                    // 401/403 = 网页通道登录态不可用（典型情况就是没有 Cookie）。
                    // 记下来，后续卡片不再白发网页请求，直接走 DAPI。
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
                    // 网页失败立刻留一条日志（以前只在全部重试结束的汇总里出现，
                    // 中途卡住时完全看不出停在哪张卡、什么原因）
                    if (!RewardsAuto.state.webNoAuth) {
                        RewardsAuto.state.webFailStreak += 1;
                        Utils.log("🟠", `网页通道未成功（${name}）：${webErr ? webErr.message : "请求未被接受"}`
                            + `（连续 ${RewardsAuto.state.webFailStreak}/${WEB_FAIL_LIMIT} 次，超限后本轮改用 DAPI）`);
                    }
                }
            }

            // ---------- 2) DAPI 兜底（Bearer Token 鉴权，不使用浏览器 Cookie，跨浏览器一致） ----------
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

        /* 网页通道（Edge 与 Chrome/Firefox 差异所在）：返回 true 仅表示请求被接受，真实加分由 claimCard() 用 DAPI 复核。
         * appChannel=true：用 Rewards 桌面应用 UA 交卷。带锁徽标的 App 专属卡在普通浏览器 UA 下
         * 恒为 isLocked:true，但同一个 hash 在应用 UA 下就是解锁态 —— 换 UA 是这类卡唯一的完成方式。 */
        /* ===== 页面通道：让 rewards 页面用自己的 fetch 代发交卷请求 =====
         *
         * 为什么需要它（2026-11-04 实测，两个账号都复现）：
         *   server action 的 `Origin` 由**浏览器强制注入**，脚本改不了。后台（service_worker）
         *   发 GM_xmlhttpRequest 时它恒为 `chrome-extension://<扩展ID>`，必应 WAF 直接回 500
         *   （0.1~0.2 秒、响应体是风控页）。而在 rewards.bing.com 页面里 fetch，Origin 天然是
         *   `https://rewards.bing.com`，同样请求 200 且记账。
         * 既然改不了头，就换发送方：后台把请求写进 GM 存储，页面读出来用自己的 fetch 发，
         * 再把响应写回去。
         *
         * 存活判定靠页面心跳：没有页面在线就直接跳过，不去等 15 秒超时。 */
        PAGE_BOX: {
            req: "Config.pageReq",
            res: "Config.pageRes",
            alive: "Config.pageAlive"
        },

        /* 页面侧：取一条待发请求并执行（带抢占标记，避免多标签页重复发）。 */
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

        /* 页面侧常驻：每 1.5 秒写一次心跳并尝试服务一条请求。
         * 注意：这里不挂「永不结束」的定时器链 —— 每轮只在内存里挂一次 next，
         * 并且可通过 __MP_TEST_TAB_WAIT__ 之外的开关（Config.pageServerOff）停掉，
         * 免得 Node 单测因为一个常驻定时器而无法退出。 */
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
                // Node 单测里不要让这个定时器把进程钉住
                if (this._pageServerTimer && typeof this._pageServerTimer.unref === "function") {
                    this._pageServerTimer.unref();
                }
            };
            this._pageServerTimer = setTimeout(tick, 600);
            if (this._pageServerTimer && typeof this._pageServerTimer.unref === "function") {
                this._pageServerTimer.unref();
            }
        },

        /* 是否有 rewards 页面在线（心跳 40 秒内有效）。 */
        _pageChannelAlive() {
            const at = Number(GM_getValue(this.PAGE_BOX.alive, 0)) || 0;
            return at > 0 && (Date.now() - at) < 40 * 1000;
        },

        /* 没有页面在线时，临时开一个 rewards 页面把通道架起来。
         *
         * 为什么必须这么做：扩展后台发 server action 时 Origin 恒为 chrome-extension://<id>，
         * 必应 WAF 直接 500，而这个头脚本改不了。唯一干净的路是让某个 rewards 页面用
         * 自己的 fetch 代发 —— 后台没有页面就开一个。
         *
         * 页面加载完、脚本注入、页面服务起来需要几秒，这里轮询等心跳。
         * 用完不立即关：同一轮后续卡片还会继续用它（见 _claimPageTab）。 */
        async _ensurePageChannel() {
            /* 默认绝不自动开标签页（用户明确要求）。
             * 现在这条通道整条默认关闭（见 submitQuestCard 策略 B），这里再加一道保险：
             * 即使有人单独调用它，也必须有 Config.allowOpenTab 才会真的开。 */
            if (!GM_getValue("Config.allowOpenTab", false)) return null;
            /* 标签页只能开一次。
             *
             * 之前每张卡、每次重试都会进来开一个新标签（用户反馈「打开了很多标签」）：
             * `_openingPage` 只防并发，跑完就清掉，下一次调用照样再开一个。
             * 现在用持久化的 `Config.pageOpenedAt` 记住「这一轮已经开过了」——
             * 跨上下文、跨重试都有效，因为 MV3 的 service_worker 随时可能被挂起，内存变量不可靠。
             * 只要开过且还在 10 分钟窗口内，就绝不再开第二个。 */
            const openedAt = Number(GM_getValue("Config.pageOpenedAt", 0)) || 0;
            const reallyAlive = this._pageChannelAlive();
            if (!reallyAlive && openedAt && (Date.now() - openedAt) < 10 * 60 * 1000) {
                // 刚开过但心跳没起来：再等一小会儿（页面可能还在加载），绝不再开新的
                for (let i = 0; i < 12; i++) {
                    await Utils.delay(500);
                    if (this._pageChannelAlive()) return null;
                }
                return null;
            }
            if (this._openingPage) {
                for (let i = 0; i < 40; i++) {
                    await Utils.delay(500);
                    if (this._pageChannelAlive()) return null;
                }
                return null;
            }
            this._openingPage = true;
            GM_setValue("Config.pageOpenedAt", Date.now());
            try {
                Utils.log("🖥️", "需要借 rewards 页面代发请求，正在打开一个临时页面…");
                /* 打开方式要容错：日志里出现过
                 *   `Tabs cannot be edited right now (user may be dragging a tab)`
                 * （ScriptCat 的 offscreen messageServer 报的）—— 用户正在拖标签页、
                 * 或浏览器窗口处于特殊状态时，insert/setParent 这类「编辑标签页」的动作会失败。
                 * 所以先试完整参数，失败就退化成最简调用；两次都失败才算真开不了。 */
                let opened = false;
                const url = "https://rewards.bing.com/earn?mpq=" + Date.now();
                for (const opts of [
                    { active: false, insert: true, setParent: true },
                    { active: false },
                    undefined
                ]) {
                    try {
                        if (opts) GM_openInTab(url, opts);
                        else GM_openInTab(url);
                        opened = true;
                        break;
                    } catch (e) {
                        // 换下一组更保守的参数
                    }
                }
                if (!opened) {
                    Utils.log("🔴", "打开代发页面失败（浏览器拒绝编辑标签页），只能退回后台直发");
                    return null;
                }
                // 等页面加载 + 脚本注入 + 页面服务起心跳。
                // 45 秒：@run-at document-start 下要等整个 earn 页（含 Next.js 水合）跑完，
                // 慢网络/低配机器上 20 秒经常不够 —— 之前那句「20 秒内没有就绪」就是这么来的。
                for (let i = 0; i < 90; i++) {
                    await Utils.delay(500);
                    if (this._pageChannelAlive()) {
                        Utils.log("✅", "代发页面已就绪");
                        return null;
                    }
                    if (i === 19) Utils.log("🖥️", "代发页面还在加载（已等 10 秒）…");
                    if (i === 49) Utils.log("🖥️", "代发页面还在加载（已等 25 秒）…");
                }
                Utils.log("🟡", "代发页面 45 秒内没有就绪。可能原因："
                    + "① 脚本未注入该页（@background 会让页面永不注入，需用 @crontab）；"
                    + "② 打开的标签页被浏览器冻结/未获得执行机会。本轮改用后台直发。");
                return null;
            } finally {
                this._openingPage = false;
            }
        },

        /* 后台侧：把请求交给页面执行并等结果。超时返回 null。
         *
         * 双通道等待（参考「商城签到」脚本的做法）：
         *   · 首选 GM_addValueChangeListener —— 页面写回结果时**立刻**收到通知，延迟≈0；
         *   · 兜底轮询 —— 某些 ScriptCat 版本里跨上下文的 GM_getValue 读不到对方写入，
         *     或者监听器拿不到，这时靠轮询（600ms）保证最终能读到。
         * 两者并存，谁先到用谁。 */
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

        /* 判断 Server Action 的响应是否「受理了这次交卷」。
         * 旧判断是 res.includes("true") || res.includes('"a":')，太松：
         * 任何带 true 的页面（甚至某些错误帧）都会被当成成功，于是日志里出现
         * 「web(已发出但服务端未生效)」——受理了，但根本没记账。
         * Next.js 的 flight 流里，错误帧长这样：1:E{"digest":"..."}，成功帧则是
         * 0:{"a":"$@1"} 之后跟 1:{"ok":true} 之类。所以这里先明确排掉错误帧和登录页。 */
        _actionLooksAccepted(res) {
            const text = String(res || "");
            if (!text) return false;
            // flight 错误帧：<hex>:E{...}，或任何带 digest 的帧 —— 服务端抛错了，肯定没记账
            if (/(?:^|\n)[0-9a-f]+:E\{/i.test(text) || /"digest"\s*:/.test(text)) return false;
            // 未登录时会被重定向到登录页 / 返回 HTML 文档，这种 2xx 也不是受理
            if (/^\s*<!doctype\s+html/i.test(text) || /<html[\s>]/i.test(text)) return false;

            /* 关键：Next.js flight 里服务端的**判定结果**是单独一行 `1:true` / `1:false`。
             *
             * 以前这里用 `text.includes("true")` 兜底，看似宽松实则致命：
             * 失败帧 `0:{"a":"$@1","q":"","i":false} 1:false` 里既没有 "true"，
             * 却命中了 `"i":false` 和 `"a":` 两个条件 —— **明确失败被当成了成功**。
             * 后果就是日志显示「已受理」，脚本跳过重试，而卡片根本没进账；
             * 更糟的是没解锁的卡提交后也被记成「成功」，掩盖了真正该做的那张。
             *
             * 现在只认 `<帧号>:true|false` 这种结果帧，并且：
             *   · 结果帧之间可能用**换行**也可能用**空格**分隔（真实响应两种都出现过，
             *     只认换行会导致成功被判失败 —— 这正是收紧判定后 5 个用例挂掉的根因）；
             *   · 取**最后一个**匹配：flight 流里结果帧总在末尾，前面的记录帧不会误判；
             *   · 排除 `1:E{...}` 错误帧（上面已先拦掉）与 `"i":false` 这类 JSON 字段
             *     （它们的冒号前不是数字，天然不匹配 `\d+:`）。 */
            const verdicts = [...text.matchAll(/\d+:(true|false)(?![\w{])/g)];
            if (verdicts.length > 0) {
                return verdicts[verdicts.length - 1][1] === "true";
            }
            // 极少数响应没有结果帧（老版本接口）：只有明确出现 ok:true 才算受理，
            // 不能再靠 "a": 或 "i":false 这种结构性字段去猜。
            return text.includes('"ok":true');
        },

        /* ===== 桌面奖励应用「每周专属任务」(punchcard) =====
         *
         * 任务形态（2026-11-03 实测，父任务 WW_pcparent_RewardsApp_weekly_Exclusive_Novw1_2026_punchcard）：
         *   · 一个 punchcard 父任务，下面挂 8 个子卡（Sunday…Saturday + 「已安装应用」那张）。
         *   · 每张子卡只在**自己对应的星期几**解锁，其余时间 isLocked:true。
         *   · 子卡 href 都是 bing.com/search（form=ML2Y2H&PUBL=RewardsDO），属于「应用内搜索」型。
         *   · 子卡与父卡的 hash / offerId 在网页端也能原样读到（只是网页版**不显示**这个入口）。
         *
         * 完成通道（纯 HTTP，不需要 CDP）：
         *   Next.js Server Action POST 到 **quest 页面**，body 是
         *     [hash, 11, {offerid, isPromotional:"$undefined", timezoneOffset:"-480"}]
         *   关键差异是 next-router-state-tree 必须带 quest 段（见 Utils.questRouterStateTree）。
         *   实测：同一份 body 换掉这个头之前「200 但不记账」，换之后子卡从列表消失并计入
         *   「状态: X/8 个任务」——锁着的卡也能被这个请求记成完成，所以是真正能一次做完一周的通道。
         *
         * 判定「是否记账」：响应的 `1:true` 只代表**受理**（锁着的卡同样返回 true），
         * 真正的判据是重新拉 quest 页面看这张卡还在不在。 */

        QUESTS: {
            // 桌面应用每周专属任务的父任务前缀（父任务 ID 会带上具体周次，如 _Novw1_2026_punchcard）
            weeklyPrefix: /WW_pcparent_RewardsApp_weekly_Exclusive/i
        },

        /* 从 earn 页 HTML 里找出所有 quest 链接（不只桌面那一个）：monthly / Duolingo 等
         * punchcard 走的是同一套完成通道，顺手一起收。 */
        _questLinksFromEarn(earnHtml) {
            /* 三重兜底，对齐参考脚本（商城签到改进版）的做法。
             *
             * 旧实现只走 _flightText（把 self.__next_f.push 的片段拼起来）。
             * 但 flight 片段解析对转义层级很敏感：字符串里再套一层 `\"` 或
             * `\u0026` 时就 parse 失败，拼出来是空串 → 一个入口都找不到
             * → 日志只说「本轮没有桌面专属任务」，而页面上明明有解锁的卡。
             *
             * 参考脚本不依赖 flight 解析，它直接在整个 HTML 上跑三条正则：
             *   1) "offerId":"...punchcard..."  ← flight 负载里的父任务字段
             *   2) "href":"/earn/quest/..."     ← flight 负载里的链接字段
             *   3) href="/earn/quest/..."       ← 渲染后 HTML 里的链接属性
             * 任一条命中即可。这样即使 flight 解析失效也照样能找到。 */
            const raw = String(earnHtml || "");
            const cleanEarn = raw.replace(/\\"/g, '"');   // 反转义后正文，参考脚本同款
            const found = new Map();
            const add = (id) => {
                let q = String(id || "").split("?")[0].split("#")[0];
                try { q = decodeURIComponent(q); } catch (_) {}
                if (q && /punchcard/i.test(q) && !found.has(q)) found.set(q, q);
            };

            // 兜底 0：flight 片段（保留原路径，正常时最准）
            const text = this._flightText(raw);
            const reFlight = /\/earn\/quest\/([A-Za-z0-9_%.\-]+punchcard[A-Za-z0-9_%.\-]*)/g;
            let m;
            while ((m = reFlight.exec(text)) !== null) add(m[1]);

            // 兜底 1：整体 HTML 里的 offerId 字段
            const reOffer = /"offerId"\s*:\s*"([^"]*punchcard[^"]*)"/g;
            while ((m = reOffer.exec(cleanEarn)) !== null) add(m[1]);

            // 兜底 2：整体 HTML 里的 href 字段（flight 负载）
            const reHref = /"href"\s*:\s*"(\/earn\/quest\/[^"]+)"/g;
            while ((m = reHref.exec(cleanEarn)) !== null) add(m[1].split("/").pop());

            // 兜底 3：渲染后 HTML 的链接属性
            const reHrefHtml = /href="(\/earn\/quest\/[^"]+)"/g;
            while ((m = reHrefHtml.exec(cleanEarn)) !== null) add(m[1].split("/").pop());

            // 兜底 4：转义形态（\"href\":\"/earn/quest/...），raw 上再扫一遍
            const reEscaped = /\\"href\\":\\"(\/earn\/quest\/[^\\"]+)/g;
            while ((m = reEscaped.exec(raw)) !== null) add(m[1].split("/").pop());

            return [...found.keys()];
        },

        /* 拉一个 quest 页面，解析出它下面所有子卡（offerId / hash / 锁态 / 完成态）。 */
        async fetchQuestCards(parentId) {
            const url = "https://rewards.bing.com/earn/quest/" + encodeURIComponent(parentId);
            const html = await Utils.xhr({
                url,
                headers: RewardsAuto.desktopAppHeaders
            });
            if (!html) return { parentId, url, html: "", cards: [] };
            const text = this._flightText(html);
            const cards = [];
            // 子卡 ID 的前缀并不统一：桌面周任务是 WW_pcchild…，月度/品牌任务可能是
            // ENWW_pcchild… / CNWW_pcchild… 等。旧版写死 "WW_pcchild" 只能收桌面那一套，
            // 换成「任意前缀 + pcchild」后，同一套通道能覆盖所有 punchcard。
            for (const item of this._flightItems(text, "[A-Za-z0-9]*_pcchild[^\"]+")) {
                if (!item.offerId || !item.hash) continue;
                cards.push({
                    offerId: item.offerId,
                    hash: item.hash,
                    title: String(item.ariaLabel || item.linkText || item.offerId).replace(/^\s*\d+\s*[分点]?\s*,?\s*/, "").trim() || item.offerId,
                    isCompleted: item.isCompleted === true,
                    isLocked: item.isLocked === true,
                    href: item.href || item.destination || ""
                });
            }
            return { parentId, url, html, text, cards };
        },

        /* 一次 Server Action 交卷（quest 页面）。返回 { accepted, raw }。 */
        /* 原始请求：**无论状态码都把 body 带回来**。
         * Utils.xhr 遇到非 2xx 只抛 `HTTP 500，用时…`，响应体全丢了 ——
         * 而 500 到底是「必应 WAF 拦截页」还是「Next.js 错误帧」还是「登录跳转」，
         * 只有 body 能分辨。排障必须看到它。 */
        async _rawXhr(options) {
            const start = Date.now();
            return await new Promise((resolve) => {
                try {
                    GM_xmlhttpRequest({
                        /* 这里**不传 anonymous**。参考脚本（微软积分商城签到）的 xhr 也不传，
                         * 实测那个脚本在同样的 service_worker 里能正常发出 server action。
                         * 而本文以前统一写 `anonymous: false`，日志出现
                         * `status=0 / 0.02 秒 / Unknown Error` —— 请求根本没出去，
                         * 与「禁改头」是两种不同的失败，不能混为一谈。
                         * 显式传 false 在部分 ScriptCat 版本里会让请求走匿名通道，
                         * 反而丢掉会话 Cookie。 */
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

        /* Server Action 交卷的「请求形态」候选表。
         *
         * 为什么需要多形态：同一个请求在不同账号/不同扩展上下文里结果不一样 ——
         * 2026-11-04 已实测到，A 账号不带 origin 就能记账，B 账号照样 500。
         * 与其继续猜哪一个头有问题，不如按代价从低到高逐个试，把**能过的那个记住**。
         *
         * 候选表（2026-11-04 第三版，对齐两个成熟参考脚本）：
         *   1) earn页 + earn树 + 同源origin —— 参考脚本 `taskRewardsAppCards` 正是这么发的，
         *      它们在 service_worker 里能正常交卷，所以作为首选；
         *   2) quest页 + quest树 + 同源origin —— 本机实测同样 200 记账，作为备选；
         *   3) earn页 + 普通UA（去掉 MSRewards 应用身份）。
         *
         * 注意：`origin` 这里是**可以设**的。上一版误以为设了必炸，其实是另一回事：
         * 本机直连四种组合（有无 origin × earn/quest 页）全部 200 —— origin 本身不是问题，
         * 真正让请求发不出去的是 `anonymous: false` 那类发送层参数（见 _rawXhr 注释）。
         *
         * 真正的禁改头（sec-fetch-* 等）依然不能出现：设了会直接 `status=0 / Unknown Error`。 */
        _questSubmitVariants() {
            const SRC = "https://rewards.bing.com";
            return [
                { name: "earn页+origin", toEarn: true, headers: { origin: SRC } },
                { name: "quest页+origin", toEarn: false, headers: { origin: SRC } },
                { name: "earn页+普通UA", toEarn: true, headers: { origin: SRC }, plainIdentity: true }
            ];
        },

        /* 试出当前账号可用的交卷形态，并把结论存下来给后续卡片直接用。
         * 返回 { variant, result } —— variant 为 null 表示全部失败。 */
        async _probeQuestVariant(pageUrl, parentId, card) {
            const saved = GM_getValue("Config.questVariant", "");
            const all = this._questSubmitVariants();
            // 已记住的形态优先，省掉每次重试的 3 次白跑
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
                // 401/403 说明是登录态问题，换形态也没用，直接停
                if (r.status === 401 || r.status === 403) break;
            }
            // 全部失败：把最后一次结果带回去打日志，不再补发请求（补发只会白挨一次 WAF）
            return { variant: null, result: last, tried };
        },

        /* 按某一种形态发一次交卷请求。
         *
         * 2026-11-04 第三版：改回参考脚本验证过的组合 —— **打到 earn 页 + earn 树 + 显式同源 origin**。
         *
         * 之前一直用 quest 页 + quest 树，是因为在本机 Node 里观察到 quest 树能记账。
         * 但对照两个成熟脚本（微软积分全能任务版 / 商城签到改进版）后发现，它们完成同类
         * 「Rewards App 专属卡」时走的都是：
         *     POST https://rewards.bing.com/earn
         *     next-action: <reportActivity id>
         *     next-router-state-tree: getRouterStateTree("earn")
         *     origin: https://rewards.bing.com
         * 而且本机四种组合实测（同一张子卡）全部 `status=200 + 1:true`，
         * 说明「quest 页 vs earn 页」不是成败关键，真正卡住的是**发送层**（见 _rawXhr 的注释）。
         * 既然参考脚本在 service_worker 里能跑通，就按它们的形态发，少一个变量。 */
        async _submitQuestOnce(pageUrl, parentId, card, variant) {
            const nextAction = RewardsAuto._nextAction || GM_getValue("Config.nextAction", ActionMap.FALLBACK.reportActivity);
            const dpl = RewardsAuto._dpl || GM_getValue("Config.dpl", "");
            const payload = JSON.stringify([card.hash, 11, {
                offerid: card.offerId,
                isPromotional: "$undefined",
                timezoneOffset: "-480"
            }]);
            // 打到 earn 页（不是 quest 页），并配 earn 段的状态树
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

        /* 交卷失败时把「服务器到底说了什么」写进日志 —— 这是唯一能继续排障的依据。
         * 500 的 body 有三种可能，处理方式完全不同：
         *   · 必应风控页（<title>Bing</title> + .sc_error）→ 被 WAF 拦，换形态/等一会儿；
         *   · Next.js 错误帧（…:E{"digest":…}）→ action ID 或请求头不对；
         *   · 登录页（login.live.com / oauth20）→ 登录态失效。 */
        _questDiag(res) {
            const t = String((res && res.text) || "");
            const st = res ? res.status : 0;
            // 状态 0 = 请求根本没发出去。以前这里显示「未知」，其实是最容易定位的一类：
            // XHR 层拒绝了某个禁改头（Origin / sec-fetch-* 等），或扩展没权限访问该域名。
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

        async submitQuestCard(parentId, card) {
            const pageUrl = "https://rewards.bing.com/earn/quest/" + encodeURIComponent(parentId);
            const nextAction = RewardsAuto._nextAction || GM_getValue("Config.nextAction", ActionMap.FALLBACK.reportActivity);
            const dpl = RewardsAuto._dpl || GM_getValue("Config.dpl", "");
            const payload = JSON.stringify([card.hash, 11, {
                offerid: card.offerId,
                isPromotional: "$undefined",
                timezoneOffset: "-480"
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

            /* 策略 A：CDP 页面通道（首选，实测唯一稳定可用）
             *
             * server action 的 Origin 由浏览器强制注入：
             *   · 扩展后台 GM_xmlhttpRequest → `chrome-extension://<id>` → 必应 WAF 直接 500；
             *   · 页面里 fetch → `https://rewards.bing.com` → 200 记账。
             * 这个头脚本改不了，所以必须换发送方。CDP 能在**页面上下文**里执行代码，
             * 等于借页面自己的 fetch —— 与本机调试时完全一致，实测确认可行。
             *
             * 前提：Edge 用桌面「Rewards Edge」快捷方式启动（已配 9224 调试端口）。
             * CDP 不可用时安静降级，不打断其它任务。 */
            if (GM_getValue("Config.questViaCdp", true) && typeof WebSocket !== "undefined") {
                try {
                    if (await CDP.available()) {
                        // 确保有一个 rewards 页可执行；earnPage 会复用已开的页面
                        const page = await CDP.earnPage();
                        if (page && page.webSocketDebuggerUrl) {
                            if (!CDP._ws || CDP._ws.readyState !== 1) {
                                await CDP.connect(page.webSocketDebuggerUrl);
                            }
                            const r = await CDP.claimInPage(pageUrl, baseHeaders, payload);
                            if (r.accepted && this._actionLooksAccepted(r.text)) {
                                Utils.log("🖥️", "  经由 CDP 页面通道交卷成功");
                                return { accepted: true, raw: r.text, status: r.status, variant: "CDP页面通道" };
                            }
                            Utils.log("🟡", `CDP 页面通道未受理（HTTP ${r.status}）：${String(r.text).replace(/\s+/g, " ").slice(0, 90)}`);
                        }
                    }
                } catch (eCdp) {
                    Utils.log("🟡", `CDP 页面通道异常：${eCdp.message}`);
                } finally {
                    try { CDP.close(); } catch (_) {}
                }
            }

            /* 策略 B：页面代发（默认关闭）
             *
             * 这条通道的设想是：把请求写进 GM 存储，让 rewards 页面用自己的 fetch 代发。
             * 但实测它在本脚本的部署方式下**从来没成功过**，原因很明确：
             * 脚本用 `@background` 只跑在 service_worker 里，**页面永远不注入脚本**，
             * 所以「代发服务」起不来，`_ensurePageChannel` 打开的那个标签页也白开
             * （日志里那句「代发页面 45 秒内没有就绪」就是这么来的）。
             *
             * 而它想解决的问题（Origin 被浏览器强制成 chrome-extension://）已经由
             * **策略 A 的 CDP 页面通道**彻底覆盖，且实测 200 记账。
             * 所以这里默认关闭，避免无意义地弹标签页；确实需要时把
             * `Config.usePageChannel` 置为 true 仍可启用。 */
            if (GM_getValue("Config.usePageChannel", false)) {
                let tabId = null;
                if (!this._pageChannelAlive()) {
                    tabId = await this._ensurePageChannel();
                }
                if (this._pageChannelAlive()) {
                    const viaPage = await this.viaPageChannel(pageUrl, baseHeaders, payload);
                    if (viaPage && !viaPage.error) {
                        const accepted = viaPage.ok && this._actionLooksAccepted(viaPage.text);
                        if (accepted) {
                            this._claimPageTab = true;   // 有页面在手，本轮后面的卡继续复用
                            return { accepted: true, raw: viaPage.text, status: viaPage.status, variant: "页面通道" };
                        }
                        Utils.log("🖥️", `页面通道未受理（HTTP ${viaPage.status}），改试后台直发`);
                    } else {
                        Utils.log("🟡", "页面通道没有返回结果（页面可能未加载完），改试后台直发");
                    }
                }
            }

            const probed = await this._probeQuestVariant(pageUrl, parentId, card);
            if (probed.variant) {
                return {
                    accepted: true,
                    raw: probed.result.text,
                    status: probed.result.status,
                    variant: probed.variant.name
                };
            }
            // 全形态都失败：用最后一次的结果打日志（不再补发请求）
            const last = probed.result;
            return {
                accepted: false,
                raw: last ? last.text : "",
                status: last ? last.status : 0,
                variant: last ? last.variant : "",
                tried: probed.tried,
                diag: last ? this._questDiag(last) : "无响应"
            };
        },

        /* 桌面应用每周专属任务：发现 → 交卷 → 复核。
         *
         * 与普通卡片最大的不同是「周节奏」：一周 8 张子卡按星期几依次解锁。
         * 用户要求「发现后可以自动完成」，所以这里不做「今天是周几」的硬过滤，
         * 而是把页面上**所有未完成**的子卡都交给服务端 —— 实测锁着的卡同样能被这个
         * 请求记成完成，服务端是否给分由它自己决定，脚本不替它保守。
         * 返回 { found, done, pending }。 */
        async runDesktopWeeklyQuests() {
            Utils.log("🖥️", "扫描桌面奖励应用专属任务…");
            /* 先预热 cookie：这个环境里后台请求默认不带登录态（见 API.getCookieHeader），
             * 不预热的话下面拉回来的 earn 页会是登录页，子卡一张也解析不到。 */
            try { await this.getCookieHeader(); } catch (_) {}
            let encEarn;
            try {
                /* 纯后台读取（不依赖 CDP）。
                 * 之前一版用 CDP 在页面上下文读，因为误判「后台不带登录态」；
                 * 但参考脚本（商城签到改进版）同样是裸 GM_xmlhttpRequest，在同样环境下能跑通，
                 * 说明后台请求本身是会带 cookie 的 —— 问题不在「读不到」，而在「请求头」。
                 * 所以回到后台读取，并把请求头降到最简（见下）。 */
                encEarn = await Utils.xhr({
                    url: "https://rewards.bing.com/earn",
                    /* 只用应用 UA + 来源标记，不带任何多余头。
                     * 参考脚本读 earn 页时也就带一个 User-Agent。 */
                    headers: {
                        ...RewardsAuto.desktopAppHeaders
                    }
                });
            } catch (eEarn) {
                Utils.log("🔴", `桌面专属任务：拉取 earn 页失败（${eEarn.message}），本轮跳过`);
                return { found: 0, done: 0, pending: 0 };
            }
            if (!encEarn) {
                Utils.log("🔴", "桌面专属任务：earn 页返回空，本轮跳过");
                return { found: 0, done: 0, pending: 0 };
            }

            /* 诊断：earn 页拿回来的是「真实页面」还是「登录页」？
             * 之前只打一句「本轮没有桌面专属任务」，让人无法判断到底是
             *   (a) 本周真的没有/已做完，还是
             *   (b) 后台请求没带登录态，只拿到登录页（于是当然解析不到任何 quest）。
             * 这两种情况的处置完全不同，必须在日志里能分开。 */
            const earnLen = String(encEarn).length;
            const looksLogin = /<title>登录<\/title>|Sign in to your account|oauth20_authorize/i.test(String(encEarn));
            if (looksLogin || earnLen < 60000) {
                Utils.log("🟡", `桌面专属任务：earn 页疑似未登录（长度 ${earnLen}，`
                    + `${looksLogin ? "是登录页" : "比正常页小很多"}）——`
                    + `请检查 GM_cookie 是否授权、账号是否已登录`);
            }

            const questIds = this._questLinksFromEarn(encEarn)
                .filter(id => this.QUESTS.weeklyPrefix.test(id));
            if (questIds.length === 0) {
                // 把所有 quest 入口都列出来，便于判断「是入口没了」还是「只是周任务入口没了」
                const allQuests = this._questLinksFromEarn(encEarn);
                Utils.log("🖥️", "本轮没有桌面奖励应用每周专属任务"
                    + `（earn 页 ${earnLen} 字节，识别到 ${allQuests.length} 个 quest 入口`
                    + (allQuests.length ? `：${allQuests.join("、")}` : "")
                    + "）");
                return { found: 0, done: 0, pending: 0 };
            }
            Utils.log("🖥️", `发现 ${questIds.length} 个桌面专属任务入口：`
                + questIds.map(id => id.replace(/^WW_pcparent_RewardsApp_weekly_Exclusive_?/i, "")).join("、"));

            let totalDone = 0, totalFound = 0, totalPending = 0, totalFailed = 0;
            for (const parentId of questIds) {
                let snap;
                try {
                    snap = await this.fetchQuestCards(parentId);
                } catch (eSnap) {
                    // 一张页面拉不到不能影响其它周任务，也不能让整批静默中止
                    Utils.log("🔴", `桌面专属任务：读取 ${parentId} 失败（${eSnap.message}），跳过这一个`);
                    totalFailed++;
                    continue;
                }
                if (snap.cards.length === 0) {
                    // 子卡全部消失 = 这一周的任务已经全部做完，是最常见的正常状态
                    Utils.log("✅", `桌面专属任务本周已全部完成：${parentId}`);
                    continue;
                }
                totalFound += snap.cards.length;
                const open = snap.cards.filter(c => !c.isCompleted);
                if (open.length === 0) {
                    Utils.log("✅", `桌面专属任务本周已全部完成：${parentId}`);
                    continue;
                }
                /* **只处理已解锁的卡**（用户明确要求）。
                 *
                 * 以前会把锁着的卡也一起提交，结果：先耗掉重试预算在注定失败的请求上，
                 * 日志里还刷出一堆「锁定/未完成」的噪音，让人分不清「今天该做的没做成」
                 * 还是「今天本来就没开」。现在：
                 *   · 锁定卡完全不显示、不提交（它们到了对应那天自然会变成解锁态）；
                 *   · 只把已解锁且未完成的卡打印出来并执行。 */
                const unlocked = open.filter(c => !c.isLocked);
                if (unlocked.length === 0) {
                    Utils.log("🖥️", `桌面专属任务：${open.length} 张待办全部未解锁（未到对应星期），本轮不处理`);
                } else {
                    Utils.log("🖥️", `桌面奖励应用专属任务：${unlocked.length} 张已解锁待办`
                        + `（另有 ${open.length - unlocked.length} 张未解锁，不处理）（${parentId}）`);
                    for (const c of unlocked) Utils.log("🖥️", `  · [已解锁] ${c.title}`);
                }

                let doneHere = 0, failedHere = 0;
                for (const card of unlocked) {
                    /* 子卡的真实完成顺序是「先按 href 做应用搜索签名上报，再交卷」。
                     * 只交卷时服务端看不到那次搜索，会返回 1:true 但不记账
                     * —— 日志里那句「已受理但未记账」就是这个原因。 */
                    if (card.href && /^https?:/i.test(card.href)) {
                        try {
                            const reported = await this.reportAppSearchForCard(card.href);
                            if (reported) Utils.log("🖥️", `  已上报应用搜索：${card.title}`);
                        } catch (_) {}
                        await Utils.randomDelay(1500, 2500);
                    }
                    /* 单张卡最多试 2 轮：submitQuestCard 内部已经把几种请求形态都试过一遍，
                     * 这里再给一次机会（中间隔几秒），因为 WAF 拦截常是瞬时的。
                     * 循环现在只含已解锁的卡，所以固定 2 次。 */
                    const maxAttempts = 2;
                    let r = null;
                    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                        try {
                            r = await this.submitQuestCard(parentId, card);
                        } catch (eSubmit) {
                            r = { accepted: false, raw: String(eSubmit.message), status: 0 };
                        }
                        if (r.accepted) break;
                        if (attempt < maxAttempts) {
                            Utils.log("🟡", `桌面任务交卷未受理（第 ${attempt} 次）：${card.title}`
                                + ` [已试形态 ${(r.tried || []).join(",") || r.variant || "-"}]，稍后重试`);
                            await Utils.randomDelay(5000, 9000);
                        }
                    }
                    if (!r || !r.accepted) {
                        failedHere++;
                        Utils.log("🟠", `桌面任务交卷失败：${card.title}`
                            + ` → ${r && r.diag ? r.diag : this._questReason(r && r.raw)}`);
                        if (r && r.tried) {
                            Utils.log("🖥️", `  形态尝试结果：${r.tried.join(" / ")}`);
                        }
                        continue;
                    }
                    if (r.variant && r.variant !== "无origin") {
                        Utils.log("🖥️", `  本次用「${r.variant}」形态交卷成功`);
                    }
                    await Utils.randomDelay(2000, 4000);
                    // 受理 ≠ 记账：重新拉一次 quest 页，看这张卡是否已经从待办列表里消失
                    let after;
                    try {
                        after = await this.fetchQuestCards(parentId);
                    } catch (eAfter) {
                        Utils.log("🟡", `桌面任务已受理但复核失败（${eAfter.message}）：${card.title}，按待定处理`);
                        totalPending++;
                        continue;
                    }
                    const stillThere = after.cards.some(c => c.offerId === card.offerId && !c.isCompleted);
                    if (stillThere) {
                        totalPending++;
                        Utils.log("🟡", `桌面任务已受理但未记账（服务端没加分）：${card.title}`);
                    } else {
                        doneHere++;
                        Utils.log("🟢", `桌面专属任务完成：${card.title}`);
                    }
                }
                totalDone += doneHere;
                let verify = null;
                try {
                    verify = await this.fetchQuestCards(parentId);
                } catch (_) {}
                if (verify && verify.cards.every(c => c.isCompleted)) {
                    Utils.log("🔵", `桌面应用每周专属任务全部完成（本次完成 ${doneHere} 张）`, true);
                } else {
                    /* 汇总也只看已解锁的卡：未解锁的不显示，
                     * 否则日志里会冒出一串「(未解锁)」，与「今天该做的没做成」混淆。 */
                    const leftUnlocked = verify ? verify.cards.filter(c => !c.isCompleted && !c.isLocked) : [];
                    const leftLocked = verify ? verify.cards.filter(c => !c.isCompleted && c.isLocked).length : 0;
                    Utils.log("🟡", `桌面应用每周专属任务：本次完成 ${doneHere} 张、失败 ${failedHere} 张`
                        + (leftUnlocked.length > 0
                            ? `，仍剩 ${leftUnlocked.length} 张已解锁未完成（${leftUnlocked.map(c => c.title).join("、")}）`
                            : (leftLocked > 0 ? "，今日已解锁的都处理完了" : ""))
                        + (leftLocked > 0 ? `（另有 ${leftLocked} 张未解锁，到对应那天自动处理）` : ""));
                }
            }
            if (totalFailed > 0) {
                Utils.log("🟠", `桌面专属任务本轮有 ${totalFailed} 个入口读取失败，下一轮会再试`, true);
            }
            return { found: totalFound, done: totalDone, pending: totalPending };
        },

        /* 把交卷失败原因翻译成一句话：500 在必应上是 WAF 拦截（响应体是风控页而非错误帧），
         * 401/403 是登录态问题，其余才按普通网络/服务端错误看。
         * 排障时这三类的处置完全不同，所以日志里必须能一眼分开。 */
        _questReason(raw) {
            const t = String(raw || "");
            if (!t) return "无响应";
            if (/HTTP 500/.test(t)) return "HTTP 500（必应风控拦截，多半是 Origin/UA 特征）";
            if (/\b(401|403)\b/.test(t)) return "未登录或无权限，请检查 Cookie / 登录态";
            if (/HTTP (404|405)/.test(t)) return "接口/路由不存在（action ID 或 quest 页面可能已变更）";
            if (/请求超时|timeout/i.test(t)) return "请求超时";
            return t.replace(/\s+/g, " ").slice(0, 110);
        },

        /* 发一次请求，按「同源优先」的顺序逐个试，返回 { ok, status, text, variant }。
         *
         * 这是全脚本唯一需要 Server Action 的地方都共用的发送层（交卷 + 领取）。
         * 之所以要抽出来：Origin 是浏览器强制的，后台直发在新版 Edge 上会被 WAF 拒；
         * 而「哪条通道此刻有效」是环境事实，不该每个调用点各写一遍猜测逻辑。
         *
         * ok = HTTP 2xx **且** 响应是受理帧（1:true），不只是 2xx ——
         * 失败帧 `1:false` 也是 2xx，把它当成功会让脚本跳过重试。
         * 401/403 是登录态问题，换通道没用，立刻停。
         * 首次成功的方式记进 savedKey，下一轮直接复用。 */
        async postAction(req, { savedKey = "Config.actionVariant" } = {}) {
            const saved = String(GM_getValue(savedKey, "") || "");
            const order = (saved && BrowserEnv.channelOrder().includes(saved))
                ? [saved, ...BrowserEnv.channelOrder().filter(v => v !== saved)]
                : BrowserEnv.channelOrder();
            const tried = [];
            let accepted = null;
            let last = null;   // 全失败时把最后一次的真实响应带回去（排障只看得到它）
            for (const v of order) {
                let r;
                try {
                    r = await this._postVia(v, req);
                } catch (e) {
                    r = { ok: false, status: 0, text: String((e && e.message) || e), variant: v };
                }
                tried.push(`${v}=${r.status}${r.ok ? "✓" : "✗"}`);
                // 「通道不可用」（CDP 没开、页面不在线）没有响应体，不该盖掉真正发出去的那次
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

        /* 按通道发一次。三条路都返回同一形状，调用方不必关心差异。 */
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

        /* 任意一个 rewards 页面都可以当同源发送方（交卷/领取对页面本身没有依赖）。
         * 优先 earn 页，其次其它 rewards 页；没有就返回 null，安静降级。 */
        async _anyRewardsPage() {
            const list = await CDP.targets();
            if (!list) return null;
            const pages = list.filter(t => t.type === "page" && t.url && /^https:\/\/rewards\.bing\.com\//i.test(t.url));
            if (!pages.length) return null;
            return pages.find(t => /\/earn/i.test(t.url)) || pages[0];
        },

        async claimCardWeb(card, { appChannel = false } = {}) {
            // Server Action 的 POST 目标必须是带 action 路由的页面：日常/连签卡在 dashboard，其余在 earn。
            // 旧版直接用 card.url 当目标，而 getuserinfo 卡的 url 可能是 destinationUrl（指向 bing.com 搜索页），
            // 往搜索页 POST action 一定 404/405 —— 这是「已解锁卡交卷失败」的另一半原因。
            const useAppUA = appChannel || card.appOnly === true || card.kind === "desktop_app";
            const isDash = card.kind === "daily" || card.kind === "streak" || card.source === "getuserinfo";
            const pageUrl = card.kind === "desktop_app"
                ? (card.url || "https://rewards.bing.com/earn")
                : (isDash ? "https://rewards.bing.com/dashboard" : "https://rewards.bing.com/earn");
            const referer = card.url || pageUrl;
            const segment = isDash ? "dashboard" : "earn";
            let nextAction = RewardsAuto._nextAction || GM_getValue("Config.nextAction", ActionMap.FALLBACK.reportActivity);

            // desktop_app（桌面应用每周专属）历史上用的是带 X-MSRewards-App 那套头；
            // appOnly 卡只需要「Rewards 应用 UA」，不该再套 X-MSRewards-App 头（那会让服务端按另一种客户端渲染）。
            const extraAppHeaders = card.kind === "desktop_app" ? RewardsAuto.desktopAppHeaders : {};
            // 部署 ID：新版 Next.js 在 URL 的 ?dpl= 与 chunk 路径里都带它。user.js 实测缺这个头时
            // 某些 action 会「返回 2xx 但不记账」——正是「web(已发出但服务端未更新)」的形态。
            const dpl = RewardsAuto._dpl || GM_getValue("Config.dpl", "");
            const buildHeaders = () => ({
                "content-type": "text/plain;charset=UTF-8",
                "next-action": nextAction,
                "referer": referer,
                /* 这里**不再显式设 origin**，理由与 submitQuestCard 完全一致（见那里的长注释）：
                 * 浏览器会把这一个头覆盖成 chrome-extension://<扩展ID>，脚本写的同源值留不住。
                 * 在扩展里「显式设同源 origin」= 主动制造一个非同源 Origin → 必应 WAF 直接 500。
                 * 去掉后：不带 Origin 的请求实测 200 + 记账；而如果调用方上下文本来就会带同源
                 * Origin（如页面里的 fetch），浏览器也会给出正确值，两种情况都正常。
                 * next-router-state-tree 不能缺，否则新版 action 端点会 500。 */
                "next-router-state-tree": Utils.routerStateTree(segment),
                "accept": "text/x-component",
                "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
                ...(dpl ? { "x-deployment-id": dpl } : {}),
                ...extraAppHeaders,
                // 放在最后：appOnly 卡必须用 Rewards 应用 UA（desktopAppHeaders 里的 Mac UA 不能盖掉它）
                "user-agent": useAppUA ? RewardsAuto.ua.rewardsApp : RewardsAuto.ua.pc
            });
            const payload = JSON.stringify([card.hash, 11, { offerid: card.offerId, isPromotional: "$undefined", timezoneOffset: "-480" }]);

            // 策略 1: Next.js Server Action (最稳妥、官方核心)
            try {
                /* 走公共发送层：同源（CDP/页面）优先，后台直发兜底。
                 * 以前这里只有一句 Utils.xhr（后台直发），在新版 Edge 上恒 500 ——
                 * 而「换发送方」这件事已经把 500 变成了可恢复的环境问题，不该每张卡都硬撞。 */
                const hit = await this.postAction(
                    { url: pageUrl, headers: buildHeaders(), data: payload },
                    { savedKey: "Config.claimActionVariant" }
                );
                const accepted = !!hit.ok;
                /* 诊断：交卷响应是排查「已发出但服务端未生效」的唯一依据。
                 * 上一版加了「全局最多 12 条」的采样上限，结果关键的那张卡被静默跳过，
                 * 排查时反而看不到证据。现在改成「受理了就不打，没受理每张都打」：
                 * 正常完成的卡不产生噪音，失败的卡一条不漏。 */
                if (!accepted || GM_getValue("Config.debugDAPI", false)) {
                    Utils.log("🔬", `交卷响应(${String(card.offerId).slice(0, 36)})：`
                        + `受理=${accepted} 通道=${hit.variant || "无"}${hit.tried ? `(${hit.tried})` : ""} `
                        + `ua=${useAppUA ? "app" : "pc"} dpl=${dpl || "无"} `
                        + `hash=${String(card.hash || "").slice(0, 20)} appOnly=${!!card.appOnly} `
                        + `src=${card.source || "-"} kind=${card.kind || "-"} `
                        + `body=${JSON.stringify(String(hit.text || "").replace(/\s+/g, " ").slice(0, 240))}`);
                }
                if (accepted) {
                    // 交卷已受理：网页侧缓存里的完成状态已经过期，下次判定要重新拉取
                    this._webCompleteCache = null;
                    return true;
                }
                // 没受理但拿回了 401/403：按登录态问题处理，和以前一样让外层改走 DAPI
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
                /* 请求整个抛异常时响应体根本没拿到 —— 这恰恰最需要看到，以前只在 401/404 分支留日志。 */
                Utils.log("🔬", `交卷异常(${String(card.offerId).slice(0, 36)})：`
                    + `ua=${useAppUA ? "app" : "pc"} dpl=${dpl || "无"} kind=${card.kind || "-"} `
                    + `err=${e2.message}`);
                /* 503：服务端前置校验拒绝（0.2~0.6 秒就返回，不是网络问题）。
                 * 早期版本曾按 offerId 里的 locked_level2 把这类卡通通拉黑当天不再尝试，
                 * 但用户实测该卡在网页上是**已解锁**状态（账号银牌，满足门槛），
                 * 拉黑等于把一张本来能完成的卡永久跳过 —— 已撤回。
                 * 现在 503 一律按普通失败交给外层重试，不做任何 ID 级别的拉黑。 */
                if (/HTTP 503/.test(String(e2.message))) {
                    return false;
                }
                // 未登录 / 无 Cookie：网页通道再怎么重试也不会成功，当轮直接把机会让给 DAPI
                // （DAPI 用 Bearer Token 鉴权，不依赖 Cookie，所以没 Cookie 也能把卡做完）
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
                        // 404 说明缓存里的标识已和当前部署对不上：整张表作废，重新扫描
                        ActionMap.clear();
                        const earnHtml = await Utils.xhr({ url: "https://rewards.bing.com/earn" });
                        nextAction = await this.getNextActionHash(earnHtml);
                        const retryRes = await Utils.xhr({ method: "POST", url: pageUrl, headers: buildHeaders(), data: payload });
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

        /* App 专属卡（带锁徽标）专用的交卷通道：换 Rewards 桌面应用 UA 走同一个 server action。
         * 这类卡的 hash / offerId 与网页端完全一致，差别只在 UA —— 普通 UA 下服务端渲染成锁态并拒绝交卷，
         * 应用 UA 下就是解锁态。单次尝试只交一次卷，重试由 claimCard 的外层循环负责
         * （每轮重试都会重新走一遍这里，避免在一次尝试里连发请求）。 */
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
                // 交卷受理 ≠ 记账：服务端 progress 可能要几十秒才更新，这里只做一次快速确认，
                // 真正「算不算完成」由 claimCard 的重试循环 + isOfferComplete 判定。
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

    /* 整轮墙钟预算：不管任务有没有全部做完，到点就交班给下一轮。
     * 之前一轮会被 PC 搜索拖到 30 分钟以上（软预算 20 分钟 + 还在记账就延到 45 分钟），
     * 表现就是「不按 20 分钟一轮，非要跑完才停」。 */
    const ROUND_BUDGET_MS = 20 * 60 * 1000;

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
        /* 通用动作节拍：阅读、卡片这类「点一下就完事」的任务直接复用搜索这套间隔。
         * 有进展 → 立刻回到最小间隔；没进展 → 按 GROW 放慢，封顶 MAX_MS。 */
        nextGap(gap, progressed) {
            return progressed ? this.startGap() : Math.min(this.MAX_MS, Math.round(gap * this.GROW));
        },
        /* 等一个节拍（带 0~35% 抖动，永不快于用户设的最小间隔） */
        async beat(gap) {
            await Utils.delay(this.jitter(gap));
        },
        /* 这点时间还等得起吗：等不起就把剩下的动作交给下一轮，别把整轮预算拖爆 */
        fits(deadline, gap) {
            const d = Number(deadline) || 0;
            if (d <= 0) return true;
            return Date.now() + Math.round(gap * 1.35) <= d;
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

    /* ===== rewards 页面「交卷代发」服务：在这里启动，不能放到脚本末尾 =====
     *
     * 脚本末尾有：
     *     if (!Utils.hasDOM()) return new Promise(() => {});
     * 后台分支到那里就 return 了，之后所有顶层代码不再执行。之前把启动代码放在末尾，
     * 结果页面里也没起来（那之后还有大量 UI/菜单代码，任一环节抛错就轮不到它），
     * 日志里因此是「代发页面 20 秒内没有就绪」——页面开着，服务却没跑。
     *
     * 这里紧跟 API 定义之后：此时 API.startPageServer 已存在，且位于任何 return 之前。 */
    try {
        if (Utils.hasDOM() && typeof location !== "undefined"
            && /(^|\.)rewards\.bing\.com$/i.test(String(location.hostname || ""))) {
            API.startPageServer();
            // 这条日志是「页面是否注入脚本」的唯一外部证据：后台开标签页后在控制台/日志
            // 看到它，就说明 @crontab 生效了（@background 下永远不会出现）。
            Utils.log("🖥️", `代发服务已启动（页面上下文：${location.hostname}）`);
        }
    } catch (_) {}

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
            // 该活动：读 10 篇文章，每篇约 3 分，共 30 分；
            // progress/max 的单位是「积分」，activityprogress/activitymax 才是「篇数」。
            const pointsPerArticle = 3;
            const maxPerDay = 10;
            const target = Math.min(Math.max(Math.ceil((max - cur) / pointsPerArticle), 1), maxPerDay);
            Utils.log("📖", `今日还可阅读 ${target} 篇（上限 ${maxPerDay} 篇/天，每篇约 ${pointsPerArticle} 分）`);
            // 阅读也是「一次只给一点」的动作，节奏直接复用 PC 搜索的节拍：
            // 起步 30 秒，有新增积分就回到最短，连续没进展逐步放慢（封顶 3 分钟）。
            // 以前是点开一篇隔 3~8 秒就点下一篇，整片阅读记录看起来像脚本。
            let gap = SEARCH_PACER.startGap();
            // 单轮最多给阅读 8 分钟：到点交班，剩下的篇数留给下一轮，别把搜索的配额挤没
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
                // 任务已满时该接口依然返回 200 + p:0 + isDuplicate:false，
                // 所以不能只看返回值，必须用服务端进度增量判断这一篇是否真的计入。
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
                // 记进去了就回到最短节拍，没记进去就慢慢放慢，别一直一个速度猛点
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

        /* 桌面奖励应用「每周专属任务」：独立任务，**每一轮都检查**。
         *
         * 为什么必须独立出来（用户反馈「没有日志出来」的根因）：
         * 以前它挂在 doPromos 里，而 doPromos 一开头就有
         *     if (this.promosDate === RewardsAuto.state.dateNowNum) return true;
         * —— 当天活动卡片判成完成之后，后面每一轮的 doPromos 都在那里直接返回，
         * 周任务的扫描代码根本执行不到，于是整轮日志里一条都没有。
         *
         * 而周任务的节奏是**按星期逐日解锁**：今天没做的卡，明天才解锁，
         * 所以它必须每轮都去看一眼，不能跟着其它任务的「今日已完成」短路。
         *
         * 完成判据也不看本地日期标记，只看服务端：quest 页上的子卡消失 = 真完成。
         * 这样即使 unix 时间跨天、或用户在别的设备上做了某张卡，也不会漏判。 */
        async doDesktopWeekly() {
            if (!GM_getValue("Tasks.desktopWeekly", true)) return true;
            try {
                const weekly = await API.runDesktopWeeklyQuests();
                RewardsAuto.state.weeklyQuestDone = weekly.done || 0;
                RewardsAuto.state.weeklyQuestPending = weekly.pending || 0;
                // 返回 false 会让 withRetry 再跑一遍（本任务内部已逐卡重试，不必叠加）
                return true;
            } catch (e) {
                Utils.log("🟡", `桌面专属任务异常：${e && e.message ? e.message : e}`);
                return true;   // 不影响其它任务
            }
        },

        async doPromos(roundDeadline) {
            if (!GM_getValue("Tasks.promos", true) || this.promosTimes > 2) return true;
            if (this.promosDate === RewardsAuto.state.dateNowNum) {
                Utils.log("✅", "活动卡片已完成");
                return true;
            }
            Utils.log("🧩", "扫描活动卡片...");
            // 预热 cookie：后台请求默认不带登录态，不补的话发现卡片时会拿回登录页
            try { await API.getCookieHeader(); } catch (_) {}
            const cards = await API.discoverCards();
            /* 登录态核对：启动时的 probeCookiePermission 只跑一次（避免反复弹授权），
             * 这里每轮轻量确认一次，但**只在异常时出声** —— 正常登录不再刷屏。 */
            try {
                const ck = await Utils.loginCookies();
                if (ck === null) {
                    // probeCookiePermission 已经提示过授权问题，这里不再重复打扰
                } else if (!ck.hasSession) {
                    Utils.log("🟡", "Cookie 里没有 Bing 登录标识（MUID=" + ck.hasMuid + "）："
                        + (ck.names.slice(0, 6).join(",") || "空") + "；网页通道可能不记账", true);
                }
            } catch (_) {}
            if (cards.length === 0) {
                // 今天压根没有待办卡片（常见的全领完/当天没放卡）：这就是「已完成」，必须落日期。
                // 否则 promosDate 一直停在昨天，keep=false 时 isAllDone 永远为假，会无限空转。
                Utils.log("✅", "未发现待处理活动卡片");
                this.promosDate = RewardsAuto.state.dateNowNum;
                this.save();
                return true;
            }
            Utils.log("🧩", `发现 ${cards.length} 个卡片`);

            /* 桌面应用每周专属任务**不在这里处理**（见 doDesktopWeekly）。
             * 以前它跟在 doPromos 里，而 doPromos 开头有：
             *     if (this.promosDate === dateNowNum) return true;
             * 当天活动卡片判成完成后，后面每一轮都在这里直接返回，
             * 周任务连扫描都轮不到 —— 这就是「没有日志出来」的原因。 */

            /* 先用 CDP 真实点击把「应用内搜索」型卡做掉 —— 这类卡只有浏览器级输入
             * 才能产生 rdrig（详见 CDP 模块注释）。CDP 不可用时会给出醒目提示，
             * 但不中断其它任务。 */
            try {
                const cdp = await CDP.claimAll(6);
                if (cdp.ok && cdp.handled > 0) {
                    Utils.log("🖱️", "CDP 真实点击完成 " + cdp.handled + " 张（当前 " + cdp.done + "/" + cdp.total + " 已完成）");
                } else if (cdp.ok) {
                    Utils.log("🖱️", "CDP 已连接，但没有待处理的应用搜索卡（" + cdp.done + "/" + cdp.total + "）");
                } else {
                    // CDP.warn() 已经在内部发过醒目通知（含启动命令），这里补一条简短汇总
                    Utils.log("🔴", "CDP 不可用（" + cdp.reason + "）：应用内搜索型卡本轮跳过，详见上方提示");
                }
            } catch (e) {
                Utils.log("🔴", "CDP 异常：" + e.message);
            }

            // 用户关掉 Quiz 时，Quiz 卡片本轮本来就不处理，判定「是否还有未完成」时也不该算它，
            // 否则这类卡片会让当天永远无法判定完成。
            const shouldSkip = (card) => card.kind === "quiz" && !GM_getValue("Tasks.quiz", true);
            let ok = 0, fail = 0;
            // 卡片之间也用搜索那套节拍：起步 30 秒，领成功就回到最短，没成功逐步放慢
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
            // 以服务端状态为准：仍有未完成卡片时不标记当天完成，下次运行会继续重试。
            // 但锁着的卡（明天才开 / 需在必应 App 里满足条件）永远 complete=false，
            // 把它们算进 pending 会让当天永远判不成完成 —— 只统计「今天还有希望完成」的卡。
            let pending = 0;
            let lockedNow = 0;
            try {
                const map = await API.getPromotionMap(true);
                if (map) {
                    for (const c of cards) {
                        if (shouldSkip(c) || !map.has(c.offerId)) continue;
                        const item = map.get(c.offerId);
                        if (item.complete) continue;
                        // 今日被服务端 503 拒绝的卡也不计入剩余：否则当天永远判不成完成
                        // 手动卡（已上报但状态需用户点击确认）也不计入剩余，否则当天永远判不成完成
                        if (CardLock.claimable(item) && !API.isUnoffered(c.offerId) && !API.isManualCard(c.offerId)) pending++;
                        else lockedNow++;
                    }
                }
            } catch (_) {}
            if (pending === 0) {
                this.promosDate = RewardsAuto.state.dateNowNum;
                this.save();
            }
            // 应用内搜索型卡：脚本只能上报搜索，卡片状态要用户点一下才翻转
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
                // 被判定受限：只打上今天已处理，别清受限计数，否则下一轮又从 0 开始数
                this.searchDate = RewardsAuto.state.dateNowNum;
                this.save();
                SEARCH_PACER.setPending(false);
                return;
            }

            // 单轮搜索最多 20 分钟，并且不会超过整轮截止时间 roundDeadline（由 runAll 传入）。
            // 旧逻辑是「软预算 20 分钟 + 还在记账就延到 45 分钟」，等于没有上限：
            // 只要每次记账成功，softDeadline 那个判断永远不成立，一轮能连着搜 30 分钟以上，
            // 表现就是「不按 20 分钟一轮，非要跑完才停」。现在到点就交班，
            // 没搜满的配额由 SEARCH_PACER.pending 安排 5 分钟后提前续做。
            const budgetMin = 20;
            const startedAt = Date.now();
            const budgetDeadline = startedAt + budgetMin * 60 * 1000;
            const roundLimit = Number(roundDeadline) || 0;
            const softDeadline = roundLimit > 0 ? Math.min(budgetDeadline, roundLimit) : budgetDeadline;
            const hardDeadline = softDeadline;   // 不再有「延到 45 分钟」：硬上限 = 软上限
            const deadlineMin = Math.max(0, Math.round((softDeadline - startedAt) / 60000));
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

            Utils.log("🔍", `单轮搜索最多 ${deadlineMin} 分钟（到点交班，未满的配额下一轮提前续做），起始节拍 ${Math.round(gap / 1000)} 秒，还差 ${Math.max(0, max - progress)} 分（约 ${needed} 次搜索）`);

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
                if (Date.now() + gap > softDeadline) {
                    // 到点就交班：不再像旧版那样「只要还在记账就一直熬到 45 分钟」
                    Utils.log("🟡", `已到本轮上限（${deadlineMin} 分钟），剩下的 ${Math.max(0, max - progress)} 分交给下一轮`);
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

        async doDailySet(roundDeadline) {
            const today = Utils.getTodayNum();
            const todayStr = Utils.getTodayStr();
            const processedKey = "Config.dailySetProcessed";
            let processed = GM_getValue(processedKey, []);
            if (!Array.isArray(processed) || processed[0]?.date !== today) processed = [];
            // 只信任「已被服务端确认完成」的卡片，避免假成功把当天卡片永久标记为已完成
            const doneIds = new Set(processed.filter(p => p && p.ok).map(p => p.offerId));

            const maxRounds = 3;
            let totalOk = 0, totalFail = 0, remain = -1;
            // 每张日常卡之间同样用搜索那套节拍（起步 30 秒，成不成都会自动缩放）
            let gap = SEARCH_PACER.startGap();
            let outOfTime = false;

            // 服务端记账有延迟且偶发限流，单轮容易「一张没完成」，故多轮：发现 → 领取 → 复核
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

                // DAPI 发现的日常卡没有 hash，走不了网页 Server Action；用网页侧解析补一次 hash，
                // 这样 DAPI 交卷失败（已解锁卡最常见的失败场景）时还有网页通道兜底
                if (round === 1 && cards.length > 0 && cards.some(c => !c.hash)) {
                    try {
                        const webCards = (await API.discoverCards()).filter(c => c.hash && (c.kind === "daily" || c.offerId.includes("DailySet")));
                        if (webCards.length > 0) {
                            const byId = new Map(webCards.map(c => [c.offerId, c]));
                            cards = cards.map(c => {
                                const w = byId.get(c.offerId);
                                if (!w) return c;
                                // appOnly / levelGated 一并带过来：网页端也认为它是「带锁徽标的 App 卡」
                                // 时交卷要走应用 UA 通道；等级门槛卡则要保住「先走应用内搜索上报」的标记，
                                // 否则补完 hash 反而退回普通网页通道（503 的老路）。
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

                // 每轮结束都以 DAPI 复核，只有真正完成的卡片才留在记录里
                remain = -1;
                try {
                    const map = await API.getPromotionMap(true);
                    if (map) {
                        const todays = [...map.values()].filter(i =>
                            (i.offerId.includes(RewardsAuto.appConfig.offerIds.dailySetPrefix) || i.dailySetDate === todayStr)
                            && (i.dailySetDate === todayStr || i.offerId.includes(String(today))));
                        // 锁着的卡（明天才开 / 需在必应 App 里满足条件）永远 complete=false，
                        // 把它们算进「剩余」会让当天永远判不成完成：doDailySet 反反复复重试同一张卡，
                        // 关掉持续检测时 isDayComplete 也永远为假。所以剩余量只统计「今天还有希望完成」的卡。
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
                    `每日活动完成: ${totalOk}成功/${totalFail}失败${remain > 0 ? `，仍剩 ${remain} 张未完成` : ""}（服务端已确认）${outOfTime ? "；本轮到点，剩余卡片下一轮继续" : ""}`,
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

        /** 自动领取「待领积分」。
         *
         *  新版 Rewards 会把部分奖励先放进待领池（搜索打卡 / 每日活动 / 限时 Quest 都走这条路），
         *  要单独点一次「领取积分」才入账。旧版这里只读 dashboard 上的「可领取 N 积分」
         *  然后提示用户手动去点 —— 现在改成自动完成（实现见 ClaimPoints）。
         *
         *  仍然不参与 isDayComplete 的判定：领没领到不影响「今日任务全部完成」的结论，
         *  否则一次领取接口抽风就会让持续检测永远停不下来。 */
        async doClaimPoints() {
            await RegionGuard.guard("领取积分");
            if (!GM_getValue("Tasks.claimPoints", true)) {
                Utils.log("✅", "自动领取待领积分已关闭（Config：Tasks.claimPoints）");
                return;
            }
            try {
                // 领之前先把 cookie 预热好（后台 xhr 拿真实登录态的前提）
                try { await API.getCookieHeader(); } catch (_) {}
                const res = await ClaimPoints.run();
                if (res.empty) {
                    Utils.log("✅", `无可领取积分（${res.reason}）`);
                    return;
                }
                if (res.claimed > 0) {
                    Utils.log("🎁", `已自动领取 ${res.claimed} 积分（当前余额：${res.after}）`, true);
                } else if (res.variant) {
                    Utils.log("🟡", `积分领取请求已受理，但余额没有变化（${res.reason}）；下一轮再复核`);
                } else {
                    // 三种通道都没过：把每条的状态写出来，并给出「怎样才有同源通道」的具体做法
                    Utils.log("🟡", `待领积分自动领取未成功：${res.reason}`, true);
                    this._explainClaimChannels();
                }
            } catch (e) {
                Utils.log("🟡", `领取积分执行异常: ${e.message}`);
            }
        },

        /* 领取通道全失败时，说明「为什么」和「怎么办」。
         * 只在真失败时打一次，避免刷日志；核心信息是：新版 Edge 上后台直发被拒是已知问题，
         * 补上门同源通道（CDP 或页面）即可，不需要改脚本。 */
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
            Utils.log("🟡", lines.join("\n"));
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
            // 本轮墙钟预算：到点就交班，剩余任务交给下一轮（避免一轮被搜索拖到 30 分钟以上）
            const roundDeadline = this.runningSince + ROUND_BUDGET_MS;
            try {
                // 后台常驻实例会跨轮次复用，这几个「本轮重试次数」必须每轮归零，
                // 否则累计到 3 次失败后就再也不重试（旧版 @crontab 每轮新实例，天然为 0）。
                this.signTimes = 0;
                this.readTimes = 0;
                this.promosTimes = 0;
                RewardsAuto.state.lockedCount = 0;
                RewardsAuto.state.lockedPoints = 0;
                RewardsAuto.state.webNoAuth = false;
                RewardsAuto.state.webFailStreak = 0;
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
                await withRetry(() => this.doSign(), "签到");
                await Utils.randomDelay();
                if (isTokenOK) {
                    // 阅读走 App/DAPI 通道（Bearer Token），与 PC 会话 Cookie 无关：
                    // 后台上下文里 PC 通道必然 401，不能用它来把关阅读任务。
                    if (RewardsAuto.state.pc401) {
                        Utils.log("🟡", "PC 会话不可用（只影响 PC 通道任务），阅读改用 App 通道继续执行");
                    }
                    await withRetry(() => this.doRead(roundDeadline), "阅读");
                    await Utils.randomDelay();
                }
                /* 周任务每轮都跑，而且**放在最前面**（在活动卡片之前）：
                 *  · 它按星期逐日解锁，今天不做明天不一定补得回来，优先级最高；
                 *  · 放在 doPromos 之后时，一旦活动卡片耗掉整轮预算，它就被轮空，
                 *    表现就是「这一轮没有任何周任务日志」。
                 * 内部有自己的逐卡重试，不需要外层 withRetry 叠加。 */
                await this.doDesktopWeekly();
                await Utils.randomDelay();
                await withRetry(() => this.doPromos(roundDeadline), "活动卡片");
                await Utils.randomDelay();
                await withRetry(() => this.doSearch(roundDeadline), "搜索");
                await withRetry(() => this.doStreak(), "连签检测");
                // 到点就不再开新阶段：整轮严格按 ROUND_BUDGET_MS 交班，没做完的留给下一轮
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
                        // 这里同样是「卡片」，按搜索那套节拍一张一张来
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
                    if (RewardsAuto.state.lockedCount > 0) {
                        logMsg += `锁卡\t\t🔒 ${RewardsAuto.state.lockedCount} 张（${RewardsAuto.state.lockedPoints} 分，需在必应 App 完成）\n`;
                    }
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

    // 原「🕵️ 捕获 Referer 里的授权码」菜单已移除：不再注册菜单按钮、不再弹窗，
    // 逻辑保留在 Auth.recoverFromPage()（自动捕获仍由 Auth.handleCallback() 负责）。

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
    /* ===== 诊断：待领积分 / 领取通道 =====
     * 新版 Edge 上「后台直发被 WAF 500」是已知的、由浏览器强制 Origin 造成的问题，
     * 不是参数写错。所以这里把三件事一次说清：当前浏览器、已记住的通道、每条通道此刻通不通。
     * 需要时在控制台调用 __MPDiagnostics.claim()。 */
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
        text += `待领状态：${pool.empty ? "空池" : (pool.variant ? `已受理（${pool.variant}）` : "未受理")}\n`;
        text += `本次结果：${pool.claimed > 0 ? `+${pool.claimed} 分（余额 ${pool.before} → ${pool.after}）` : (pool.reason || "—")}\n`;
        if (!pool.variant && !pool.empty) {
            text += `\n提示：新版 Edge 请用桌面「Rewards Edge」快捷方式启动（端口 ${cdpPort}）并留一个 rewards 页面，`
                + "这样领取会走页面同源请求；Chrome 上后台直发通常也能过。";
        }
        if (pool.claimed > 0) Utils.log("🎁", `诊断中已自动领取 ${pool.claimed} 积分`, true);
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

    // 原「🔍 PC 搜索诊断」菜单已移除：不再注册菜单按钮、不再弹窗，逻辑照旧（仍会立刻单独跑一次 PC 搜索），
    // 需要看这段状态文本时在控制台调用 __MPDiagnostics.pcSearch()。
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

    /* ===== 诊断：交卷请求到底被谁拦了 =====
     *
     * 排障背景：本机（CDP 页面上下文 / Python 裸 HTTP）同样的请求全部 200，
     * 但在 ScriptCat 里三种形态全是 500。所以必须在一个**真实扩展上下文**里，
     * 把各个变量逐个打开/关闭，看哪个组合能过 —— 靠猜已经浪费太多轮了。
     *
     * 全程用 _rawXhr（无论状态码都带回 body），并给每条结果分类：
     *   风控页 / flight错误帧 / 登录页 / 未发出。
     */
    const diagClaimRequest = async () => {
        const PARENT = "WW_pcparent_RewardsApp_weekly_Exclusive_Novw1_2026_punchcard";
        const EARN = "https://rewards.bing.com/earn";
        const QUEST = "https://rewards.bing.com/earn/quest/" + PARENT;
        const APP_UA = RewardsAuto.desktopAppHeaders["user-agent"];
        const ACTION = RewardsAuto._nextAction || GM_getValue("Config.nextAction", ActionMap.FALLBACK.reportActivity);
        const DPL = RewardsAuto._dpl || GM_getValue("Config.dpl", "");

        Utils.log("🧪", "=== 交卷诊断开始 ===");
        Utils.log("🧪", `上下文=${Utils.hasDOM() ? "页面(" + location.hostname + ")" : "后台/service_worker"}`
            + ` action=${String(ACTION).slice(0, 12)}… dpl=${DPL || "无"}`);

        // 取一张真子卡的 hash
        let card = null;
        try {
            const snap = await API.fetchQuestCards(PARENT);
            card = (snap.cards && snap.cards[0]) || null;
            Utils.log("🧪", card ? `取到子卡：${card.title}（${snap.cards.length} 张待办）` : "该周已无待办子卡，用占位 hash 测通道");
        } catch (e) {
            Utils.log("🧪", `拉 quest 页失败：${e.message}`);
        }
        const hash = card ? card.hash : "0".repeat(64);
        const offerId = card ? card.offerId : "WW_pcchild4_urlreward_Tuesday_RewardsApp_weekly_Exclusive_Novw1_2026_punchcard";
        const body = JSON.stringify([hash, 11, { offerid: offerId, isPromotional: "$undefined", timezoneOffset: "-480" }]);

        const earnTree = Utils.routerStateTree("earn");
        const questTree = Utils.questRouterStateTree(PARENT);

        // 逐个变量隔离：每条只改动一个因素
        const cases = [
            { n: "① earn+origin+appUA（参考脚本写法）", url: EARN, h: { origin: "https://rewards.bing.com", "user-agent": APP_UA, "x-rewards-source": "msrewards-desktop", "next-router-state-tree": earnTree } },
            { n: "② earn+origin 但无 x-rewards-source", url: EARN, h: { origin: "https://rewards.bing.com", "user-agent": APP_UA, "next-router-state-tree": earnTree } },
            { n: "③ earn 无origin+appUA", url: EARN, h: { "user-agent": APP_UA, "x-rewards-source": "msrewards-desktop", "next-router-state-tree": earnTree } },
            { n: "④ earn+origin 用普通浏览器UA", url: EARN, h: { origin: "https://rewards.bing.com", "user-agent": RewardsAuto.ua.pc, "next-router-state-tree": earnTree } },
            { n: "⑤ quest+origin+appUA", url: QUEST, h: { origin: "https://rewards.bing.com", "user-agent": APP_UA, "x-rewards-source": "msrewards-desktop", "next-router-state-tree": questTree } },
            { n: "⑥ 不带 next-router-state-tree", url: EARN, h: { origin: "https://rewards.bing.com", "user-agent": APP_UA } },
        ];

        const lines = [];
        for (const c of cases) {
            const headers = {
                "content-type": "text/plain;charset=UTF-8",
                "next-action": ACTION,
                "referer": c.url,
                "accept": "text/x-component",
                "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
                ...(DPL ? { "x-deployment-id": DPL } : {}),
                ...c.h
            };
            let r;
            try {
                r = await API._rawXhr({ method: "POST", url: c.url, headers, data: body });
            } catch (e) {
                r = { status: 0, text: String(e.message), cost: 0 };
            }
            const t = String(r.text || "");
            let kind;
            if (r.status === 0) kind = "未发出";
            else if (/login\.live\.com|oauth20_authorize/i.test(t)) kind = "登录页";
            else if (/<title>Bing<\/title>|sc_error/i.test(t)) kind = "风控页";
            else if (/[0-9a-f]+:E\{|"digest"\s*:/.test(t)) kind = "flight错误帧";
            else if (t.includes("1:true")) kind = "受理";
            else kind = "其他";
            lines.push(`  ${c.n} → ${r.status} ${kind} ${String(r.cost).slice(0, 5)}s`);
            // 非 200 且拿得到 body 时，附上前 100 字，这是唯一能继续排障的线索
            if (r.status !== 200 && t) lines.push(`      body=${t.replace(/\s+/g, " ").slice(0, 100)}`);
            await Utils.delay(1200);
        }
        Utils.log("🧪", "=== 诊断结果 ===\n" + lines.join("\n"));
        Utils.log("🧪", "判定：哪一行出现「受理」= 那种组合可用；全 500 且都是风控页 = 后台身份被拒，只能用页面通道。");
    };
    GM_registerMenuCommand("🧪 诊断：交卷请求", () => {
        Promise.resolve()
            .then(diagClaimRequest)
            .catch(e => Utils.log("🔴", `交卷诊断异常：${e && e.message ? e.message : e}`));
    });

    // 原「🔓 强制释放运行锁」菜单已移除：不再注册菜单按钮，
    // 万一某轮卡在「认领了但没跑完」的状态里（上下文被冻结、请求不回调等），
    // 需要立刻把锁和调度状态清干净（不用等 40 分钟残留判定）时，在控制台调用
    // __MPDiagnostics.releaseLock()。
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
            if (ok) Utils.log("🕒", `本轮结束（用时 ${Math.max(0, Math.round((now - base) / 60000))} 分钟，上限 ${ROUND_BUDGET_MS / 60000} 分钟），下一轮 ${this.fmt(this.plan(now))}`);
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

        /* 首次运行就把 GM_cookie 探测掉。
         * 原因：GM_cookie 是**需要用户授权的权限**，ScriptCat 第一次调用时会弹权限框。
         * 以前这个调用藏在 doPromos 深处（要等跑到「活动卡片」阶段才触发），
         * 用户根本不知道该点什么，日志里只剩一句「无法读取 Cookie」。
         * 现在放在启动最前面：一运行就会弹出授权提示，点了「允许」之后一切正常；
         * 若是用户明确拒绝过，则记下来避免每轮刷错误日志。 */
        Utils.probeCookiePermission().catch(() => {});


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
        /* Bing 搜索页：脚本自己打开的页面不参与调度。
         *
         * 2026-11-03 在真实 Edge（CDP）里完整调试过这类「应用内搜索」卡，结论如下：
         *
         *  1) 页面被动打开时只加载 widget.js —— 不发 ncheader、更不发 reportActivity；
         *  2) 页面全局函数 sj_rra(url) 是记账入口，调用后请求参数与手动抓包一致，
         *     服务端也返回 RewardsIncrement:1、余额 +15；
         *  3) **但卡片完成状态不会因此更新**（等 90 秒仍是未完成）；
         *  4) 只有用户从 earn 页真实点击那张卡，卡片才会变成「已完成」；
         *  5) 页面里 onRALoad 没有绑定（sjEvtBound=false），缺少事件驱动，
         *     这就是「能加分但不标记完成」的原因。
         *
         * 所以脚本这边调用 sj_rra 作为**尽力而为**：能加分的账户会拿到分，
         * 但卡片状态需要用户自己点一下。日志会明确写出这一点，不再让人误以为失败。 */
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
                    /* 实测提醒：这一步能让服务端记分（RewardsIncrement:1），
                     * 但卡片状态不会因此变成「已完成」—— 那个状态只有真实点击才会翻转。 */
                    GM_log("🎯 注意：sj_rra 已尽力上报；若卡片仍显示未完成，需在 earn 页手动点一次该卡");
                } catch (e) {
                    GM_log(`🎯 奖励搜索页处理异常：${e.message}`);
                }
            });
        }
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

    // 原六个菜单（Edge 连签状态、PC 搜索诊断、查看调度状态、重置调度计划、强制释放运行锁、网络出口检测）
    // 已从右键菜单移除。逻辑原样保留在这里，不再弹出任何提示框：需要时在控制台（脚本管理器或
    // rewards.bing.com 页面）调用 __MPDiagnostics.edgeStreak() / pcSearch() / region() / schedule() /
    // resetSchedule() / releaseLock()，前四个的返回值就是原来弹窗里的那段文本。
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

    /* 页面「交卷代发」服务的启动已移到 TaskManager 定义之前（见那里的说明）。
     * 这里只留一行注释标记，不再重复调用 —— 重复启动会被 _pageServerStarted 挡住，
     * 但更重要的是末尾这段在后台分支根本执行不到。 */

    /* 测试挂钩：Node 回归测试加载本文件时会先在作用域里注入 __MP_TEST_HOOK__（见 tests/harness.mjs），
     * 借此对内部纯函数（请求头拼装、出口判定、节拍器等）做单元断言。
     * 浏览器/扩展里没有这个全局变量，typeof 判断直接跳过，不影响任何运行时行为。 */
    if (typeof __MP_TEST_HOOK__ === "function") {
        try {
            __MP_TEST_HOOK__({ Utils, API, RewardsAuto, RegionGuard, Webhooks, Sched, TaskManager, Auth,
                CardLock, SEARCH_PACER, EdgeStreak, EdgePacer, UA, EDGE, CDP,
                BrowserEnv, ActionMap, ClaimPoints });
        } catch (_) {}
    }

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
