import { env } from '$env/dynamic/private';

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

export type Questions = Record<string, unknown>;

function detail(cause: unknown, e: unknown): string {
	const c = cause as { code?: string; message?: string } | undefined;
	return c?.code ?? c?.message ?? (e as Error).message;
}

// ── JEV (text -> decisions) via OpenRouter ────────────────────────────────
const JEV_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = 'typesafe/jev-1.13';

export async function decide(state: string, questions: Questions) {
	const apiKey = env.OPENROUTER_API_KEY?.trim();
	if (!apiKey) throw new ApiError(500, 'OPENROUTER_API_KEY non impostata');
	if (typeof state !== 'string' || !state.trim()) throw new ApiError(400, 'state mancante');
	if (
		!questions ||
		typeof questions !== 'object' ||
		Array.isArray(questions) ||
		Object.keys(questions).length === 0
	) {
		throw new ApiError(400, 'serve almeno una domanda');
	}

	let res: Response;
	try {
		res = await fetch(JEV_ENDPOINT, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ model: JEV_MODEL, state, questions })
		});
	} catch (e) {
		const cause = (e as { cause?: unknown }).cause;
		console.error('OpenRouter fetch failed:', cause ?? e);
		throw new ApiError(502, `OpenRouter non raggiungibile (${detail(cause, e)})`);
	}

	const data = await res.json();
	if (!res.ok) {
		throw new ApiError(res.status, data?.error?.message ?? 'Errore OpenRouter');
	}

	return { answers: data.answers as Record<string, unknown>, usage: data.usage };
}

// ── Local model: draft a question structure ──────────────────────────────
// proposer (structure) -> K2-Horizon; chat -> MiniCPM. Both are local servers.
const PROPOSER_DEFAULT_URL = 'http://127.0.0.1:8081/v1/chat/completions';
const CHAT_DEFAULT_URL = 'http://127.0.0.1:8080/v1/chat/completions';

const SYSTEM = `You design decision questions for JEV. JEV reads ONE text (the "state") and answers several typed questions about it in one pass. Each question is an independent, ATOMIC judgment: the kind an expert makes in 2 seconds. JEV cannot write or reason: it returns exactly one value per question. NEVER ask for explanations, summaries, reasons or generated text.

The user gives a GOAL (it may be a single word). Design questions about THAT goal and its subject, judged on the incoming text. If the goal is vague or one word, choose a sensible judging task about that subject (category, severity, sentiment, quality, boolean flags).

Reply with ONLY a JSON object: no prose, no markdown, no code fences.
Shape: {"questions":{"<id>":{"type":"noul"|"choice"|"score","instructions":"<the judgment>","criteria":<...>}}}

Design 3 to 6 questions about the goal's subject, judging DIFFERENT facets. Hard rules:
1. ATOMIC: one property per question. If it contains "and"/"or", split it.
2. ORTHOGONAL: no two questions measure the same thing.
3. GROUNDED: answerable from the text alone; no outside knowledge, no guesses.
4. NO REASONING WORDS: never use explain, summarize, justify, why.
5. ids: short snake_case naming the facet, about the goal's subject.
6. Use all three types: at least one choice, one score, one noul.
7. Judge the TEXT about the subject. Never ask identity/definition questions and never restate the goal as a question.
8. Every option and level must be a real, mutually exclusive category of the subject — no placeholders, no filler.

Types:
- noul  -> ONE true/false statement the text can support. Omit "criteria".
- choice -> pick exactly one option_key; "criteria" maps option_key -> when to pick it; 3 to 5 options, ALWAYS one "other".
- score -> an ORDERED scale; "criteria" is an array of 4 to 5 level labels, low to high, adapted to the subject.

Now design the questions for the USER's goal and subject. Check: each question tests exactly one thing, none overlap, no forbidden words, every choice has "other", every score has 4-5 ordered levels.`;

