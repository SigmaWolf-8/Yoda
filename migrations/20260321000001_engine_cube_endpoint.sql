-- Add Cube daemon endpoint per engine slot.
-- Each self-hosted engine pairs an LLM inference server with a PlenumNET Cube node.
-- Default: cube port = LLM port + 1000 (8080→9080, 8081→9081, 8082→9082).
ALTER TABLE engine_configs ADD COLUMN IF NOT EXISTS cube_endpoint_url TEXT;
