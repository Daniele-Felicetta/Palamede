<script lang="ts">
	import { tick } from 'svelte';
	import Help from '$lib/components/Help.svelte';

	type Type = 'noul' | 'choice' | 'score';
	type Choice = { key: string; description: string };
	type Question = {
		id: string;
		type: Type;
		instructions: string;
		options: Choice[];
		levels: string[];
	};

	type Answer =
		| { type: 'noul'; noul: number }
		| {
				type: 'choice';
				choice: string;
				confidence?: number;
				probabilities?: Record<string, number>;
			}
		| {
				type: 'score';
				score: number;
				confidence?: number;
				legend?: Record<string, string>;
				probabilities?: Record<string, number>;
			};

	type Result = {
		answers: Record<string, Answer>;
		usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
	};

	let text = $state('');
	let questions = $state<Question[]>([
		{
			id: 'sentiment',
			type: 'noul',
			instructions: 'The text expresses a positive sentiment.',
			options: [],
			levels: []
		},
		{
			id: 'intent',
			type: 'choice',
			instructions: 'What is the primary intent of the text?',
			options: [
				{ key: 'question', description: 'Asking for information' },
				{ key: 'complaint', description: 'Reporting a problem or dissatisfaction' },
				{ key: 'praise', description: 'Expressing appreciation' },
				{ key: 'other', description: 'None of the above' }
			],
			levels: []
		},
		{
			id: 'urgency',
			type: 'score',
			instructions: 'How urgent is the text?',
			options: [],
			levels: ['Low', 'Medium', 'High', 'Critical']
		}
	]);

	let result = $state<Result | null>(null);
	let err = $state('');
	let loading = $state(false);
	let errBox = $state<HTMLParagraphElement | null>(null);
	let describe = $state('');
	let genErr = $state('');
	let proposing = $state(false);

	type ChatMessage = { role: 'user' | 'assistant'; content: string };
	let chat = $state<ChatMessage[]>([]);
	let chatInput = $state('');
	let chatting = $state(false);
	let chatErr = $state('');
	let suggesting = $state(false);
	let stateErr = $state('');

	const types: Type[] = ['noul', 'choice', 'score'];

	function addQuestion() {
		questions.push({
			id: '',
			type: 'noul',
			instructions: '',
			options: [{ key: '', description: '' }],
			levels: ['']
		});
	}

	function removeQuestion(index: number) {
		questions.splice(index, 1);
	}

	function toBuilder(raw: Record<string, unknown>): Question[] {
		const out: Question[] = [];
		for (const [id, value] of Object.entries(raw)) {
			const q = (value ?? {}) as { type?: string; instructions?: string; criteria?: unknown };
			const type: Type = q.type === 'choice' || q.type === 'score' ? q.type : 'noul';
			const instructions = typeof q.instructions === 'string' ? q.instructions : '';

			const criteria = q.criteria;
			if (type === 'choice') {
				let options: Choice[] = [];
				if (criteria && typeof criteria === 'object' && !Array.isArray(criteria)) {
					options = Object.entries(criteria as Record<string, unknown>).map(
						([key, description]) => ({
							key,
							description:
								typeof description === 'string' ? description : JSON.stringify(description)
						})
					);
				} else if (typeof criteria === 'string') {
					options = [{ key: '', description: criteria }];
				} else if (Array.isArray(criteria)) {
					options = criteria.map((item) => ({
						key: typeof item === 'string' ? item : '',
						description: ''
					}));
				}
				out.push({
					id,
					type,
					instructions,
					options: options.length ? options : [{ key: '', description: '' }],
					levels: []
				});
			} else if (type === 'score') {
				let levels: string[] = [];
				if (Array.isArray(criteria)) {
					levels = (criteria as unknown[]).map((level) =>
						typeof level === 'string' ? level : JSON.stringify(level)
					);
				} else if (typeof criteria === 'string') {
					levels = criteria
						.split(/[,;\n]+/)
						.map((level) => level.trim())
						.filter(Boolean);
				}
				out.push({
					id,
					type,
					instructions,
					options: [],
					levels: levels.length ? levels : ['']
				});
			} else {
				out.push({ id, type: 'noul', instructions, options: [], levels: [] });
			}
		}
		return out;
	}

	async function propose() {
		if (!describe.trim() || proposing) return;

		proposing = true;
		genErr = '';
		try {
			const res = await fetch('/api/propose', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ description: describe })
			});
			const data = await res.json();
			if (!res.ok) {
				genErr = (data as { message?: string }).message ?? 'Errore del modello locale';
				return;
			}

			const built = toBuilder((data as { questions: Record<string, unknown> }).questions);
			if (built.length === 0) {
				genErr = 'Nessuna domanda generata.';
				return;
			}

			questions = built;
			result = null;
			err = '';
		} catch {
			genErr = 'Errore di rete verso il server locale.';
		} finally {
			proposing = false;
		}
	}

	async function sendChat(event?: SubmitEvent) {
		event?.preventDefault();
		const message = chatInput.trim();
		if (!message || chatting) return;

		const history: ChatMessage[] = [...chat, { role: 'user', content: message }];
		chat = history;
		chatInput = '';
		chatting = true;
		chatErr = '';
		try {
			const res = await fetch('/api/local-chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ messages: history })
			});
			const data = await res.json();
			if (!res.ok) {
				chatErr = (data as { message?: string }).message ?? 'Errore del modello locale';
				return;
			}
			const reply = (data as { reply?: string }).reply ?? '';
			chat = [...chat, { role: 'assistant', content: reply }];
		} catch {
			chatErr = 'Errore di rete verso il server locale.';
		} finally {
			chatting = false;
		}
	}

	async function suggestState() {
		if (suggesting) return;

		suggesting = true;
		stateErr = '';
		try {
			const res = await fetch('/api/suggest-state', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ description: describe, questions: buildQuestions() })
			});
			const data = await res.json();
			if (!res.ok) {
				stateErr = (data as { message?: string }).message ?? 'Errore del modello locale';
				return;
			}
			text = (data as { state?: string }).state ?? '';
		} catch {
			stateErr = 'Errore di rete verso il server locale.';
		} finally {
			suggesting = false;
		}
	}

	function buildQuestions() {
		const out: Record<string, unknown> = {};
		for (const q of questions) {
			const id = q.id.trim();
			if (!id) continue;

			const base = { type: q.type, instructions: q.instructions };
			if (q.type === 'choice') {
				const criteria: Record<string, string> = {};
				for (const o of q.options) {
					const key = o.key.trim();
					if (key) criteria[key] = o.description;
				}
				out[id] = { ...base, criteria };
			} else if (q.type === 'score') {
				out[id] = { ...base, criteria: q.levels.map((l) => l.trim()).filter(Boolean) };
			} else {
				out[id] = base;
			}
		}
		return out;
	}

	async function ask() {
		if (!text.trim() || loading) return;

		const payload = buildQuestions();
		if (Object.keys(payload).length === 0) {
			err = 'Aggiungi almeno una domanda con un id.';
			return;
		}

		loading = true;
		result = null;
		err = '';
		try {
			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ state: text, questions: payload })
			});
			const data = await res.json();
			if (res.ok) result = data as Result;
			else err = (data as { message?: string }).message ?? 'Errore';
		} catch {
			err = 'Errore di rete';
		} finally {
			loading = false;
		}

		if (err) {
			await tick();
			errBox?.focus();
		}
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		ask();
	}

	function pct(value?: number) {
		return `${Math.round((value ?? 0) * 100)}%`;
	}

	function width(value?: number) {
		return Math.max(0, Math.min(100, (value ?? 0) * 100));
	}

	function sorted(probabilities?: Record<string, number>) {
		return Object.entries(probabilities ?? {}).sort((a, b) => b[1] - a[1]);
	}

	function legendEntries(legend?: Record<string, string>) {
		return Object.entries(legend ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]));
	}

	function markerPosition(score: number, legend?: Record<string, string>) {
		const n = Object.keys(legend ?? {}).length;
		if (n < 2) return 0;
		return Math.max(0, Math.min(100, (score / (n - 1)) * 100));
	}
