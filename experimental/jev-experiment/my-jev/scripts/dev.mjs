import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const envFile = resolve(root, '.env');

// In dev, the project's .env is authoritative: a stale/inherited OS variable
// must not shadow it. (Vite/Node would otherwise keep the OS value.)
if (existsSync(envFile)) {
	for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
		if (/^\s*(#|$)/.test(line)) continue;
		const eq = line.indexOf('=');
		if (eq === -1) continue;

		let value = line.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		process.env[line.slice(0, eq).trim()] = value;
	}
}

function isPortOpen(port) {
	return new Promise((done) => {
		const socket = net.connect({ host: '127.0.0.1', port });
		const finish = (open) => {
			socket.destroy();
			done(open);
		};
		socket.once('connect', () => finish(true));
		socket.once('error', () => finish(false));
		socket.setTimeout(400, () => finish(false));
	});
}

const k2Model = [
	resolve(root, 'models', 'K2-Horizon-7B-Q4_K_M.gguf'),
	// modelli condivisi di Palamede (my-jev vive in Palamede/experimental/jev-experiment/)
	resolve(root, '..', '..', '..', 'models', 'k2-7b', 'K2-Horizon-7B-Q4_K_M.gguf')
].find(existsSync);

// MiniCPM now lives in Palamede's models/ (shared with the main app): prefer
// that copy, fall back to a local models/ dir if present.
const minicpmModel = [
	resolve(root, '..', '..', '..', 'models', 'minicpm5-2b', 'MiniCPM5-2B-Q4_K_M.gguf'),
	resolve(root, 'models', 'MiniCPM5-2B-Q4_K_M.gguf')
].find(existsSync);

// chat -> MiniCPM (official llama.cpp); proposer -> K2-Horizon (custom llama.cpp).
const servers = [
	{
		name: 'chat',
		port: 8080,
		context: 8192,
		server: resolve(root, 'tools', 'llama-cpp', 'llama-server.exe'),
		model: minicpmModel
	},
	{
		name: 'proposer',
		port: 8081,
		// K2 is a reasoning model: it needs room for the chain-of-thought.
		context: 16384,
		server: resolve(root, 'tools', 'llama-cpp-k2', 'llama-server.exe'),
		model: k2Model
	}
];

const children = [];

function stopAll() {
	for (const child of children) {
		if (child?.pid) {
			spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
		}
	}
	children.length = 0;
}

async function startServers() {
	if (process.env.LOCAL_MODEL === '0') return;

	const script = resolve(root, 'scripts', 'serve-local.ps1');
	if (!existsSync(script)) return;

	for (const s of servers) {
		if (!s.model || !existsSync(s.server) || !existsSync(s.model)) continue;
		if (await isPortOpen(s.port)) {
			console.log(`[${s.name}] già in ascolto su :${s.port}, lo riuso`);
			continue;
		}

		console.log(`[${s.name}] avvio ${s.name === 'chat' ? 'MiniCPM' : 'K2-Horizon'} su :${s.port}…`);
		children.push(
			spawn(
				'powershell',
				[
					'-NoProfile',
					'-ExecutionPolicy',
					'Bypass',
					'-File',
					script,
					'-Server',
					s.server,
					'-Model',
					s.model,
					'-Port',
					String(s.port),
					'-Context',
					String(s.context ?? 8192)
				],
				{ stdio: 'inherit', windowsHide: true }
			)
		);
	}
}

process.on('exit', stopAll);
process.on('SIGINT', () => {
	stopAll();
	process.exit(0);
});
process.on('SIGTERM', () => {
	stopAll();
	process.exit(0);
});

await startServers();

await import(pathToFileURL(resolve(root, 'node_modules/vite/bin/vite.js')).href);
