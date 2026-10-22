// Chrysolite PowerFilter source check.
// Reads the source register from Firestore (guidelines/pfsources), opens every primary and backup link,
// works out whether each source looks current, and writes the result to guidelines/pfcheck.
// Run by .github/workflows/source-check.yml. Local test: node check-sources.mjs --pack guidelines-pack.json --dry
import fs from 'node:fs';

const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i < 0 ? null : (args[i + 1] || true); };
const NOW = new Date(), Y = NOW.getFullYear(), DAY = 864e5;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

// how old a source may be (in days) before it counts as outdated, from its publication cadence
export function maxAge(cadence, freq){
  const c = String(cadence || freq || '').toLowerCase();
  if (/live|continuous|daily|real.?time/.test(c)) return 0;           // live trackers: reachable = current
  if (/week/.test(c)) return 45;
  if (/month/.test(c)) return 62;
  if (/quarter/.test(c)) return 125;
  if (/half|semi|bi-?annual|6.?month/.test(c)) return 215;
  if (/announced|ad hoc|irregular/.test(c)) return -1;                 // no fixed cadence
  return 400;                                                          // annual and anything else
}

const okDate = d => d instanceof Date && !isNaN(d) && d.getFullYear() >= 2010 && d <= new Date(+NOW + 2 * DAY);
const parse = s => { if (!s) return null; const d = new Date(String(s).trim().replace(/(\d)(st|nd|rd|th)\b/gi, '$1')); return okDate(d) ? d : null; };

// find the most recent "updated / published" date a page states about itself
export function findDates(html, headers = {}){
  const found = [];
  const add = (s, how) => { const d = parse(s); if (d) found.push({d, how}); };
  const lm = headers['last-modified']; if (lm) { const d = parse(lm); if (d && NOW - d > 1.5 * DAY) found.push({d, how: 'server last-modified'}); }
  for (const m of html.matchAll(/"(dateModified|datePublished|uploadDate)"\s*:\s*"([^"]{8,40})"/g)) add(m[2], 'page data (' + m[1] + ')');
  for (const m of html.matchAll(/<meta[^>]+(?:property|name|itemprop)\s*=\s*["'](article:modified_time|article:published_time|og:updated_time|last-modified|dateModified|datePublished|dc\.date|date)["'][^>]*>/gi)) { const c = /content\s*=\s*["']([^"']+)["']/i.exec(m[0]); if (c) add(c[1], 'page meta (' + m[1] + ')'); }
  for (const m of html.matchAll(/<time[^>]+datetime\s*=\s*["']([^"']+)["']/gi)) add(m[1], 'page time tag');
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
  const near = new RegExp(`(?:updated|published|released|as of|last revised|data as of)[^.]{0,30}?((?:${MONTHS})\\.? \\d{1,2},? \\d{4}|\\d{1,2} (?:${MONTHS})\\.? \\d{4}|(?:${MONTHS})\\.? \\d{4}|\\d{4}-\\d{2}-\\d{2})`, 'gi');
  for (const m of text.matchAll(near)) add(/^\D+\d{4}$/.test(m[1]) ? '1 ' + m[1] : m[1], 'page text "' + m[0].slice(0, 60).trim() + '"');
  // newest year that the page talks about (a list "2026 Top 100" etc.)
  const yc = {}; for (const m of text.matchAll(/\b(20[1-3]\d)\b/g)) { const y = +m[1]; if (y <= Y + 1) yc[y] = (yc[y] || 0) + 1; }
  const years = Object.keys(yc).map(Number).filter(y => yc[y] >= 2).sort((a, b) => b - a);
  found.sort((a, b) => b.d - a.d);
  const title = (/<title[^>]*>([^<]{1,160})/i.exec(html) || [])[1];
  return {updated: found[0] || null, year: years[0] || null, title: title ? title.trim().replace(/\s+/g, ' ') : null};
}

export function judge(res, cadence, freq){
  if (res.error || !res.http) return {status: 'Link broken', note: 'The link could not be opened (' + (res.error || 'no response') + ').'};
  if ([404, 410].includes(res.http) || res.http >= 500 && res.http !== 503) return {status: 'Link broken', note: 'The site answered ' + res.http + '. The link may have moved.'};
  if ([401, 403, 429, 503].includes(res.http) || res.blocked) return {status: 'Not verified', note: 'The site blocks automatic checks (' + res.http + '). Open it manually.'};
  if (res.http >= 400) return {status: 'Not verified', note: 'The site answered ' + res.http + '.'};
  const lim = maxAge(cadence, freq), u = res.updated;
  if (lim === 0) return {status: 'Current', note: 'Live source and the link works.' + (u ? '' : '')};
  if (u) { const age = Math.round((NOW - u.d) / DAY); if (lim < 0) return {status: 'Current', note: 'Last update found on the page: ' + age + ' days ago.'};
    return age <= lim ? {status: 'Current', note: 'Updated ' + age + ' days ago (expected at least every ' + lim + ' days).'} : {status: 'Outdated', note: 'Last update was ' + age + ' days ago; a newer edition was expected within ' + lim + ' days.'}; }
  if (res.year) { const need = lim >= 300 ? Y - 1 : Y; return res.year >= need ? {status: 'Current', note: 'No date on the page, but it refers to ' + res.year + '.', soft: true} : {status: 'Outdated', note: 'The newest year on the page is ' + res.year + '.', soft: true}; }
  return {status: 'Not verified', note: 'The link works but the page does not show a date. Check it manually.'};
}

async function fetchOne(url){
  if (!url) return null;
  const u = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(u, {redirect: 'follow', signal: ctl.signal, headers: {'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9'}});
    const headers = Object.fromEntries(r.headers.entries()), type = headers['content-type'] || '';
    let body = ''; if (/html|text|json|xml/.test(type)) body = (await r.text()).slice(0, 3_000_000); else await r.arrayBuffer().catch(() => {});
    const blocked = /cf-chl|captcha|access denied|are you a robot|enable javascript and cookies/i.test(body.slice(0, 20000)) && body.length < 60000;
    return {http: r.status, finalUrl: r.url, blocked, ...findDates(body, headers)};
  } catch (e) { return {error: e.name === 'AbortError' ? 'timed out' : (e.cause && e.cause.code) || e.message}; }
  finally { clearTimeout(t); }
}

async function checkRow(r){
  const one = async (url) => { if (!url) return null; const res = await fetchOne(url), j = judge(res, r.cadence, r.freq);
    return {url, status: j.status, note: j.note, soft: !!j.soft, http: res.http || null, moved: res.finalUrl && res.finalUrl.replace(/\/$/, '') !== (/^https?:/i.test(url) ? url : 'https://' + url).replace(/\/$/, '') ? res.finalUrl : null,
      updated: res.updated ? res.updated.d.toISOString().slice(0, 10) : null, updatedHow: res.updated ? res.updated.how : null, year: res.year || null, title: res.title || null}; };
  const [p, b] = await Promise.all([one(r.primaryUrl), one(r.backupUrl)]);
  return {id: r.id, p, b, at: new Date().toISOString()};
}

async function pool(items, n, fn){ const out = []; let i = 0; await Promise.all([...Array(n)].map(async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); process.stdout.write('.'); } })); return out; }

