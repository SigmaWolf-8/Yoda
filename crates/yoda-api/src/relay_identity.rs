//! Persistent, dedicated TL-DSA-87 relay signer. No nonce echo, disposable
//! pretend public key, or borrowing one of the Array3 daemon identities.
use chacha20poly1305::{aead::{Aead, KeyInit, Payload}, ChaCha20Poly1305, Nonce};
use rand::RngCore;
use sha2::{Digest,Sha256};
use sqlx::{PgPool,Row};
use yoda_plenumnet_bridge::signing::{self,PrivateKey,PublicKey};

const CONTEXT: &[u8] = b"YODA-RELAY-IDENTITY-v1";

pub struct RelayIdentity {
    pub public_hex: String,
    private: PrivateKey,
}

impl RelayIdentity {
    pub async fn load_or_create(db: &PgPool) -> anyhow::Result<Self> {
        // SESSION_SECRET is accessed only by the running application, never
        // returned through an API or printed. Missing/changed keys fail closed.
        let secret = std::env::var("SESSION_SECRET")
            .map_err(|_| anyhow::anyhow!("SESSION_SECRET is required to protect the relay signing identity"))?;
        if secret.len()<32 { anyhow::bail!("SESSION_SECRET must contain at least 32 bytes for relay key protection"); }
        let mut hash = Sha256::new();
        hash.update(CONTEXT);
        hash.update(secret.as_bytes());
        let key = hash.finalize();
        let cipher = ChaCha20Poly1305::new_from_slice(&key)
            .map_err(|_| anyhow::anyhow!("Cannot initialize relay key protection"))?;
        let mut tx = db.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(671203901285)").execute(&mut *tx).await?;
        let row = sqlx::query("SELECT public_key,private_key_ciphertext,nonce FROM relay_service_identity WHERE singleton")
            .fetch_optional(&mut *tx).await?;
        let identity = if let Some(row) = row {
            let public_hex: String = row.get("public_key");
            let ciphertext: Vec<u8> = row.get("private_key_ciphertext");
            let nonce: Vec<u8> = row.get("nonce");
            if nonce.len()!=12 { anyhow::bail!("Stored relay identity nonce has invalid length"); }
            let bytes = cipher.decrypt(Nonce::from_slice(&nonce),
                Payload {msg:&ciphertext,aad:public_hex.as_bytes()})
                .map_err(|_| anyhow::anyhow!("Relay identity cannot be decrypted; restore its original SESSION_SECRET. Identity was not replaced."))?;
            Self {public_hex, private:PrivateKey(bytes)}
        } else {
            let (public,private) = signing::generate_keypair();
            let public_hex = hex::encode(&public.0);
            let mut nonce = [0u8;12];
            rand::rngs::OsRng.fill_bytes(&mut nonce);
            let encrypted = cipher.encrypt(Nonce::from_slice(&nonce),
                Payload {msg:&private.0,aad:public_hex.as_bytes()})
                .map_err(|_| anyhow::anyhow!("Cannot encrypt relay signing identity"))?;
            sqlx::query("INSERT INTO relay_service_identity (singleton,public_key,private_key_ciphertext,nonce) VALUES(TRUE,$1,$2,$3)")
                .bind(&public_hex).bind(encrypted).bind(nonce.to_vec()).execute(&mut *tx).await?;
            Self {public_hex,private}
        };
        let public = PublicKey(hex::decode(&identity.public_hex)?);
        if identity.private.0.len()!=signing::secret_key_size() || public.0.len()!=signing::public_key_size() {
            anyhow::bail!("Stored relay identity has invalid TL-DSA-87 key lengths");
        }
        let proof = signing::sign(CONTEXT,&identity.private);
        if !signing::verify(CONTEXT,&proof,&public) {
            anyhow::bail!("Stored relay signing key does not match its public key");
        }
        tx.commit().await?;
        Ok(identity)
    }

    pub fn authenticate(&self, nonce: &str, address: &str) -> anyhow::Result<serde_json::Value> {
        if nonce.is_empty() || nonce.len()>1024 || nonce.contains('|') || !nonce.is_ascii() {
            anyhow::bail!("Relay challenge nonce is malformed");
        }
        // The deployed CRS derives some service IDs with legacy 0-based
        // digits. Sign its exact opaque wire ID; translating it would break
        // the registration/signature binding. Daemon Rep C addresses are
        // unchanged, and this service ID is not presented as a Rep C address.
        if address.len()!=13 || !address.bytes().all(|b| matches!(b,b'0'..=b'3')) {
            anyhow::bail!("Relay assigned an invalid service identifier");
        }
        let payload = format!("{nonce}||{address}||{}",self.public_hex);
        let signature = signing::sign(payload.as_bytes(),&self.private);
        Ok(serde_json::json!({
            "type":"auth","address":address,"publicKey":self.public_hex,
            "nonce":nonce,"signature":hex::encode(signature.0)
        }))
    }
}
