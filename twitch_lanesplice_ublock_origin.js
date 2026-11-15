twitch-lanesplice.js text/javascript
(function() {
    if (!/(^|\.)twitch\.tv$/.test(document.location.hostname) || window.__laneSplice) { return; }
    window.__laneSplice = true;
    // LANE SPLICE. Twitch stitches ads per access token. This keeps a private timeline per rendition
    // (resolution + fps + codec). Only segments titled "live" with a PROGRAM-DATE-TIME enter it, from the
    // main playlist or from shadow "lanes" (same channel, other player-type tokens). Lanes are used only
    // when they carry the EXACT same rendition, so quality never drops. Every playlist the player gets is
    // rebuilt from the timeline with its own sequence numbers: no ad tags, no player reload, no swap.
    // NOTE: no blank lines allowed in this file (uBO resource format).
    const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
    const TOKEN_HASH = 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9'; // PlaybackAccessToken persisted query; breaks if Twitch rotates it
    const hdr = {};
    const realFetch = window.fetch;
    window.fetch = function(input, init) {
        try {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('gql.twitch.tv')) {
                const h = new Headers(input instanceof Request ? input.headers : undefined);
                new Headers((init && init.headers) || undefined).forEach((v, k) => h.set(k, v));
                for (const k of ['authorization', 'client-integrity', 'client-version', 'client-session-id', 'x-device-id', 'device-id']) {
                    const v = h.get(k);
                    if (v) { hdr[k === 'device-id' ? 'x-device-id' : k] = v; }
                }
            }
        } catch (e) {}
        return realFetch.apply(window, arguments);
    };
    async function getToken(login, playerType) {
        const r = await realFetch.call(window, 'https://gql.twitch.tv/gql', {
            method: 'POST',
            headers: Object.assign({ 'Client-ID': CLIENT_ID }, hdr),
            body: JSON.stringify({ operationName: 'PlaybackAccessToken', variables: { isLive: true, login: login, isVod: false, vodID: '', playerType: playerType, platform: 'web' }, extensions: { persistedQuery: { version: 1, sha256Hash: TOKEN_HASH } } })
        });
        const j = await r.json();
        return (j && j.data && j.data.streamPlaybackAccessToken) || null;
    }
    // Everything inside workerMain runs inside Twitch's video worker (it is serialized with toString).
    function workerMain() {
        const realFetch = self.fetch.bind(self);
        const LANE_TYPES = ['embed', 'popout', 'site', 'mobile_web'];
        // twitch-trigger, twitch-session, twitch-stream-source, timestamp ranges sit on every normal live playlist (checked 2026-11-15): not ads
        const AD_RANGE = /stitched|twitch-maf-ad|X-TV-TWITCH-AD|SCTE35/;
        const AD_URL = /\/adsquared\/|\/_404\/|\/processing/;
        const keyOf = new Map(); // media playlist url -> rendition key
        const tls = new Map();   // rendition key -> timeline
        let lanes = new Map();   // player type -> Promise<lane|null>
        let master = null, login = null, lastGood = null, rid = 0;
        const waits = new Map();
        self.addEventListener('message', e => {
            const d = e.data;
            if (d && d.lsRes !== undefined) {
                e.stopImmediatePropagation();
                const w = waits.get(d.lsRes);
                waits.delete(d.lsRes);
                if (w) { w(d.v); }
            }
        });
        function token(type) {
            return new Promise(res => {
                const id = ++rid;
                waits.set(id, res);
                self.postMessage({ lsTok: type, id: id, login: login });
                setTimeout(() => { if (waits.delete(id)) { res(null); } }, 5000);
            });
        }
        function renditions(text) {
            const out = [];
            const L = text.replace(/\r/g, '').split('\n');
            for (let i = 0; i < L.length - 1; i++) {
                const a = L[i];
                if (!a.startsWith('#EXT-X-STREAM-INF:')) { continue; }
                const g = (n, d) => { const m = new RegExp('[:,]' + n + '="?([^",]*)').exec(a); return m ? m[1] : d; };
                const key = g('RESOLUTION', 'audio') + '@' + Math.round(parseFloat(g('FRAME-RATE', '0'))) + '/' + g('CODECS', '').slice(0, 4).replace('hvc1', 'hev1');
                const url = L[i + 1].trim();
                if (url && url[0] !== '#') { out.push([key, url]); }
            }
            return out;
        }
        function parse(text) {
            const L = text.replace(/\r/g, '').split('\n');
            const p = { head: [], segs: [], prefetch: [], msn: 0, ad: false, end: L.includes('#EXT-X-ENDLIST') };
            const ranges = [];
            for (const l of L) {
                if (l.startsWith('#EXT-X-DATERANGE') && AD_RANGE.test(l)) {
                    p.ad = true;
                    const s = Date.parse((/START-DATE="([^"]+)"/.exec(l) || [])[1]);
                    const d = parseFloat((/DURATION=([\d.]+)/.exec(l) || [])[1]) || 0;
                    if (!isNaN(s)) { ranges.push([s - 500, s + d * 1000 + 500]); }
                }
            }
            let body = false, pdt = NaN, inf = null, cue = false;
            for (const l of L) {
                if (l.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) { pdt = Date.parse(l.slice(25)); body = true; }
                else if (l.startsWith('#EXTINF:')) { inf = l; body = true; }
                else if (l === '#EXT-X-DISCONTINUITY') { body = true; }
                else if (l.startsWith('#EXT-X-CUE-OUT')) { cue = true; p.ad = true; }
                else if (l.startsWith('#EXT-X-CUE-IN')) { cue = false; }
                else if (l.startsWith('#EXT-X-TWITCH-PREFETCH:')) { p.prefetch.push(l); }
                else if (l.startsWith('#EXT-X-MEDIA-SEQUENCE:')) { p.msn = parseInt(l.slice(22), 10) || 0; }
                else if (l && l[0] !== '#' && inf) {
                    const dur = parseFloat(inf.slice(8)) || 2;
                    const live = inf.includes(',live') && !/Amazon|FT\|/.test(inf) && !AD_URL.test(l) && !cue && !isNaN(pdt) && !ranges.some(r => pdt >= r[0] && pdt <= r[1]);
                    if (!live) { p.ad = true; }
                    p.segs.push({ pdt: pdt, dur: dur, inf: inf, url: l.trim(), live: live });
                    if (!isNaN(pdt)) { pdt += dur * 1000; }
                    inf = null;
                } else if (!body && l && !/^#EXT-X-(DATERANGE|DISCONTINUITY-SEQUENCE|ENDLIST)/.test(l)) { p.head.push(l); }
            }
            return p;
        }
        // Append only live segments that are newer than the timeline tail. PDT is identical across lanes
        // (same transcoder), so it dedupes main and lane copies of one segment.
        function feed(tl, p) {
            if (!p.ad) { tl.head = p.head; }
            for (const s of p.segs) {
                if (!s.live || s.pdt <= tl.last + 250) { continue; }
                s.disc = tl.last > 0 && s.pdt - tl.last > tl.lastDur * 1000 + 1500;
                s.seq = tl.seq++;
                tl.segs.push(s);
                tl.last = s.pdt;
                tl.lastDur = s.dur;
            }
            while (tl.segs.length > 12) { if (tl.segs.shift().disc) { tl.dseq++; } }
        }
        function render(tl, p, sync) {
            const out = (tl.head || p.head).slice();
            out.push('#EXT-X-MEDIA-SEQUENCE:' + (tl.segs.length ? tl.segs[0].seq : tl.seq), '#EXT-X-DISCONTINUITY-SEQUENCE:' + tl.dseq);
            for (const s of tl.segs) {
                if (s.disc) { out.push('#EXT-X-DISCONTINUITY'); }
                out.push('#EXT-X-PROGRAM-DATE-TIME:' + new Date(s.pdt).toISOString(), s.inf, s.url);
            }
            if (sync) { out.push.apply(out, p.prefetch); }
            if (p.end) { out.push('#EXT-X-ENDLIST'); }
            return out.join('\n') + '\n';
        }
        function lane(type) {
            let pr = lanes.get(type);
            if (pr) { return pr; }
            pr = (async () => {
                const t = await token(type);
                if (!t || !master) { return null; }
                const u = new URL(master);
                u.searchParams.set('sig', t.signature);
                u.searchParams.set('token', t.value);
                u.searchParams.set('p', String(Math.floor(Math.random() * 1e7)));
                u.searchParams.delete('parent_domains');
                const r = await realFetch(u.href);
                if (!r.ok) { return null; }
                const map = new Map();
                for (const [k, v] of renditions(await r.text())) { if (!map.has(k)) { map.set(k, v); } }
                return { map: map, bad: 0 };
            })().catch(() => null);
            lanes.set(type, pr);
            // fresh token every 4 min, failed lane retried after 30 s
            pr.then(l => setTimeout(() => { if (lanes.get(type) === pr) { lanes.delete(type); } }, l ? 240000 : 30000));
            return pr;
        }
        // ponytail: lanes tried one after another; run them in parallel if ad-start latency shows up.
        async function fill(key, tl) {
            const order = lastGood ? [lastGood].concat(LANE_TYPES.filter(t => t !== lastGood)) : LANE_TYPES;
            for (const type of order) {
                const l = await lane(type);
                if (!l || l.bad > Date.now()) { continue; }
                const url = l.map.get(key);
                if (!url) { continue; } // lane lacks this exact rendition: skip it, never downgrade
                try {
                    const r = await realFetch(url);
                    if (!r.ok) { lanes.delete(type); continue; }
                    const p = parse(await r.text());
                    feed(tl, p);
                    if (!p.ad) {
                        if (lastGood !== type) { console.log('[LaneSplice] ad on main, splicing from lane "' + type + '" at ' + key); }
                        lastGood = type;
                        return;
                    }
                    l.bad = Date.now() + 30000;
                } catch (e) { lanes.delete(type); }
            }
            console.log('[LaneSplice] no clean lane at ' + key + ', holding (no downgrade)');
        }
        self.fetch = async function(input, init) {
            const url = input instanceof Request ? input.url : String(input);
            if (/\/api\/(v2\/)?channel\/hls\//.test(url) && !url.includes('picture-by-picture')) {
                const r = await realFetch(input, init);
                if (!r.ok) { return r; }
                const text = await r.text();
                const m = /\/hls\/([^/.?]+)\.m3u8/.exec(url);
                const who = m ? m[1].toLowerCase() : null;
                if (who !== login) { lanes = new Map(); lastGood = null; }
                login = who;
                master = url;
                tls.clear();
                keyOf.clear();
                for (const [k, v] of renditions(text)) { keyOf.set(v, k); }
                lane(LANE_TYPES[0]); // prewarm so the first ad (preroll) has a token ready
                return new Response(text, { status: r.status, statusText: r.statusText });
            }
            const key = keyOf.get(url);
            if (key === undefined) { return realFetch(input, init); }
            const r = await realFetch(input, init);
            if (!r.ok) { return r; }
            const p = parse(await r.text());
            let tl = tls.get(key);
            if (!tl) { tl = { segs: [], seq: p.msn, dseq: 0, last: 0, lastDur: 2, head: null }; tls.set(key, tl); }
            feed(tl, p);
            if (p.ad) { await fill(key, tl); }
            const lastMain = p.segs[p.segs.length - 1];
            const sync = !p.ad && !!lastMain && lastMain.pdt >= tl.last - 250;
            return new Response(render(tl, p, sync), { status: r.status, statusText: r.statusText });
        };
    }
    const RealWorker = window.Worker;
    window.Worker = class extends RealWorker {
        constructor(url, opts) {
            let finalUrl = url;
            if (String(url).startsWith('blob:') && !(opts && opts.type === 'module')) {
                try {
                    const x = new XMLHttpRequest();
                    x.open('GET', url, false);
                    x.send();
                    if (x.responseText.includes('twitch')) {
                        finalUrl = URL.createObjectURL(new Blob(['(' + workerMain.toString() + ')();\n' + x.responseText], { type: 'text/javascript' }));
                    }
                } catch (e) {}
            }
            super(finalUrl, opts);
            if (finalUrl !== url) {
                this.addEventListener('message', e => {
                    const d = e.data;
                    if (!d || d.lsTok === undefined) { return; }
                    e.stopImmediatePropagation();
                    getToken(d.login, d.lsTok).catch(() => null).then(v => this.postMessage({ lsRes: d.id, v: v }));
                });
            }
        }
    };
    // Twitch lowers quality in background tabs: always report the tab as visible.
    try {
        Object.defineProperty(document, 'hidden', { get: () => false });
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
        document.addEventListener('visibilitychange', e => e.stopImmediatePropagation(), true);
    } catch (e) {}
    // Side-by-side ad player (since Jul 2026): any <video> playing a file from a non-Twitch host is an ad.
    setInterval(() => {
        for (const v of document.getElementsByTagName('video')) {
            const src = v.currentSrc || '';
            if (/^https?:\/\//.test(src) && !/^https?:\/\/([^/]*\.)?(twitch\.tv|twitchcdn\.net|ttvnw\.net|jtvnw\.net)\//.test(src)) {
                if (!v.dataset.lsAd) { v.dataset.lsAd = v.muted ? 'm' : 'u'; }
                v.muted = true;
                if (!v.paused) { v.pause(); }
                v.style.setProperty('display', 'none', 'important');
            } else if (v.dataset.lsAd) {
                // Twitch recycled the node for real video: undo what we did
                v.style.removeProperty('display');
                if (v.dataset.lsAd === 'u') { v.muted = false; }
                delete v.dataset.lsAd;
            }
        }
    }, 1000);
})();
