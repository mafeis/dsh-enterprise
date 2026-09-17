/**
 * 深色模式配色回归守卫（0.9.6 及以前浏览器半区把浅色色值写死在代码里，
 * 宿主切深色（body[data-ds-dark-theme]）后深灰字落在深色面板上对比度仅 1.07:1，等于看不见）。
 *
 * 不变量：
 *  1. 主题令牌层必须挂在 body / body[data-ds-dark-theme]（宿主把 --dsw-alias-* 声明在 body，
 *     写成 :root 取不到宿主令牌），且模块加载即注入；
 *  2. UI 里引用的每个 --ent-* 令牌都必须在浅色块里有声明；深色块必须覆盖会翻转的那批；
 *  3. 令牌块之外不得出现任何硬编码十六进制色值（新面板忘了套令牌 → 这里直接红）；
 *  4. 三处全屏遮罩各自的 rgba 蒙层必须有深色下的对应覆盖规则；
 *  5. 独立登录页（/plugins/enterprise）必须有 prefers-color-scheme: dark 分支。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const CLIENT_DIR = join(import.meta.dirname, '..', 'src-client')
const LOGIN_PAGE = join(import.meta.dirname, '..', 'src-node', 'web', 'login-page.js')

const fragments = readdirSync(CLIENT_DIR).filter((f) => f.endsWith('.js')).sort()
const sources = Object.fromEntries(fragments.map((f) => [f, readFileSync(join(CLIENT_DIR, f), 'utf8')]))
const allSrc = fragments.map((f) => sources[f]).join('\n')

const themeSrc = sources['40-theme.js']
const THEME_CSS = (themeSrc.match(/const THEME_CSS = `([\s\S]*?)`;/) || [])[1]

test('40-theme.js 存在主题令牌层，且模块加载即挂载', () => {
	assert.ok(THEME_CSS, '缺少 const THEME_CSS = `…`; 主题令牌层')
	assert.match(themeSrc, /function mountThemeStyle\(/, '缺少 mountThemeStyle() 定义')
	// 必须被调用（只定义不注入 = 全部 var(--ent-*) 失效）
	assert.match(themeSrc, /\n\s*mountThemeStyle\(\)/, 'mountThemeStyle() 未被调用')
	assert.match(themeSrc, /document\.head\.appendChild/, '令牌层未注入 document.head')
})

test('令牌声明在 body 上（不是 :root），并提供宿主别名 + 兜底值', () => {
	assert.match(THEME_CSS, /(^|\n)\s*body\s*\{/, '浅色令牌块必须声明在 body 上')
	assert.match(THEME_CSS, /(^|\n)\s*body\[data-ds-dark-theme\]\s*\{/, '深色令牌块必须是 body[data-ds-dark-theme]')
	assert.doesNotMatch(THEME_CSS, /(^|\n)\s*:root\s*\{/, '令牌不得声明在 :root —— 宿主 --dsw-alias-* 在 body 上，:root 取不到')
	// 文字色优先跟随宿主设计令牌，保证宿主调色板变化时插件同步跟随
	for (const tok of ['--ent-fg', '--ent-fg-2', '--ent-fg-3']) {
		assert.match(
			THEME_CSS,
			new RegExp(`${tok}:\\s*var\\(--dsw-alias-label-[a-z]+,\\s*#[0-9a-f]{3,8}\\)`),
			`${tok} 应写成 var(--dsw-alias-label-*, 兜底色)`,
		)
	}
})

test('UI 引用的每个 --ent-* 令牌都已声明，深色块覆盖会翻转的那批', () => {
	const used = new Set([...allSrc.matchAll(/var\((--ent-[a-z0-9-]+)/g)].map((m) => m[1]))
	assert.ok(used.size >= 25, `--ent-* 令牌引用数异常（${used.size}），疑似令牌层被绕过`)

	const declared = (blockRe) => {
		const m = THEME_CSS.match(blockRe)
		return new Set([...(m ? m[1].matchAll(/(--ent-[a-z0-9-]+)\s*:/g) : [])].map((x) => x[1]))
	}
	const light = declared(/(?:^|\n)\s*body\s*\{([\s\S]*?)\n\s*\}/)
	const dark = declared(/(?:^|\n)\s*body\[data-ds-dark-theme\]\s*\{([\s\S]*?)\n\s*\}/)

	for (const tok of used) {
		assert.ok(light.has(tok), `令牌 ${tok} 被引用但浅色块未声明`)
	}
	// 深色下必须翻转的令牌（不翻转的走宿主别名自动跟随，不在此列）
	for (const tok of ['--ent-line', '--ent-box', '--ent-input-bg', '--ent-accent', '--ent-accent-ink',
		'--ent-ok', '--ent-bad', '--ent-warn', '--ent-notice', '--ent-shadow', '--ent-wm-color']) {
		assert.ok(dark.has(tok), `深色块缺少 ${tok} 覆盖`)
	}
})

test('令牌块之外不得出现硬编码色值（新代码必须套 --ent-* 令牌）', () => {
	const HEX = /#[0-9a-fA-F]{3,8}\b/g
	for (const f of fragments) {
		// 从 40-theme.js 里剔除令牌块本身
		const body = f === '40-theme.js' ? sources[f].replace(THEME_CSS, '') : sources[f]
		const hits = body.match(HEX)
		assert.equal(hits, null, `${f} 含硬编码色值 ${hits}：请改用 var(--ent-*)`)
	}
})

test('三处全屏遮罩的 rgba 蒙层都有深色覆盖', () => {
	for (const f of ['15-violation-overlay.js', '20-login-overlay.js', '60-confirm-dialog.js']) {
		const src = sources[f]
		assert.match(src, /background:\s*rgba\(/, `${f} 缺少蒙层`)
		assert.match(src, /body\[data-ds-dark-theme\]\s+#[a-z-]+\s*\{[^}]*rgba\(/,
			`${f} 的蒙层缺少 body[data-ds-dark-theme] 深色覆盖`)
	}
})

test('独立登录页（/plugins/enterprise）有深色分支且输入框显式配色', () => {
	const html = readFileSync(LOGIN_PAGE, 'utf8')
	assert.match(html, /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/, '登录页缺少深色分支')
	assert.match(html, /color-scheme:\s*dark/, '登录页缺少 color-scheme: dark（原生控件/滚动条仍走浅色）')
	assert.match(html, /::placeholder/, '登录页输入框缺少占位符配色')
})