</script>

<main class="shell">
	<header class="masthead">
		<p class="eyebrow">typesafe/jev-1.13 · text → decisions</p>
		<h1>JEV playground</h1>
		<p class="lede">
			Componi lo <code>state</code> e le domande tipizzate. JEV non genera testo: restituisce
			valori e probabilità calibrate.
		</p>
	</header>

	<div class="grid">
		<div class="left">
			<form class="composer" onsubmit={submit}>
			<section class="generator">
				<div class="field-head">
					<span class="label" id="gen-label">Parti da una descrizione</span>
					<Help
						label="Aiuto: modello locale"
						text="Un modello locale propone la struttura delle domande a partire da una descrizione. Poi la modifichi prima di inviare a JEV. Richiede un server locale attivo."
					/>
				</div>
				<textarea
					bind:value={describe}
					rows="2"
					placeholder="es. Smistare i ticket di supporto per reparto e urgenza…"
					aria-labelledby="gen-label"
				></textarea>
				<div class="actions">
					<button type="button" class="ghost add" onclick={propose} disabled={proposing}>
						{proposing ? 'Genero…' : 'Genera struttura'}
					</button>
				</div>
				{#if genErr}
					<p class="err" role="alert">{genErr}</p>
				{/if}
			</section>

			<div class="field">
				<div class="field-head">
					<span class="label" id="state-label">State</span>
					<Help
						label="Aiuto: state"
						text="Il testo o lo stato che JEV deve giudicare: un ticket, un log, una frase. Ogni richiesta valuta un solo state."
					/>
					<button
						type="button"
						class="ghost add suggest"
						onclick={suggestState}
						disabled={suggesting}>{suggesting ? 'Suggerisco…' : 'Suggerisci state'}</button
					>
				</div>
				<textarea
					bind:value={text}
					rows="4"
					placeholder="Incolla un testo, un ticket, un log…"
					aria-labelledby="state-label"
				></textarea>
				{#if stateErr}
					<p class="err" role="alert">{stateErr}</p>
				{/if}
			</div>

			<div class="q-head">
				<span class="label">Domande</span>
				<Help
					label="Aiuto: domande"
					text="Puoi chiedere più cose sullo stesso state: vengono valutate tutte in una sola chiamata, in parallelo."
				/>
				<span class="count">{questions.length}</span>
			</div>

			<div class="questions">
				{#each questions as q, i (i)}
					<article class="card" role="group" aria-label={`Domanda ${i + 1}`}>
						<div class="card-top">
							<input
								class="qid"
								bind:value={q.id}
								placeholder="es. intent"
								autocomplete="off"
								spellcheck="false"
								aria-label={`id della domanda ${i + 1}`}
							/>
							<div class="seg" role="group" aria-label="Tipo di domanda">
								{#each types as t (t)}
									<button
										type="button"
										class:active={q.type === t}
										aria-pressed={q.type === t}
										onclick={() => (q.type = t)}>{t}</button
									>
								{/each}
							</div>
							<Help
								label="Aiuto: tipo di domanda"
								text="noul: vero/falso, restituisce P(true) come numero 0–1. choice: sceglie una opzione tra quelle che elenchi. score: vota su una scala ordinata che definisci tu."
							/>
							<button
								type="button"
								class="ghost x"
								onclick={() => removeQuestion(i)}
								disabled={questions.length === 1}
								aria-label="Rimuovi domanda">×</button
							>
						</div>

						<div class="with-help">
							<input
								class="instr"
								bind:value={q.instructions}
								placeholder="es. What is the primary intent?"
								autocomplete="off"
								aria-label="Istruzione: cosa deve giudicare"
							/>
							<Help
								label="Aiuto: istruzione"
								text="La domanda vera e propria, scritta in chiaro. Sii specifico: è ciò che JEV usa per giudicare."
							/>
						</div>

						{#if q.type === 'choice'}
							<div class="criteria">
								<div class="crit-head">
									<span class="label">Opzioni</span>
									<Help
										label="Aiuto: opzioni"
										text="Per ogni opzione scrivi quando va scelta: sono queste descrizioni a guidare la decisione. Includi sempre un'uscita tipo «other»."
									/>
								</div>
								{#each q.options as o, j (j)}
									<div class="crit-row">
										<input
											class="ck"
											bind:value={o.key}
											placeholder="es. complaint"
											autocomplete="off"
											spellcheck="false"
											aria-label="Opzione"
										/>
										<input
											class="cd"
											bind:value={o.description}
											placeholder="quando sceglierla"
											autocomplete="off"
											aria-label="Quando sceglierla"
										/>
										<button
											type="button"
											class="ghost x"
											onclick={() => q.options.splice(j, 1)}
											disabled={q.options.length === 1}
											aria-label="Rimuovi opzione">×</button
										>
									</div>
								{/each}
								<button
									type="button"
									class="ghost add"
									onclick={() => q.options.push({ key: '', description: '' })}>+ opzione</button
								>
							</div>
						{:else if q.type === 'score'}
							<div class="criteria">
								<div class="crit-head">
									<span class="label">Livelli</span>
									<Help
										label="Aiuto: livelli"
										text="Scala ordinata dal livello più basso al più alto. Il punteggio va da 0 a n-1: 1.5 significa «tra il 2° e il 3° livello»."
									/>
								</div>
								{#each q.levels as _level, j (j)}
									<div class="crit-row">
										<span class="ord">{j}</span>
										<input
											class="cd"
											bind:value={q.levels[j]}
											placeholder={`livello ${j}`}
											autocomplete="off"
											aria-label={`Livello ${j}`}
										/>
										<button
											type="button"
											class="ghost x"
											onclick={() => q.levels.splice(j, 1)}
											disabled={q.levels.length === 1}
											aria-label="Rimuovi livello">×</button
										>
									</div>
								{/each}
								<button type="button" class="ghost add" onclick={() => q.levels.push('')}
									>+ livello</button
								>
							</div>
						{:else}
							<p class="note">P(true) in [0,1] · nessun criterio</p>
						{/if}
					</article>
				{/each}
			</div>

			<div class="actions">
				<button type="button" class="ghost add" onclick={addQuestion}>+ domanda</button>
				<button class="run" disabled={loading}>{loading ? 'Valuto…' : 'Valuta'}</button>
			</div>
			</form>

			<section class="chat">
				<div class="field-head">
					<span class="label" id="chat-label">Chat MiniCPM</span>
					<Help
						label="Aiuto: chat locale"
						text="Parla direttamente col modello locale caricato da pnpm dev. Comodo per ragionare a voce alta prima di costruire le domande."
					/>
				</div>

				<div class="chat-log" role="log" aria-live="polite" aria-labelledby="chat-label">
					{#if chat.length === 0 && !chatting}
						<p class="empty">Scrivi un messaggio per parlare col modello locale.</p>
					{/if}
					{#each chat as m, i (i)}
						<div class="msg" class:user={m.role === 'user'}>
							<span class="who">{m.role === 'user' ? 'Tu' : 'MiniCPM'}</span>
							<p>{m.content}</p>
						</div>
					{/each}
					{#if chatting}<p class="empty">MiniCPM sta scrivendo…</p>{/if}
				</div>

				{#if chatErr}
					<p class="err" role="alert">{chatErr}</p>
				{/if}

				<form class="chat-form" onsubmit={sendChat}>
					<input
						bind:value={chatInput}
						placeholder="Scrivi a MiniCPM…"
						autocomplete="off"
						aria-label="Messaggio per MiniCPM"
					/>
					<button class="ghost" disabled={chatting}>{chatting ? '…' : 'Invia'}</button>
				</form>
			</section>
		</div>

		<aside class="results" aria-live="polite" aria-busy={loading}>
			<div class="r-head"><span class="label">Risposte</span></div>

			{#if err}
				<p class="err" bind:this={errBox} tabindex="-1">{err}</p>
			{:else if !result}
				<p class="empty">Le decisioni compariranno qui.</p>
			{:else}
				{#each Object.entries(result.answers) as [id, a] (id)}
					<div class="ans">
						<div class="ans-top">
							<span class="ans-id">{id}</span>
							<span class="ans-type">{a.type}</span>
						</div>

						{#if a.type === 'noul'}
							<div class="value">
								<span class="big">{pct(a.noul)}</span>
								<span class="cap">P(true)</span>
							</div>
							<div class="meter"><span style="width:{width(a.noul)}%"></span></div>
						{:else if a.type === 'choice'}
							<div class="value">
								<span class="big">{a.choice}</span>
								{#if a.confidence != null}<span class="cap">conf {pct(a.confidence)}</span>{/if}
							</div>
							<div class="bars">
								{#each sorted(a.probabilities) as [k, v] (k)}
									<div class="bar">
										<span class="bk">{k}</span>
										<span class="bt"><i style="width:{width(v)}%"></i></span>
										<span class="bv">{pct(v)}</span>
									</div>
								{/each}
							</div>
						{:else}
							<div class="value">
								<span class="big">{a.score.toFixed(2)}</span>
								{#if a.confidence != null}<span class="cap">conf {pct(a.confidence)}</span>{/if}
							</div>
							{#if a.legend && Object.keys(a.legend).length > 1}
								<div class="ruler">
									<div class="ruler-track">
										<span
											class="ruler-marker"
											style="left:{markerPosition(a.score, a.legend)}%"
										></span>
									</div>
									<div class="ruler-ticks">
										{#each legendEntries(a.legend) as [k, lv] (k)}<span>{lv}</span>{/each}
									</div>
								</div>
							{/if}
						{/if}
					</div>
				{/each}

				{#if result.usage}
					<p class="usage">
						in {result.usage.input_tokens ?? 0} · out {result.usage.output_tokens ?? 0}
						{#if result.usage.cost != null}· ${result.usage.cost.toFixed(6)}{/if}
					</p>
				{/if}
			{/if}
		</aside>
	</div>
</main>

<style>
	.shell {
		width: min(72rem, 100%);
		margin: 0 auto;
		padding: 2.5rem 1.5rem 4rem;
	}

	.masthead {
		max-width: 40rem;
		margin-bottom: 2rem;
	}

	.eyebrow {
		margin: 0 0 0.6rem;
		font-family: var(--font-mono);
		font-size: 0.72rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--copper);
	}

	h1 {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(2rem, 6vw, 3rem);
		font-weight: 400;
		line-height: 1.05;
		text-wrap: balance;
	}

	.lede {
		margin: 0.75rem 0 0;
		max-width: 34rem;
		color: var(--muted);
		line-height: 1.55;
		text-wrap: pretty;
	}

	code {
		font-family: var(--font-mono);
		font-size: 0.85em;
		color: var(--bone);
	}

	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
		gap: 1.5rem;
		align-items: start;
	}

	.composer,
	.results {
		min-width: 0;
	}

	.left {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		min-width: 0;
	}

	.composer {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.chat {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding-top: 1.1rem;
		border-top: 1px solid var(--line);
	}

	.chat-log {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-height: 18rem;
		overflow-y: auto;
		padding-right: 0.2rem;
	}

	.msg {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.5rem 0.65rem;
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		background: rgba(0, 0, 0, 0.22);
	}

	.msg.user {
		border-color: rgba(208, 138, 60, 0.35);
		background: rgba(208, 138, 60, 0.12);
	}

	.who {
		font-family: var(--font-mono);
		font-size: 0.66rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--copper);
	}

	.msg p {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.5;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.chat-form {
		display: flex;
		gap: 0.5rem;
	}

	.chat-form input {
		flex: 1;
		min-width: 0;
	}

	.generator {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-bottom: 1.1rem;
		border-bottom: 1px solid var(--line);
	}

	.generator .actions {
		justify-content: flex-start;
	}

	.label {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.field-head,
	.crit-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.crit-head {
		margin-bottom: 0.1rem;
	}

	.suggest {
		margin-left: auto;
	}

	.with-help {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.with-help .instr {
		flex: 1 1 auto;
		width: auto;
		min-width: 0;
	}

	.q-head {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.count {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		color: var(--copper);
	}

	.questions {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.9rem;
		border: 1px solid var(--line);
		border-radius: 0.6rem;
		background: linear-gradient(180deg, var(--panel-2), var(--panel));
	}

	.card-top {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.qid {
		flex: 1 1 7rem;
		min-width: 0;
		font-family: var(--font-mono);
		font-weight: 600;
	}

	.seg {
		display: flex;
		padding: 2px;
		border: 1px solid var(--line);
		border-radius: 0.45rem;
		background: rgba(0, 0, 0, 0.25);
	}

	.seg button {
		padding: 0.35rem 0.7rem;
		border: none;
		border-radius: 0.3rem;
		background: transparent;
		color: var(--muted);
		font-family: var(--font-mono);
		font-size: 0.75rem;
		cursor: pointer;
	}

	.seg button:hover {
		color: var(--bone);
	}

	.seg button.active {
		background: var(--copper);
		color: #201810;
	}

	.instr {
		width: 100%;
	}

	.criteria {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding-left: 0.6rem;
		border-left: 2px solid var(--line);
	}

	.crit-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}

	.ck {
		flex: 0 1 7rem;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: 0.82rem;
	}

	.cd {
		flex: 1 1 9rem;
		min-width: 0;
	}

	.ord {
		flex: 0 0 1.5rem;
		font-family: var(--font-mono);
		font-size: 0.8rem;
		color: var(--copper);
		text-align: center;
	}

	input,
	textarea {
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 0.45rem;
		background: rgba(0, 0, 0, 0.28);
		color: inherit;
		font: inherit;
		font-size: 0.9rem;
	}

	input:focus-visible,
	textarea:focus-visible,
	button:focus-visible {
		outline: 2px solid var(--copper);
		outline-offset: 1px;
	}

	input:focus,
	textarea:focus {
		border-color: var(--copper);
	}

	textarea {
		resize: vertical;
		min-height: 5rem;
	}

	.note {
		margin: 0;
		font-size: 0.82rem;
		color: var(--muted);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	button {
		font: inherit;
		cursor: pointer;
	}

	.run {
		padding: 0.6rem 1.4rem;
		border: none;
		border-radius: 0.45rem;
		background: var(--copper);
		color: #201810;
		font-weight: 600;
	}

	.run:hover {
		filter: brightness(1.07);
	}

	.ghost {
		padding: 0.5rem 0.9rem;
		border: 1px solid var(--line);
		border-radius: 0.45rem;
		background: transparent;
		color: var(--bone);
	}

	.ghost:hover {
		border-color: var(--copper);
	}

	.x {
		padding: 0.35rem 0.6rem;
		line-height: 1;
		color: var(--muted);
	}

	.add {
		align-self: flex-start;
		font-size: 0.82rem;
		color: var(--muted);
	}

	button:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.results {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: 0.6rem;
		background: rgba(0, 0, 0, 0.22);
	}

	.r-head {
		padding-bottom: 0.6rem;
		border-bottom: 1px solid var(--line);
	}

	.empty,
	.err {
		margin: 0.25rem 0;
		font-size: 0.9rem;
	}

	.empty {
		color: var(--muted);
	}

	.err {
		color: #e8a87c;
	}

	.ans {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-bottom: 0.9rem;
		border-bottom: 1px solid var(--line);
	}

	.ans:last-of-type {
		border-bottom: none;
		padding-bottom: 0;
	}

	.ans-top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
	}

	.ans-id {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		color: var(--bone);
		overflow-wrap: anywhere;
	}

	.ans-type {
		font-family: var(--font-mono);
		font-size: 0.68rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--copper);
	}

	.value {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.big {
		font-family: var(--font-mono);
		font-size: 1.5rem;
		line-height: 1.1;
		overflow-wrap: anywhere;
		font-variant-numeric: tabular-nums;
	}

	.cap {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--muted);
	}

	.meter {
		height: 6px;
		border-radius: 3px;
		background: rgba(236, 227, 212, 0.12);
		overflow: hidden;
	}

	.meter > span {
		display: block;
		height: 100%;
		background: var(--copper);
	}

	.bars {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.bar {
		display: grid;
		grid-template-columns: minmax(0, 7rem) minmax(0, 1fr) 2.5rem;
		gap: 0.5rem;
		align-items: center;
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}

	.bk {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--muted);
	}

	.bt {
		height: 6px;
		border-radius: 3px;
		background: rgba(236, 227, 212, 0.1);
		overflow: hidden;
	}

	.bt > i {
		display: block;
		height: 100%;
		background: var(--copper);
	}

	.bv {
		text-align: right;
		color: var(--bone);
		font-variant-numeric: tabular-nums;
	}

	.ruler {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.ruler-track {
		position: relative;
		height: 6px;
		border-radius: 3px;
		background: rgba(236, 227, 212, 0.12);
	}

	.ruler-marker {
		position: absolute;
		top: 50%;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--copper);
		transform: translate(-50%, -50%);
	}

	.ruler-ticks {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.68rem;
		color: var(--muted);
	}

	.ruler-ticks span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.usage {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	@media (min-width: 901px) {
		.results {
			position: sticky;
			top: 1.5rem;
			max-height: calc(100vh - 3rem);
			overflow: auto;
		}
	}

	@media (max-width: 900px) {
		.shell {
			padding: 1.75rem 1rem 3rem;
		}

		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (prefers-reduced-motion: no-preference) {
		.ans {
			animation: rise 0.28s ease both;
		}

		@keyframes rise {
			from {
				opacity: 0;
				transform: translateY(4px);
			}
		}
	}
</style>
