		/* ============ HTTP 工具 ============ */

		async function apiGet(path) { const r = await fetch(path); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }
		async function apiPost(path, body) {
			const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
			return r.json();
		}
