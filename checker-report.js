/* "Report to admin" for the Chrysolite checkers.
   The page sets window.CK_REPORT = {checker, label, inputs: [idA, idB], go: idCompareButton, row: idButtonRow, collect: () => ({...})} before loading this file.
   A report holds everything needed to recreate the case: the exact text typed on both sides, the options, what the checker answered and why,
   the page's internal working (collect), the page version, browser details and any page errors. It is saved to Firestore (checkerReports)
   under the next serial number, using the employee's portal sign-in (same website, so the sign-in is shared). */
(function(){
  const C = window.CK_REPORT; if (!C) return;
  const FB_CONFIG = {apiKey: "AIzaSyDJ8u4jCNp9c8nKu_tvAge_p-jZWLlezNQ", authDomain: "chrysolite-portal.firebaseapp.com", projectId: "chrysolite-portal",
    storageBucket: "chrysolite-portal.firebasestorage.app", messagingSenderId: "118431634869", appId: "1:118431634869:web:57f25f0e8af78e5aa275fc"};
  const FB_VER = '10.12.2', $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  // page errors are kept so a report shows if the page itself broke
  const errs = []; window.addEventListener('error', e => { errs.push(String(e.message || e.error || 'error').slice(0, 300)); if (errs.length > 10) errs.shift(); });
  window.addEventListener('unhandledrejection', e => { errs.push('Promise: ' + String((e.reason && (e.reason.message || e.reason.code)) || e.reason).slice(0, 300)); if (errs.length > 10) errs.shift(); });

  const css = document.createElement('style');
  css.textContent = `.rp-btn{display:inline-flex;align-items:center;gap:6px;border:1.5px solid #e2b7ad;background:#fff7f4;color:#9a2f1d;border-radius:999px;padding:9px 16px;font:600 14px var(--body,system-ui);cursor:pointer}
.rp-btn:hover{background:#ffece6}.rp-dlg{border:0;border-radius:18px;padding:0;width:min(640px,calc(100vw - 32px));max-height:calc(100vh - 40px);box-shadow:0 30px 80px rgba(0,0,0,.3);color:var(--ink,#1c2620);background:var(--surface,#fff)}
.rp-dlg::backdrop{background:rgba(15,25,20,.45)}.rp-in{padding:20px 22px;display:grid;gap:14px}.rp-in h3{margin:0;font:800 20px var(--display,system-ui)}.rp-in p{margin:0}.rp-hint{font-size:13px;color:var(--ink-soft,#5b6b62)}
.rp-q{font-weight:700;font-size:14px;margin-bottom:6px}.rp-chips{display:flex;flex-wrap:wrap;gap:6px}.rp-chips button{border:1.5px solid var(--line,#d8e0da);background:var(--surface,#fff);border-radius:999px;padding:7px 12px;font:600 13px var(--body,system-ui);cursor:pointer;color:inherit}
.rp-chips button.on{border-color:#5a8a1a;background:#eef6e2;color:#2d5a14}.rp-in textarea{width:100%;min-height:80px;border:1.5px solid var(--line,#d8e0da);border-radius:12px;padding:10px 12px;font:14px/1.45 var(--body,system-ui);resize:vertical;background:transparent;color:inherit;box-sizing:border-box}
.rp-sum{border:1px solid var(--line,#d8e0da);border-radius:12px;padding:10px 12px;font-size:13px;background:var(--surface-2,#f4f6f3)}.rp-sum summary{cursor:pointer;font-weight:700}.rp-sum ul{margin:8px 0 0;padding-left:18px;display:grid;gap:3px}.rp-sum li span{color:var(--ink-soft,#5b6b62)}
.rp-row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;align-items:center}.rp-row .sp{margin-right:auto}.rp-go{border:0;border-radius:999px;padding:10px 18px;font:700 14px var(--body,system-ui);background:#7d9b16;color:#fff;cursor:pointer}.rp-go:disabled{opacity:.55;cursor:wait}
.rp-x{border:1.5px solid var(--line,#d8e0da);border-radius:999px;padding:9px 16px;font:600 14px var(--body,system-ui);background:transparent;cursor:pointer;color:inherit}.rp-msg{padding:10px 12px;border-radius:12px;font-size:14px}.rp-msg.ok{background:#eaf6e3;color:#2d5a14}.rp-msg.err{background:#fff0ec;color:#8a2a17}.rp-msg.warn{background:#fff6db;color:#5a4500}
.rp-ok{font:800 30px var(--display,system-ui);color:#2d5a14}`;
  document.head.appendChild(css);

  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'rp-btn'; btn.id = 'rpOpen'; btn.title = 'Send this case to the admin so the checker can be corrected';
  btn.innerHTML = '<span aria-hidden="true">⚑</span> Report to admin'; const row = $(C.row); if (row) row.appendChild(btn);

  const KINDS = [['wrong', 'Wrong suggested answer'], ['notfound', C.checker === 'location' ? 'A place was not found' : 'Text not read correctly'], ['broken', 'Page error or stuck'], ['idea', 'Idea / suggestion']];
  const ANS = [['m', '✓ Match'], ['n', '✗ Not a match'], ['c', '? Can\'t tell'], ['', 'Not sure']];
  const dlg = document.createElement('dialog'); dlg.className = 'rp-dlg'; dlg.id = 'rpDlg'; document.body.appendChild(dlg);
  let kind = 'wrong', exp = '';

  const val = id => { const e = $(id); return e ? e.value : ''; };
  const cap = (v, n) => { const s = String(v ?? ''); return s.length > n ? s.slice(0, n) + ' …[cut, ' + s.length + ' characters in all]' : s; };
  function snapshot(){ let detail = null, err = null; try { detail = C.collect ? C.collect() : null; } catch (e) { err = String(e && e.message || e); }
    let dj = ''; try { dj = JSON.stringify(detail || null); } catch (e) { dj = 'null'; } if (dj.length > 250000) detail = {cut: true, text: dj.slice(0, 250000)};
    return {checker: C.checker, checkerName: C.label || C.checker, page: location.origin + location.pathname, pageVersion: document.lastModified,
      input: {a: cap(val(C.inputs[0]), 60000), b: cap(val(C.inputs[1]), 60000)}, result: detail, collectError: err, errors: errs.slice(),
      env: {ua: navigator.userAgent, screen: innerWidth + '×' + innerHeight, tz: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || '', lang: navigator.language}}; }

  function open(){ kind = 'wrong'; exp = ''; const s = snapshot(), r = s.result || {};
    const has = s.input.a.trim() || s.input.b.trim();
    dlg.innerHTML = `<div class="rp-in"><div><h3>⚑ Report to admin</h3><p class="rp-hint">Tell us what went wrong. The two ${C.checker === 'location' ? 'locations' : 'texts'}, the checker's answer and how it worked it out are attached, so the problem can be recreated and the checker corrected.</p></div>
      ${has ? '' : '<div class="rp-msg warn">Both boxes are empty. Paste the case and press Compare first, so the report shows the problem.</div>'}
      <div><div class="rp-q">What is wrong?</div><div class="rp-chips" id="rpKind">${KINDS.map(([k, t]) => `<button type="button" data-k="${k}" class="${k === kind ? 'on' : ''}">${t}</button>`).join('')}</div></div>
      <div id="rpExpWrap"><div class="rp-q">What should the answer be?</div><div class="rp-chips" id="rpExp">${ANS.map(([k, t]) => `<button type="button" data-e="${k}" class="${k === exp ? 'on' : ''}">${t}</button>`).join('')}</div></div>
      <div><div class="rp-q">Explain (helps a lot)</div><textarea id="rpNote" maxlength="3000" placeholder="${C.checker === 'location' ? 'e.g. Raleigh-Durham is one metro area, both are the same place' : 'e.g. Only the bullets are different, the words are the same'}"></textarea></div>
      <details class="rp-sum"><summary>What will be sent</summary><ul>
        <li><span>Checker:</span> ${esc(s.checkerName)}</li><li><span>THE FILE SAYS:</span> ${esc(cap(s.input.a, 140)) || '<i>(empty)</i>'}</li><li><span>PUBLIC PROFILE SAYS:</span> ${esc(cap(s.input.b, 140)) || '<i>(empty)</i>'}</li>
        <li><span>Checker's answer:</span> ${esc(r.answerText || '—')}${r.pct != null ? ' · ' + esc(r.pct) + '%' : ''}</li><li><span>Plus:</span> how the checker worked it out${C.checker === 'location' ? ' (places found on the map, levels, distance, airports)' : ' (differences, 20-point check)'}, page version, browser, your sign-in email${s.errors.length ? ', ' + s.errors.length + ' page error(s)' : ''}</li></ul></details>
      <div id="rpMsg"></div>
      <div class="rp-row"><button type="button" class="rp-x sp" id="rpCopy" title="Copy the report as text (if sending doesn't work)">Copy report</button><button type="button" class="rp-x" id="rpCancel">Cancel</button><button type="button" class="rp-go" id="rpSend">Send report</button></div></div>`;
    $('rpKind').onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; $('rpKind').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); $('rpExpWrap').hidden = kind === 'broken' || kind === 'idea'; };
    $('rpExp').onclick = e => { const b = e.target.closest('[data-e]'); if (!b) return; exp = b.dataset.e; $('rpExp').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
    $('rpCancel').onclick = () => dlg.close();
    $('rpCopy').onclick = async () => { const t = JSON.stringify(build(s), null, 1); try { await navigator.clipboard.writeText(t); msg('ok', 'Report copied. Paste it to your admin.'); } catch (e) { msg('err', 'Copy was blocked by the browser.'); } };
    $('rpSend').onclick = () => send(s);
    try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); } }
  btn.onclick = open;
  const msg = (k, h) => { $('rpMsg').innerHTML = h ? `<div class="rp-msg ${k}">${h}</div>` : ''; };
  const build = s => ({...s, kind, kindText: (KINDS.find(k => k[0] === kind) || [])[1] || kind, expected: kind === 'broken' || kind === 'idea' ? null : exp || null, note: ($('rpNote') ? $('rpNote').value : '').trim()});

  // Firebase is loaded only when a report is sent, so the checker itself stays fast
  const load = src => new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = src; sc.onload = ok; sc.onerror = () => no(new Error('load')); document.head.appendChild(sc); });
  let fbReady = null;
  function fb(){ if (fbReady) return fbReady;
    fbReady = (async () => { if (!window.firebase || !firebase.firestore) { const base = 'https://www.gstatic.com/firebasejs/' + FB_VER + '/'; await load(base + 'firebase-app-compat.js'); await load(base + 'firebase-auth-compat.js'); await load(base + 'firebase-firestore-compat.js'); }
      if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG); const auth = firebase.auth();
      const user = auth.currentUser || await new Promise(r => { let done = false; const un = auth.onAuthStateChanged(u => { if (done) return; done = true; try { un && un(); } catch (e) {} r(u); }); setTimeout(() => { if (!done) { done = true; r(auth.currentUser); } }, 6000); });
      return {db: firebase.firestore(), user}; })();
    fbReady.catch(() => { fbReady = null; }); return fbReady; }

  async function send(s){ const b = $('rpSend'); const rep = build(s);
    if ((kind === 'wrong' || kind === 'notfound') && exp === '' && !rep.note) { msg('warn', 'Choose what the answer should be, or explain in the box (choose “Not sure” if you don\'t know).'); return; }
    b.disabled = true; b.textContent = 'Sending…'; msg('', '');
    try { const {db, user} = await fb();
      if (!user || !user.email) { b.disabled = false; b.textContent = 'Send report'; msg('warn', 'You are not signed in to the employee portal in this browser. <a href="portal.html" target="_blank" rel="noopener">Sign in to the portal</a> (new tab), then press <b>Send report</b> again. Or press <b>Copy report</b> and send it to your admin.'); return; }
      const email = String(user.email).toLowerCase(), cRef = db.doc('reportMeta/counter'); let n = 0;
      await db.runTransaction(async t => { const c = await t.get(cRef); n = (c.exists ? +c.data().n || 0 : 0) + 1;
        t.set(cRef, {n}); t.set(db.doc('checkerReports/' + n), {...rep, n, by: email, at: new Date().toISOString(), status: 'new'}); });
      $('rpMsg').innerHTML = ''; dlg.querySelector('.rp-in').innerHTML = `<div style="text-align:center;display:grid;gap:8px;padding:10px 0"><div class="rp-ok">✓ Report sent</div><p>Ticket <b>#${String(n).padStart(4, '0')}</b> is with the admin. Thank you, this helps make the checker better.</p><p class="rp-hint">Keep making your own decision using the rules for this case.</p><div class="rp-row" style="justify-content:center"><button type="button" class="rp-go" id="rpDone">Close</button></div></div>`;
      $('rpDone').onclick = () => dlg.close();
    } catch (e) { b.disabled = false; b.textContent = 'Send report';
      const code = (e && (e.code || e.message)) || 'error';
      msg('err', (code === 'permission-denied' ? 'The report was refused (your portal account may not be active, or the admin has not switched reports on yet).' : code === 'load' ? 'Couldn\'t reach the portal server. Check your internet connection.' : 'The report couldn\'t be sent (' + esc(code) + ').') + ' Press <b>Copy report</b> and send it to your admin instead.'); } }

  // "Open in checker" from the admin's Reported issues page: #rep=<base64 of {a, b}> fills both boxes and runs the compare
  try { const m = location.hash.match(/^#rep=(.+)$/); if (m) { const d = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1]))))); const A = $(C.inputs[0]), B = $(C.inputs[1]);
    if (A && B) { A.value = d.a || ''; B.value = d.b || ''; history.replaceState(null, '', location.pathname); setTimeout(() => { const g = $(C.go); if (g) g.click(); }, 200); } } } catch (e) {}
})();
