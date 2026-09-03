//! 0.4.0 — Amis distants : appairage par code, présence, activité,
//! aperçu bibliothèque (titres + IDs TMDB uniquement) et demandes de
//! média.
//!
//! Principe absolu : AUCUNE connexion permanente. Le listener TCP est
//! passif ; des connexions sortantes éphémères ne sont ouvertes que
//! pour : appairage, ping de présence, aperçu bibliothèque, demande de
//! média. Chaque échange = une connexion, fermée aussitôt la réponse lue.

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream, UdpSocket, ToSocketAddrs};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const TIMEOUT: Duration = Duration::from_millis(2000);
const MAGIC: &str = "AVM1-";

// ---------------------------------------------------------------------
// Types wire (JSON une ligne par message)
// ---------------------------------------------------------------------

#[derive(Clone, Serialize, Deserialize)]
pub struct ActivityWire {
    pub title_name: Option<String>,
    pub category_key: Option<String>,
    pub position_seconds: Option<f64>,
    pub duration_seconds: Option<f64>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CatalogItem {
    pub title_id: i64,
    pub name: String,
    pub kind: String,
    pub category_name: String,
    pub tmdb_id: Option<i64>,
	pub poster_path: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct RemoteFriendDto {
    pub id: i64,
    pub peer_name: String,
    pub host: String,
    pub port: u16,
    pub last_seen: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct RemotePresence {
    pub id: i64,
    pub peer_name: String,
    pub online: bool,
    pub activity: Option<ActivityWire>,
}

#[derive(Clone, Serialize)]
pub struct FriendRequestDto {
    pub id: i64,
    pub friend_name: String,
    pub title_name: String,
    pub tmdb_id: Option<i64>,
    pub media_type: Option<String>,
    pub poster_path: Option<String>,
    pub status: String,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind")]
enum Msg {
    #[serde(rename = "hello")]
    Hello { token: String, name: String, host: String, port: u16 },
    #[serde(rename = "ack")]
    Ack { name: String, host: String, port: u16, activity: Option<ActivityWire> },
    #[serde(rename = "status")]
    Status { token: String },
    #[serde(rename = "status-ack")]
    StatusAck { name: String, activity: Option<ActivityWire> },
    #[serde(rename = "catalog")]
    Catalog { token: String },
    #[serde(rename = "catalog-ack")]
    CatalogAck { items: Vec<CatalogItem> },
    #[serde(rename = "request")]
    Request {
        token: String,
        title_name: String,
        tmdb_id: Option<i64>,
        media_type: Option<String>,
        poster_path: Option<String>,
    },
    #[serde(rename = "request-ack")]
    RequestAck,
    #[serde(rename = "error")]
    Error { message: String },
}

// ---------------------------------------------------------------------
// Listener passif (état global)
// ---------------------------------------------------------------------

struct ListenerState {
    port: u16,
    pairing_token: Option<String>,
    own_name: String,
}

static LISTENER: OnceLock<Arc<Mutex<ListenerState>>> = OnceLock::new();

fn listener_state() -> Arc<Mutex<ListenerState>> {
    LISTENER
        .get_or_init(|| {
            Arc::new(Mutex::new(ListenerState {
                port: 0,
                pairing_token: None,
                own_name: String::new(),
            }))
        })
        .clone()
}

/// Adresse IP locale (astuce UDP, sans dépendance).
fn local_ip() -> String {
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("8.8.8.8:80")?;
            s.local_addr()
        })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

fn ensure_listener(pool: crate::db::DbPool, app: AppHandle) -> Result<u16, String> {
    let state = listener_state();
    {
        let guard = state.lock().unwrap();
        if guard.port != 0 {
            return Ok(guard.port);
        }
    }
    let listener = TcpListener::bind("0.0.0.0:0")
        .map_err(|e| format!("Impossible d'ouvrir le listener amis : {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();
    {
        let mut guard = state.lock().unwrap();
        guard.port = port;
    }
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            if let Ok(stream) = stream {
                let pool = pool.clone();
                let app = app.clone();
                std::thread::spawn(move || {
                    let _ = handle_conn(stream, pool, app);
                });
            }
        }
    });
    Ok(port)
}

fn handle_conn(
    stream: TcpStream,
    pool: crate::db::DbPool,
    app: AppHandle,
) -> Result<(), String> {
    let _ = stream.set_read_timeout(Some(TIMEOUT));
    let _ = stream.set_write_timeout(Some(TIMEOUT));
    let peer_addr = stream.peer_addr().ok();
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|e| format!("lecture impossible : {e}"))?;
    let msg: Msg = serde_json::from_str(&line).map_err(|e| format!("message invalide : {e}"))?;

    let state = listener_state();
    let (own_name, my_host, my_port) = {
        let guard = state.lock().unwrap();
        (guard.own_name.clone(), local_ip(), guard.port)
    };

    let reply = match msg {
        Msg::Hello { token, name, host, port } => {
            let expected = state.lock().unwrap().pairing_token.clone();
            if expected.as_deref() != Some(token.as_str()) {
                Msg::Error { message: "code ami invalide ou expiré".into() }
            } else {
                if let Ok(conn) = pool.get() {
                    let _ = conn.execute(
                        "INSERT INTO remote_friends (token, my_name, peer_name, host, port, last_seen)
                         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
                         ON CONFLICT(token) DO UPDATE SET
                           peer_name = ?3, host = ?4, port = ?5, last_seen = datetime('now')",
                        rusqlite::params![token, own_name, name, host, port],
                    );
                }
                let _ = app.emit("friends:changed", ());
                Msg::Ack {
                    name: own_name.clone(),
                    host: my_host,
                    port: my_port,
                    activity: own_activity(&pool),
                }
            }
        }
        Msg::Status { token } => match friend_by_token(&pool, &token) {
            Some(_) => Msg::StatusAck { name: own_name.clone(), activity: own_activity(&pool) },
            None => Msg::Error { message: "non autorisé".into() },
        },
        Msg::Catalog { token } => match friend_by_token(&pool, &token) {
            Some(_) => Msg::CatalogAck { items: catalog_items(&pool) },
            None => Msg::Error { message: "non autorisé".into() },
        },
        Msg::Request { token, title_name, tmdb_id, media_type, poster_path } => {
            match friend_by_token(&pool, &token) {
                Some((friend_id, peer_name)) => {
                    if let Ok(conn) = pool.get() {
                        let _ = conn.execute(
                            "INSERT INTO friend_requests
                             (friend_id, title_name, tmdb_id, media_type, poster_path)
                             VALUES (?1, ?2, ?3, ?4, ?5)",
                            rusqlite::params![friend_id, title_name, tmdb_id, media_type, poster_path],
                        );
                    }
                    let _ = app.emit(
                        "friends:request",
                        FriendRequestEvent {
                            friend_name: peer_name,
                            title_name: title_name.clone(),
                        },
                    );
                    let _ = app.emit("friends:requests-changed", ());
                    Msg::RequestAck
                }
                None => Msg::Error { message: "non autorisé".into() },
            }
        }
        _ => Msg::Error { message: "message inattendu".into() },
    };

    let mut out = stream;
    let payload = serde_json::to_string(&reply).map_err(|e| e.to_string())?;
    let _ = out.write_all(payload.as_bytes());
    let _ = out.write_all(b"\n");
    let _ = out.flush();
    let _ = peer_addr;
    Ok(())
}

#[derive(Clone, serde::Serialize)]
pub struct FriendRequestEvent {
    pub friend_name: String,
    pub title_name: String,
}

// ---------------------------------------------------------------------
// Helpers DB
// ---------------------------------------------------------------------

fn friend_by_token(pool: &crate::db::DbPool, token: &str) -> Option<(i64, String)> {
    let conn = pool.get().ok()?;
    conn.query_row(
        "SELECT id, peer_name FROM remote_friends WHERE token = ?1",
        rusqlite::params![token],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .ok()
}

fn own_activity(pool: &crate::db::DbPool) -> Option<ActivityWire> {
    let conn = pool.get().ok()?;
    let visible: i32 = conn
        .query_row(
            "SELECT COALESCE((SELECT activity_visibility FROM profile_settings
              WHERE profile_id = (SELECT value FROM active_profile_view)), 1)",
            [],
            |row| row.get(0),
        )
        .unwrap_or(1);
    if visible != 1 {
        return None;
    }
    conn.query_row(
        "SELECT title_name, category_key, position_seconds, duration_seconds
         FROM profile_activity LIMIT 1",
        [],
        |row| {
            Ok(ActivityWire {
                title_name: row.get(0)?,
                category_key: row.get(1)?,
                position_seconds: row.get(2)?,
                duration_seconds: row.get(3)?,
            })
        },
    )
    .ok()
    .filter(|a: &ActivityWire| a.title_name.is_some())
}

