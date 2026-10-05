"""Palamede — Osservatorio neurale (LFM2.5 230M).

Laboratorio sperimentale per guardare e modificare in tempo reale un LLM
piccolo: si da' un esempio, il modello fa un paio di optimizer step, e il
frontend 3D mostra cosa e' cambiato nei pesi. Tutte le misure sono reali:
gradienti, delta e attivazioni vengono letti dai tensori, non ricostruiti.

Punti d'ingresso:
  server.py   FastAPI + WebSocket (porta 8131)
  model.py    ModelHost: caricamento, precisione, LoRa, attivazioni
  trainer.py  il ciclo incrementale di un esempio
  analyzer.py statistiche per tensori, moduli e layer + cronologia
  graph.py    topologia del 3D, derivata dal checkpoint reale
"""
