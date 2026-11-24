//! 0.8.x — Télécommande mobile : serveur HTTP + WebSocket embarqué,
//! limité au réseau local, protégé par un token d'appairage.
//! Le téléphone scanne le QR (Paramètres → Télécommande mobile), ouvre la
//! page servie ici, et envoie des actions JSON relaies au frontend via
//! l'événement Tauri `remote-action`. L'état du lecteur revient par
//! l'événement `remote-state` (émis par le pont frontend) → broadcast WS.
//! `/auth` permet à la page de distinguer « token invalide » d'une simple
//! coupure réseau ; le ping/pong mesure la latence ; un receiver WS en
//! retard (Lagged) ne casse plus la connexion.
use std::collections::HashMap;
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