fn table_columns(conn: &rusqlite::Connection, table: &str) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(mut stmt) = conn.prepare(&format!("PRAGMA table_info({table})")) {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(1)) {
            for r in rows.flatten() {
                out.push(r);
            }
        }
    }
    out
}

fn catalog_items(pool: &crate::db::DbPool) -> Vec<CatalogItem> {
    let Ok(conn) = pool.get() else { return Vec::new() };
    let tcols = table_columns(&conn, "titles");
    let name_col = if tcols.iter().any(|c| c == "name") { "name" } else { "title" };
    let tmdb_expr = if tcols.iter().any(|c| c == "tmdb_id") { "t.tmdb_id" } else { "NULL" };
    let poster_expr = if tcols.iter().any(|c| c == "poster_path") { "t.poster_path" } else { "NULL" };
    let kind_expr = if tcols.iter().any(|c| c == "kind") { "t.kind" } else { "''" };
    let cat_expr = if tcols.iter().any(|c| c == "category_id") {
        "COALESCE((SELECT COALESCE(c.name, '') FROM categories c WHERE c.id = t.category_id), '')"
    } else {
        "''"
    };
    let sql = format!(
        "SELECT t.id, t.{name_col}, {kind_expr}, {cat_expr}, {tmdb_expr}, {poster_expr}
         FROM titles t ORDER BY t.{name_col} LIMIT 500"
    );
    let Ok(mut stmt) = conn.prepare(&sql) else { return Vec::new() };
    let rows = stmt.query_map([], |row| {
        Ok(CatalogItem {
            title_id: row.get(0)?,
            name: row.get(1)?,
            kind: row.get(2)?,
            category_name: row.get(3)?,
            tmdb_id: row.get(4)?,
            poster_path: row.get(5)?,
        })
    });
    rows.map(|r| r.filter_map(|x| x.ok()).collect()).unwrap_or_default()
}

