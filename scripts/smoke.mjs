/**
 * 冒烟测试：通过 Chrome DevTools Protocol 检查三个渲染进程是否正常挂载。
 * 用法：先以 --remote-debugging-port=9333 启动 Electron，再 node scripts/smoke.mjs
 */
const PORT = Number(process.env.SMOKE_PORT || 9333);
const BASE = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listPages() {
  const res = await fetch(`${BASE}/json/list`);
  if (!res.ok) throw new Error(`devtools http ${res.status}`);
  const all = await res.json();
  return all.filter((t) => t.type === 'page');
}

async function waitForPages() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const pages = await listPages();
      if (pages.length > 0) return pages;
    } catch {
      // 端口还没起来，继续等
    }
    await sleep(500);
  }
  throw new Error(`devtools 端口 ${PORT} 在 30s 内不可用`);
}

class PageSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.problems = [];
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const detail = msg.params?.exceptionDetails;
        this.problems.push(`exception: ${detail?.exception?.description || detail?.text}`);
      }
      if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
        this.problems.push(`log: ${msg.params.entry.text}`);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        this.problems.push(`console: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
      }
    });
  }

  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const session = new PageSession(ws);
    await session.send('Runtime.enable');
    await session.send('Log.enable');
    return session;
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  }

  close() {
    this.ws.close();
  }
}

async function snapshot(page) {
  const session = await PageSession.open(page.webSocketDebuggerUrl);
  const info = await session.evaluate(`JSON.stringify({
    title: document.title,
    url: location.href,
    hasApi: typeof window.api === 'object',
    canvases: document.querySelectorAll('canvas').length,
    buttons: document.querySelectorAll('button').length,
    text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 160)
  })`);
  await sleep(1200);
  const problems = session.problems.slice();
  session.close();
  return { ...JSON.parse(info), problems };
}

async function main() {
  const pages = await waitForPages();
  const results = [];
  for (const page of pages) {
    results.push(await snapshot(page));
  }

  // 从宠物页触发另外两个窗口，验证懒加载窗口也能正常渲染
  const pet = pages.find((p) => p.url.includes('/pet/')) || pages[0];
  if (pet) {
    const session = await PageSession.open(pet.webSocketDebuggerUrl);
    await session.evaluate('window.api.openChat()');
    await sleep(1500);
    await session.evaluate('window.api.openSettings()');
    session.close();
    await sleep(2500);

    for (const page of await listPages()) {
      if (pages.some((p) => p.id === page.id)) continue;
      results.push(await snapshot(page));
    }
  }

  console.log(JSON.stringify(results, null, 2));

  // 可选：校验打包版 CSP 是否允许 live2d:// 的脚本与 fetch（需要 userData 里已放 core）
  if (process.env.SMOKE_CSP === '1') {
    const petPage = pages.find((p) => p.url.includes('/pet/')) || pages[0];
    if (petPage) {
      const session = await PageSession.open(petPage.webSocketDebuggerUrl);
      const fetchStatus = await session.evaluate(
        `fetch('live2d://core/live2dcubismcore.min.js').then(r => 'http ' + r.status).catch(e => 'ERR ' + e.message)`,
      );
      const scriptState = await session.evaluate(`new Promise((resolve) => {
        const el = document.createElement('script');
        el.src = 'live2d://core/live2dcubismcore.min.js';
        el.onload = () => resolve('loaded:' + (typeof window.Live2DCubismCore));
        el.onerror = () => resolve('blocked');
        document.head.appendChild(el);
      })`);
      console.log(JSON.stringify({ live2dFetch: fetchStatus, live2dScript: scriptState }, null, 2));
      session.close();
      if (!String(fetchStatus).startsWith('http') || !String(scriptState).startsWith('loaded')) {
        console.error('FAILED: live2d:// blocked by CSP');
        process.exitCode = 1;
      }
    }
  }

  const broken = results.filter((r) => !r.hasApi || r.problems.length > 0 || r.url.startsWith('chrome-error'));
  if (broken.length > 0) {
    console.error(`FAILED: ${broken.length} page(s) with problems`);
    process.exitCode = 1;
  } else {
    console.log('OK: all pages mounted without runtime errors');
  }
}

main().catch((e) => {
  console.error('smoke failed:', e.message);
  process.exitCode = 1;
});
