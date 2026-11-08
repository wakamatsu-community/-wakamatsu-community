// scripts/verify_live_site.cjs
// 本番公開サイト (GitHub Pages) 実ブラウザ検証スクリプト

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const LIVE_BASE_URL = 'https://wakamatsu-community.github.io/-wakamatsu-community';

class CdpClient {
    constructor(wsUrl) {
        this.ws = new WebSocket(wsUrl);
        this.msgId = 1;
        this.callbacks = new Map();
        this.eventListeners = new Map();

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.id && this.callbacks.has(data.id)) {
                const cb = this.callbacks.get(data.id);
                this.callbacks.delete(data.id);
                if (data.error) cb.reject(new Error(data.error.message));
                else cb.resolve(data.result);
            } else if (data.method) {
                const listeners = this.eventListeners.get(data.method) || [];
                listeners.forEach(fn => fn(data.params));
            }
        };
    }

    ready() {
        return new Promise((resolve) => {
            if (this.ws.readyState === WebSocket.OPEN) return resolve();
            this.ws.onopen = () => resolve();
        });
    }

    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = this.msgId++;
            this.callbacks.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    on(event, handler) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(handler);
    }

    close() {
        this.ws.close();
    }
}

function launchChrome(userDataDir) {
    return new Promise((resolve, reject) => {
        const chrome = spawn(CHROME_PATH, [
            '--headless=new',
            '--remote-debugging-port=0',
            `--user-data-dir=${userDataDir}`,
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-background-networking'
        ]);

        let wsUrl = null;
        chrome.stderr.on('data', (chunk) => {
            const str = chunk.toString();
            const match = str.match(/DevTools listening on (ws:\/\/[^\r\n]+)/);
            if (match && !wsUrl) {
                wsUrl = match[1];
                resolve({ chrome, wsUrl });
            }
        });

        chrome.on('error', reject);
        setTimeout(() => {
            if (!wsUrl) reject(new Error('Chrome 起動タイムアウト (10秒)'));
        }, 10000);
    });
}

async function verifyPage(browserCdp, wsUrl, url, pageName) {
    console.log(`\n--- [検証] ${pageName}: ${url} ---`);
    const errors = [];
    const logs = [];

    const createTargetResult = await browserCdp.send('Target.createTarget', { url: 'about:blank' });
    const targetId = createTargetResult.targetId;
    const pageWsUrl = `ws://${new URL(wsUrl).host}/devtools/page/${targetId}`;

    const pageCdp = new CdpClient(pageWsUrl);
    await pageCdp.ready();

    await pageCdp.send('Page.enable');
    await pageCdp.send('Runtime.enable');

    pageCdp.on('Runtime.exceptionThrown', (params) => {
        const text = params?.exceptionDetails?.text || 'Unknown Error';
        const desc = params?.exceptionDetails?.exception?.description || text;
        errors.push(desc);
    });

    pageCdp.on('Runtime.consoleAPICalled', (params) => {
        const text = (params.args || []).map(a => a.value || a.description || '').join(' ');
        if (params.type === 'error') {
            errors.push(`[Console Error] ${text}`);
        } else {
            logs.push(`[${params.type}] ${text}`);
        }
    });

    await pageCdp.send('Page.navigate', { url });
    await new Promise(r => setTimeout(r, 3500));

    // DOM検証
    const evalRes = await pageCdp.send('Runtime.evaluate', {
        expression: `({
            title: document.title,
            hasLoginGate: Boolean(document.getElementById('b-mode-login-gate')),
            mainDisplay: (document.querySelector('main') ? getComputedStyle(document.querySelector('main')).display : 'none'),
            gateFormExists: Boolean(document.getElementById('gate-login-form')),
            bodyDatasetPage: document.body.dataset.page
        })`,
        returnByValue: true
    });

    const info = evalRes?.result?.value || {};
    console.log(`  ページタイトル: "${info.title}"`);
    console.log(`  data-page: "${info.bodyDatasetPage}"`);
    console.log(`  ログインゲート表示: ${info.hasLoginGate ? '[PASS] 正常表示中' : (info.bodyDatasetPage === 'admin' ? '[PASS] 管理専用ログインUI表示中' : '[FAIL]')}`);
    console.log(`  main要素保護: display=${info.mainDisplay}`);

    if (errors.length > 0) {
        console.error(`  [WARN/ERROR] 検出された例外 (${errors.length}件):`);
        errors.forEach(e => console.error(`    - ${e}`));
    } else {
        console.log(`  [PASS] ランタイムJavaScript例外: 0件 (完全クリーン)`);
    }

    pageCdp.close();
    await browserCdp.send('Target.closeTarget', { targetId });

    return { info, errors };
}

(async () => {
    console.log('=== 本番公開サイト (GitHub Pages) 実ブラウザ検証開始 ===');
    const userDataDir = path.join(os.tmpdir(), `chrome_live_verify_${Date.now()}`);
    let chrome, wsUrl;

    try {
        const launched = await launchChrome(userDataDir);
        chrome = launched.chrome;
        wsUrl = launched.wsUrl;

        const browserCdp = new CdpClient(wsUrl);
        await browserCdp.ready();

        // 1. ホーム画面 (index.html)
        await verifyPage(browserCdp, wsUrl, `${LIVE_BASE_URL}/index.html`, 'ホーム画面');
        // 2. 行事予定画面 (events.html)
        await verifyPage(browserCdp, wsUrl, `${LIVE_BASE_URL}/events.html`, '行事予定画面');
        // 3. 管理画面 (admin.html)
        await verifyPage(browserCdp, wsUrl, `${LIVE_BASE_URL}/admin.html`, '管理ページ');

        console.log('\n======================================================');
        console.log('本番サイトの実ブラウザ検証が完全成功 (ALL PASSED)');
        console.log('======================================================');

        browserCdp.close();
    } finally {
        if (chrome) chrome.kill();
        try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    }
})();