// ---------------------------------------------------------------------
// Client éphémère (une connexion = une requête)
// ---------------------------------------------------------------------

fn rpc(host: &str, port: u16, msg: &Msg) -> Result<Msg, String> {
    let addr: SocketAddr = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("adresse invalide : {e}"))?
        .next()
        .ok_or_else(|| "adresse introuvable".to_string())?;
    let stream = TcpStream::connect_timeout(&addr, TIMEOUT)
        .map_err(|_| "ami injoignable (hors ligne ou NAT fermé)".to_string())?;
    let _ = stream.set_read_timeout(Some(TIMEOUT));
    let _ = stream.set_write_timeout(Some(TIMEOUT));
    let payload = serde_json::to_string(msg).map_err(|e| e.to_string())?;
    let mut s = stream.try_clone().map_err(|e| e.to_string())?;
    s.write_all(payload.as_bytes()).map_err(|e| e.to_string())?;
    s.write_all(b"\n").map_err(|e| e.to_string())?;
    s.flush().map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|e| format!("réponse illisible : {e}"))?;
    serde_json::from_str(&line).map_err(|e| format!("réponse invalide : {e}"))
}

// ---------------------------------------------------------------------
// Commandes Tauri
// ---------------------------------------------------------------------

#[tauri::command]
pub fn friends_generate_code(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let pool = state.db_pool.clone();
    let own_name = {
        let active = state.active_profile_id.lock().unwrap();
        let conn = pool.get().map_err(|e| e.to_string())?;
        match *active {
            Some(id) => conn
                .query_row("SELECT name FROM profiles WHERE id = ?1", rusqlite::params![id], |r| {
                    r.get::<_, String>(0)
                })
                .unwrap_or_else(|_| "Ami".into()),
            None => "Ami".into(),
        }
    };
    let port = ensure_listener(pool.clone(), app)?;
    let token = {
        let mut bytes = [0u8; 16];
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(1);
        for (i, b) in bytes.iter_mut().enumerate() {
            *b = (seed >> (i % 16 * 4)) as u8 ^ (i as u8).wrapping_mul(37);
        }
        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
    };
    let state_arc = listener_state();
    {
        let mut guard = state_arc.lock().unwrap();
        guard.pairing_token = Some(token.clone());
        guard.own_name = own_name;
    }
    let ticket = serde_json::json!({ "host": local_ip(), "port": port, "token": token });
    Ok(format!("{MAGIC}{}", b64_encode(ticket.to_string().as_bytes())))
}

