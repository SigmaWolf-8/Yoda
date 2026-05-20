# Verification checklist

After applying the fix (drop-in or patch), do all four checks below.

## 1. DevTools Network — same-host LAN/public IP

1. Make sure the three YODA daemons are running on the same machine that serves the frontend (defaults: ports `11488`, `11515`, `11906` — adjust in the Daemon Config panel if you changed them).
2. Load `http://<your-host>:<port>/monitoring` in the browser. `<your-host>` can be:
   - your LAN IP (e.g. `192.168.1.42`)
   - your public IP (e.g. `24.65.67.91`)
   - any custom hostname pointing at the box
3. Open DevTools → Network and filter on `slots`. You should see **three** requests, all going to your own host:
   ```
   GET http://<your-host>:11488/api/salvi/inter-cube/slots
   GET http://<your-host>:11515/api/salvi/inter-cube/slots
   GET http://<your-host>:11906/api/salvi/inter-cube/slots
   ```
4. There must be **zero** requests to `plenumnet.replit.app` (unless all three local fetches fail — see check #4 below).
5. The status line at the top should read:
   ```
   Connecting to local daemons at <your-host>:11488,11515,11906…
   ```

## 2. Status-line text after Save & Reconnect

Open the Daemon Config panel, click **Save & Reconnect**. The status text should name the host and ports being tried. On failure, you should see one of the categorized messages — **never** the old generic `"Saved, but fetch failed — check token/ports"`.

## 3. Partial-failure rendering

Stop one daemon (e.g. kill the process on port `11515`) and reload. The page must:
- still render the other two slots,
- mark the third node as down,
- **not** throw "fetch failed".

## 4. Full-failure fallback to relay

Stop **all three** daemons. With a valid relay token configured in the Daemon Config panel, the page must fall back to fetching from `https://plenumnet.replit.app/api/salvi/inter-cube/slots` (visible in DevTools Network). Without a token configured, the status line should read:
```
Saved — relay token required for remote mode. Add a token or start local daemons.
```

## 5. Relay-side probes (used during diagnosis)

Run from any machine — these confirm whether the relay itself is healthy, independent of any local config:

```bash
# Should return 200 with connectedNodes / nodes JSON
curl -i https://plenumnet.replit.app/api/salvi/inter-cube/relay/status

# Should return 403 with the "server-hosted monitor only" hint
# (this is correct — confirms the cookie gate works)
curl -i https://plenumnet.replit.app/api/salvi/inter-cube/monitor/slots

# Should return 401 with a bad token, or 200 + slot JSON with a valid one
curl -i -H "Authorization: Bearer <YOUR_TOKEN>" \
  https://plenumnet.replit.app/api/salvi/inter-cube/slots
```

If `relay/status` is 200, the relay is fine and any remaining failure is local. If it is anything else, the failure is server-side and unrelated to this fix.
