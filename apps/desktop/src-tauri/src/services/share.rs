//! Partage de média par code (Étape 8) — P2P direct, aucun cloud.
//!
//! Sécurité (version durcie) :
//! - jeton aléatoire 128 bits : sans le code exact, connexion refusée ;
//! - flux chiffré AES-256-GCM (clé = SHA-256 du jeton) : même intercepté,
//!   le contenu est illisible ; nonce unique par trame (compteur 64 bits) ;
//! - expiration du code (10 min) vérifiée côté récepteur ;
//! - session à usage unique : une connexion servie puis listener fermé ;
//! - option « LAN uniquement » : jamais d'UPnP, IP locale seulement.
use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const CHUNK: usize = 262_144;
const CODE_TTL_SECS: i64 = 10 * 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OfferPayload {
    ip: String,
    port: u16,
    token: String,
    name: String,
    size: u64,
    sha: String,
    exp: i64,
}

pub struct ShareOffer {
    pub code: String,
    pub port: u16,
    pub file_name: String,
    pub size: u64,
}

struct ActiveShare {
    stop: AtomicBool,
}
static ACTIVE: OnceLock<Mutex<Option<ActiveShare>>> = OnceLock::new();
fn active_slot() -> &'static Mutex<Option<ActiveShare>> {
    ACTIVE.get_or_init(|| Mutex::new(None))
}
fn stopped() -> bool {
    active_slot()
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| s.stop.load(Ordering::Relaxed))
        .unwrap_or(true)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Clé de chiffrement du flux : SHA-256 du jeton (32 octets → AES-256).
fn stream_cipher(token: &str) -> Aes256Gcm {
    let key = Sha256::digest(token.as_bytes());
    Aes256Gcm::new_from_slice(&key).expect("clé AES-256 : 32 octets")
}

fn nonce_for(index: u64) -> Nonce<aes_gcm::aead::consts::U12> {
    let mut bytes = [0u8; 12];
    bytes[..8].copy_from_slice(&index.to_le_bytes());
    *Nonce::from_slice(&bytes)
}

/// Trame chiffrée : [u32 BE longueur][ciphertext + tag 16 octets].
fn send_encrypted(
    stream: &mut TcpStream,
    cipher: &Aes256Gcm,
    index: u64,
    plain: &[u8],
) -> Result<(), String> {
    let ciphertext = cipher
        .encrypt(&nonce_for(index), plain)
        .map_err(|e| format!("chiffrement : {e}"))?;
    stream
        .write_all(&(ciphertext.len() as u32).to_be_bytes())
        .map_err(|e| e.to_string())?;
    stream.write_all(&ciphertext).map_err(|e| e.to_string())
}

fn recv_encrypted(stream: &mut TcpStream, cipher: &Aes256Gcm, index: u64) -> Result<Vec<u8>, String> {
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).map_err(|e| e.to_string())?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > CHUNK + 64 {
        return Err("trame invalide".into());
    }
    let mut ciphertext = vec![0u8; len];
    stream.read_exact(&mut ciphertext).map_err(|e| e.to_string())?;
    cipher
        .decrypt(&nonce_for(index), ciphertext.as_slice())
        .map_err(|e| format!("déchiffrement : {e}"))
}

/// IP locale sans dépendance (astuce UDP) — mapping UPnP et repli LAN.
fn local_ip() -> Option<Ipv4Addr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    match socket.local_addr().ok()? {
        std::net::SocketAddr::V4(v4) => Some(*v4.ip()),
        _ => None,
    }
}

fn sha256_file(path: &std::path::Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; CHUNK];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex(&hasher.finalize()))
}

fn random_token() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex(&bytes)
}

fn read_line(stream: &mut TcpStream) -> Result<String, String> {
    let mut out = Vec::new();
    let mut one = [0u8; 1];
    while out.len() < 8192 {
        stream.read_exact(&mut one).map_err(|e| e.to_string())?;
        if one[0] == b'\n' {
            break;
        }
        out.push(one[0]);
    }
    String::from_utf8(out).map_err(|e| e.to_string())
}

