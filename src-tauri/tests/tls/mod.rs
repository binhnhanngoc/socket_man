// Test-only TLS plumbing: a local self-signed `wss://` echo server and a matching
// client connector that trusts that cert. Lets the integration test prove the
// single-task select! loop runs over a real TLS stream without any network access.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::{TlsAcceptor, TlsConnector};
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::HeaderMap;
use tokio_tungstenite::tungstenite::Message;

pub struct ServerCert {
    pub cert_der: CertificateDer<'static>,
    pub captured: Arc<Mutex<Option<HeaderMap>>>,
}

/// Spawn a self-signed TLS echo server that echoes exactly one text frame then
/// closes (deterministic end for `run_connection`). Returns its address + the cert
/// the client must trust + the captured upgrade headers.
pub async fn spawn_tls_echo_server() -> (SocketAddr, ServerCert) {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let certified = rcgen::generate_simple_self_signed(vec!["localhost".to_string()]).unwrap();
    let cert_der: CertificateDer<'static> = certified.cert.der().clone();
    let key_der = PrivatePkcs8KeyDer::from(certified.key_pair.serialize_der());

    let server_config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![cert_der.clone()], PrivateKeyDer::Pkcs8(key_der))
        .unwrap();
    let acceptor = TlsAcceptor::from(Arc::new(server_config));

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let captured = Arc::new(Mutex::new(None));
    let cap = captured.clone();

    tokio::spawn(async move {
        if let Ok((tcp, _)) = listener.accept().await {
            if let Ok(tls) = acceptor.accept(tcp).await {
                let cap = cap.clone();
                let on_req = move |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
                    *cap.lock().unwrap() = Some(req.headers().clone());
                    Ok(resp)
                };
                if let Ok(mut ws) = accept_hdr_async(tls, on_req).await {
                    if let Some(Ok(msg)) = ws.next().await {
                        let _ = ws.send(msg).await;
                    }
                    let _ = ws.close(None).await;
                }
            }
        }
    });

    (addr, ServerCert { cert_der, captured })
}

/// Connect a TLS client stream to `addr`, trusting `cert_der`, verifying the
/// "localhost" name baked into the self-signed cert.
pub async fn tls_client_connect(addr: SocketAddr, cert_der: &CertificateDer<'static>) -> tokio_rustls::client::TlsStream<TcpStream> {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let mut roots = rustls::RootCertStore::empty();
    roots.add(cert_der.clone()).unwrap();
    let client_config = rustls::ClientConfig::builder().with_root_certificates(roots).with_no_client_auth();
    let connector = TlsConnector::from(Arc::new(client_config));
    let server_name = ServerName::try_from("localhost").unwrap();
    let tcp = TcpStream::connect(addr).await.unwrap();
    connector.connect(server_name, tcp).await.unwrap()
}

// Silence dead-code analysis for the unused Message import path on some toolchains.
#[allow(dead_code)]
fn _assert_message_in_scope(_m: Message) {}
