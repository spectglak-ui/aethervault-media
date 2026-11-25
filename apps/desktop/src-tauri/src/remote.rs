//! 0.8.x — Télécommande mobile : serveur HTTP + WebSocket embarqué,
//! limité au réseau local, protégé par un token d'appairage.
//! Le téléphone scanne le QR (Paramètres → Télécommande mobile), ouvre la
//! page servie ici, et envoie des actions JSON relaies au frontend via
//! l'événement Tauri `remote-action`. L'état du lecteur revient par
//! l'événement `remote-state` (émis par le pont frontend) → broadcast WS.
//! `/auth` permet à la page de distinguer « token invalide » d'une simple
//! coupure réseau ; le ping/pong mesure la latence ; un receiver WS en
//! retard (Lagged) ne casse plus la connexion.
//! Patch 53 : sous Windows, un Wi-Fi classé « Public » fait bloquer par le
//! pare-feu les connexions entrantes du téléphone (la page ne charge pas).
//! `remote_network_check` détecte ce cas, `remote_fix_network` passe le réseau
//! en « Privé » (et crée la règle pare-feu de l'exe) après une élévation UAC.
use std::collections::HashMap;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::{header, StatusCode};
use axum::response::{Html, IntoResponse, Json};
use axum::routing::get;
use axum::Router;
use rand::Rng;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Listener};
use tokio::sync::{broadcast, broadcast::error::RecvError, Mutex};

const PORT_RANGE: std::ops::RangeInclusive<u16> = 8765..=8775;

struct Shared {
    token: String,
    app: AppHandle,
    tx: broadcast::Sender<String>,
    last: Mutex<String>,
}

pub struct Running {
    token: String,
    port: u16,
    task: tokio::task::JoinHandle<()>,
    listen_id: tauri::EventId,
}

#[derive(Default)]
pub struct RemoteManager(pub Mutex<Option<Running>>);

#[derive(Serialize, Clone)]
pub struct RemoteInfo {
    pub url: String,
    pub token: String,
    pub port: u16,
}

fn local_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
}

fn info(token: &str, port: u16) -> RemoteInfo {
    let ip = local_ip().unwrap_or_else(|| "127.0.0.1".into());
    RemoteInfo {
        url: format!("http://{}:{}/?token={}", ip, port, token),
        token: token.to_string(),
        port,
    }
}

async fn index() -> Html<&'static str> {
    Html(include_str!("remote_ui.html"))
}

async fn auth(
    State(shared): State<Arc<Shared>>,
    Query(params): Query<HashMap<String, String>>,
) -> axum::response::Response {
    if params.get("token").map(String::as_str) == Some(shared.token.as_str()) {
        (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "ok": false, "error": "token invalide" })),
        )
            .into_response()
    }
}

/* Chaîne brute à DEUX dièses : le JSON contient `"#` (couleurs hex,
   type MIME) qui fermerait prématurément un délimiteur `r#"…"#`. */
async fn manifest() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "application/manifest+json")],
        r##"{"name":"AetherVault Remote","short_name":"AV Remote","start_url":"/","display":"standalone","background_color":"#07080d","theme_color":"#07080d","icons":[{"src":"/icon.svg","sizes":"any","type":"image/svg+xml","purpose":"any"}]}"##,
    )
}

async fn sw() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "application/javascript")],
        r#"self.addEventListener("install",e=>{e.waitUntil(caches.open("avr2").then(c=>c.addAll(["/"])).catch(()=>{}))});self.addEventListener("fetch",e=>{if(e.request.mode==="navigate"){e.respondWith(fetch(e.request).catch(()=>caches.match("/")))} });"#,
    )
}

async fn icon() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "image/svg+xml")],
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#00c2ff"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><text x="32" y="44" font-size="34" font-family="monospace" text-anchor="middle" fill="#fff">&#916;</text></svg>"##,
    )
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(shared): State<Arc<Shared>>,
    Query(params): Query<HashMap<String, String>>,
) -> axum::response::Response {
    if params.get("token").map(String::as_str) != Some(shared.token.as_str()) {
        return (StatusCode::UNAUTHORIZED, "token invalide").into_response();
    }
    ws.on_upgrade(move |socket| handle_socket(socket, shared))
}

async fn handle_socket(mut socket: WebSocket, shared: Arc<Shared>) {
    let mut rx = shared.tx.subscribe();
    let snapshot = shared.last.lock().await.clone();
    if !snapshot.is_empty() && socket.send(Message::Text(snapshot.into())).await.is_err() {
        return;
    }
    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(value) = serde_json::from_str::<serde_json::Value>(text.as_str()) {
                            if value.get("action").and_then(|a| a.as_str()) == Some("ping") {
                                let pong = json!({
                                    "type": "pong",
                                    "t": value.get("t").cloned().unwrap_or(json!(0)),
                                }).to_string();
                                if socket.send(Message::Text(pong.into())).await.is_err() { break; }
                            } else {
                                let _ = shared.app.emit("remote-action", value);
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
            outgoing = rx.recv() => {
                match outgoing {
                    Ok(text) => {
                        if socket.send(Message::Text(text.into())).await.is_err() { break; }
                    }
                    // Un client lent ne doit JAMAIS être déconnecté pour retard.
                    Err(RecvError::Lagged(_)) => continue,
                    Err(RecvError::Closed) => break,
                }
            }
        }
    }
}

