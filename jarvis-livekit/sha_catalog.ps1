$Root = 'C:\Users\danie\Desktop\Palamede'
$files = Get-ChildItem -LiteralPath (Join-Path $Root 'models\Jarvis') -Recurse -File -Include '*.gguf','*.safetensors','*.pt','*.pth','*.nemo','*.json' |
  Where-Object { $_.FullName -notmatch '\.cache|chatterbox-turbo|TTS-chatterbox-preview|livekit-wakeword[\\/]\.(git)|livekit[\\/]\.git|agents[\\/]\.git|agents-js[\\/]\.git' } |
  Sort-Object FullName
$out = foreach ($f in $files) { $h = Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256; '{0}  {1}' -f $h.Hash, $f.FullName.Replace($Root + '\','') }
$out | Out-File -LiteralPath (Join-Path $Root 'jarvis-livekit\WEIGHTS.sha256') -Encoding utf8
"weighed $($out.Count) files"
