// Palamede — Osservatorio: i tipi che arrivano dal backend.
//
// Sono lo spec del protocollo: ogni campo qui corrisponde a una chiave che
// `backend/` mette davvero nel payload. Se aggiungi un campo, aggiungilo anche
// la'; se lo rinomini, l'errore ti dice subito dove.

/** Un nodo del grafo: un GRUPPO di tensori di parametri, non un neurone. */
export interface GraphNode {
  id: string
  kind: 'embedding' | 'layer' | 'lm_head'
  label: string
  layer: number | null
  layer_type: 'conv' | 'full_attention' | null
  params: string[]
  numel: number
  modules: string[]
  /** I parametri sono un alias di un altro nodo (LM Head tied a Embeddings). */
  params_aliased: boolean
}

/** Un modulo dentro un layer: attenzione, short conv, MLP o normalizzazione. */
export interface GraphModule {
  id: string
  node: string
  layer: number
  layer_type: 'conv' | 'full_attention'
  group: 'attn' | 'conv' | 'feed_forward' | 'norm'
  /** Ruolo semantico: q/k/v/o, gate/up/down, in_proj, depthwise, norm_*. */
  role: string
  /** Nome grezzo del parametro nel checkpoint: w1/w3/w2 per il gate/up/down. */
  param_role: string
  group_title: string
  label: string
  params: string[]
  numel: number
}

export interface ModelInfo {
  name: string
  model_type: string
  hidden_size: number
  intermediate_size: number
  num_hidden_layers: number
  num_attention_heads: number
  num_key_value_heads: number
  vocab_size: number
  norm_eps: number
  conv_L_cache: number
  rope_theta: number | null
  tie_word_embeddings: boolean
  layer_types: string[]
  attn_layers: number[]
  conv_layers: number[]
  total_params: number
  unique_params: number
  tied: string[]
}

export interface Graph {
  model: ModelInfo
  nodes: GraphNode[]
  modules: GraphModule[]
  links: { from: string; to: string; kind: string }[]
  shapes: Record<string, number[]>
  unclassified: string[]
  disclaimer: string
}

/** Statistiche di un singolo tensore, dopo un optimizer step. */
export interface TensorStat {
  name: string
  shape: number[]
  numel: number
  dtype: string
  grad_norm: number | null
  grad_mean: number | null
  grad_std: number | null
  grad_absmax: number | null
  weight_norm_before: number
  weight_norm_after: number
  delta_norm: number
  delta_mean_abs: number
  delta_absmax: number
  rel_change_pct: number
  changed: boolean
  /** Gradiente arrivato, delta azzerato dal formato: la perdita e' silenziosa. */
  rounded_away: boolean
}

/** Statistiche aggregate su un gruppo (modulo o nodo). */
export interface GroupStat {
  id: string
  tensors: number
  params: number
  grad_norm: number
  grad_tensors: number
  weight_norm_before: number
  weight_norm_after: number
  delta_norm: number
  delta_mean_abs: number
  delta_absmax: number
  changed_tensors: number
  rounded_away: number
  /** false = nessun tensore trainabile in questo gruppo (es. LoRa). */
  measured: boolean
  rel_change_pct: number
  /** Quota quadratica della norma: le quote dei gruppi reali sommano a 100. */
  contribution_pct: number | null
  label?: string
  kind?: string
  layer?: number | null
  layer_type?: string | null
  params_count?: number
  aliased?: boolean
}

/** Profilo per layer della barra `Layer 0 ░░░ / Layer 3 ███████`. */
export interface LayerProfile {
  id: string
  label: string
  grad_norm: number
  delta_norm: number
  params: number
  grad_pct_of_peak: number
}

export interface StepTiming {
  forward_ms: number
  backward_ms: number
  optimizer_ms: number
  analyze_ms: number
  total_ms: number
}

export interface RunTiming {
  load_ms: number
  tokenize_ms: number
  inference_before_ms: number
  loss_before_ms: number
  train_ms: number
  analyze_ms: number
  inference_after_ms: number
  loss_after_ms: number
  total_ms: number
  mean_step_ms: number
  steps: StepTiming[]
}

export interface Vram {
  allocated_mib: number
  reserved_mib: number
  max_allocated_mib: number
  max_reserved_mib: number
}

export interface GpuInfo {
  available: boolean
  name: string | null
  total_mib: number
  capability: string | null
  bf16: boolean
  fp16: boolean
  tf32: boolean
}

export interface TokenRow {
  i: number
  id: number
  text: string
  is_target: boolean
  norm: number | null
  entropy: number | null
}

export interface AttentionPayload {
  /** Le teste sono mediate: dichiarato, non silenzioso. */
  reduction: string
  layers: Record<
    string,
    { matrix: number[][]; key_mass: number[]; heads: number }
  >
}

export interface Throughput {
  tokens: number
  seconds: number
  tokens_per_second: number
}

export interface Totals {
  tensors: number
  params: number
  grad_norm: number
  grad_tensors: number
  delta_norm: number
  changed_tensors: number
  rounded_away_tensors: number
  max_rel_change_pct: number
  max_delta_absmax: number
}