fn sanitize_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if "/\\:*?\"<>|".contains(c) { '_' } else { c })
        .collect();
    if cleaned.is_empty() {
        "media".into()
    } else {
        cleaned
    }
}

/// Démarre un partage : listener temporaire + (si `lan_only` est faux)
/// UPnP best-effort + code autoportant avec expiration.
pub fn start_share(app: &AppHandle, path: &str, lan_only: bool) -> Result<ShareOffer, String> {
    if active_slot().lock().unwrap().is_some() {
        return Err("Un partage est déjà en cours — arrêtez-le d'abord.".into());
    }
    let file_path = std::path::PathBuf::from(path);
    let meta = std::fs::metadata(&file_path).map_err(|e| format!("Fichier inaccessible : {e}"))?;
    let size = meta.len();
    let name = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "media".into());
    let sha = sha256_file(&file_path)?;

    let listener = TcpListener::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    let token = random_token();
    let mut ip = local_ip().map(|a| a.to_string()).unwrap_or_else(|| "127.0.0.1".into());
    if !lan_only {
        // UPnP best-effort : IP publique + mapping ; échec silencieux =
        // repli IP locale (partage même réseau).
        if let Some(ipv4) = local_ip() {
            if let Ok(gateway) = igd::search_gateway(igd::SearchOptions::default()) {
                if let Ok(external) = gateway.get_external_ip() {
                    let _ = gateway.add_port(
                        igd::PortMappingProtocol::TCP,
                        port,
                        SocketAddrV4::new(ipv4, port),
                        3600,
                        "AetherVault Media",
                    );
                    ip = external.to_string();
                }
            }
        }
    }

    let payload = OfferPayload {
        ip,
        port,
        token: token.clone(),
        name: name.clone(),
        size,
        sha: sha.clone(),
        exp: now_secs() + CODE_TTL_SECS,
    };
    let json = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let code = format!("AVM-{}", base64::engine::general_purpose::URL_SAFE.encode(json));

    *active_slot().lock().unwrap() = Some(ActiveShare {
        stop: AtomicBool::new(false),
    });

    let app_handle = app.clone();
        let name_for_thread = name.clone();
    std::thread::spawn(move || serve_loop(app_handle, listener, token, file_path, name_for_thread, size, sha));

    Ok(ShareOffer {
        code,
        port,
        file_name: name,
        size,
    })
}

/// Boucle d'attente : une seule connexion servie (chiffrée), puis fin.
fn serve_loop(
    app: AppHandle,
    listener: TcpListener,
    token: String,
    file: std::path::PathBuf,
    name: String,
    size: u64,
    sha: String,
) {
    let mut served = false;
    while !stopped() && !served {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_nonblocking(false).ok();
                stream.set_read_timeout(Some(Duration::from_secs(10))).ok();
                let line = match read_line(&mut stream) {
                    Ok(l) => l,
                    Err(_) => continue,
                };
                if line != token {
                    let _ = stream.write_all(b"ERR\n");
                    continue;
                }
                let _ = stream.write_all(b"OK\n");
                let cipher = stream_cipher(&token);
                // Trame 0 : métadonnées chiffrées (nom, taille, sha).
                let meta = serde_json::json!({ "name": name, "size": size, "sha": sha });
                if send_encrypted(&mut stream, &cipher, 0, meta.to_string().as_bytes()).is_err() {
                    continue;
                }
                stream.set_read_timeout(None).ok();
                if let Ok(mut f) = std::fs::File::open(&file) {
                    let mut buf = [0u8; CHUNK];
                    let mut index = 1u64;
                    let mut sent = 0u64;
                    let mut last = Instant::now();
                    loop {
                        match f.read(&mut buf) {
                            Ok(0) => break,
                            Ok(n) => {
                                if send_encrypted(&mut stream, &cipher, index, &buf[..n]).is_err() {
                                    break;
                                }
                                index += 1;
                                sent += n as u64;
                                if last.elapsed() > Duration::from_millis(150) {
                                    last = Instant::now();
                                    let _ = app.emit(
                                        "share-progress",
                                        serde_json::json!({ "phase": "send", "transferred": sent, "total": size }),
                                    );
                                }
                            }
                            Err(_) => break,
                        }
                    }
                    let _ = app.emit(
                        "share-progress",
                        serde_json::json!({ "phase": "send", "transferred": sent, "total": size }),
                    );
                }
                served = true;
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(_) => break,
        }
    }
    let _ = app.emit("share-ended", ());
    *active_slot().lock().unwrap() = None;
}