/// Diagnostic réseau de la télécommande (patch 53).
#[derive(Serialize, Clone)]
pub struct NetworkCheck {
    /// "windows" ou "other" (Linux / macOS : pas de diagnostic pour l'instant).
    pub platform: String,
    /// "Public", "Private" ou "DomainAuthenticated" ; `None` si inconnu.
    pub category: Option<String>,
    pub network_name: Option<String>,
    /// Vrai si le pare-feu Windows bloquera très probablement le téléphone.
    pub needs_fix: bool,
}

/// Résultat de la sonde PowerShell : `Catégorie|IndexInterface|NomDuRéseau`.
#[cfg_attr(not(windows), allow(dead_code))]
struct NetworkProbe {
    category: String,
    index: u32,
    name: String,
}

#[cfg_attr(not(windows), allow(dead_code))]
fn parse_probe(out: &str) -> Option<NetworkProbe> {
    let line = out.lines().map(str::trim).find(|l| !l.is_empty())?;
    let mut parts = line.splitn(3, '|');
    let category = parts.next()?.trim().to_string();
    let index = parts.next()?.trim().parse::<u32>().ok()?;
    let name = parts.next().unwrap_or("").trim().to_string();
    if category.is_empty() {
        return None;
    }
    Some(NetworkProbe { category, index, name })
}

#[cfg_attr(not(windows), allow(dead_code))]
fn check_from_probe(probe: Option<NetworkProbe>) -> NetworkCheck {
    match probe {
        Some(p) => NetworkCheck {
            platform: "windows".into(),
            needs_fix: p.category == "Public",
            network_name: if p.name.is_empty() { None } else { Some(p.name) },
            category: Some(p.category),
        },
        None => NetworkCheck {
            platform: "windows".into(),
            category: None,
            network_name: None,
            needs_fix: false,
        },
    }
}

#[cfg(windows)]
fn encode_powershell(script: &str) -> String {
    use base64::Engine;
    let utf16: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    base64::engine::general_purpose::STANDARD.encode(utf16)
}

/// Exécute un script PowerShell sans fenêtre ; renvoie (code de sortie, stdout).
#[cfg(windows)]
fn run_powershell(script: &str) -> Result<(i32, String), String> {
    let encoded = encode_powershell(script);
    let output = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            encoded.as_str(),
        ])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .map_err(|e| format!("PowerShell indisponible : {e}"))?;
    Ok((
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).trim().to_string(),
    ))
}

/// Catégorie du réseau portant l'IP que le QR code annonce au téléphone.
#[cfg(windows)]
fn probe_network() -> Option<NetworkProbe> {
    let ip: std::net::Ipv4Addr = local_ip()?.parse().ok()?;
    if ip.is_loopback() {
        return None;
    }
    let script = format!(
        r#"[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
try {{
  $idx = (Get-NetIPAddress -AddressFamily IPv4 -IPAddress '{ip}' | Select-Object -First 1).InterfaceIndex
  $p = Get-NetConnectionProfile -InterfaceIndex $idx | Select-Object -First 1
  Write-Output ('{{0}}|{{1}}|{{2}}' -f $p.NetworkCategory, $idx, $p.Name)
}} catch {{ exit 3 }}"#
    );
    match run_powershell(&script) {
        Ok((0, out)) => parse_probe(&out),
        _ => None,
    }
}

#[cfg(windows)]
fn network_check_blocking() -> NetworkCheck {
    check_from_probe(probe_network())
}

#[cfg(not(windows))]
fn network_check_blocking() -> NetworkCheck {
    NetworkCheck {
        platform: "other".into(),
        category: None,
        network_name: None,
        needs_fix: false,
    }
}

/// Passe le réseau en « Privé » et (re)crée la règle pare-feu entrante de cet
/// exécutable, dans une session PowerShell élevée (invite UAC).
#[cfg(windows)]
fn fix_network_blocking() -> Result<NetworkCheck, String> {
    let probe = probe_network().ok_or_else(|| "Réseau local introuvable.".to_string())?;
    let exe = std::env::current_exe().map_err(|e| format!("Chemin de l'application inconnu : {e}"))?;
    let exe_ps = exe.to_string_lossy().replace('\'', "''");

    // Script exécuté en administrateur.
    let elevated = format!(
        r#"$ErrorActionPreference = 'Stop'
try {{
  Set-NetConnectionProfile -InterfaceIndex {index} -NetworkCategory Private
  Get-NetFirewallRule -DisplayName 'AetherVault Media - Telecommande' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName 'AetherVault Media - Telecommande' -Direction Inbound -Action Allow -Protocol TCP -LocalPort '8765-8775' -RemoteAddress LocalSubnet -Program '{exe_ps}' -Profile Private | Out-Null
  exit 0
}} catch {{ exit 1 }}"#,
        index = probe.index,
    );
    // Lanceur non élevé : demande l'UAC ; code 5 = autorisation refusée.
    let launcher = format!(
        r#"$ErrorActionPreference = 'Stop'
try {{
  $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','{encoded}'
  exit $p.ExitCode
}} catch {{ exit 5 }}"#,
        encoded = encode_powershell(&elevated),
    );

    log::info!("[remote] passage du réseau « {} » en Privé (UAC)", probe.name);
    let (code, _) = run_powershell(&launcher)?;
    match code {
        0 => {}
        5 => return Err("Autorisation administrateur refusée : le réseau n'a pas été modifié.".into()),
        other => return Err(format!("Windows a refusé la modification (code {other}).")),
    }

    let after_probe = probe_network().ok_or_else(|| {
    "La modification a été exécutée, mais le profil réseau n'a pas pu être vérifié. La correction n'est pas confirmée.".to_string()
})?;

if after_probe.category != "Private" {
    return Err(format!(
        "Le réseau est toujours classé « {} » : le passage en privé n'a pas été confirmé.",
        after_probe.category
    ));
}

Ok(check_from_probe(Some(after_probe)))
}

