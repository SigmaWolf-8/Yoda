-- Dedicated YODA service identity, not an Array3 daemon identity.
-- Private key material is AEAD-encrypted in the application before insertion.
CREATE TABLE relay_service_identity (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    public_key TEXT NOT NULL,
    private_key_ciphertext BYTEA NOT NULL,
    nonce BYTEA NOT NULL CHECK (octet_length(nonce)=12),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
