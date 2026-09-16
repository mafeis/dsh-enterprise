		/* ============ 自定义确认对话框（替代浏览器 confirm） ============ */
		/* 全屏遮罩 + 白卡片，与登录遮罩同一视觉语言；Promise 风格：confirmDialog({title, message, confirmText}) → true/false */

		function mountConfirmDialog({ title, message, confirmText, cancelText }) {
			return new Promise((resolve) => {
				const overlay = document.createElement("div");
				overlay.id = "enterprise-confirm-overlay";
				overlay.innerHTML = `
<style>
#enterprise-confirm-overlay { position: fixed; inset: 0; z-index: 2147483600; background: rgba(15,23,42,.5);
  display: flex; align-items: center; justify-content: center; backdrop-filter: blur(3px);
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif; }
#enterprise-confirm-overlay .box { background: #fff; border-radius: 14px; padding: 24px 26px 20px; width: min(360px, 90vw);
  box-shadow: 0 24px 70px rgba(0,0,0,.28); color: #1f2937; }
#enterprise-confirm-overlay h3 { margin: 0 0 10px; font-size: 16px; display: flex; align-items: center; gap: 9px; }
#enterprise-confirm-overlay .warn-ico { width: 30px; height: 30px; border-radius: 50%; background: rgba(220,38,38,.1);
  color: #dc2626; display: inline-flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 700; flexShrink: 0; }
#enterprise-confirm-overlay .msg { font-size: 13px; line-height: 1.7; color: #4b5563; margin: 0 0 20px; }
#enterprise-confirm-overlay .btns { display: flex; gap: 10px; justify-content: flex-end; }
#enterprise-confirm-overlay button { padding: 8px 18px; font-size: 13px; border-radius: 8px; cursor: pointer; font-family: inherit; }
#enterprise-confirm-overlay .cancel { border: 1px solid #e6eaf1; background: #fff; color: #374151; }
#enterprise-confirm-overlay .cancel:hover { background: #f6f8fb; }
#enterprise-confirm-overlay .ok { border: none; background: #dc2626; color: #fff; }
#enterprise-confirm-overlay .ok:hover { background: #b91c1c; }
</style>
<div class="box">
  <h3><span class="warn-ico">!</span><span>${esc(title || t2("确认操作", "Confirm"))}</span></h3>
  <p class="msg">${esc(message || "")}</p>
  <div class="btns">
    <button class="cancel">${esc(cancelText || t2("取消", "Cancel"))}</button>
    <button class="ok">${esc(confirmText || t2("确定", "OK"))}</button>
  </div>
</div>`;
				document.body.appendChild(overlay);
				const done = (v) => { overlay.remove(); resolve(v); };
				overlay.querySelector(".cancel").addEventListener("click", () => done(false));
				overlay.querySelector(".ok").addEventListener("click", () => done(true));
				// 点遮罩空白 = 取消；Esc = 取消
				overlay.addEventListener("click", (e) => { if (e.target === overlay) done(false); });
				const onKey = (e) => { if (e.key === "Escape") { document.removeEventListener("keydown", onKey); done(false); } };
				document.addEventListener("keydown", onKey);
				overlay.querySelector(".ok").focus();
			});
		}