const summarise = rows => { const s = {Current: 0, Outdated: 0, 'Not verified': 0, 'Link broken': 0}; rows.forEach(x => x.p && (s[x.p.status] = (s[x.p.status] || 0) + 1)); return s; };

async function main(){
  let db = null, rows;
  if (opt('--pack')) rows = JSON.parse(fs.readFileSync(opt('--pack'), 'utf8')).pfsources.rows;
  else {
    const {initializeApp, cert} = await import('firebase-admin/app'), {getFirestore} = await import('firebase-admin/firestore');
    initializeApp({credential: cert(JSON.parse(process.env.FIREBASE_SA))}); db = getFirestore();
    await db.doc('guidelines/pfcheck').set({running: true, startedAt: new Date().toISOString(), trigger: process.env.TRIGGER || 'manual'}, {merge: true});
    const snap = await db.doc('guidelines/pfsources').get(); rows = (snap.exists && snap.data().rows) || [];
  }
  if (opt('--limit')) rows = rows.slice(0, +opt('--limit'));
  console.log('Checking', rows.length, 'PowerFilters');
  const res = await pool(rows, 6, checkRow); console.log('');
  const summary = summarise(res), out = {running: false, at: new Date().toISOString(), trigger: process.env.TRIGGER || 'manual', summary, backup: summarise(res.map(x => ({p: x.b}))), rows: Object.fromEntries(res.map(x => [x.id.replace(/\./g, '~'), x]))};
  console.log('Primary sources:', JSON.stringify(summary), '| Backup sources:', JSON.stringify(out.backup));
  if (db) await db.doc('guidelines/pfcheck').set(out); else fs.writeFileSync(opt('--out') || 'pfcheck.json', JSON.stringify(out, null, 1));
}
if (process.argv[1] && process.argv[1].endsWith('check-sources.mjs')) main().catch(async e => { console.error(e); process.exit(1); });
