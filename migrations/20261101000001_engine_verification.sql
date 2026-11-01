ALTER TABLE engine_configs
    ADD COLUMN verification jsonb,
    ADD COLUMN verification_version uuid NOT NULL DEFAULT uuid_generate_v4();

-- Old reachability probes did not prove generation. Discard those certifications.
UPDATE engine_configs SET health_status='offline';

CREATE FUNCTION enforce_engine_verification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (
        NEW.hosting_mode IS DISTINCT FROM OLD.hosting_mode OR
        NEW.endpoint_url IS DISTINCT FROM OLD.endpoint_url OR
        NEW.model_name IS DISTINCT FROM OLD.model_name OR
        NEW.auth_type IS DISTINCT FROM OLD.auth_type OR
        NEW.credentials_encrypted IS DISTINCT FROM OLD.credentials_encrypted OR
        NEW.cube_endpoint_url IS DISTINCT FROM OLD.cube_endpoint_url OR
        NEW.is_disabled IS DISTINCT FROM OLD.is_disabled
    ) THEN
        NEW.verification_version := uuid_generate_v4();
        NEW.verification := NULL;
        NEW.health_status := 'offline';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.health_status = 'online' AND
        OLD.health_status <> 'online' AND
        NEW.verification IS NOT DISTINCT FROM OLD.verification THEN
        NEW.health_status := 'offline';
    END IF;
    IF NEW.health_status = 'online' AND (
        NEW.is_disabled OR
        COALESCE(NEW.verification->>'verified','false') <> 'true' OR
        COALESCE((NEW.verification->>'expires_at')::timestamptz, '-infinity') <= now()
    ) THEN
        NEW.health_status := 'offline';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER engine_verification_guard BEFORE INSERT OR UPDATE ON engine_configs
    FOR EACH ROW EXECUTE FUNCTION enforce_engine_verification();