#[cfg(not(windows))]
fn fix_network_blocking() -> Result<NetworkCheck, String> {
    Err("Cette correction n'est disponible que sous Windows.".into())
}

#[tauri::command]
pub async fn remote_network_check() -> Result<NetworkCheck, String> {
    tauri::async_runtime::spawn_blocking(network_check_blocking)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remote_fix_network() -> Result<NetworkCheck, String> {
    tauri::async_runtime::spawn_blocking(fix_network_blocking)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_probe_reads_category_index_and_name() {
        let p = parse_probe("Public|10|Bbox-ABCD 5G\r\n").unwrap();
        assert_eq!(p.category, "Public");
        assert_eq!(p.index, 10);
        assert_eq!(p.name, "Bbox-ABCD 5G");
    }

    #[test]
    fn parse_probe_keeps_pipes_inside_the_network_name() {
        let p = parse_probe("Private|3|Wi|Fi").unwrap();
        assert_eq!(p.name, "Wi|Fi");
    }

    #[test]
    fn parse_probe_rejects_garbage() {
        assert!(parse_probe("").is_none());
        assert!(parse_probe("Public|abc|x").is_none());
        assert!(parse_probe("|3|x").is_none());
    }

    #[test]
    fn only_public_networks_need_a_fix() {
        let public = check_from_probe(parse_probe("Public|10|Box"));
        let private = check_from_probe(parse_probe("Private|10|Box"));
        let domain = check_from_probe(parse_probe("DomainAuthenticated|10|Corp"));
        assert!(public.needs_fix);
        assert!(!private.needs_fix);
        assert!(!domain.needs_fix);
        assert!(!check_from_probe(None).needs_fix);
    }
}

#[tauri::command]
pub async fn remote_start(
    app: AppHandle,
    state: tauri::State<'_, RemoteManager>,
) -> Result<RemoteInfo, String> {
    let mut guard = state.0.lock().await;
    if let Some(running) = guard.as_ref() {
        return Ok(info(&running.token, running.port));
    }
    let token = format!("{:032x}", rand::thread_rng().gen::<u128>());
    let mut listener = None;
    let mut port = 0u16;
    for candidate in PORT_RANGE {
        if let Ok(l) = tokio::net::TcpListener::bind(("0.0.0.0", candidate)).await {
            listener = Some(l);
            port = candidate;
            break;
        }
    }
    let listener = listener.ok_or_else(|| "Aucun port libre (8765-8775).".to_string())?;
    let (tx, _) = broadcast::channel::<String>(64);
    let shared = Arc::new(Shared {
        token: token.clone(),
        app: app.clone(),
        tx: tx.clone(),
        last: Mutex::new(String::new()),
    });
    let last = Arc::clone(&shared);
    let listen_id = app.listen("remote-state", move |event| {
        let raw = event.payload().to_string();
        let _ = last.tx.send(raw.clone());
        if let Ok(mut guard) = last.last.try_lock() {
            *guard = raw;
        }
    });
    let router = Router::new()
        .route("/", get(index))
        .route("/auth", get(auth))
        .route("/ws", get(ws_handler))
        .route("/manifest.webmanifest", get(manifest))
        .route("/sw.js", get(sw))
        .route("/icon.svg", get(icon))
        .with_state(shared);
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    *guard = Some(Running { token: token.clone(), port, task, listen_id });
    Ok(info(&token, port))
}

#[tauri::command]
pub async fn remote_stop(
    app: AppHandle,
    state: tauri::State<'_, RemoteManager>,
) -> Result<(), String> {
    let mut guard = state.0.lock().await;
    if let Some(running) = guard.take() {
        running.task.abort();
        app.unlisten(running.listen_id);
    }
    Ok(())
}

#[tauri::command]
pub async fn remote_status(
    state: tauri::State<'_, RemoteManager>,
) -> Result<Option<RemoteInfo>, String> {
    let guard = state.0.lock().await;
    Ok(guard.as_ref().map(|r| info(&r.token, r.port)))
}