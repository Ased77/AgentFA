// Regenerates `public/og.png` and `public/apple-touch-icon.png`.
//
// The toolchain here has no rasterizer (no ImageMagick, no rsvg, no PIL), and the
// social card needs real text — which means a browser has to draw it. So this
// script serves a tiny local page that paints both images on a canvas and posts
// them back, and the server writes them into `public/`. The generated PNGs are
// committed; this is a regeneration tool, not part of the build.
//
//   node scripts/make-social-assets.mjs   # ASSET_PORT overrides 8899
//   → open the printed URL in any browser; the script exits once both are saved.
//
// The mark matches `public/favicon.svg`: the letter A built from three rounded
// strokes, in the violet-to-fuchsia gradient the app uses, on the theme navy.
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public')
// Deliberately not `PORT`: that variable is set by other tooling here (Vite reads
// it too), and inheriting it silently bound port 0 — a random port nothing could
// open. This server has exactly one purpose and its own knob.
const port = Number(process.env.ASSET_PORT ?? 8899)

mkdirSync(outDir, { recursive: true })

const page = `<!doctype html>
<meta charset="utf-8" />
<title>AgentFa — generating brand assets</title>
<body style="margin:0;background:#0b1124;color:#e2e8f0;font:14px system-ui">
<canvas id="og" width="1200" height="630" style="max-width:100%"></canvas>
<canvas id="icon" width="180" height="180"></canvas>
<pre id="status" style="padding:16px"></pre>
<script>
const NAVY = '#0b1124';
const status = document.getElementById('status');
const log = (line) => { status.textContent += line + '\\n'; };

/** The A mark: apex to both feet, plus the crossbar. */
function mark(ctx, size, x, y) {
  const s = size / 64;
  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, '#a78bfa');
  gradient.addColorStop(1, '#f0abfc');
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(32, 15); ctx.lineTo(17, 49);
  ctx.moveTo(32, 15); ctx.lineTo(47, 49);
  ctx.moveTo(23, 38); ctx.lineTo(41, 38);
  ctx.stroke();
  ctx.restore();
}

function card() {
  const canvas = document.getElementById('og');
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Soft violet glow so the card does not read as a flat rectangle in a feed.
  const glow = ctx.createRadialGradient(180, 120, 20, 180, 120, 900);
  glow.addColorStop(0, 'rgba(124, 58, 237, .45)');
  glow.addColorStop(1, 'rgba(11, 17, 36, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  mark(ctx, 132, 96, 96);

  ctx.fillStyle = '#f8fafc';
  ctx.font = '900 92px Tahoma, "Segoe UI", system-ui, sans-serif';
  ctx.fillText('AgentFa', 96, 348);

  ctx.fillStyle = '#c4b5fd';
  ctx.font = '600 44px Tahoma, "Segoe UI", system-ui, sans-serif';
  ctx.fillText('ایجنت‌های هوش مصنوعی فارسی', 96, 428);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '400 34px Tahoma, "Segoe UI", system-ui, sans-serif';
  ctx.fillText('خرید یک‌باره · دسترسی همیشگی · گفتگو به فارسی', 96, 500);
  ctx.fillText('264 specialized agents for real work', 96, 546);
  return canvas.toDataURL('image/png');
}

function icon() {
  const canvas = document.getElementById('icon');
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  mark(ctx, 116, 32, 32);
  return canvas.toDataURL('image/png');
}

async function save(name, dataUrl) {
  const response = await fetch('/save/' + name, { method: 'POST', body: dataUrl });
  log(name + ': ' + (response.ok ? 'saved' : 'failed (' + response.status + ')'));
}

(async () => {
  await save('og.png', card());
  await save('apple-touch-icon.png', icon());
  log('done — you can close this tab');
})();
</script>
</body>
`

let remaining = 2

const server = createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page)
    return
  }

  if (req.method === 'POST' && req.url?.startsWith('/save/')) {
    // `basename` keeps a crafted name from escaping the public directory.
    const name = path.basename(decodeURIComponent(req.url.slice('/save/'.length)))
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const bytes = Buffer.from(body.replace(/^data:image\/png;base64,/, ''), 'base64')
      const file = path.join(outDir, name)
      writeFileSync(file, bytes)
      console.log(`${name}: ${bytes.length} bytes -> ${path.relative(root, file)}`)
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
      if (--remaining === 0) server.close(() => process.exit(0))
    })
    return
  }

  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Brand assets will be written to ${path.relative(process.cwd(), outDir)}`)
  console.log(`Open http://localhost:${port}/ in a browser to generate them.`)
})
