/** 内置登录页（GET /plugins/enterprise）——在 DSH 里直接打开的独立 HTML；中英双语（跟随浏览器语言） */
export const LOGIN_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>企业账号登录 · DSH</title>
<style>
:root { --bg:#f4f6fa; --card:#fff; --line:#e6eaf1; --txt:#1f2937; --dim:#6b7280; --hint:#94a3b8; --accent:#2563eb; --accent-ink:#fff; --bad:#dc2626; --ok:#059669; --input-bg:#fff; --shadow:rgba(0,0,0,.18); }
@media (prefers-color-scheme: dark) {
  :root { --bg:#111216; --card:#232429; --line:rgba(255,255,255,.14); --txt:#e9edf3; --dim:#b9bfc7; --hint:#979da6; --accent:#6ba4ff; --accent-ink:#10131a; --bad:#f25a5a; --ok:#4ed17e; --input-bg:rgba(255,255,255,.07); --shadow:rgba(0,0,0,.55); }
  html { color-scheme: dark; }
}
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif; background:var(--bg); color:var(--txt); font-size:14px; line-height:1.7; display:flex; align-items:center; justify-content:center; min-height:100vh; }
.box { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:32px 34px; width:min(380px,92vw); box-shadow:0 24px 70px var(--shadow); }
h2 { font-size:18px; margin-bottom:4px; }
.sub { font-size:12.5px; color:var(--dim); margin-bottom:18px; }
input { width:100%; border:1px solid var(--line); border-radius:9px; padding:9px 13px; font-size:14px; margin-bottom:12px; font-family:inherit; outline:none; transition:border .15s; background:var(--input-bg); color:var(--txt); }
input::placeholder { color:var(--hint); opacity:1; }
input:focus { border-color:var(--accent); }
button { width:100%; padding:10px; font-size:14px; border:none; border-radius:9px; background:var(--accent); color:var(--accent-ink); cursor:pointer; }
button:disabled { opacity:.6; cursor:default; }
.err { color:var(--bad); font-size:12.5px; min-height:20px; margin-bottom:6px; }
.ok { color:var(--ok); font-size:13px; }
</style></head><body>
<div class="box">
  <h2>企业账号登录</h2>
  <div class="sub">登录后自动配置企业模型网关，无需手工设置</div>
  <div class="err" id="err"></div>
  <input id="server" placeholder="网关地址">
  <input id="user" placeholder="账号" autocomplete="username">
  <input id="pass" placeholder="密码" type="password" autocomplete="currenterprise-password">
  <button id="btn">登录并自动配置</button>
  <div class="ok" id="ok"></div>
</div>
<script>
const $ = (id) => document.getElementById(id);
/* ---- i18n：zh 为默认文案，英文浏览器整表替换 ---- */
const EN = (navigator.language || '').toLowerCase().indexOf('zh') !== 0;
const I18N = {
  title: ['企业账号登录 · DSH', 'Enterprise Sign-in · DSH'],
  h2: ['企业账号登录', 'Enterprise Sign-in'],
  sub: ['登录后自动配置企业模型网关，无需手工设置', 'Sign in to auto-configure the enterprise model gateway'],
  server: ['网关地址', 'Gateway URL'],
  user: ['账号', 'Account'],
  pass: ['密码', 'Password'],
  btn: ['登录并自动配置', 'Sign in & auto-configure'],
  signingIn: ['登录中…', 'Signing in…'],
  configured: ['已配置 ✓', 'Configured ✓'],
  okModels: ['✓ 登录成功，模型已就绪', '✓ Signed in, models ready'],
  okBack: ['回到 DSH 对话框即可直接使用。', 'Back in the DSH chat, ready to use.'],
  fail: ['登录失败', 'Sign-in failed'],
  netErr: ['网络错误：', 'Network error: '],
  current: ['✓ 已登录，模型已就绪', '✓ Signed in, models ready'],
};
if (EN) {
  document.documentElement.lang = 'en';
  document.title = I18N.title[1];
  document.querySelector('h2') && (document.querySelector('h2').textContent = I18N.h2[1]);
  document.querySelector('.sub').textContent = I18N.sub[1];
  $('server').placeholder = I18N.server[1];
  $('user').placeholder = I18N.user[1];
  $('pass').placeholder = I18N.pass[1];
  $('btn').textContent = I18N.btn[1];
}
const t = (k) => EN ? I18N[k][1] : I18N[k][0];
$('btn').onclick = async () => {
  const btn = $('btn'); btn.disabled = true; btn.textContent = t('signingIn'); $('err').textContent = ''; $('ok').textContent = '';
  try {
    const r = await fetch('/api/enterprise/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ server: $('server').value.trim() || undefined, username: $('user').value.trim(), password: $('pass').value }) });
    const b = await r.json();
    if (b.ok) {
      $('ok').innerHTML = t('okModels') + '<br>' + (EN ? 'Back in the DSH chat, ready to use.' : '回到 DSH 对话框即可直接使用。');
      btn.textContent = t('configured');
    } else { $('err').textContent = b.error || t('fail'); btn.textContent = t('btn'); }
  } catch (e) { $('err').textContent = t('netErr') + e.message; btn.textContent = t('btn'); }
  btn.disabled = false;
};
$('pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn').click(); });
(async () => { try { const s = await (await fetch('/api/enterprise/status')).json(); if (s.gateway || s.factoryGateway) { $('server').value = s.gateway || s.factoryGateway; } if (s.configured) { $('ok').textContent = t('current'); } } catch {} })();
</script>
</body></html>`
