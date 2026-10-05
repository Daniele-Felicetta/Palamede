// Verifica eseguibile della logica dello stormo (node scripts/check-swarm.mjs).
// Nessun modello, nessuna GPU: si controlla che estrazione del JSON,
// validazione, filtro del critico e pool di concorrenza regolino.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// swarm.ts è TypeScript: lo si compila in una cartella temporanea con il
// tsc del frontend e lo si importa da lì (stessa fonte, nessun doppio).
const tmp = mkdtempSync(join(tmpdir(), 'palamede-swarm-'))
execFileSync(
  process.execPath,
  [
    join(resolve('frontend', 'node_modules', 'typescript', 'bin', 'tsc')),
    join(resolve('frontend', 'src', 'lib', 'swarm.ts')),
    '--outDir', tmp, '--module', 'es2022', '--target', 'es2022', '--moduleResolution', 'bundler',
  ],
  { stdio: 'inherit' },
)

const { Swarm } = await import(pathToFileURL(join(tmp, 'swarm.js')).href)

process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* già rimossa */ } })

let fails = 0
function ok(name, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}`)
  if (!cond) fails++
}

// ── extractJson: il 2B aggiunge prosa attorno all'oggetto ──
ok('JSON pulito', Swarm.extractJson('{"a":1}').value.a === 1)
const conProse = Swarm.extractJson('Ecco il piano:\n```json\n{"subtasks":[{"id":"x_y","task":"fare"}]}\n```\nFatto.')
ok('JSON dentro code fence + prosa', conProse.value?.subtasks?.[0]?.id === 'x_y')
ok('graffe dentro stringa', Swarm.extractJson('{"note":"a { b } c"}').value.note === 'a { b } c')
ok('testo senza JSON', Swarm.extractJson('non so').value === null)
ok('error descrittivo', Swarm.extractJson('non so').error.length > 0)

// ── validatePlan: forma del piano (id snake_case, 2-5 task) ──
const buono = { subtasks: [{ id: 'a_one', task: 'fare uno' }, { id: 'b_two', task: 'fare due' }] }
ok('piano valido', Swarm.validatePlan(buono).length === 0)
ok('troppo pochi', Swarm.validatePlan({ subtasks: [{ id: 'a_b', task: 'fare uno' }] }).length > 0)
ok('troppi', Swarm.validatePlan({ subtasks: Array.from({ length: 6 }, (_, i) => ({ id: `a_${i}`, task: 'fare uno' })) }).length > 0)
ok('id non snake', Swarm.validatePlan({ subtasks: [{ id: 'A-Bad', task: 'fare uno' }, { id: 'c_d', task: 'fare due' }] }).some((p) => p.includes('id')))
ok('task troppo corto', Swarm.validatePlan({ subtasks: [{ id: 'a_b', task: 'x' }, { id: 'c_d', task: 'fare due' }] }).some((p) => p.includes('task')))
ok('id duplicati', Swarm.validatePlan({ subtasks: [{ id: 'a_b', task: 'fare uno' }, { id: 'a_b', task: 'fare due' }] }).some((p) => p.includes('duplicat')))
ok('piano null', Swarm.validatePlan(null).length === 1)
ok('non array', Swarm.validatePlan({ subtasks: 'nope' }).length === 1)
ok('repairPrompt elenca i problemi', Swarm.repairPrompt(['uno', 'due']).includes('uno'))

// ── verified: il filtro del critico ──
const res = [{ id: 'a', done: 'x' }, { id: 'b', done: 'y' }, { id: 'c', done: 'z' }]
ok('filtro 1-based', Swarm.verified(res, [1, 3]).map((r) => r.id).join(',') === 'a,c')
ok('valid vuoto', Swarm.verified(res, []).length === 0)

// ── mapLimit: ordine preservato + rispetto del limite ──
let inVolo = 0
let picco = 0
const out = await Swarm.mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
  inVolo++
  picco = Math.max(picco, inVolo)
  await new Promise((r) => setTimeout(r, 5))
  inVolo--
  return n * 10
})
ok('ordine d\'origine preservato', out.join(',') === '10,20,30,40,50,60')
ok(`max ${2} in volo (picco ${picco})`, picco <= 2)
ok('array vuoto', (await Swarm.mapLimit([], 3, async () => 1)).length === 0)

console.log(fails === 0 ? '\nTUTTO OK' : `\n${fails} FALLITI`)
process.exit(fails === 0 ? 0 : 1)