// Constrains generation to the exact envelope, so a weak model cannot drift
// into a bare question or prose.
const QUESTIONS_SCHEMA = {
	type: 'json_schema',
	json_schema: {
		name: 'jev_questions',
		schema: {
			type: 'object',
			properties: {
				questions: {
					type: 'object',
					additionalProperties: {
						type: 'object',
						properties: {
							type: { type: 'string', enum: ['noul', 'choice', 'score'] },
							instructions: { type: 'string' },
							criteria: { type: ['object', 'array'] }
						},
						required: ['type', 'instructions']
					}
				}
			},
			required: ['questions']
		}
	}
};

function callLocal(url: string, body: Record<string, unknown>): Promise<Response> {
	return fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

export async function proposeQuestions(description: string): Promise<Questions> {
	if (typeof description !== 'string' || !description.trim()) {
		throw new ApiError(400, 'descrizione mancante');
	}

	const url = env.LOCAL_LLM_URL?.trim() || PROPOSER_DEFAULT_URL;
	const messages: { role: string; content: string }[] = [
		{ role: 'system', content: SYSTEM },
		{ role: 'user', content: description }
	];

	let lastQuestions: Questions | null = null;
	let lastProblems: string[] = [];

	// Up to two generations, each followed by a targeted repair pass.
	for (let attempt = 0; attempt < 2; attempt++) {
		let questions = await requestQuestions(url, messages);
		let problems = validateQuestions(questions);

		if (problems.length > 0) {
			const repair = [
				...messages,
				{ role: 'assistant', content: JSON.stringify({ questions }) },
				{
					role: 'user',
					content: `Fix ONLY these problems and return the corrected JSON object:\n- ${problems.join('\n- ')}`
				}
			];
			try {
				questions = await requestQuestions(url, repair);
				problems = validateQuestions(questions);
			} catch {
				// keep the previous problems
			}
		}

		if (problems.length === 0) return questions;
		lastQuestions = questions;
		lastProblems = problems;
	}

	// Last resort: drop the questions flagged as invalid and keep the sound ones.
	if (lastQuestions) {
		const salvaged = dropInvalid(lastQuestions, lastProblems);
		if (Object.keys(salvaged).length >= 1) {
			const remaining = validateQuestions(salvaged).filter((p) => !p.includes('domande'));
			if (remaining.length === 0) return salvaged;
		}
	}

	throw new ApiError(502, `Struttura non valida: ${lastProblems.join('; ')}`);
}

function dropInvalid(questions: Questions, problems: string[]): Questions {
	const bad = new Set(
		problems.map((p) => p.split(':')[0].trim()).filter((id) => id in questions)
	);
	const out: Questions = {};
	for (const [id, value] of Object.entries(questions)) {
		if (!bad.has(id)) out[id] = value;
	}
	return out;
}

async function requestQuestions(
	url: string,
	messages: { role: string; content: string }[]
): Promise<Questions> {
	// A reasoning model must be allowed to think: the chain-of-thought is what
	// makes it design a good rubric. But a JSON grammar would force the first
	// token to be "{", blocking the thinking block — so use one or the other.
	const think = env.LOCAL_LLM_THINK !== '0';
	const body: Record<string, unknown> = {
		messages,
		temperature: 0.2,
		max_tokens: 4096,
		stream: false
	};
	if (!think) {
		body.chat_template_kwargs = { enable_thinking: false };
		body.response_format = QUESTIONS_SCHEMA;
	}
	if (env.LOCAL_LLM_MODEL?.trim()) {
		body.model = env.LOCAL_LLM_MODEL.trim();
	}

	let res: Response;
	try {
		res = await callLocal(url, body);
		if (res.status === 400) {
			// Server rejects the thinking toggle or the JSON schema: retry plain.
			const fallback = { ...body };
			delete fallback.chat_template_kwargs;
			delete fallback.response_format;
			res = await callLocal(url, fallback);
		}
	} catch (e) {
		const cause = (e as { cause?: unknown }).cause;
		console.error('Local LLM fetch failed:', cause ?? e);
		throw new ApiError(
			502,
			`Modello locale non raggiungibile su ${url} (${detail(cause, e)}). Avvialo con "pnpm dev" o "pnpm local".`
		);
	}

	const data = await res.json();
	if (!res.ok) {
		throw new ApiError(res.status, data?.error?.message ?? 'Errore del modello locale');
	}

	const content: string = data?.choices?.[0]?.message?.content ?? '';
	const questions = extractQuestions(content);
	if (!questions) {
		throw new ApiError(502, 'Il modello non ha restituito una struttura JSON valida.');
	}
	return normalizeQuestions(questions);
}

/** Guarantee the JEV escape hatch: every choice needs an "other" option. */
function normalizeQuestions(questions: Questions): Questions {
	for (const item of Object.values(questions)) {
		if (!item || typeof item !== 'object') continue;
		const q = item as { type?: unknown; criteria?: unknown };
		if (
			q.type === 'choice' &&
			q.criteria &&
			typeof q.criteria === 'object' &&
			!Array.isArray(q.criteria)
		) {
			const criteria = q.criteria as Record<string, unknown>;
			if (!Object.keys(criteria).some((key) => ESCAPE_HATCH.test(key))) {
				criteria.other = 'None of the above';
			}
		}
	}
	return questions;
}

const STATE_SYSTEM = `You write ONE short "state": realistic raw text that a system receives and that JEV will judge (a support ticket, a chat message, a review, an email, a log line).
Rules:
- Plain text only: no JSON, no markdown, no code fences, no surrounding quotes, no preamble.
- 1 to 4 sentences, concrete and specific (names, numbers, details).
- Write it in the same language as the goal.
- Include enough signal to answer the given questions.
Output only the text of the state.`;

export async function suggestState(description: string, questions: Questions) {
	const hasDescription = typeof description === 'string' && description.trim().length > 0;
	const hasQuestions =
		questions && typeof questions === 'object' && Object.keys(questions).length > 0;
	if (!hasDescription && !hasQuestions) {
		throw new ApiError(400, 'servono una descrizione o delle domande');
	}

	const url = env.LOCAL_LLM_URL?.trim() || PROPOSER_DEFAULT_URL;
	const context = [
		hasDescription ? `Goal: ${description}` : '',
		hasQuestions
			? `Questions JEV will answer:\n${JSON.stringify(questions, null, 2)}`
			: ''
	]
		.filter(Boolean)
		.join('\n\n');

	const body: Record<string, unknown> = {
		messages: [
			{ role: 'system', content: STATE_SYSTEM },
			{ role: 'user', content: context }
		],
		temperature: 0.7,
		max_tokens: 300,
		stream: false,
		chat_template_kwargs: { enable_thinking: false }
	};
	if (env.LOCAL_LLM_MODEL?.trim()) {
		body.model = env.LOCAL_LLM_MODEL.trim();
	}

	let res: Response;
	try {
		res = await callLocal(url, body);
		if (res.status === 400) {
			const fallback = { ...body };
			delete fallback.chat_template_kwargs;
			res = await callLocal(url, fallback);
		}
	} catch (e) {
		const cause = (e as { cause?: unknown }).cause;
		console.error('Local LLM fetch failed:', cause ?? e);
		throw new ApiError(
			502,
			`Modello locale non raggiungibile su ${url} (${detail(cause, e)}). Avvialo con "pnpm dev" o "pnpm local".`
		);
	}

	const data = await res.json();
	if (!res.ok) {
		throw new ApiError(res.status, data?.error?.message ?? 'Errore del modello locale');
	}

	const raw: string = data?.choices?.[0]?.message?.content ?? '';
	const state = raw
		.replace(/```[a-z]*\n?/gi, '')
		.replace(/```/g, '')
		.replace(/^["'“”]+|["'“”]+$/g, '')
		.trim();
	if (!state) throw new ApiError(502, 'Il modello non ha suggerito nessuno state.');
	return { state };
}

const BANNED_WORDS = /\b(explain|summar\w*|justif\w*|why)\b/i;
const ESCAPE_HATCH = /^(other|altro|autre|otro|other)$/i;

function validateQuestions(questions: Questions): string[] {
	const problems: string[] = [];
	const ids = Object.keys(questions);
	if (ids.length < 2) problems.push('servono da 2 a 6 domande');
	if (ids.length > 6) problems.push('massimo 6 domande');

	for (const id of ids) {
		if (!/^[a-z][a-z0-9_]{1,}$/.test(id)) problems.push(`id non valido: "${id}"`);

		const item = questions[id] as { type?: unknown; instructions?: unknown; criteria?: unknown };
		const instructions = item?.instructions;

		if (typeof instructions !== 'string' || instructions.trim().length < 5) {
			problems.push(`${id}: manca "instructions"`);
		} else if (BANNED_WORDS.test(instructions)) {
			problems.push(`${id}: l'istruzione chiede ragionamento/testo`);
		}

		if (item?.type === 'choice') {
			const c = item.criteria;
			if (!c || typeof c !== 'object' || Array.isArray(c)) {
				problems.push(`${id}: choice.criteria deve essere un oggetto`);
			} else {
				const keys = Object.keys(c as Record<string, unknown>);
				if (keys.length < 2) problems.push(`${id}: choice servono almeno 2 opzioni`);
				if (!keys.some((k) => ESCAPE_HATCH.test(k))) problems.push(`${id}: choice deve avere "other"`);
			}
		} else if (item?.type === 'score') {
			const c = item.criteria;
			if (!Array.isArray(c) || c.length < 3) {
				problems.push(`${id}: score.criteria deve essere un array di almeno 3 livelli`);
			}
		}
	}
	return problems;
}

export async function localChat(messages: { role: string; content: string }[]) {
	if (!Array.isArray(messages) || messages.length === 0) {
		throw new ApiError(400, 'messaggi mancanti');
	}

	const url = env.LOCAL_CHAT_URL?.trim() || CHAT_DEFAULT_URL;
	const body: Record<string, unknown> = {
		messages,
		temperature: 0.7,
		max_tokens: 1024,
		stream: false,
		chat_template_kwargs: { enable_thinking: false }
	};
	if (env.LOCAL_LLM_MODEL?.trim()) {
		body.model = env.LOCAL_LLM_MODEL.trim();
	}

	let res: Response;
	try {
		res = await callLocal(url, body);
		if (res.status === 400 && 'chat_template_kwargs' in body) {
			const fallback = { ...body };
			delete fallback.chat_template_kwargs;
			res = await callLocal(url, fallback);
		}
	} catch (e) {
		const cause = (e as { cause?: unknown }).cause;
		console.error('Local LLM fetch failed:', cause ?? e);
		throw new ApiError(
			502,
			`Modello locale non raggiungibile su ${url} (${detail(cause, e)}). Avvialo con "pnpm dev" o "pnpm local".`
		);
	}

	const data = await res.json();
	if (!res.ok) {
		throw new ApiError(res.status, data?.error?.message ?? 'Errore del modello locale');
	}

	const reply: string = data?.choices?.[0]?.message?.content ?? '';
	return { reply };
}

function extractQuestions(text: string): Questions | null {
	const cleaned = text.replace(/```json/gi, '```');

	for (let i = 0; i < cleaned.length; i++) {
		if (cleaned[i] !== '{') continue;

		const end = matchBrace(cleaned, i);
		if (end === -1) continue;

		try {
			const parsed = JSON.parse(cleaned.slice(i, end + 1));
			if (isQuestionMap(parsed?.questions)) {
				return parsed.questions as Questions;
			}
		} catch {
			// not the object we are looking for; keep scanning
		}
	}
	return null;
}

/** True only for a map of id -> { type: noul|choice|score, ... }. Rejects bare
 *  question objects and anything the model drifts into. */
function isQuestionMap(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const entries = Object.values(value as Record<string, unknown>);
	if (entries.length === 0) return false;
	return entries.every((q) => {
		if (!q || typeof q !== 'object' || Array.isArray(q)) return false;
		const type = (q as { type?: unknown }).type;
		return type === 'noul' || type === 'choice' || type === 'score';
	});
}

/** Index of the `}` matching the `{` at `start`, ignoring braces inside strings. */
function matchBrace(text: string, start: number): number {
	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let i = start; i < text.length; i++) {
		const char = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === '\\') escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') inString = true;
		else if (char === '{') depth++;
		else if (char === '}') {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}
