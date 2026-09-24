param(
	[string]$Server = $env:LLAMA_SERVER,
	[string]$Model = $env:LLAMA_MODEL,
	[int]$Port = 8080,
	[int]$Context = 8192,
	[int]$GpuLayers = 99,
	[int]$FlashAttention = 1
)

if (-not $Server) {
	$Server = (Join-Path $PSScriptRoot '..\tools\llama-cpp\llama-server.exe')
}
if (-not $Model) {
	# modelli condivisi di Palamede (my-jev vive in Palamede/experimental/jev-experiment/)
	$shared = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..\models\minicpm5-2b\MiniCPM5-2B-Q4_K_M.gguf') -ErrorAction SilentlyContinue)
	$local = (Join-Path $PSScriptRoot '..\models\MiniCPM5-2B-Q4_K_M.gguf')
	if ($shared -and (Test-Path $shared)) { $Model = $shared } else { $Model = $local }
}

if (-not (Test-Path $Server)) {
	throw "llama-server.exe non trovato: $Server. Imposta `$env:LLAMA_SERVER."
}
if (-not (Test-Path $Model)) {
	throw "Modello non trovato: $Model"
}

Write-Host "llama-server : $Server"
Write-Host "model        : $Model"
Write-Host "url          : http://127.0.0.1:$Port/v1/chat/completions"
Write-Host ""

& $Server -m $Model --host 127.0.0.1 --port $Port -c $Context -ngl $GpuLayers -fa $FlashAttention --jinja
