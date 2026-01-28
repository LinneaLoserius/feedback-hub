/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

interface Env {
	DB: D1Database;
	AI: {
		run(model: string, input: unknown): Promise<unknown>;
	};
	ENVIRONMENT?: string;
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(body), {
		...init,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			...(init?.headers ?? {}),
		},
	});
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

type FeedbackAnalysis = {
	sentiment: 'positive' | 'neutral' | 'negative';
	urgency: number;
	theme: string;
	summary: string;
};

function truncate(value: string, maxLen: number): string {
	if (value.length <= maxLen) return value;
	return value.slice(0, maxLen - 1).trimEnd() + '…';
}

async function analyzeFeedback(env: Env, text: string): Promise<FeedbackAnalysis> {
	const fallback: FeedbackAnalysis = {
		sentiment: 'neutral',
		urgency: 50,
		theme: 'unknown',
		summary: truncate(text.replaceAll(/\s+/g, ' ').trim(), 160),
	};

	let aiResult: unknown;
	try {
		aiResult = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
			messages: [
				{
					role: 'system',
					content:
						'You are a strict JSON generator. Return ONLY a single JSON object (no markdown, no code fences, no extra text). Keys: sentiment ("positive"|"neutral"|"negative"), urgency (integer 0-100), theme (short label), summary (1-2 lines).\n\nUrgency rubric:\n0-20 = suggestion / nice-to-have / praise\n21-40 = minor UX issue / unclear docs / low impact workaround exists\n41-60 = noticeable bug / moderate impact / partial workaround\n61-80 = major bug / blocks key workflow for multiple users / time-sensitive\n81-100 = outage/security/data loss/billing block/legal/compliance emergency\n\nOnly use 80+ when it truly matches outage/security/billing-blocker. Otherwise choose a lower band. Aim to use the full scale; don\'t default to 80.',
				},
				{ role: 'user', content: text },
			],
		});
	} catch {
		return fallback;
	}

	const raw =
		typeof aiResult === 'string'
			? aiResult
			: typeof (aiResult as any)?.response === 'string'
				? (aiResult as any).response
				: JSON.stringify(aiResult);

	const jsonTextMatch = raw.match(/\{[\s\S]*\}/);
	if (!jsonTextMatch) return fallback;

	let parsed: any;
	try {
		parsed = JSON.parse(jsonTextMatch[0]);
	} catch {
		return fallback;
	}

	const sentiment =
		parsed?.sentiment === 'positive' || parsed?.sentiment === 'negative' || parsed?.sentiment === 'neutral'
			? parsed.sentiment
			: fallback.sentiment;

	const urgencyRaw = typeof parsed?.urgency === 'number' ? parsed.urgency : Number(parsed?.urgency);
	const urgency = Number.isFinite(urgencyRaw)
		? Math.max(0, Math.min(100, Math.round(urgencyRaw)))
		: fallback.urgency;

	const theme = typeof parsed?.theme === 'string' && parsed.theme.trim() ? parsed.theme.trim() : fallback.theme;
	const summary =
		typeof parsed?.summary === 'string' && parsed.summary.trim()
			? truncate(parsed.summary.trim(), 220)
			: fallback.summary;

	return { sentiment, urgency, theme, summary };
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		switch (url.pathname) {
			case '/admin/seed': {
				if (env.ENVIRONMENT === 'production') {
					return new Response('Not Found', { status: 404 });
				}
				if (url.searchParams.get('token') !== 'dev') {
					return jsonResponse({ error: 'Forbidden' }, { status: 403 });
				}
				if (request.method !== 'POST') {
					return jsonResponse(
						{ error: 'Method Not Allowed' },
						{ status: 405, headers: { allow: 'POST' } }
					);
				}

				const mock: Array<{ source: string; title: string; body: string }> = [
					{
						source: 'Support',
						title: 'Billing invoice doesn\'t match usage totals',
						body: 'Our invoice is higher than the dashboard usage summary. Please clarify proration, overages, and whether taxes are included. This is blocking finance approval.',
					},
					{
						source: 'Discord',
						title: 'Rate limits feel too aggressive',
						body: 'We\'re getting 429s at low volume during normal usage. The docs aren\'t clear on per-IP vs per-token limits. Is there a way to raise limits for paid plans?',
					},
					{
						source: 'GitHub',
						title: 'API returns 500 on specific payload',
						body: 'When sending a JSON body with nested arrays, the API intermittently returns 500. Request IDs attached. Looks like a validation edge case. We need a fix ASAP.',
					},
					{
						source: 'Email',
						title: 'Docs missing example for webhook signature verification',
						body: 'The documentation explains signatures conceptually but doesn\'t include runnable examples for Node/Python. We wasted hours implementing this. Please add copy-pastable snippets.',
					},
					{
						source: 'Twitter/X',
						title: 'Dashboard UX is confusing for new users',
						body: 'The onboarding flow is unclear and settings are scattered. I couldn\'t find where to rotate API keys. The UI feels slow and toggles don\'t explain impact.',
					},
					{
						source: 'Forum',
						title: 'WAF false positives blocking legitimate traffic',
						body: 'Our login endpoint is being challenged unexpectedly. We\'re seeing legitimate users blocked. Need better visibility into which rule triggered and how to tune safely.',
					},
					{
						source: 'Support',
						title: 'Cannot export logs for incident review',
						body: 'We had a production outage and need to export logs for a 24h window. The export feature times out and there\'s no API alternative. This is urgent for compliance.',
					},
					{
						source: 'Discord',
						title: 'Docs unclear on retry/backoff behavior',
						body: 'Is the client expected to retry 5xx? Are there idempotency keys? We\'re getting duplicate writes. Please document recommended retry strategy and safe patterns.',
					},
					{
						source: 'GitHub',
						title: 'SDK throws on network blips',
						body: 'The official SDK doesn\'t handle transient network errors well; it crashes our worker. Suggest adding configurable retries and better error messages.',
					},
					{
						source: 'Email',
						title: 'Need clearer billing tiers and limits',
						body: 'Pricing page says \"fair use\" but doesn\'t specify limits. We need explicit quotas per plan for procurement. Otherwise we can\'t sign off.',
					},
					{
						source: 'Support',
						title: 'API error messages too generic',
						body: 'We get \"invalid request\" without field-level details. Please return which field failed and expected format. It slows down integration a lot.',
					},
					{
						source: 'Forum',
						title: 'Dashboard filters reset unexpectedly',
						body: 'Every time I navigate back, my selected filters are lost. It makes triaging issues painful. Please persist filter state in the URL or local storage.',
					},
					{
						source: 'Discord',
						title: 'Rate limit headers missing',
						body: 'If we\'re being throttled, can you return standard rate limit headers (limit/remaining/reset)? Right now we can\'t adapt behavior automatically.',
					},
					{
						source: 'Twitter/X',
						title: 'Love the product, but docs need polish',
						body: 'Overall great experience. The docs are close, but some pages have outdated parameter names and broken links. A quick sweep would make onboarding smoother.',
					},
					{
						source: 'GitHub',
						title: 'WAF configuration API returns 403 unexpectedly',
						body: 'We are authenticated but some endpoints return 403 with no explanation. Might be permission scoping bug. Please provide better diagnostics.',
					},
					{
						source: 'Support',
						title: 'Need audit trail for key changes',
						body: 'We require an audit log showing who rotated keys and when. This is a blocker for enterprise rollout.',
					},
					{
						source: 'Forum',
						title: 'API returns 429 with long recovery time',
						body: 'Once we hit a limit, traffic stays throttled for minutes. Can we get a shorter reset window or an explicit reset timestamp? This is hurting user experience.',
					},
					{
						source: 'Email',
						title: 'Docs: examples for pagination are missing',
						body: 'The API supports pagination but the docs don\'t show best practices. Please include examples of iterating pages safely and handling cursors.',
					},
					{
						source: 'Discord',
						title: 'Dashboard feels slow under load',
						body: 'When we have many events, the dashboard takes 10+ seconds to load. Even basic tables lag. Any plans for performance improvements or bulk endpoints?',
					},
					{
						source: 'Support',
						title: 'Billing: need purchase order support',
						body: 'We can\'t pay by card. Please support POs or invoicing. This is urgent for our procurement process and renewal.',
					},
					{
						source: 'GitHub',
						title: 'API error: invalid signature, but signature is correct',
						body: 'Webhook verification fails in production but passes locally. We suspect whitespace/canonicalization issues. Please document exact signing format and provide test vectors.',
					},
					{
						source: 'Forum',
						title: 'WAF challenges break mobile app login',
						body: 'Our mobile clients can\'t complete challenges and users get stuck. Need guidance on bypass rules or alternative protection modes.',
					},
					{
						source: 'Twitter/X',
						title: 'Great support experience',
						body: 'Shoutout to support for quick turnaround and clear explanations. Keep it up! The product is improving fast.',
					},
					{
						source: 'Email',
						title: 'Docs: clarify error codes and troubleshooting',
						body: 'Please add a troubleshooting page mapping common errors (400/401/403/429/5xx) to causes and fixes. Right now we\'re guessing.',
					},
					{
						source: 'Support',
						title: 'Dashboard UX: need bulk actions',
						body: 'We need to triage dozens of items at once (assign, tag, close). Clicking one by one is painful. Bulk actions would save a lot of time.',
					},
				];

				let insertedCount = 0;
				for (const item of mock) {
					const createdAt = new Date().toISOString();
					const inserted = await env.DB.prepare(
						'INSERT INTO feedback (source, title, body, created_at) VALUES (?, ?, ?, ?) RETURNING id, title, body'
					)
						.bind(item.source, item.title, item.body, createdAt)
						.first();

					const id = (inserted as any)?.id;
					if (typeof id === 'number') {
						const title = String((inserted as any)?.title ?? item.title);
						const body = String((inserted as any)?.body ?? item.body);
						const analysis = await analyzeFeedback(env, `${title}\n${body}`);
						await env.DB.prepare(
							'UPDATE feedback SET sentiment = ?, urgency = ?, theme = ?, summary = ? WHERE id = ?'
						)
							.bind(analysis.sentiment, analysis.urgency, analysis.theme, analysis.summary, id)
							.run();
						insertedCount += 1;
					}
				}

				return jsonResponse({ inserted: insertedCount });
			}
			case '/admin/analyze_all': {
				if (env.ENVIRONMENT === 'production') {
					return new Response('Not Found', { status: 404 });
				}
				if (url.searchParams.get('token') !== 'dev') {
					return jsonResponse({ error: 'Forbidden' }, { status: 403 });
				}
				if (request.method !== 'POST') {
					return jsonResponse(
						{ error: 'Method Not Allowed' },
						{ status: 405, headers: { allow: 'POST' } }
					);
				}

				const { results } = await env.DB.prepare(
					"SELECT id, title, body FROM feedback WHERE (theme IS NULL OR theme = '' OR theme = 'unknown') OR (sentiment IS NULL OR sentiment = '' OR sentiment = 'neutral') OR (urgency IS NULL OR urgency = 50) OR (summary IS NULL OR summary = '') ORDER BY id ASC LIMIT 10"
				).all();

				const updatedIds: number[] = [];
				for (const row of results ?? []) {
					const id = (row as any)?.id;
					const title = String((row as any)?.title ?? '');
					const body = String((row as any)?.body ?? '');
					if (typeof id !== 'number') continue;

					const analysis = await analyzeFeedback(env, `${title}\n${body}`);
					await env.DB.prepare(
						'UPDATE feedback SET sentiment = ?, urgency = ?, theme = ?, summary = ? WHERE id = ?'
					)
						.bind(analysis.sentiment, analysis.urgency, analysis.theme, analysis.summary, id)
						.run();
					updatedIds.push(id);
				}

				return jsonResponse({ processed: updatedIds.length, updated_ids: updatedIds });
			}
			case '/': {
				const selectedTheme = (url.searchParams.get('theme') ?? '').trim();
				const selectedSentiment = (url.searchParams.get('sentiment') ?? '').trim();
				const minUrgencyParam = (url.searchParams.get('minUrgency') ?? '').trim();
				const minUrgencyRaw = minUrgencyParam ? Number(minUrgencyParam) : 0;
				const minUrgency = Number.isFinite(minUrgencyRaw) ? Math.max(0, Math.min(100, Math.floor(minUrgencyRaw))) : 0;

				const allowedSentiments = new Set(['positive', 'neutral', 'negative']);
				const sentimentFilter = allowedSentiments.has(selectedSentiment) ? selectedSentiment : '';

				const baseWhere: string[] = [];
				const baseBinds: unknown[] = [];
				if (selectedTheme) {
					baseWhere.push('theme = ?');
					baseBinds.push(selectedTheme);
				}
				if (sentimentFilter) {
					baseWhere.push('sentiment = ?');
					baseBinds.push(sentimentFilter);
				}
				if (minUrgency > 0) {
					baseWhere.push('urgency IS NOT NULL AND urgency >= ?');
					baseBinds.push(minUrgency);
				}
				const baseWhereSql = baseWhere.length ? `WHERE ${baseWhere.join(' AND ')}` : '';

				const themeOptions = await env.DB.prepare(
					"SELECT theme FROM feedback WHERE theme IS NOT NULL AND theme != '' GROUP BY theme ORDER BY theme ASC"
				).all();

				const kpis = await env.DB.prepare(
					`SELECT
						COUNT(*) AS total,
						SUM(CASE WHEN sentiment = 'negative' THEN 1 ELSE 0 END) AS negative_count,
						SUM(CASE WHEN sentiment = 'neutral' THEN 1 ELSE 0 END) AS neutral_count,
						AVG(CASE WHEN urgency IS NOT NULL THEN urgency END) AS avg_urgency
					FROM feedback ${baseWhereSql}`
				)
					.bind(...baseBinds)
					.first();

				const topThemesWhere = [...baseWhere];
				const topThemesBinds = [...baseBinds];
				topThemesWhere.push("theme IS NOT NULL AND theme != ''");
				const topThemesWhereSql = `WHERE ${topThemesWhere.join(' AND ')}`;
				const topThemes = await env.DB.prepare(
					`SELECT theme, COUNT(*) as count FROM feedback ${topThemesWhereSql} GROUP BY theme ORDER BY count DESC LIMIT 8`
				)
					.bind(...topThemesBinds)
					.all();

				const sentimentWhere = [...baseWhere];
				const sentimentBinds = [...baseBinds];
				sentimentWhere.push("sentiment IS NOT NULL AND sentiment != ''");
				const sentimentWhereSql = `WHERE ${sentimentWhere.join(' AND ')}`;
				const sentimentBreakdown = await env.DB.prepare(
					`SELECT sentiment, COUNT(*) as count FROM feedback ${sentimentWhereSql} GROUP BY sentiment`
				)
					.bind(...sentimentBinds)
					.all();

				const urgentWhere = [...baseWhere];
				const urgentBinds = [...baseBinds];
				urgentWhere.push('urgency IS NOT NULL');
				const urgentWhereSql = `WHERE ${urgentWhere.join(' AND ')}`;
				const mostUrgent = await env.DB.prepare(
					`SELECT id, title, source, created_at, urgency, theme, sentiment FROM feedback ${urgentWhereSql} ORDER BY urgency DESC LIMIT 8`
				)
					.bind(...urgentBinds)
					.all();

				const recent = await env.DB.prepare(
					`SELECT id, source, title, body, created_at, sentiment, urgency, theme, summary FROM feedback ${baseWhereSql} ORDER BY id DESC LIMIT 15`
				)
					.bind(...baseBinds)
					.all();

				const total = Number((kpis as any)?.total ?? 0);
				const negativeCount = Number((kpis as any)?.negative_count ?? 0);
				const neutralCount = Number((kpis as any)?.neutral_count ?? 0);
				const negativePct = total > 0 ? Math.round((negativeCount / total) * 100) : 0;
				const neutralPct = total > 0 ? Math.round((neutralCount / total) * 100) : 0;
				const avgUrgencyRaw = Number((kpis as any)?.avg_urgency);
				const avgUrgency = Number.isFinite(avgUrgencyRaw) ? Math.round(avgUrgencyRaw) : 0;

				const topThemesHtml = (topThemes.results ?? [])
					.map((row: any) => {
						const theme = escapeHtml(String(row.theme ?? ''));
						const count = escapeHtml(String(row.count ?? ''));
						return `<div class="row"><div class="label">${theme || 'unknown'}</div><div class="muted">${count}</div></div>`;
					})
					.join('');

				const sentimentRows = (sentimentBreakdown.results ?? []).map((r: any) => ({
					sentiment: String(r.sentiment ?? ''),
					count: Number(r.count ?? 0),
				}));
				const sentimentMax = Math.max(1, ...sentimentRows.map((r) => r.count));
				const sentimentBarsHtml = sentimentRows
					.map((r) => {
						const sentiment = escapeHtml(r.sentiment || 'unknown');
						const count = escapeHtml(String(r.count));
						const width = Math.round((r.count / sentimentMax) * 100);
						const cls = r.sentiment === 'negative' ? 'bar-neg' : r.sentiment === 'positive' ? 'bar-pos' : 'bar-neu';
						return `<div class="barRow"><div class="barLabel">${sentiment}</div><div class="barTrack"><div class="barFill ${cls}" style="width: ${width}%"></div></div><div class="barCount">${count}</div></div>`;
					})
					.join('');

				const urgentRowsHtml = (mostUrgent.results ?? [])
					.map((row: any) => {
						const urgency = Number(row.urgency ?? 0);
						const urgencyText = escapeHtml(String(urgency));
						const title = escapeHtml(String(row.title ?? ''));
						const source = escapeHtml(String(row.source ?? ''));
						const theme = escapeHtml(String(row.theme ?? ''));
						const createdAt = escapeHtml(String(row.created_at ?? ''));
						const sentiment = String(row.sentiment ?? '');
						const sentimentClass =
							sentiment === 'negative' ? 'badge-neg' : sentiment === 'positive' ? 'badge-pos' : 'badge-neu';
						const urgencyClass = urgency >= 80 ? 'badge-urg-5' : urgency >= 60 ? 'badge-urg-4' : urgency >= 40 ? 'badge-urg-3' : urgency >= 20 ? 'badge-urg-2' : 'badge-urg-1';
						return `<tr class="${urgency >= 70 ? 'urgentRow' : ''}"><td><span class="badge ${urgencyClass}">${urgencyText}</span></td><td><span class="badge ${sentimentClass}">${escapeHtml(sentiment || 'neutral')}</span></td><td class="muted">${theme || 'unknown'}</td><td class="muted">${source}</td><td><strong>${title}</strong><div class="muted small">${createdAt}</div></td></tr>`;
					})
					.join('');

				const recentHtml = (recent.results ?? [])
					.map((row: any) => {
						const id = escapeHtml(String(row.id ?? ''));
						const source = escapeHtml(String(row.source ?? ''));
						const title = escapeHtml(String(row.title ?? ''));
						const createdAt = escapeHtml(String(row.created_at ?? ''));
						const theme = escapeHtml(String(row.theme ?? ''));
						const sentiment = String(row.sentiment ?? '');
						const urgency = Number(row.urgency ?? 0);
						const urgencyText = escapeHtml(String(row.urgency ?? ''));
						const summary = escapeHtml(String(row.summary ?? ''));
						const body = escapeHtml(String(row.body ?? ''));

						const sentimentClass =
							sentiment === 'negative' ? 'badge-neg' : sentiment === 'positive' ? 'badge-pos' : 'badge-neu';
						const urgencyClass = urgency >= 80 ? 'badge-urg-5' : urgency >= 60 ? 'badge-urg-4' : urgency >= 40 ? 'badge-urg-3' : urgency >= 20 ? 'badge-urg-2' : 'badge-urg-1';
						return `<details class="item"><summary class="itemSummary"><div class="itemMain"><div class="itemTitle"><strong>${title}</strong></div><div class="muted small">${source} · ${createdAt} · Theme: ${theme || 'unknown'}</div></div><div class="itemBadges"><span class="badge ${sentimentClass}">${escapeHtml(sentiment || 'neutral')}</span><span class="badge ${urgencyClass}">${urgencyText || '50'}</span></div></summary><div class="itemBody"><div class="muted small">Row #${id}</div><div class="block"><div class="muted small">Summary</div><div>${summary || '<span class="muted">(none)</span>'}</div></div><div class="block"><div class="muted small">Body</div><div class="mono">${body}</div></div></div></details>`;
					})
					.join('');

				const themeOptionsHtml = (themeOptions.results ?? [])
					.map((row: any) => {
						const t = String(row.theme ?? '').trim();
						if (!t) return '';
						const esc = escapeHtml(t);
						const selected = t === selectedTheme ? ' selected' : '';
						return `<option value="${esc}"${selected}>${esc}</option>`;
					})
					.join('');

				const selectedMinUrgency = String(minUrgencyParam || '0');
				const minUrgencyOptions = [
					{ v: '0', label: 'Any' },
					{ v: '20', label: '20+' },
					{ v: '40', label: '40+' },
					{ v: '60', label: '60+' },
					{ v: '80', label: '80+' },
				];
				const minUrgencyOptionsHtml = minUrgencyOptions
					.map((o) => `<option value="${o.v}"${o.v === selectedMinUrgency ? ' selected' : ''}>${o.label}</option>`)
					.join('');

				const sentimentOptions = [
					{ v: '', label: 'Any' },
					{ v: 'negative', label: 'Negative' },
					{ v: 'neutral', label: 'Neutral' },
					{ v: 'positive', label: 'Positive' },
				];
				const sentimentOptionsHtml = sentimentOptions
					.map((o) => `<option value="${o.v}"${o.v === sentimentFilter ? ' selected' : ''}>${o.label}</option>`)
					.join('');

				const html = `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>Feedback Hub</title>
	<style>
		:root {
			--bg: #0b0f19;
			--panel: rgba(255, 255, 255, 0.06);
			--border: rgba(255, 255, 255, 0.10);
			--text: rgba(255, 255, 255, 0.92);
			--muted: rgba(255, 255, 255, 0.62);
			--muted2: rgba(255, 255, 255, 0.42);
			--accent: #7c3aed;
			--shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
			--radius: 14px;
		}
		* { box-sizing: border-box; }
		body {
			margin: 0;
			background: radial-gradient(1200px 600px at 20% 0%, rgba(124, 58, 237, 0.35), transparent 60%),
				linear-gradient(180deg, #070a12, #0b0f19);
			color: var(--text);
			font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
		}
		a { color: inherit; }
		.container { max-width: 1100px; margin: 40px auto; padding: 0 16px; }
		.header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
		.hTitle { font-size: 28px; margin: 0; letter-spacing: -0.02em; }
		.hSub { margin: 6px 0 0; color: var(--muted); font-size: 14px; }
		.btn {
			display: inline-flex; align-items: center; gap: 8px;
			padding: 10px 14px; border-radius: 12px;
			background: linear-gradient(180deg, rgba(124,58,237,0.95), rgba(124,58,237,0.75));
			border: 1px solid rgba(255,255,255,0.14);
			text-decoration: none;
			box-shadow: var(--shadow);
			font-weight: 600;
		}
		.grid { display: grid; gap: 12px; }
		.kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
		.row2 { grid-template-columns: 1.2fr 1fr; }
		@media (max-width: 980px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .row2 { grid-template-columns: 1fr; } }
		.card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; box-shadow: var(--shadow); }
		.card h2 { margin: 0 0 10px; font-size: 14px; color: var(--muted); font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; }
		.kpiValue { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
		.kpiHint { margin-top: 6px; font-size: 12px; color: var(--muted2); }
		.muted { color: var(--muted); }
		.small { font-size: 12px; }
		.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
		.filterBar {
			display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
			margin: 10px 0 12px;
			padding: 12px;
			border-radius: var(--radius);
			background: rgba(255,255,255,0.04);
			border: 1px solid var(--border);
		}
		.field { display: flex; flex-direction: column; gap: 6px; min-width: 160px; }
		label { font-size: 12px; color: var(--muted); }
		select {
			background: rgba(0,0,0,0.18);
			border: 1px solid rgba(255,255,255,0.14);
			color: var(--text);
			border-radius: 10px;
			padding: 8px 10px;
			outline: none;
		}
		.hr { height: 1px; background: rgba(255,255,255,0.08); margin: 12px 0; }
		.row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.08); }
		.row:last-child { border-bottom: none; }
		.label { font-weight: 600; }
		.barRow { display: grid; grid-template-columns: 90px 1fr 40px; align-items: center; gap: 10px; margin: 8px 0; }
		.barLabel { color: var(--muted); font-size: 12px; }
		.barTrack { height: 10px; background: rgba(255,255,255,0.10); border-radius: 999px; overflow: hidden; }
		.barFill { height: 100%; border-radius: 999px; }
		.barNeg { background: rgba(239, 68, 68, 0.85); }
		.barNeu { background: rgba(245, 158, 11, 0.85); }
		.barPos { background: rgba(34, 197, 94, 0.85); }
		.barCount { color: var(--muted); font-size: 12px; text-align: right; }
		table { width: 100%; border-collapse: separate; border-spacing: 0; }
		th { text-align: left; font-size: 12px; color: var(--muted); font-weight: 600; padding: 10px 10px; border-bottom: 1px solid rgba(255,255,255,0.10); }
		td { padding: 10px 10px; border-bottom: 1px solid rgba(255,255,255,0.06); vertical-align: top; }
		.urgentRow td { border-left: 3px solid rgba(239,68,68,0.9); }
		.badge {
			display: inline-flex; align-items: center; justify-content: center;
			padding: 4px 8px;
			border-radius: 999px;
			font-size: 12px;
			font-weight: 700;
			border: 1px solid rgba(255,255,255,0.12);
		}
		.badge-neg { background: rgba(239, 68, 68, 0.18); color: rgba(255, 225, 225, 0.95); }
		.badge-neu { background: rgba(245, 158, 11, 0.18); color: rgba(255, 242, 210, 0.95); }
		.badge-pos { background: rgba(34, 197, 94, 0.18); color: rgba(220, 255, 235, 0.95); }
		.badge-urg-1 { background: rgba(148,163,184,0.18); color: rgba(255,255,255,0.88); }
		.badge-urg-2 { background: rgba(59,130,246,0.18); color: rgba(220,235,255,0.95); }
		.badge-urg-3 { background: rgba(245,158,11,0.18); color: rgba(255,242,210,0.95); }
		.badge-urg-4 { background: rgba(249,115,22,0.22); color: rgba(255,230,210,0.95); }
		.badge-urg-5 { background: rgba(239,68,68,0.22); color: rgba(255,225,225,0.95); }
		.item { border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.04); border-radius: 12px; margin-bottom: 10px; overflow: hidden; }
		.itemSummary { list-style: none; cursor: pointer; display: flex; gap: 12px; justify-content: space-between; padding: 12px 12px; }
		.itemSummary::-webkit-details-marker { display: none; }
		.itemMain { min-width: 0; }
		.itemTitle { margin-bottom: 4px; }
		.itemBadges { display: flex; gap: 8px; align-items: flex-start; }
		.itemBody { padding: 12px 12px; border-top: 1px solid rgba(255,255,255,0.08); }
		.block { margin-top: 10px; }
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<div>
				<h1 class="hTitle">Feedback Hub</h1>
				<div class="hSub">Scannable insights and triage-ready feedback.</div>
			</div>
			<a class="btn" href="/submit">Submit feedback</a>
		</div>

		<form class="filterBar" method="GET" action="/">
			<div class="field">
				<label for="theme">Theme</label>
				<select id="theme" name="theme" onchange="this.form.submit()">
					<option value=""${selectedTheme ? '' : ' selected'}>Any</option>
					${themeOptionsHtml}
				</select>
			</div>
			<div class="field">
				<label for="sentiment">Sentiment</label>
				<select id="sentiment" name="sentiment" onchange="this.form.submit()">
					${sentimentOptionsHtml}
				</select>
			</div>
			<div class="field">
				<label for="minUrgency">Min urgency</label>
				<select id="minUrgency" name="minUrgency" onchange="this.form.submit()">
					${minUrgencyOptionsHtml}
				</select>
			</div>
			<noscript><button type="submit" class="btn" style="padding: 8px 12px;">Apply</button></noscript>
		</form>

		<div class="grid kpis">
			<div class="card"><h2>Total feedback</h2><div class="kpiValue">${escapeHtml(String(total))}</div><div class="kpiHint">With current filters</div></div>
			<div class="card"><h2>Negative %</h2><div class="kpiValue">${escapeHtml(String(negativePct))}%</div><div class="kpiHint">${escapeHtml(String(negativeCount))} / ${escapeHtml(String(total))}</div></div>
			<div class="card"><h2>Neutral %</h2><div class="kpiValue">${escapeHtml(String(neutralPct))}%</div><div class="kpiHint">${escapeHtml(String(neutralCount))} / ${escapeHtml(String(total))}</div></div>
			<div class="card"><h2>Avg urgency</h2><div class="kpiValue">${escapeHtml(String(avgUrgency))}</div><div class="kpiHint">Across rows with urgency</div></div>
		</div>

		<div class="grid row2" style="margin-top: 12px;">
			<div class="card">
				<h2>Top themes</h2>
				${topThemesHtml || '<div class="muted small">No themes for current filters.</div>'}
			</div>
			<div class="card">
				<h2>Sentiment breakdown</h2>
				${sentimentBarsHtml || '<div class="muted small">No sentiment data for current filters.</div>'}
			</div>
		</div>

		<div class="card" style="margin-top: 12px;">
			<h2>Most urgent</h2>
			<table>
				<thead>
					<tr><th>Urgency</th><th>Sentiment</th><th>Theme</th><th>Source</th><th>Title</th></tr>
				</thead>
				<tbody>
					${urgentRowsHtml || '<tr><td colspan="5" class="muted">No urgent items for current filters.</td></tr>'}
				</tbody>
			</table>
		</div>

		<div class="card" style="margin-top: 12px;">
			<h2>Recent feedback</h2>
			<div class="muted small" style="margin-bottom: 10px;">Click an item to expand summary and body.</div>
			${recentHtml || '<div class="muted">No feedback yet.</div>'}
		</div>
	</div>
</body>
</html>`;

				return new Response(html, {
					headers: { 'content-type': 'text/html; charset=utf-8' },
				});
			}
			case '/submit': {
				const html = `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>Submit feedback</title>
</head>
<body>
	<main style="max-width: 720px; margin: 40px auto; font-family: system-ui, -apple-system, sans-serif;">
		<h1>Submit feedback</h1>
		<p><a href="/">Back</a></p>
		<form id="feedbackForm">
			<label>
				<div>Source</div>
				<input name="source" required style="width: 100%; padding: 8px;" />
			</label>
			<div style="height: 12px"></div>
			<label>
				<div>Title</div>
				<input name="title" required style="width: 100%; padding: 8px;" />
			</label>
			<div style="height: 12px"></div>
			<label>
				<div>Body</div>
				<textarea name="body" required rows="6" style="width: 100%; padding: 8px;"></textarea>
			</label>
			<div style="height: 12px"></div>
			<button type="submit">Submit</button>
		</form>
		<pre id="error" style="color: #b00020; white-space: pre-wrap;"></pre>
	</main>
	<script>
		const form = document.getElementById('feedbackForm');
		const errorEl = document.getElementById('error');
		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			errorEl.textContent = '';
			const fd = new FormData(form);
			const payload = {
				source: String(fd.get('source') || ''),
				title: String(fd.get('title') || ''),
				body: String(fd.get('body') || ''),
			};
			const res = await fetch('/api/feedback', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
			});
			if (!res.ok) {
				let msg = await res.text();
				try { msg = JSON.stringify(JSON.parse(msg), null, 2); } catch {}
				errorEl.textContent = msg;
				return;
			}
			window.location.href = '/';
		});
	</script>
</body>
</html>`;

				return new Response(html, {
					headers: { 'content-type': 'text/html; charset=utf-8' },
				});
			}
			case '/api/feedback': {
				if (request.method !== 'POST') {
					return jsonResponse(
						{ error: 'Method Not Allowed' },
						{ status: 405, headers: { allow: 'POST' } }
					);
				}

				let payload: unknown;
				try {
					payload = await request.json();
				} catch {
					return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
				}

				const source = typeof (payload as any)?.source === 'string' ? (payload as any).source.trim() : '';
				const title = typeof (payload as any)?.title === 'string' ? (payload as any).title.trim() : '';
				const body = typeof (payload as any)?.body === 'string' ? (payload as any).body.trim() : '';

				if (!source || !title || !body) {
					return jsonResponse(
						{ error: 'Missing required fields: source, title, body' },
						{ status: 400 }
					);
				}

				const createdAt = new Date().toISOString();
				const inserted = await env.DB.prepare(
					'INSERT INTO feedback (source, title, body, created_at) VALUES (?, ?, ?, ?) RETURNING id, source, title, body, created_at, sentiment, urgency, theme, summary'
				)
					.bind(source, title, body, createdAt)
					.first();

				const insertedId = (inserted as any)?.id;
				if (typeof insertedId === 'number') {
					const analysis = await analyzeFeedback(env, `${title}\n${body}`);
					await env.DB.prepare(
						'UPDATE feedback SET sentiment = ?, urgency = ?, theme = ?, summary = ? WHERE id = ?'
					)
						.bind(analysis.sentiment, analysis.urgency, analysis.theme, analysis.summary, insertedId)
						.run();

					const updated = await env.DB.prepare(
						'SELECT id, source, title, body, created_at, sentiment, urgency, theme, summary FROM feedback WHERE id = ?'
					)
						.bind(insertedId)
						.first();

					return jsonResponse(updated ?? { ...(inserted as any), ...analysis });
				}

				return jsonResponse(inserted ?? { source, title, body, created_at: createdAt });
			}
			case '/message':
				return new Response('Hello, World!');
			case '/random':
				return new Response(crypto.randomUUID());
			default:
				return new Response('Not Found', { status: 404 });
		}
	},
} satisfies ExportedHandler<Env>;
