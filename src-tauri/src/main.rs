// Palamede — app desktop nativa (Tauri v2).
//
// Comportamento "tray" stile WhatsApp:
//  - all'avvio lancia i servizi locali (modello server :8000, hub web :4600)
//    come processi nascosti e apre la finestra sulla UI;
//  - chiudere la finestra NON esce: l'app resta nel tray (in basso a destra)
//    e i servizi continuano (utile durante una generazione);
//  - clic sul tray → riapre la finestra;
//  - menu tray "Ferma tutto ed esci" → termina i servizi e libera RAM/VRAM;
//  - un Job Object Windows (KILL_ON_JOB_CLOSE) garantisce che, se l'app
//    muore per QUALSIASI motivo, i figli vengano terminati dal sistema.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(windows)]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

// ── Job Object: il processo padre muore → Windows termina tutti i figli ──
#[cfg(windows)]
struct KillJob(HANDLE);
#[cfg(windows)]
// Gli handle del job sono thread-safe per il nostro uso (solo adopt/kill);
// Tauri richiede che lo stato sia Send+Sync.
unsafe impl Send for KillJob {}
#[cfg(windows)]
unsafe impl Sync for KillJob {}
#[cfg(windows)]
impl KillJob {
    fn new() -> Option<KillJob> {
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                handle,
                9, // JobObjectExtendedLimitInformation
                &info as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                CloseHandle(handle);
                return None;
            }
            Some(KillJob(handle))
        }
    }
    fn adopt(&self, pid: u32) {
        unsafe {
            let proc = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if !proc.is_null() {
                AssignProcessToJobObject(self.0, proc);
                CloseHandle(proc);
            }
        }
    }
}

#[cfg(not(windows))]
struct KillJob;
#[cfg(not(windows))]
impl KillJob {
    fn new() -> Option<KillJob> { None }
    fn adopt(&self, _pid: u32) {}
}

struct Services {
    children: Mutex<Vec<Child>>,
    _job: Option<KillJob>,
}

// ── individuazione della root del progetto ───────────────────────────────
fn find_root() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    let mut dir = exe.parent().map(Path::to_path_buf).unwrap_or_default();
    for _ in 0..6 {
        if dir.join("hub").join("server.mjs").exists() {
            return dir;
        }
        if !dir.pop() {
            break;
        }
    }
    std::env::current_dir().unwrap_or_default()
}

// ── avvio dei servizi ────────────────────────────────────────────────────
fn spawn_services(root: &Path, job: &Option<KillJob>) -> Vec<Child> {
    let mut children = Vec::new();
    let py = root.join("reference").join("bonsai").join(".venv").join("Scripts").join("python.exe");
    let node = find_node();

    let mut adopt = |child: Child| {
        if let Some(j) = job {
            j.adopt(child.id());
        }
        children.push(child);
    };

    if py.exists() {
        let model = root.join("models").join("bonsai-image-4B-ternary-gemlite");
        let mut cmd = Command::new(&py);
        cmd.current_dir(root)
            .args(["-m", "uvicorn", "backends.modelserver:app", "--port", "8000"])
            .env("MFLUX_STUDIO_GPU_DEFAULT_BACKEND", "bonsai-ternary-gemlite")
            .env("MFLUX_STUDIO_GPU_TEXT_ENCODER_PATH", model.join("text_encoder-hqq-4bit"))
            .env("MFLUX_STUDIO_GPU_VAE_PATH", model.join("vae"))
            .env("MFLUX_STUDIO_GPU_TOKENIZER_PATH", model.join("text_encoder-hqq-4bit").join("tokenizer"))
            .env("MFLUX_STUDIO_GPU_TERNARY_TRANSFORMER_PATH", model.join("transformer-gemlite-int2"))
            .env("MFLUX_STUDIO_GPU_BINARY_TRANSFORMER_PATH", model.join("transformer-gemlite-int2"))
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1")
            .creation_flags(0x08000000); // CREATE_NO_WINDOW
        match cmd.spawn() {
            Ok(c) => { eprintln!("[palamede] backend :8000 avviato (pid {})", c.id()); adopt(c); }
            Err(e) => eprintln!("[palamede] backend non avviato: {e}"),
        }
    } else {
        eprintln!("[palamede] python non trovato in {}", py.display());
    }

    if let Some(node) = &node {
        let mut cmd = Command::new(node);
        cmd.current_dir(root).args(["hub/server.mjs"])
            .env("PALAMEDE_PORT", "4600")
            .creation_flags(0x08000000);
        match cmd.spawn() {
            Ok(c) => { eprintln!("[palamede] hub :4600 avviato (pid {})", c.id()); adopt(c); }
            Err(e) => eprintln!("[palamede] hub non avviato: {e}"),
        }
    } else {
        eprintln!("[palamede] node non trovato nel PATH");
    }

    children
}

