# Running YODA with a local LLM on Windows (Ollama)

You have a compiler (LLVM) installed — that builds C/C++ programs, it does **not**
run language models. To give YODA a working local engine you need an actual **LLM
runtime**. This guide uses **Ollama**: a single-installer runtime that exposes an
OpenAI-compatible HTTP API on `http://localhost:11434`, needs no GPU
configuration, and works out of the box on Windows.

Everything below is copy-pasteable into **PowerShell**.

---

## 1. Install Ollama

Download and run the Windows installer from:

> https://ollama.com/download

After it finishes, open a **new** PowerShell window (so the freshly-added `ollama`
command is on your `PATH`) and confirm it is installed:

```powershell
ollama --version
```

You should see a version string like `ollama version is 0.x.x`.

The installer also registers Ollama as a background service, so the API server on
`http://localhost:11434` normally starts automatically at login.

---

## 2. Pull a model

Pull a small, fast model to start with (`llama3.2` is ~2 GB):

```powershell
ollama pull llama3.2
```

List what you have installed:

```powershell
ollama list
```

Expected output (the tag `llama3.2:latest` is what the runtime serves):

```
NAME               ID              SIZE      MODIFIED
llama3.2:latest    a80c4f17acd5    2.0 GB    5 seconds ago
```

> The model name YODA talks to is `llama3.2` — Ollama resolves the bare name to
> `llama3.2:latest` automatically.

---

## 3. Start / confirm the server

Ollama usually runs as a service already. If it is not running (see the
troubleshooting section), start it in its own window and leave it open:

```powershell
ollama serve
```

Confirm the server is up:

```powershell
Invoke-RestMethod -Uri "http://localhost:11434/api/version"
```

Expected:

```
version
-------
0.x.x
```

---

## 4. Verify a real chat completion

### 4a. Native Ollama API (`/api/generate`)

```powershell
$body = @{
  model  = "llama3.2"
  prompt = "Say hello in five words."
  stream = $false
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:11434/api/generate" `
  -Method Post -Body $body -ContentType "application/json"
```

Expected response shape (fields trimmed for brevity):

```
model      : llama3.2
created_at : 2026-07-21T...
response   : Hello there, nice to meet!
done       : True
...
```

### 4b. OpenAI-compatible API (`/v1/chat/completions`)

This is the endpoint YODA uses. **No API key is required** for local Ollama.

```powershell
$body = @{
  model    = "llama3.2"
  messages = @(
    @{ role = "user"; content = "Say hello in five words." }
  )
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:11434/v1/chat/completions" `
  -Method Post -Body $body -ContentType "application/json"
```

Expected response shape:

```
id      : chatcmpl-...
object  : chat.completion
model   : llama3.2
choices : {@{index=0; message=; finish_reason=stop}}
usage   : @{prompt_tokens=...; completion_tokens=...; total_tokens=...}
```

The assistant text lives at `choices[0].message.content`. To print just that:

```powershell
$resp = Invoke-RestMethod -Uri "http://localhost:11434/v1/chat/completions" `
  -Method Post -Body $body -ContentType "application/json"
$resp.choices[0].message.content
```

On any modern machine this returns in **well under 10 seconds** for `llama3.2`.

---

## 5. Wire it into YODA

1. Open YODA → **Settings → AI Engines**.
2. Pick an engine slot (A, B, or C) and make sure it is on **Self-Hosted** mode.
3. Click **Local Ollama** in the quick-preset row. This fills in:
   - **Model:** `llama3.2`
   - **Model Server URL:** `http://localhost:11434/v1`
   - **Auth:** none (no API key)
4. Edit any field if your setup differs, then click **Save**.

Because Ollama runs on `localhost`, the YODA cloud server cannot reach it
directly — your browser relays inference calls to it. After saving, the engine
appears **Online** on the **Monitoring** page once the connection is confirmed.

---

## 6. Troubleshooting

### Port 11434 already in use

Another Ollama instance (or a stale process) is already bound to the port.

```powershell
# See what owns the port
Get-NetTCPConnection -LocalPort 11434 | Select-Object -First 1 OwningProcess
Get-Process -Id (Get-NetTCPConnection -LocalPort 11434).OwningProcess

# If it's a stale ollama process, stop it and let the service restart it
Get-Process ollama -ErrorAction SilentlyContinue | Stop-Process -Force
```

To run the server on a different port instead, set `OLLAMA_HOST` before starting,
and use the same port in YODA's Model Server URL:

```powershell
$env:OLLAMA_HOST = "127.0.0.1:11500"
ollama serve
# → YODA Model Server URL becomes http://localhost:11500/v1
```

### Firewall blocking 11434

If verification commands time out, Windows Defender Firewall may be blocking the
port. Add an inbound rule (run PowerShell **as Administrator**):

```powershell
New-NetFirewallRule -DisplayName "Ollama" -Direction Inbound `
  -Action Allow -Protocol TCP -LocalPort 11434
```

For purely local use you can also confirm the loopback interface works:

```powershell
Test-NetConnection -ComputerName 127.0.0.1 -Port 11434
```

`TcpTestSucceeded : True` means the server is reachable.

### Model name mismatch ("model not found")

The name you send must match an installed model. A request for `llama3` when you
pulled `llama3.2` returns a `model ... not found` error.

```powershell
# List exactly what is installed
ollama list

# Pull the exact name you intend to use
ollama pull llama3.2
```

Use the bare name (`llama3.2`) in YODA — it resolves to `llama3.2:latest`. If you
pulled a specific tag (e.g. `llama3.2:1b`), use that full tag in the Model field.
