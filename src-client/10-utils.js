		/* ============ 通用小工具 ============ */

		function esc(s) {
			return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
		}

		function fmtNum(n) { return Number(n || 0).toLocaleString(); }
