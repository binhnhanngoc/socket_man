// TLS strategy selection for the WS upgrade.
//
// Two modes, chosen per connection:
//   - SecureNativeRoots (default): `connect_async` with the rustls native-roots
//     config (the Windows cert store) — full cert-chain, expiry, and hostname checks.
//   - InsecureNoVerification (opt-in `insecure_tls`): a custom verifier that accepts
//     ANY certificate and ANY hostname. This is FULL MITM exposure, not merely
//     "accept self-signed" — named honestly because it is a footgun. Default OFF;
//     the UI re-warns and badges red at every connect (see the frontend).
//
// `tls_mode` is split out and unit-tested (NOT behind `#[ignore]`) so the
// security-critical branch is always covered even when the live self-signed
// integration test is skipped.

use std::sync::Arc;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, Error as RustlsError, SignatureScheme};
use tokio::net::TcpStream;
use tokio_tungstenite::{connect_async, connect_async_tls_with_config, Connector, MaybeTlsStream, WebSocketStream};

use super::request::build_request;
use super::types::ConnectConfig;
use crate::error::AppError;

/// Which TLS strategy a config selects. Extracted so the branch is unit-testable
/// without a live socket.
#[derive(Debug, PartialEq, Eq)]
pub enum TlsMode {
    SecureNativeRoots,
    InsecureNoVerification,
}

pub fn tls_mode(cfg: &ConnectConfig) -> TlsMode {
    if cfg.insecure_tls {
        TlsMode::InsecureNoVerification
    } else {
        TlsMode::SecureNativeRoots
    }
}

/// A rustls verifier that accepts everything. Holds the crypto provider only to
/// report its supported signature schemes (required by the trait).
#[derive(Debug)]
struct NoVerification(Arc<rustls::crypto::CryptoProvider>);

impl ServerCertVerifier for NoVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, RustlsError> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

/// Build the danger connector that disables ALL verification. An explicit provider is
/// passed to `builder_with_provider` so this works whether or not a process-default
/// provider was installed.
fn insecure_connector() -> Connector {
    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let config: ClientConfig = ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .expect("aws-lc-rs supports the default protocol versions")
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(NoVerification(provider)))
        .with_no_client_auth();
    Connector::Rustls(Arc::new(config))
}

/// Open the WS upgrade, selecting the TLS strategy from `cfg.insecure_tls`. Returns
/// the same `WebSocketStream<MaybeTlsStream<TcpStream>>` for both `ws://` and
/// `wss://` so the supervisor can swap sockets across a reconnect uniformly.
pub async fn connect_ws(cfg: &ConnectConfig) -> Result<WebSocketStream<MaybeTlsStream<TcpStream>>, AppError> {
    let request = build_request(cfg)?;
    let result = match tls_mode(cfg) {
        TlsMode::InsecureNoVerification => {
            connect_async_tls_with_config(request, None, false, Some(insecure_connector())).await
        }
        TlsMode::SecureNativeRoots => connect_async(request).await,
    };
    result.map(|(ws, _resp)| ws).map_err(|e| AppError::Connect(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secure_by_default_insecure_only_when_opted_in() {
        assert_eq!(tls_mode(&ConnectConfig::default()), TlsMode::SecureNativeRoots);
        let insecure = ConnectConfig { insecure_tls: true, ..Default::default() };
        assert_eq!(tls_mode(&insecure), TlsMode::InsecureNoVerification);
    }

    #[test]
    fn insecure_connector_builds_a_rustls_connector() {
        // Proves the danger path constructs without panicking and selects rustls.
        assert!(matches!(insecure_connector(), Connector::Rustls(_)));
    }
}
