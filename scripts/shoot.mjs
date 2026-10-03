// Open a page in headless Chrome, wait (in real time) until document.title === 'DONE', then screenshot.
// Usage: node scripts/shoot.mjs <url> <out.png> [timeoutSec]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [url, out, secs = 240] = process.argv.slice(2);
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${port}`, '--window-size=760,700', `--user-data-dir=/tmp/brixel-chrome-${port}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
await send('Page.enable'); await send('Page.navigate', { url });
const t0 = Date.now(); let title = '', log = '';
while (Date.now() - t0 < secs * 1000) {
  await sleep(1000);
  const r = await send('Runtime.evaluate', { expression: 'document.title + "|" + (document.getElementById("log")?.textContent || "")', returnByValue: true });
  [title, log] = String(r?.result?.value || '|').split('|');
  if (title === 'DONE' || /ERROR/.test(log)) break;
}
await sleep(500);
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s title=${title}\n${log}`);
ws.close(); chrome.kill(); process.exit(0);