fn find_node() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("NODE") { if !p.is_empty() { return Some(PathBuf::from(p)); } }
    for cand in [
        r"C:\Program Files\nodejs\node.exe",
        r"C:\Program Files (x86)\nodejs\node.exe",
    ] {
        let p = PathBuf::from(cand);
        if p.exists() { return Some(p); }
    }
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(';') {
            let p = Path::new(dir).join("node.exe");
            if p.exists() { return Some(p); }
        }
    }
    None
}

// ── verifica rapida dei modelli all'avvio (magic bytes + dimensione) ───────
// NON calcola SHA-256 (troppo lento con decine di GB): la verifica integrale
// è compito di `python experimental/model-antivirus/scan-models.py`. Restituisce una lista
// di problemi; vuota se tutto ok. I problemi "informativi" (manifest assente
// o non valido) NON devono bloccare l'avvio; conta solo la presenza di un
// problema reale (file mancante / dimensione o magic bytes sbagliati).
fn verify_models_fast(root: &Path) -> Vec<String> {
    use std::io::Read;

    let manifest_path = root.join("experimental").join("model-antivirus").join("models.manifest.json");
    if !manifest_path.exists() {
        return vec!["[verifica] manifest assente, verifiche saltate".to_string()];
    }
    let data = match std::fs::read_to_string(&manifest_path) {
        Ok(d) => d,
        Err(e) => {
            return vec![format!(
                "[verifica] impossibile leggere il manifest {}: {}",
                manifest_path.display(),
                e
            )]
        }
    };

    // parse JSON: un errore di parsing NON blocca l'avvio (trattato informativo).
    let manifest: serde_json::Value = match serde_json::from_str(&data) {
        Ok(v) => v,
        Err(e) => {
            return vec![format!(
                "[verifica] manifest non valido JSON (saltate le verifiche): {}",
                e
            )]
        }
    };

    let files = match manifest.get("files").and_then(|f| f.as_array()) {
        Some(a) => a,
        None => return Vec::new(),
    };

    let mut problems = Vec::new();
    for entry in files {
        // controlliamo solo i file con enforce=true (usati a runtime).
        if !entry.get("enforce").and_then(|e| e.as_bool()).unwrap_or(false) {
            continue;
        }
        let path_str = match entry.get("path").and_then(|p| p.as_str()) {
            Some(s) => s,
            None => continue,
        };
        let fmt = entry.get("format").and_then(|f| f.as_str()).unwrap_or("");
        // i path nel manifest sono RELATIVI a models/ (non più alla repo root)
        let file_path = root.join("models").join(path_str);

        // esistenza + dimensione.
        let size = match std::fs::metadata(&file_path) {
            Ok(m) => m.len(),
            Err(_) => {
                problems.push(format!("[verifica] {}: file non esistente", path_str));
                continue;
            }
        };
        if let Some(expected) = entry.get("size").and_then(|s| s.as_u64()) {
            if expected != size {
                problems.push(format!(
                    "[verifica] {}: dimensione {} != manifest ({})",
                    path_str, size, expected
                ));
                continue; // dimensione sbagliata: non re-agire sui magic bytes.
            }
        }

        // check magic bytes per formato (solo primi byte del file).
        if let Ok(f) = std::fs::File::open(&file_path) {
            let mut r = std::io::BufReader::new(f);
            match fmt {
                "gguf" => {
                    let mut buf = [0u8; 4];
                    if r.read_exact(&mut buf).is_ok() && &buf != b"GGUF" {
                        problems.push(format!(
                            "[verifica] {}: magic bytes GGUF attesi, trovato {:02x?}",
                            path_str, buf
                        ));
                    }
                }
                "safetensors" => {
                    let mut buf = [0u8; 8];
                    if r.read_exact(&mut buf).is_ok() {
                        let header_len = u64::from_le_bytes(buf);
                        // header_len plausibile: >=8 e <=50MB, e file abbastanza grande.
                        if !(header_len >= 8 && header_len <= 50_000_000) || size < 8 + header_len {
                            problems.push(format!(
                                "[verifica] {}: header_len safetensors non plausibile ({})",
                                path_str, header_len
                            ));
                        }
                    }
                }
                "pickle" => {
                    // .pt moderni (PyTorch >= 1.6) sono archivi ZIP ("PK"); i pickle
                    // PROTO classici iniziano con 0x80. Accettiamo entrambi per non
                    // bloccare l'avvio su file validi.
                    let mut buf = [0u8; 2];
                    if r.read_exact(&mut buf).is_ok() {
                        let ok_magic = buf[0] == 0x80 || buf == *b"PK";
                        if !ok_magic {
                            problems.push(format!(
                                "[verifica] {}: primi byte attesi 0x80/PK, trovato {:02x?}",
                                path_str, buf
                            ));
                        }
                    }
                }
                _ => {} // formato sconosciuto: non blocchiamo.
            }
        }
    }

    problems
}