#[tauri::command]
pub fn friends_add_by_code(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    code: String,
) -> Result<RemoteFriendDto, String> {
    let pool = state.db_pool.clone();
    let trimmed = code.trim();
    let Some(b64) = trimmed.strip_prefix(MAGIC) else {
        return Err("Format de code invalide.".into());
    };
    let json = b64_decode(b64).ok_or_else(|| "Code illisible.".to_string())?;
    let ticket: serde_json::Value =
        serde_json::from_slice(&json).map_err(|_| "Code corrompu.".to_string())?;
    let host = ticket["host"].as_str().unwrap_or_default().to_string();
    let port = ticket["port"].as_u64().unwrap_or(0) as u16;
    let token = ticket["token"].as_str().unwrap_or_default().to_string();
    if host.is_empty() || port == 0 || token.is_empty() {
        return Err("Code incomplet.".into());
    }
    let my_port = ensure_listener(pool.clone(), app)?;
    let own_name = {
        let active = state.active_profile_id.lock().unwrap();
        let conn = pool.get().map_err(|e| e.to_string())?;
        match *active {
            Some(id) => conn
                .query_row("SELECT name FROM profiles WHERE id = ?1", rusqlite::params![id], |r| {
                    r.get::<_, String>(0)
                })
                .unwrap_or_else(|_| "Ami".into()),
            None => "Ami".into(),
        }
    };
    let state_arc = listener_state();
    {
        let mut guard = state_arc.lock().unwrap();
        guard.own_name = own_name.clone();
    }
    let reply = rpc(
        &host,
        port,
        &Msg::Hello { token: token.clone(), name: own_name.clone(), host: local_ip(), port: my_port },
    )?;
    let Msg::Ack { name, host: peer_host, port: peer_port, .. } = reply else {
        return Err("L'ami a refusé l'appairage (code invalide ?).".into());
    };
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO remote_friends (token, my_name, peer_name, host, port, last_seen)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
         ON CONFLICT(token) DO UPDATE SET
           peer_name = ?3, host = ?4, port = ?5, last_seen = datetime('now')",
        rusqlite::params![token, own_name, name, peer_host, peer_port],
    )
    .map_err(|e| format!("Enregistrement impossible : {e}"))?;
    let id = conn.last_insert_rowid();
    Ok(RemoteFriendDto {
        id,
        peer_name: name,
        host: peer_host,
        port: peer_port,
        last_seen: None,
    })
}

