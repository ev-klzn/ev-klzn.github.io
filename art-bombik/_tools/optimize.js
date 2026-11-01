const { chromium } = require('playwright-core');
const postcss = require('postcss');
const esbuild = require('esbuild');
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const CSS_SOURCE = path.join(ROOT, 'assets/css/style.css');
const CSS_MIN = path.join(ROOT, 'assets/css/style.min.css');
const JS_SOURCE = path.join(ROOT, 'assets/js/script.js');
const JS_MIN = path.join(ROOT, 'assets/js/script.min.js');
const VIEWPORTS = [[320, 568], [360, 640], [390, 844], [430, 932], [568, 320], [844, 390], [768, 1024], [820, 1180], [1024, 768], [1180, 820], [1280, 720], [1366, 768], [1440, 900], [1536, 864], [1920, 1080], [2560, 1080], [3440, 1440]];
const FOLD = 1.25;
const INJECTED = /<style>[\s\S]*?<\/style>\s*<link rel="preload" href="([^"]*)assets\/css\/style\.min\.css"[^>]*>\s*<noscript>[\s\S]*?<\/noscript>/;
const SOURCE_LINK = /<link rel="stylesheet" href="([^"]*)assets\/css\/style\.css">/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const minifyCss = (code) => esbuild.transformSync(code, { loader: 'css', minify: true, charset: 'utf8' }).code.trim();
const clean = (selector) => selector.replace(/:[:\w-]+(\((?:[^()]|\([^()]*\))*\))?/g, '').trim();
const isGlobal = (selector) => !/[.#]/.test(selector);

const findPages = (dir = ROOT, prefix = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  if (entry.isDirectory()) {
    if (/^[._]/.test(entry.name) || ['assets', 'node_modules'].includes(entry.name)) return [];
    return findPages(path.join(dir, entry.name), `${prefix}${entry.name}/`);
  }
  return entry.name.endsWith('.html') ? [`${prefix}${entry.name}`] : [];
});

const groupOf = (file) => path.basename(file, '.html').replace(/^event-\d+$/, 'event');

const prefixOf = (file, html) => {
  const match = html.match(INJECTED) || html.match(SOURCE_LINK);
  if (!match) throw new Error(`${file}: no stylesheet block found in the head`);
  return match[1];
};

const withSourceStylesheet = (html, prefix) => {
  const link = `<link rel="stylesheet" href="${prefix}assets/css/style.css">`;
  return html.replace(INJECTED, () => link);
};

const startServer = () => new Promise((resolve) => {
  const server = http.createServer((request, response) => {
    const url = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.join(ROOT, url.endsWith('/') ? `${url}index.html` : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404);
      response.end();
      return;
    }
    const ext = path.extname(file);
    let body = fs.readFileSync(file);
    if (ext === '.html') {
      const html = body.toString('utf8');
      body = withSourceStylesheet(html, prefixOf(file, html));
    }
    response.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
    response.end(body);
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

const measure = ([list, fold]) => {
  const limit = innerHeight * fold;
  return list.filter((selector) => {
    try {
      return [...document.querySelectorAll(selector)].some((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.top + scrollY < limit;
      });
    } catch (error) {
      return true;
    }
  });
};

const pick = (parsed, matched) => {
  const keep = (selector) => (selector.includes(':hover') ? false : isGlobal(selector) || matched.has(clean(selector)));
  const animations = new Set();
  const walk = (nodes, target, withKeyframes) => {
    for (const node of nodes) {
      if (node.type === 'rule') {
        const kept = node.selectors.filter(keep);
        if (kept.length) {
          const copy = node.clone();
          copy.selectors = kept;
          target.append(copy);
          copy.walkDecls(/^animation(-name)?$/, (declaration) => declaration.value.split(/\s+/).forEach((word) => animations.add(word)));
        }
      } else if (node.type === 'atrule') {
        if (node.name === 'font-face') {
          target.append(node.clone());
        } else if (node.name === 'keyframes') {
          if (withKeyframes && animations.has(node.params)) target.append(node.clone());
        } else if (node.name === 'media') {
          const wrap = node.clone();
          wrap.removeAll();
          walk(node.nodes, wrap, withKeyframes);
          if (wrap.nodes.length) target.append(wrap);
        }
      }
    }
  };
  walk(parsed.nodes, postcss.root(), false);
  const result = postcss.root();
  walk(parsed.nodes, result, true);
  return result.toString();
};

const inject = (file, critical) => {
  const target = path.join(ROOT, file);
  const html = fs.readFileSync(target, 'utf8');
  const prefix = prefixOf(file, html);
  const css = critical.replace(/url\((["']?)\.\.\/(fonts|img)\//g, `url($1${prefix}assets/$2/`);
  const sheet = `${prefix}assets/css/style.min.css`;
  const handler = "this.onload=function(){this.onload=null;var t=document.getElementById(location.hash.slice(1));if(t)t.scrollIntoView()};this.rel='stylesheet'";
  const block = `<style>${css}</style>\n  <link rel="preload" href="${sheet}" as="style" onload="${handler}">\n  <noscript><link rel="stylesheet" href="${sheet}"></noscript>`;
  fs.writeFileSync(target, html.replace(INJECTED.test(html) ? INJECTED : SOURCE_LINK, () => block));
};

const main = async () => {
  const pages = findPages();
  pages.forEach((file) => prefixOf(file, fs.readFileSync(path.join(ROOT, file), 'utf8')));
  const parsed = postcss.parse(fs.readFileSync(CSS_SOURCE, 'utf8'));
  const selectors = new Set();
  parsed.walkRules((rule) => {
    if (rule.parent.name !== 'keyframes') rule.selectors.forEach((selector) => { if (!isGlobal(selector)) selectors.add(clean(selector)); });
  });

  const groups = {};
  pages.forEach((file) => { (groups[groupOf(file)] = groups[groupOf(file)] || []).push(file); });

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  const critical = {};
  try {
    for (const [group, files] of Object.entries(groups)) {
      const matched = new Set();
      for (const [width, height] of VIEWPORTS) {
        const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
        await context.route(/\.(webp|jpg|png|gif|svg|woff2)(\?|$)/, (route) => route.abort());
        const page = await context.newPage();
        for (const file of files) {
          await page.goto(`${base}/${file}`, { waitUntil: 'load' });
          (await page.evaluate(measure, [[...selectors], FOLD])).forEach((selector) => matched.add(selector));
        }
        await context.close();
      }
      critical[group] = minifyCss(pick(parsed, matched));
    }
  } finally {
    await browser.close();
    server.close();
  }

  const full = parsed.clone();
  full.walkAtRules('font-face', (rule) => rule.remove());
  fs.writeFileSync(CSS_MIN, `${minifyCss(full.toString())}\n`);
  fs.writeFileSync(JS_MIN, esbuild.transformSync(fs.readFileSync(JS_SOURCE, 'utf8'), { loader: 'js', minify: true, charset: 'utf8' }).code);
  pages.forEach((file) => inject(file, critical[groupOf(file)]));

  const report = (from, to) => `${path.basename(from)} ${fs.statSync(from).size} → ${path.basename(to)} ${fs.statSync(to).size} bytes`;
  console.log(report(CSS_SOURCE, CSS_MIN));
  console.log(report(JS_SOURCE, JS_MIN));
  Object.entries(critical).forEach(([group, css]) => console.log(`critical ${group}: ${Buffer.byteLength(css)} bytes, gzip ${zlib.gzipSync(css).length}`));
  console.log(`${pages.length} pages updated`);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
