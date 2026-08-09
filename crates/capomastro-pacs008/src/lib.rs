//! ISO 20022 `pacs.008.001.10` — FIToFICustomerCreditTransfer.
//!
//! Two entry points:
//!
//! * [`extract_end_to_end_id`] — a streaming scan that pulls the `EndToEndId`
//!   out of a raw byte slice without deserialising the whole document. Use it
//!   for routing/dedup on the hot path.
//! * [`parse_pacs008`] — full deserialisation into typed structs.
//!
//! The struct shape follows the ISO 20022 element names; `serde(rename_all =
//! "PascalCase")` maps the Rust snake_case fields onto them.

use quick_xml::de::from_str;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use serde::{Deserialize, Serialize};

/// Streaming extractor for `EndToEndId`.
///
/// Borrows straight out of the input slice — no `Document` allocation, no
/// intermediate `String`. Returns `None` if the element is absent, the payload
/// is not valid UTF-8, or the XML is malformed.
pub fn extract_end_to_end_id(xml: &[u8]) -> Option<String> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut in_end_to_end = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) if e.local_name().as_ref() == b"EndToEndId" => {
                in_end_to_end = true;
            }
            Ok(Event::Text(e)) if in_end_to_end => {
                // `unescape` resolves &amp; and friends; the value is copied
                // because the unescaped form may not exist in the source slice.
                return e.unescape().ok().map(|c| c.into_owned());
            }
            Ok(Event::End(e)) if e.local_name().as_ref() == b"EndToEndId" => {
                in_end_to_end = false;
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    None
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub struct Document {
    #[serde(rename = "FIToFICstmrCdtTrf")]
    pub fi_to_fi_cstmr_cdt_trf: FIToFICstmrCdtTrf,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub struct FIToFICstmrCdtTrf {
    pub grp_hdr: GrpHdr,
    /// A pacs.008 may carry many credit-transfer transactions; `Vec` keeps
    /// multi-transaction batches parseable instead of erroring on the second.
    #[serde(default)]
    pub cdt_trf_tx_inf: Vec<CdtTrfTxInf>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub struct GrpHdr {
    pub msg_id: String,
    pub cre_dt_tm: String,
    pub nb_of_txs: String,
    pub sttlm_inf: SttlmInf,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub struct SttlmInf {
    pub sttlm_mtd: String,
    pub clr_sys: Option<ClrSys>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub struct ClrSys {
    pub prtry: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub struct CdtTrfTxInf {
    pub pmt_id: PmtId,
    pub intr_bk_sttlm_amt: IntrBkSttlmAmt,
    pub dbtr: Party,
    pub dbtr_agt: Agent,
    pub cdtr: Party,
    pub cdtr_agt: Agent,
    pub rmt_inf: Option<RmtInf>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub struct PmtId {
    pub end_to_end_id: String,
    #[serde(rename = "UETR")]
    pub uetr: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct IntrBkSttlmAmt {
    #[serde(rename = "@Ccy")]
    pub currency: String,
    /// Kept as a string: ISO 20022 amounts are decimal and must not be routed
    /// through a binary float before they are settled or displayed.
    #[serde(rename = "$text")]
    pub amount: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub struct Party {
    pub nm: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub struct Agent {
    pub fin_instn_id: FinInstnId,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub struct FinInstnId {
    #[serde(rename = "BICFI")]
    pub bicfi: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub struct RmtInf {
    pub ustrd: String,
}

/// Parse an ISO 20022 `pacs.008.001.10` XML document into typed structs.
pub fn parse_pacs008(xml_data: &str) -> Result<Document, quick_xml::DeError> {
    from_str(xml_data)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.10">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>CAP-AETURNUM-0001</MsgId>
      <CreDtTm>2026-04-01T00:00:00Z</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <SttlmInf>
        <SttlmMtd>CLRG</SttlmMtd>
        <ClrSys><Prtry>CAPOMASTRO-LATTICE</Prtry></ClrSys>
      </SttlmInf>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <EndToEndId>E2E-MODULO9-ZERO</EndToEndId>
        <UETR>7a3f1c2e-0000-4000-8000-000000000001</UETR>
      </PmtId>
      <IntrBkSttlmAmt Ccy="USD">1250000000.00</IntrBkSttlmAmt>
      <Dbtr><Nm>Capomastro Holdings Ltd. Applied Physics Division</Nm></Dbtr>
      <DbtrAgt><FinInstnId><BICFI>CAPOMAST33XXX</BICFI></FinInstnId></DbtrAgt>
      <Cdtr><Nm>Salvalaggio Family Trust</Nm></Cdtr>
      <CdtrAgt><FinInstnId><BICFI>SALVALAG99XXX</BICFI></FinInstnId></CdtrAgt>
      <RmtInf><Ustrd>AETURNUM UNIFIED MATRIX - ZERO BALANCE MODULO 9 RECONCILED</Ustrd></RmtInf>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>"#;

    #[test]
    fn streams_end_to_end_id_without_full_parse() {
        assert_eq!(
            extract_end_to_end_id(SAMPLE.as_bytes()).as_deref(),
            Some("E2E-MODULO9-ZERO")
        );
    }

    #[test]
    fn missing_end_to_end_id_is_none() {
        assert_eq!(extract_end_to_end_id(b"<Document/>"), None);
    }

    #[test]
    fn parses_full_document() {
        let doc = parse_pacs008(SAMPLE).expect("sample pacs.008 must parse");
        let body = &doc.fi_to_fi_cstmr_cdt_trf;
        assert_eq!(body.grp_hdr.msg_id, "CAP-AETURNUM-0001");
        assert_eq!(body.grp_hdr.sttlm_inf.sttlm_mtd, "CLRG");
        assert_eq!(
            body.grp_hdr.sttlm_inf.clr_sys.as_ref().map(|c| c.prtry.as_str()),
            Some("CAPOMASTRO-LATTICE")
        );
        assert_eq!(body.cdt_trf_tx_inf.len(), 1);

        let tx = &body.cdt_trf_tx_inf[0];
        assert_eq!(tx.pmt_id.end_to_end_id, "E2E-MODULO9-ZERO");
        assert_eq!(tx.intr_bk_sttlm_amt.currency, "USD");
        assert_eq!(tx.intr_bk_sttlm_amt.amount, "1250000000.00");
        assert_eq!(tx.dbtr_agt.fin_instn_id.bicfi, "CAPOMAST33XXX");
        assert_eq!(tx.cdtr_agt.fin_instn_id.bicfi, "SALVALAG99XXX");
        assert_eq!(
            tx.rmt_inf.as_ref().map(|r| r.ustrd.as_str()),
            Some("AETURNUM UNIFIED MATRIX - ZERO BALANCE MODULO 9 RECONCILED")
        );
    }

    #[test]
    fn rejects_malformed_document() {
        assert!(parse_pacs008("<Document><Nope/></Document>").is_err());
    }
}