/** L'evento `update_start`: arriva l'esempio, con lo stato BEFORE. */
export interface UpdateStart {
  index: number
  prompt: string
  target: string
  steps: number
  mode: string
  tokens: string[]
  token_ids: number[]
  n_prompt: number
  n_target: number
  prompt_tokens: string[]
  target_tokens: string[]
  loss_before: number
  perplexity_before: number
  output_before: string
  output_before_tokens: string[]
  inference_before_ms: number
  tokens_per_second: number
  trainable_tensors: number
}

/** L'evento `step`: un optimizer step e' finito. */
export interface StepEvent {
  index: number
  step: number
  steps: number
  loss: number
  perplexity: number
  grad_norm_global: number
  timing: StepTiming
  layers: LayerProfile[]
  modules: GroupStat[]
  totals: Totals
  vram: Vram
}

/** L'evento `update_end`: il ciclo BEFORE -> TRAIN -> AFTER, completo. */
export interface UpdateEnd extends UpdateStart {
  ts: number
  example: { prompt: string; target: string }
  loss_after: number
  perplexity_after: number
  output_after: string
  output_after_tokens: string[]
  timing: RunTiming
  vram: Vram
  throughput: { generate_before: Throughput; generate_after: Throughput }
  tensors: TensorStat[]
  modules: GroupStat[]
  layers: GroupStat[]
  steps_detail: {
    step: number
    loss: number
    grad_norm_global: number
    timing: StepTiming
    totals: Totals
  }[]
  totals: Totals
  activations: Record<string, { rms: number; mean: number; std: number; absmax: number; norm: number; shape: number[] }>
  per_token: {
    rows: TokenRow[]
    per_layer_hidden: Record<string, number[]>
    last_layer: number | null
    note: string
  } | null
  attention: AttentionPayload
  precision_note: string
  history_index: number
}

export interface LegendEntry {
  channel: string
  measures: string
  scale: string
}

export interface LoRaInfo {
  mode: string
  rank: number
  alpha: number
  dropout: number
  scaling: number
  target_modules: string[]
  adapters: number
  adapter_modules: string[]
  missing_targets: string[]
  trainable_tensors: string[]
  trainable_params: number
  frozen_params: number
  base_tensors: number
  base_frozen: boolean
}

export interface ModeInfo {
  mode: string
  trainable_tensors: number
  trainable_params: number
  frozen_params: number
  learning_rate: number | null
  optimizer: string
  lora: LoRaInfo | null
}

export interface LoadInfo {
  checkpoint: string
  load_ms: number
  tokenize_ms: number
  attn_implementation: string
  master_dtype: string
  compute_dtype: string
  device: string
  model_type: string
  hidden_size: number
  intermediate_size: number
  num_hidden_layers: number
  layer_types: string[]
  attn_layers: number[]
  conv_layers: number[]
  tensors: number
  total_params: number
  base_params: number
  adapter_params: number
  unique_params: number
  trainable_params: number
  trainable_tensors: number
  vocab_size: number
  tie_word_embeddings: boolean
  warmup: { generate_ms: number; train_ms: number; loss: number }
}

export interface ServerState {
  phase: 'idle' | 'loading' | 'training' | 'paused' | 'error'
  detail: string
  error: string | null
  loaded: boolean
  busy: boolean
  updates: number
  vram: Vram
  gpu: GpuInfo
  precision: string
  mode: string
  device: string
}

export interface ObsConfig {
  checkpoint: string
  mode: 'FULL' | 'LORA'
  steps: number
  learning_rate: number
  lora_learning_rate: number
  grad_clip: number
  optimizer: string
  batch_size: number
  max_seq_len: number
  add_bos: boolean
  precision: 'mixed' | 'bf16' | 'fp16' | 'fp32'
  device: string
  max_new_tokens: number
  temperature: number
  collect_activations: boolean
  collect_attention: boolean
  collect_per_token: boolean
  keep_history: number
  weight_snapshot_keep: number
  animation_mode: 'live' | 'step'
  host: string
  port: number
  lora: {
    rank: number
    alpha: number
    dropout: number
    target_modules: string[]
  }
}

export interface HistoryItem {
  index: number
  ts: number
  mode: string
  steps: number
  prompt: string
  target: string
  loss_before: number
  loss_after: number
  loss_delta: number
  output_before: string
  output_after: string
  output_changed: boolean
  total_ms: number
  delta_norm: number
  grad_norm: number
  weights_ref: number | null
}

export interface CompareResult {
  a: HistoryItem
  b: HistoryItem
  loss: Record<string, number>
  totals: Record<string, number | null>
  output: Record<string, string>
  layers: {
    id: string
    label: string
    delta_norm_a: number
    delta_norm_b: number
    delta_norm_ratio: number | null
    grad_norm_a: number | null
    grad_norm_b: number | null
    rel_change_pct_a: number | null
    rel_change_pct_b: number | null
  }[]
  exact_weight_distance: { total: number; per_tensor: Record<string, number> } | null
  exact_weight_distance_note: string
}

export interface HelloPayload {
  config: ObsConfig
  state: ServerState
  gpu: GpuInfo
  vram: Vram
  graph: Graph | null
  model: LoadInfo | null
  mode: ModeInfo | null
  history: HistoryItem[]
  legend: LegendEntry[]
  disclaimer: string
}