#[tauri::command]
pub fn friends_list_remote(state: tauri::State<'_, AppState>) -> Result<Vec<RemoteFriendDto>, String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, peer_name, host, port, last_seen FROM remote_friends ORDER BY peer_name")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(RemoteFriendDto {
                id: row.get(0)?,
                peer_name: row.get(1)?,
                host: row.get(2)?,
                port: row.get(3)?,
                last_seen: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn friends_remove_remote(state: tauri::State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM remote_friends WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn friends_ping_all(state: tauri::State<'_, AppState>) -> Result<Vec<RemotePresence>, String> {
    let friends = friends_list_remote(state.clone())?;
    let pool = state.db_pool.clone();
    let mut out = Vec::new();
    for f in friends {
        let presence = match rpc(&f.host, f.port, &Msg::Status { token: token_of(&pool, f.id) }) {
            Ok(Msg::StatusAck { name, activity }) => {
                if let Ok(conn) = pool.get() {
                    let _ = conn.execute(
                        "UPDATE remote_friends SET last_seen = datetime('now'), peer_name = ?2 WHERE id = ?1",
                        rusqlite::params![f.id, name],
                    );
                }
                RemotePresence { id: f.id, peer_name: f.peer_name, online: true, activity }
            }
            _ => RemotePresence { id: f.id, peer_name: f.peer_name, online: false, activity: None },
        };
        out.push(presence);
    }
    Ok(out)
}

fn token_of(pool: &crate::db::DbPool, id: i64) -> String {
    pool.get()
        .ok()
        .and_then(|conn| {
            conn.query_row("SELECT token FROM remote_friends WHERE id = ?1", rusqlite::params![id], |r| {
                r.get::<_, String>(0)
            })
            .ok()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub fn friends_fetch_catalog(
    state: tauri::State<'_, AppState>,
    friend_id: i64,
) -> Result<Vec<CatalogItem>, String> {
    let pool = state.db_pool.clone();
    let (host, port) = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT host, port FROM remote_friends WHERE id = ?1",
            rusqlite::params![friend_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, u16>(1)?)),
        )
        .map_err(|_| "Ami introuvable.".to_string())?
    };
    match rpc(&host, port, &Msg::Catalog { token: token_of(&pool, friend_id) })? {
        Msg::CatalogAck { items } => Ok(items),
        Msg::Error { message } => Err(message),
        _ => Err("Réponse inattendue.".into()),
    }
}

#[tauri::command]
pub fn friends_send_request(
    state: tauri::State<'_, AppState>,
    friend_id: i64,
    item: CatalogItem,
) -> Result<(), String> {
    let pool = state.db_pool.clone();
    let (host, port) = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT host, port FROM remote_friends WHERE id = ?1",
            rusqlite::params![friend_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, u16>(1)?)),
        )
        .map_err(|_| "Ami introuvable.".to_string())?
    };
    match rpc(
        &host,
        port,
        &Msg::Request {
            token: token_of(&pool, friend_id),
            title_name: item.name.clone(),
            tmdb_id: item.tmdb_id,
            media_type: Some(item.kind.clone()),
            poster_path: None,
        },
    )? {
        Msg::RequestAck => Ok(()),
        Msg::Error { message } => Err(message),
        _ => Err("Réponse inattendue.".into()),
    }
}

#[tauri::command]
pub fn friends_list_requests(state: tauri::State<'_, AppState>) -> Result<Vec<FriendRequestDto>, String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT r.id, f.peer_name, r.title_name, r.tmdb_id, r.media_type, r.poster_path, r.status
             FROM friend_requests r JOIN remote_friends f ON f.id = r.friend_id
             ORDER BY r.created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(FriendRequestDto {
                id: row.get(0)?,
                friend_name: row.get(1)?,
                title_name: row.get(2)?,
                tmdb_id: row.get(3)?,
                media_type: row.get(4)?,
                poster_path: row.get(5)?,
                status: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn friends_set_request_status(
    state: tauri::State<'_, AppState>,
    id: i64,
    status: String,
) -> Result<(), String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE friend_requests SET status = ?2 WHERE id = ?1",
        rusqlite::params![id, status],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------
// base64 minimal (sans dépendance)
// ---------------------------------------------------------------------

const B64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn b64_encode(data: &[u8]) -> String {
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64_ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(B64_ALPHABET[(n >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
            out.push(B64_ALPHABET[(n >> 6) as usize & 63] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(B64_ALPHABET[n as usize & 63] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn b64_decode(s: &str) -> Option<Vec<u8>> {
    let rev = |c: u8| -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a') as u32 + 26),
            b'0'..=b'9' => Some((c - b'0') as u32 + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    };
    let clean: Vec<u8> = s.bytes().filter(|&b| b != b'=' && b != b'\n' && b != b'\r').collect();
    let mut out = Vec::new();
    for chunk in clean.chunks(4) {
        let mut n = 0u32;
        let mut count = 0;
        for &b in chunk {
            n = (n << 6) | rev(b)?;
            count += 1;
        }
        n <<= (4 - count) * 6;
        out.push((n >> 16) as u8);
        if count > 2 {
            out.push((n >> 8) as u8);
        }
        if count > 3 {
            out.push(n as u8);
        }
    }
    Some(out)
}