// ── splash minimale ──────────────────────────────────────────────────────
const SPLASH: &str = r#"<!doctype html><html><head><meta charset="utf-8">
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0d14;color:#e7ebf3;font-family:Inter,system-ui,sans-serif}
  .box{text-align:center}
  .logo{font-family:'Space Grotesk',sans-serif;font-size:34px;font-weight:700;letter-spacing:.5px}
  .logo span{color:#8b93ff}
  .bar{width:220px;height:5px;border-radius:4px;background:#161d2b;margin:18px auto 0;overflow:hidden}
  .fill{height:100%;width:0;background:linear-gradient(90deg,#8b93ff,#34d399);animation:grow 8s ease forwards}
  @keyframes grow{to{width:100%}}
  .sub{margin-top:14px;font-size:12.5px;color:#626d84;letter-spacing:1px}
</style></head><body>
<div class="box">
  <div class="logo">Palamede<span>.</span></div>
  <div class="bar"><div class="fill"></div></div>
  <div class="sub">accensione dell'officina…</div>
</div></body></html>"#;

// ── notifica nativa (plugin) ─────────────────────────────────────────────
#[tauri::command]
fn notify(app: tauri::AppHandle, title: String, body: String) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(&title).body(&body).show();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![notify])
        .setup(|app| {
            let root = find_root();
            eprintln!("[palamede] root: {}", root.display());

            // ── verifica rapida dei modelli PRIMA di avviare i servizi ───────
            // I problemi "informativi" (manifest assente/non valido) NON bloccano;
            // conta solo la presenza di un problema reale (file mancante,
            // dimensione o magic bytes sbagliati su un file enforce=true).
            let problems = verify_models_fast(&root);
            if !problems.is_empty() {
                for p in &problems {
                    eprintln!("[palamede] {}", p);
                }
                let real: Vec<&str> = problems.iter().map(String::as_str)
                    .filter(|p| {
                        !(p.starts_with("[verifica] manifest ") ||
                          p.contains("saltate le verifiche") ||
                          p.contains("impossibile leggere il manifest"))
                    })
                    .collect();
                if !real.is_empty() {
                    eprintln!(
                        "[palamede] MODELLI NON VERIFICATI: avvio bloccato. \
                          Esegui python experimental/model-antivirus/scan-models.py"
                     );
                     return Ok(()); // NON chiamo spawn_services().
                }
            }

            // ── scanner deterministico dei modelli (model-antivirus) ────────
            // SOLO determinismo all'avvio: MAI l'audit LLM. Se lo scanner
            // fallisce con exit 2 (errore grave), avvio bloccato; altrimenti
            // si prosegue. Nessuna dipendenza di rete / fetch.
            let py = root.join("reference").join("bonsai").join(".venv")
                .join("Scripts").join("python.exe");
            if py.exists() {
                let mut scan_cmd = Command::new(py);
                scan_cmd
                    .current_dir(&root)
                    .args(["experimental/model-antivirus/scan-models.py", "--quick"])
                    .creation_flags(0x08000000);
                match scan_cmd.stdout(Stdio::inherit()).stderr(Stdio::inherit()).status() {
                    Ok(status) => {
                        let code = status.code().unwrap_or(-1);
                        if code == 2 {
                            eprintln!(
                             "[palamede] MODELLI NON VERIFICATI: avvio bloccato. \
                  Esegui python experimental/model-antivirus/scan-models.py"
                     );
                            return Ok(()); // NON chiamo spawn_services().
                        }
                        eprintln!("[palamede] scanner modelli OK (exit {})", code);
                    }
                    Err(e) => {
                        eprintln!("[palamede] scanner modelli non disponibile, procedo ({e})");
                    }
                }
            }

            let job = KillJob::new();
            if job.is_none() {
                eprintln!("[palamede] job object non creato (kill manuale comunque attivo)");
            }
            let children = spawn_services(&root, &job);
            let services = Services { children: Mutex::new(children), _job: job };
            app.manage(services);

            // ── tray icon (stile WhatsApp) ──
            let open = MenuItem::with_id(app, "open", "Apri Palamede", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Ferma tutto ed esci", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let _tray = TrayIconBuilder::with_id("palamede-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Palamede · officina locale")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => {
                        stop_services(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            // ── finestra: chiudere = nascondi nel tray (non uscire) ──
            let win = app.get_webview_window("main").expect("finestra main");
            let _ = win.eval(&format!("document.write({:?})", SPLASH));

            // attesa readiness dell'hub, poi naviga
            let win2 = app.get_webview_window("main").unwrap();
            std::thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(60);
                loop {
                    if hub_ready() {
                        eprintln!("[palamede] hub pronto, navigo la webview");
                        let _ = win2.navigate("http://127.0.0.1:4600".parse().unwrap());
                        break;
                    }
                    if Instant::now() > deadline {
                        eprintln!("[palamede] hub non pronto entro 60s");
                        let _ = win2.navigate("http://127.0.0.1:4600".parse().unwrap());
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(800));
                }
            });
            let _ = _tray;
            Ok(())
        })
        .on_window_event(|window, event| {
            // X sulla finestra → si nasconde nel tray, l'app resta viva
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("errore nella build dell'app")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // rete di sicurezza: kill diretto dei figli
                let state = app_handle.state::<Services>();
                let mut kids = state.children.lock().unwrap();
                for c in kids.iter_mut() {
                    let _ = c.kill();
                }
                eprintln!("[palamede] servizi fermati");
            }
        });
}

fn stop_services(app: &tauri::AppHandle) {
    // kill dell'albero (copre anche sd-server spawnato dal backend)
    let state = app.state::<Services>();
    let mut kids = state.children.lock().unwrap();
    for c in kids.iter_mut() {
        if c.try_wait().ok().flatten().is_none() {
            let _ = Command::new("taskkill")
                .args(["/PID", &c.id().to_string(), "/T", "/F"])
                .creation_flags(0x08000000)
                .spawn()
                .and_then(|mut k| k.wait());
        }
    }
    kids.clear();
}

fn hub_ready() -> bool {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    let Ok(mut s) = TcpStream::connect_timeout(
        &"127.0.0.1:4600".parse().unwrap(), Duration::from_millis(1500)) else {
        return false;
    };
    let _ = s.write_all(b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:4600\r\nConnection: close\r\n\r\n");
    let mut buf = [0u8; 64];
    let _ = s.read(&mut buf);
    String::from_utf8_lossy(&buf).contains("200")
}