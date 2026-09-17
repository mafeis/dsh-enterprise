		/* ============ 全屏登录遮罩（未配置时自动弹出） ============ */

		async function mountLoginOverlay() {
			// 预填网关地址：上次使用（state.gateway 登出/清场后保留）→ 出厂默认（ENT_GATEWAY_URL / gateway-url.txt）：新机零输入
			let lastGateway = "";
			try {
				const r = await fetch("/api/enterprise/status", { headers: { accept: "application/json" } });
				if (r.ok) {
					const s = await r.json();
					lastGateway = (s && (s.gateway || s.lastGateway || s.factoryGateway)) || "";
				}
			} catch {}
			const overlay = document.createElement("div");
			overlay.id = "enterprise-overlay";
			overlay.innerHTML = `
<style>
#enterprise-overlay { position: fixed; inset: 0; z-index: 2147483000; background: rgba(15,23,42,.55);
  display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px);
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif; }
#enterprise-overlay .box { background: #fff; border-radius: 14px; padding: 30px 32px; width: min(380px, 92vw);
  box-shadow: 0 24px 70px rgba(0,0,0,.28); color: #1f2937; font-size: 14px; line-height: 1.7; }
#enterprise-overlay h2 { font-size: 18px; margin: 0 0 4px; }
#enterprise-overlay .sub { font-size: 12.5px; color: #6b7280; margin-bottom: 18px; }
#enterprise-overlay input { width: 100%; border: 1px solid #e6eaf1; border-radius: 9px; padding: 9px 13px; font-size: 14px; margin-bottom: 12px; font-family: inherit; outline: none; transition: border .15s; box-sizing: border-box; }
#enterprise-overlay input:focus { border-color: #2563eb; }
#enterprise-overlay button { width: 100%; padding: 10px; font-size: 14px; border: none; border-radius: 9px;
  background: #2563eb; color: #fff; cursor: pointer; font-family: inherit; }
#enterprise-overlay button:disabled { opacity: .6; cursor: default; }
#enterprise-overlay .err { color: #dc2626; font-size: 12.5px; min-height: 20px; margin-bottom: 6px; }
#enterprise-overlay .ok { color: #059669; font-size: 13px; min-height: 18px; }
#enterprise-overlay .lockhint { margin-top: 10px; text-align: center; font-size: 12px; color: #94a3b8; }
</style>
<div class="box">
  <h2>${t2("企业账号登录", "Enterprise sign-in")}</h2>
  <div class="sub">${t2("登录后自动配置企业模型网关，无需手工设置", "Sign in to auto-configure the enterprise model gateway")}</div>
  <div class="err" id="enterprise-err"></div>
  <input id="enterprise-server" placeholder="${t2("网关地址", "Gateway URL")}" value="${lastGateway.replace(/"/g, "&quot;")}">
  <input id="enterprise-user" placeholder="${t2("账号", "Account")}" autocomplete="username">
  <input id="enterprise-pass" placeholder="${t2("密码", "Password")}" type="password" autocomplete="currenterprise-password">
  <button id="enterprise-btn">${t2("登录并自动配置", "Sign in & auto-configure")}</button>
  <div class="ok" id="enterprise-ok"></div>
  <div class="lockhint">${t2("企业管控：本机由企业账号统一管理，登录后方可使用", "Enterprise managed: sign in with your enterprise account to use this device")}</div>
</div>`;
			document.body.appendChild(overlay);

			const $ = (id) => overlay.querySelector("#" + id);
			const btn = $("enterprise-btn");

			const submit = async () => {
				btn.disabled = true;
				btn.textContent = t2("登录中…", "Signing in…");
				$("enterprise-err").textContent = "";
				$("enterprise-ok").textContent = "";
				try {
					const r = await fetch("/api/enterprise/login", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							server: $("enterprise-server").value.trim() || undefined,
							username: $("enterprise-user").value.trim(),
							password: $("enterprise-pass").value
						})
					});
					const b = await r.json();
					if (b.ok) {
						// 配置经 settings watch 热生效，无需重启；若 Desktop 首启向导还挂着
						//（旧安装未预写 skipped 标记），提示用户直接关掉即可，模型已可用。
						$("enterprise-ok").innerHTML = t2("✓ 登录成功，模型已就绪", "✓ Signed in, models ready");
						btn.textContent = t2("已配置 ✓", "Configured ✓");
						setTimeout(() => location.reload(), 2600);
						return;
					}
					$("enterprise-err").textContent = b.error || t2("登录失败", "Sign-in failed");
				} catch (e) {
					$("enterprise-err").textContent = t2("网络错误：", "Network error: ") + (e && e.message ? e.message : e);
				}
				btn.disabled = false;
				btn.textContent = t2("登录并自动配置", "Sign in & auto-configure");
			};
			btn.addEventListener("click", submit);
			$("enterprise-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
			$("enterprise-user").focus();
		}
