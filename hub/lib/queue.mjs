// Palamede hub — coda mutex GPU (un solo modello alla volta).
// Ogni dominio che tocca la GPU (image/select/chat-start/3d/kb-ingest/history)
// passa di qui: il vincolo di esclusività è una regola di prodotto, non
// un'abitudine di avvio. Una factory così i test possono creare code isolate.

export function createQueue() {
  let chain = Promise.resolve()
  return function queued(fn) {
    const run = chain.then(fn, fn)
    chain = run.then(() => {}, () => {})
    return run
  }
}
