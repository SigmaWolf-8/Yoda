-- Add Cube daemon endpoint per engine slot.
-- Each self-hosted engine pairs an LLM inference server with a PlenumNET Cube node.
-- Default: cube daemon port = LLM port + 1 (8080→8081, 8082→8083, 8084→8085).
ALTER TABLE engine_configs ADD COLUMN IF NOT EXISTS cube_endpoint_url TEXT;
