// Code Anim server: static files + /api/trace. No npm install needed (Node 18+).
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
try { for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch {}
const PORT = process.env.PORT || 3000, MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function pyTrace(code) {
  return new Promise((ok, no) => {
    const f = path.join(os.tmpdir(), 'codeanim_' + Date.now() + '.py'); fs.writeFileSync(f, code);
    const p = spawn(process.platform === 'win32' ? 'python' : 'python3', [path.join(__dirname, 'tracers', 'py_tracer.py'), f]);
    let out = '', err = '';
    const t = setTimeout(() => { p.kill(); no(new Error('Program ran longer than 10 seconds')); }, 10000);
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('error', () => { clearTimeout(t); no(Object.assign(new Error('Python not found'), { missing: true })); });
    p.on('close', () => { clearTimeout(t); fs.unlink(f, () => {}); try { ok(JSON.parse(out)); } catch { no(new Error(err || 'Tracer failed')); } });
  });
}

const PROMPT = (lang, code) => 'You are the engine of a code visualizer. Simulate running the program below and return ONLY JSON (no markdown): {"steps":[{"line":<1-based source line being executed>,"note":"<one or two simple sentences for a complete beginner with zero coding knowledge, using everyday analogies and the real values>","vars":{"name":value},"print":"<text printed to the console in this step, else empty>","scene":null}]}. Rules: at most 80 steps; condense long loops (first iterations, then the final result). vars holds live variables after the step: numbers, strings, arrays, nested arrays or objects; show trees as objects with value/left/right, linked lists as objects with value/next, maps as objects. For GUI, applet, Android layout, canvas, HTML or React code set scene={"w":300,"h":200,"items":[{"t":"rect|circle|text|line|button","x":0,"y":0,"w":10,"h":10,"r":5,"x2":0,"y2":0,"text":"","color":"#hex"}]} listing everything drawn or rendered so far; otherwise scene is null. Always return at least one step.\nLanguage: ' + lang + '\nCode:\n' + code;

async function llm(prompt) {
  const ak = process.env.ANTHROPIC_API_KEY, ok = process.env.OPENAI_API_KEY;
  if (ak) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': ak, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }) });
    const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || 'API error ' + r.status);
    return j.content.map(c => c.text || '').join('');
  }
  if (ok) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST',
      headers: { Authorization: 'Bearer ' + ok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }) });
    const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || 'API error ' + r.status);
    return j.choices[0].message.content;
  }
  throw new Error('Add OPENAI_API_KEY (or ANTHROPIC_API_KEY) to the .env file.');
}

async function aiTrace(lang, code) {
  const t = await llm(PROMPT(lang, code.slice(0, 8000)));
  const o = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  let out = '';
  return (o.steps || []).slice(0, 150).map(s => { if (s.print) out += String(s.print) + '\n';
    return { line: Math.max(1, +s.line || 1), vars: s.vars && typeof s.vars === 'object' && !Array.isArray(s.vars) ? s.vars : {}, note: String(s.note || ''), scene: s.scene || null, outText: out }; });
}

async function trace({ lang, code }) {
  if (typeof code !== 'string' || !code.trim()) throw new Error('No code given.');
  if (lang === 'py') {
    try { const r = await pyTrace(code); return { steps: r.steps, note: r.error ? 'Program stopped: ' + r.error : '' }; }
    catch (e) { if (!e.missing) throw e; }
  }
  return { steps: await aiTrace(lang, code), note: 'Simulated step by step by Claude; check it against real output.' };
}

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/trace') {
    let b = ''; req.on('data', d => { b += d; if (b.length > 2e6) req.destroy(); });
    req.on('end', async () => { let code = 200, o;
      try { o = await trace(JSON.parse(b)); } catch (e) { code = 400; o = { error: e.message }; }
      res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); });
    return;
  }
  const f = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : path.normalize(req.url.split('?')[0]).replace(/^(\.\.[\/\\])+/, ''));
  if (!f.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' }); res.end(d); });
}).listen(PORT, () => console.log('Code Anim running at http://localhost:' + PORT));
