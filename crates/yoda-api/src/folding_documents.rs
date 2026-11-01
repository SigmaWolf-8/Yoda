//! Ephemeral file-to-text extraction. No input storage, model calls or certification.
use axum::{body::Bytes,extract::Request,http::HeaderMap,middleware::Next,response::Response,Json};
use serde_json::Value;
use crate::error::AppError;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;

static LIMIT:tokio::sync::Semaphore=tokio::sync::Semaphore::const_new(2);
pub async fn limit(request:Request,next:Next)->Result<Response,AppError>{
    let _permit=LIMIT.try_acquire().map_err(|_|AppError::Unavailable("Two documents are already being extracted; retry shortly".into()))?;
    Ok(next.run(request).await)
}
pub async fn extract(headers:HeaderMap,bytes:Bytes)->Result<Json<Value>,AppError>{
    let format=headers.get("x-document-format").and_then(|v|v.to_str().ok())
        .filter(|v|["txt","md","csv","json","html","pdf","docx"].contains(v))
        .ok_or_else(||AppError::Validation("Unsupported document format".into()))?;
    if bytes.is_empty() {return Err(AppError::Validation("Document is empty".into()));}
    let mut child=tokio::process::Command::new("python3").arg("scripts/extract-folding-text.py").arg(format)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true).spawn()
        .map_err(|_|AppError::Unavailable("Document extractor could not start".into()))?;
    let mut stdin=child.stdin.take().ok_or_else(||AppError::Internal("Extractor input unavailable".into()))?;
    // Bound the whole exchange, not just the wait after writing.
    let result=tokio::time::timeout(std::time::Duration::from_secs(20),async {
        stdin.write_all(&bytes).await.map_err(|_|AppError::Validation("Document input could not be read".into()))?;
        drop(stdin);
        let output=child.wait_with_output().await.map_err(|_|AppError::Internal("Extractor process failed".into()))?;
        let result:Value=serde_json::from_slice(&output.stdout)
            .map_err(|_|AppError::Validation("Extractor exceeded its limits or could not read the document".into()))?;
        if !output.status.success() {
            return Err(AppError::Validation(result["error"].as_str().unwrap_or("Document extraction failed").to_string()));
        }
        Ok(Json(result))
    }).await.map_err(|_|AppError::Validation("Document extraction exceeded 20 seconds; import a smaller document".into()))?;
    result
}
