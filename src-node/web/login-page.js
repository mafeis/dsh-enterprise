/** 内置登录页（GET /plugins/enterprise）——在 DSH 里直接打开的独立 HTML */
export const LOGIN_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>企业账号登录 · DSH</title>
<style>
:root { --bg:#f4f6fa; --card:#fff; --line:#e6eaf1; --txt:#1f2937; --dim:#6b7280; --accent:#2563eb; --bad:#dc2626; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif; background:var(--bg); color:var(--txt); font-size:14px; line-height:1.7; display:flex; align-items:center; justify-content:center; min-height:100vh; }
.box { background:var(--card); border-radius:14px; padding:32px 34px; width:min(380px,92vw); box-shadow:0 24px 70px rgba(0,0,0,.18); }
h2 { font-size:18px; margin-bottom:4px; }
.sub { font-size:12.5px; color:var(--dim); margin-bottom:18px; }
input { width:100%; border:1px solid var(--line); border-radius:9px; padding:9px 13px; font-size:14px; margin-bottom:12px; font-family:inherit; outline:none; transition:border .15s; }
input:focus { border-color:var(--accent); }
button { width:100%; padding:10px; font-size:14px; border:none; border-radius:9px; background:var(--accent); color:#fff; cursor:pointer; }
button:disabled { opacity:.6; cursor:default; }
.err { color:var(--bad); font-size:12.5px; min-height:20px; margin-bottom:6px; }
.ok { color:#059669; font-size:13px; }
</style></head><body>
<div class="box">
  <h2>企业账号登录</h2>
  <div class="sub">登录后自动配置企业模型网关，无需手工设置</div>
  <div class="err" id="err"></div>
  <input id="server" placeholder="网关地址（默认上次使用，出厂地址见企业部署文档）">
  <input id="user" placeholder="账号" autocomplete="username">
  <input id="pass" placeholder="密码" type="password" autocomplete="currenterprise-password">
  <button id="btn">登录并自动配置</button>
  <div class="ok" id="ok"></div>
</div>
<script>
const $ = (id) => document.getElementById(id);
$('btn').onclick = async () => {
  const btn = $('btn'); btn.disabled = true; btn.textContent = '登录中…'; $('err').textContent = ''; $('ok').textContent = '';
  try {
    const r = await fetch('/api/enterprise/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ server: $('server').value.trim() || undefined, username: $('user').value.trim(), password: $('pass').value }) });
    const b = await r.json();
    if (b.ok) {
      $('ok').innerHTML = '✓ 登录成功，已自动配置企业模型：' + b.models.join('、') + '<br>回到 DSH 对话框即可直接使用。';
      btn.textContent = '已配置 ✓';
    } else { $('err').textContent = b.error || '登录失败'; btn.textContent = '登录并自动配置'; }
  } catch (e) { $('err').textContent = '网络错误：' + e.message; btn.textContent = '登录并自动配置'; }
  btn.disabled = false;
};
$('pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn').click(); });
(async () => { try { const s = await (await fetch('/api/enterprise/status')).json(); if (s.gateway) { $('server').value = s.gateway; } if (s.configured) { $('ok').textContent = '当前已配置：' + (s.models || []).join('、'); } } catch {} })();
</script>
</body></html>`