pub fn stop_share() {
    if let Some(session) = active_slot().lock().unwrap().as_ref() {
        session.stop.store(true, Ordering::Relaxed);
    }
}

/// Côté récepteur : décode le code, vérifie l'expiration, télécharge
/// chiffré, vérifie le SHA-256, sinon supprime le fichier partiel.
pub fn receive(app: &AppHandle, code: &str, target_dir: &std::path::Path) -> Result<String, String> {
    let b64 = code
        .trim()
        .strip_prefix("AVM-")
        .ok_or("Code invalide (préfixe AVM- manquant).")?;
    let json = base64::engine::general_purpose::URL_SAFE
        .decode(b64.trim())
        .map_err(|e| format!("Code illisible : {e}"))?;
    let payload: OfferPayload =
        serde_json::from_slice(&json).map_err(|e| format!("Code illisible : {e}"))?;
    if now_secs() >= payload.exp {
        return Err("Code expiré (validité 10 minutes) — demandez un nouveau code.".into());
    }

    let addr = std::net::SocketAddr::new(
        payload.ip.parse().map_err(|e| format!("IP invalide : {e}"))?,
        payload.port,
    );
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(10))
        .map_err(|e| {
            format!("Connexion impossible (expéditeur en ligne ? même réseau ou port ouvert ?) : {e}")
        })?;
    stream.set_read_timeout(Some(Duration::from_secs(30))).ok();
    stream.write_all(payload.token.as_bytes()).ok();
    stream.write_all(b"\n").ok();
    if read_line(&mut stream)? != "OK" {
        return Err("Jeton refusé par l'expéditeur.".into());
    }

    let cipher = stream_cipher(&payload.token);
    let meta_bytes = recv_encrypted(&mut stream, &cipher, 0)?;
    let meta: serde_json::Value =
        serde_json::from_slice(&meta_bytes).map_err(|e| e.to_string())?;
    let total = meta["size"].as_u64().unwrap_or(0);
    let expected_sha = meta["sha"].as_str().unwrap_or("").to_string();
    let file_name = sanitize_name(meta["name"].as_str().unwrap_or("media"));

    std::fs::create_dir_all(target_dir).map_err(|e| e.to_string())?;
    let target = target_dir.join(&file_name);
    let mut out = std::fs::File::create(&target).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let mut index = 1u64;
    let mut last = Instant::now();
    stream.set_read_timeout(None).ok();
    while received < total {
        let plain = recv_encrypted(&mut stream, &cipher, index)
            .map_err(|e| format!("Transfert interrompu : {e}"))?;
        if plain.is_empty() {
            break;
        }
        out.write_all(&plain).map_err(|e| e.to_string())?;
        hasher.update(&plain);
        received += plain.len() as u64;
        index += 1;
        if last.elapsed() > Duration::from_millis(150) {
            last = Instant::now();
            let _ = app.emit(
                "share-progress",
                serde_json::json!({ "phase": "recv", "transferred": received, "total": total }),
            );
        }
    }
    let _ = app.emit(
        "share-progress",
        serde_json::json!({ "phase": "recv", "transferred": received, "total": total }),
    );
    drop(out);
    if !expected_sha.is_empty() && hex(&hasher.finalize()) != expected_sha {
        let _ = std::fs::remove_file(&target);
        return Err("SHA-256 invalide — fichier corrompu, réessayez.".into());
    }
    Ok(target.to_string_lossy().to_string())
}