$t0 = Get-Date
$payload = @{
  messages = @(@{ role = 'user'; content = 'Genera un tramonto sul mare. Rispondi SOLO con un oggetto JSON: {"tool":"palamede.image","args":{"prompt":"..."}}' })
  temperature = 0.2
  stream = $false
} | ConvertTo-Json -Depth 8
$r = Invoke-RestMethod -Uri 'http://127.0.0.1:8121/v1/chat/completions' -Method Post -ContentType 'application/json' -Body $payload -TimeoutSec 180
((Get-Date) - $t0).TotalSeconds
$r.choices[0].message.content
