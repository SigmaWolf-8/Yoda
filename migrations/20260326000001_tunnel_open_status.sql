-- Add 'tunnel_open' to the health_status check constraint.
-- tunnel_open = PlenumLAN relay armed + cube peers heartbeating,
-- but llama-server model has not yet been confirmed responding.
-- Only mark-online (called by the Step 2 script) transitions to 'online'.

DO $$ BEGIN
    ALTER TABLE engine_configs
        DROP CONSTRAINT IF EXISTS engine_configs_health_status_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE engine_configs
    ADD CONSTRAINT engine_configs_health_status_check
    CHECK (health_status IN ('online', 'offline', 'suspect', 'tunnel_open'));
