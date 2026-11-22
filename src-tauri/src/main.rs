#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
const NO_WINDOW: u32 = 0x0800_0000;

fn hidden(cmd: &str) -> Command {
    let mut c = Command::new(cmd);
    #[cfg(windows)]
    c.creation_flags(NO_WINDOW);
    c
}

fn appdata_obs() -> PathBuf {
    PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join("obs-studio")
}

fn obs_exe() -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = vec![];
    if let Ok(out) = hidden("reg").args(["query", r"HKLM\SOFTWARE\OBS Studio", "/ve"]).output() {
        let s = String::from_utf8_lossy(&out.stdout);
        if let Some(i) = s.find("REG_SZ") {
            dirs.push(PathBuf::from(s[i + 6..].trim()));
        }
    }
    for v in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        if let Ok(p) = std::env::var(v) {
            dirs.push(PathBuf::from(p).join("obs-studio"));
        }
    }
    dirs.into_iter()
        .map(|d| d.join("bin").join("64bit").join("obs64.exe"))
        .find(|p| p.exists())
}

fn obs_running() -> bool {
    hidden("tasklist")
        .args(["/FI", "IMAGENAME eq obs64.exe", "/NH"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains("obs64.exe"))
        .unwrap_or(false)
}

fn ws_config_path() -> PathBuf {
    appdata_obs().join("plugin_config").join("obs-websocket").join("config.json")
}

#[derive(Serialize)]
struct ObsInfo {
    installed: bool,
    running: bool,
    ws_enabled: bool,
    port: u64,
    password: String,
}

#[tauri::command]
async fn obs_info() -> ObsInfo {
    let cfg: Value = std::fs::read_to_string(ws_config_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(json!({}));
    ObsInfo {
        installed: obs_exe().is_some(),
        running: obs_running(),
        ws_enabled: cfg["server_enabled"].as_bool().unwrap_or(false),
        port: cfg["server_port"].as_u64().unwrap_or(4455),
        password: if cfg["auth_required"].as_bool().unwrap_or(true) {
            cfg["server_password"].as_str().unwrap_or("").to_string()
        } else {
            String::new()
        },
    }
}

#[tauri::command]
async fn obs_launch() -> Result<(), String> {
    if obs_running() {
        return Ok(());
    }
    let exe = obs_exe().ok_or("OBS is not installed")?;
    Command::new(&exe)
        .current_dir(exe.parent().unwrap())
        .arg("--disable-shutdown-check")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn close_obs() -> Result<(), String> {
    if !obs_running() {
        return Ok(());
    }
    let _ = hidden("taskkill").args(["/IM", "obs64.exe"]).output();
    for _ in 0..40 {
        std::thread::sleep(Duration::from_millis(500));
        if !obs_running() {
            std::thread::sleep(Duration::from_millis(800));
            return Ok(());
        }
    }
    Err("OBS did not close. Close it yourself, then press Set up again.".into())
}

fn random_password() -> String {
    use rand::Rng;
    const C: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let mut r = rand::thread_rng();
    (0..16).map(|_| C[r.gen_range(0..C.len())] as char).collect()
}

/// Adds JhemsStream's transitions to the active scene collection. OBS must be closed.
fn add_transitions(stinger_dir: Option<&Path>) -> Result<(), String> {
    let base = appdata_obs();
    let mut file = "Untitled".to_string();
    for ini in ["user.ini", "global.ini"] {
        if let Ok(s) = std::fs::read_to_string(base.join(ini)) {
            if let Some(l) = s.lines().find(|l| l.starts_with("SceneCollectionFile=")) {
                file = l["SceneCollectionFile=".len()..].trim().trim_end_matches(".json").to_string();
                break;
            }
        }
    }
    let path = base.join("basic").join("scenes").join(format!("{file}.json"));
    if !path.exists() {
        return Ok(()); // first run: OBS creates it
    }
    add_transitions_to(&path, stinger_dir)
}

/// Idempotent by name: only transitions the collection doesn't already have are added, after a backup.
fn add_transitions_to(path: &Path, stinger_dir: Option<&Path>) -> Result<(), String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut doc: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let list = doc["transitions"].as_array().cloned().unwrap_or_default();
    let luma = |img: &str| json!({"luma_image": img, "luma_softness": 0.1, "luma_invert": false});
    let mut wanted = vec![
        ("Swipe", "swipe_transition", json!({"direction": "left"})),
        ("Swipe Up", "swipe_transition", json!({"direction": "up"})),
        ("Slide", "slide_transition", json!({"direction": "left"})),
        ("Slide Right", "slide_transition", json!({"direction": "right"})),
        ("Fade to Black", "fade_to_color_transition", json!({"color": 4278190080u32, "switch_point": 50})),
        ("Luma Wipe", "wipe_transition", json!({})),
        ("Luma Wipe Iris", "wipe_transition", luma("iris.png")),
        ("Luma Wipe Diagonal", "wipe_transition", luma("linear-topleft.png")),
        ("Luma Wipe Barn Door", "wipe_transition", luma("barndoor-h.png")),
    ];
    // the bundled stingers also show up as native OBS Stinger transitions (tp_type 0 = time in ms)
    let manifest: Vec<Value> = stinger_dir
        .and_then(|d| std::fs::read_to_string(d.join("stingers.json")).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let stingers: Vec<(String, Value)> = manifest
        .iter()
        .filter_map(|m| {
            let dir = stinger_dir?;
            let file = dir.join(m["file"].as_str()?);
            file.exists().then(|| {
                (format!("Stinger {}", m["name"].as_str().unwrap_or("")),
                 json!({"path": file.to_string_lossy(), "transition_point": m["cutPointMs"], "tp_type": 0}))
            })
        })
        .collect();
    for (name, settings) in &stingers {
        wanted.push((name.as_str(), "obs_stinger_transition", settings.clone()));
    }
    let mut out = list.clone();
    for (name, id, settings) in wanted {
        if !list.iter().any(|t| t["name"] == name) {
            out.push(json!({"name": name, "id": id, "settings": settings}));
        }
    }
    if out.len() == list.len() {
        return Ok(());
    }
    std::fs::copy(path, path.with_extension("json.jhemsstream-backup")).map_err(|e| e.to_string())?;
    doc["transitions"] = Value::Array(out);
    std::fs::write(path, serde_json::to_string_pretty(&doc).unwrap()).map_err(|e| e.to_string())
}

/// Stinger videos ship as app resources; OBS needs a stable path that survives updates,
/// so they're copied to %APPDATA%\JhemsStream\stingers (only files that are missing or changed).
fn stingers_ready(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dst = PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join("JhemsStream").join("stingers");
    let src = app
        .path()
        .resolve("stingers", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|p| p.join("stingers.json").exists())
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("stingers")); // dev run
    std::fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
    let entries = std::fs::read_dir(&src).map_err(|e| format!("No stingers at {}: {e}", src.display()))?;
    for e in entries.flatten() {
        let (from, to) = (e.path(), dst.join(e.file_name()));
        if !from.is_file() {
            continue;
        }
        let size = |p: &Path| std::fs::metadata(p).map(|m| m.len()).ok();
        if size(&from) != size(&to) {
            std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(dst)
}

#[tauri::command]
async fn stinger_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(stingers_ready(&app)?.to_string_lossy().into())
}

#[tauri::command]
async fn stinger_manifest(app: tauri::AppHandle) -> Result<Value, String> {
    let dir = stingers_ready(&app)?;
    let text = std::fs::read_to_string(dir.join("stingers.json")).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// Turns on obs-websocket (with a password) and adds transitions, restarting OBS if it is open.
#[tauri::command]
async fn obs_setup(app: tauri::AppHandle) -> Result<ObsInfo, String> {
    obs_exe().ok_or("OBS is not installed")?;
    close_obs()?;
    let p = ws_config_path();
    let mut cfg: Value = std::fs::read_to_string(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(json!({}));
    cfg["server_enabled"] = json!(true);
    cfg["auth_required"] = json!(true);
    if cfg["server_port"].as_u64().is_none() {
        cfg["server_port"] = json!(4455);
    }
    if cfg["server_password"].as_str().unwrap_or("").is_empty() {
        cfg["server_password"] = json!(random_password());
    }
    if cfg.get("first_load").is_none() {
        cfg["first_load"] = json!(false);
    }
    std::fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&p, serde_json::to_string_pretty(&cfg).unwrap()).map_err(|e| e.to_string())?;
    let _ = add_transitions(stingers_ready(&app).ok().as_deref());
    obs_launch().await?;
    Ok(obs_info().await)
}

#[tauri::command]
async fn obs_install() -> Result<String, String> {
    let out = hidden("winget")
        .args([
            "install", "--id", "OBSProject.OBSStudio", "-e", "--silent",
            "--accept-package-agreements", "--accept-source-agreements",
        ])
        .output()
        .map_err(|e| format!("winget is not available: {e}"))?;
    if obs_exe().is_some() {
        Ok("OBS installed".into())
    } else {
        Err(String::from_utf8_lossy(&out.stdout).lines().last().unwrap_or("Install failed").to_string())
    }
}

/* ---------- music files ---------- */

const AUDIO_EXT: [&str; 7] = ["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"];

fn is_audio(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXT.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

#[derive(Serialize, Default)]
struct Track {
    path: String,
    file: String,
    title: String,
    artist: String,
    album: String,
    isrc: String,
    copyright: String,
    label: String,
    comment: String,
    duration: f64,
}

#[tauri::command]
async fn list_audio(dir: String) -> Result<Vec<Track>, String> {
    use lofty::prelude::*;
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_file() && is_audio(p))
        .collect();
    files.sort();
    Ok(files
        .into_iter()
        .map(|p| {
            let mut t = Track {
                path: p.to_string_lossy().into(),
                file: p.file_name().unwrap().to_string_lossy().into(),
                ..Default::default()
            };
            if let Ok(f) = lofty::read_from_path(&p) {
                t.duration = f.properties().duration().as_secs_f64();
                if let Some(tag) = f.primary_tag().or(f.first_tag()) {
                    let g = |k: &lofty::tag::ItemKey| tag.get_string(k).unwrap_or("").to_string();
                    t.title = tag.title().map(|s| s.to_string()).unwrap_or_default();
                    t.artist = tag.artist().map(|s| s.to_string()).unwrap_or_default();
                    t.album = tag.album().map(|s| s.to_string()).unwrap_or_default();
                    t.isrc = g(&lofty::tag::ItemKey::Isrc);
                    t.copyright = g(&lofty::tag::ItemKey::CopyrightMessage);
                    t.label = g(&lofty::tag::ItemKey::Label);
                    if t.label.is_empty() {
                        t.label = g(&lofty::tag::ItemKey::Publisher);
                    }
                    t.comment = g(&lofty::tag::ItemKey::Comment);
                }
            }
            t
        })
        .collect())
}

#[tauri::command]
async fn read_audio(path: String) -> Result<tauri::ipc::Response, String> {
    let p = PathBuf::from(&path);
    if !is_audio(&p) {
        return Err("Not an audio file".into());
    }
    std::fs::read(&p).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

/* ---------- other apps' volume (Spotify, browser) ---------- */

#[derive(Serialize)]
struct AppAudio {
    name: String,
    volume: f32,
}

#[cfg(windows)]
fn with_sessions(mut f: impl FnMut(String, &windows::Win32::Media::Audio::ISimpleAudioVolume)) -> Result<(), String> {
    use windows::core::Interface;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;
    use windows::Win32::System::Threading::*;
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
        let dev = en.GetDefaultAudioEndpoint(eRender, eConsole).map_err(|e| e.to_string())?;
        let mgr: IAudioSessionManager2 = dev.Activate(CLSCTX_ALL, None).map_err(|e| e.to_string())?;
        let list = mgr.GetSessionEnumerator().map_err(|e| e.to_string())?;
        for i in 0..list.GetCount().map_err(|e| e.to_string())? {
            let Ok(ctl) = list.GetSession(i) else { continue };
            let Ok(ctl2) = ctl.cast::<IAudioSessionControl2>() else { continue };
            let pid = ctl2.GetProcessId().unwrap_or(0);
            if pid == 0 {
                continue;
            }
            let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { continue };
            let mut buf = [0u16; 512];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
            let _ = CloseHandle(h);
            if !ok {
                continue;
            }
            let full = String::from_utf16_lossy(&buf[..len as usize]);
            let name = full.rsplit('\\').next().unwrap_or("").to_string();
            if let Ok(v) = ctl.cast::<ISimpleAudioVolume>() {
                f(name, &v);
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn app_audio_list() -> Result<Vec<AppAudio>, String> {
    let mut out: Vec<AppAudio> = vec![];
    #[cfg(windows)]
    with_sessions(|name, v| {
        if !out.iter().any(|a| a.name.eq_ignore_ascii_case(&name)) {
            let volume = unsafe { v.GetMasterVolume() }.unwrap_or(1.0);
            out.push(AppAudio { name, volume });
        }
    })?;
    Ok(out)
}

#[tauri::command]
async fn app_audio_set(name: String, volume: f32) -> Result<(), String> {
    #[cfg(windows)]
    with_sessions(|n, v| {
        if n.eq_ignore_ascii_case(&name) {
            unsafe {
                let _ = v.SetMasterVolume(volume.clamp(0.0, 1.0), std::ptr::null());
            }
        }
    })?;
    Ok(())
}

/// Graphics adapter names, so the encoder list only offers hardware this PC has.
#[tauri::command]
async fn gpu_names() -> Vec<String> {
    hidden("powershell")
        .args(["-NoProfile", "-Command", "(Get-CimInstance Win32_VideoController).Name"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
        .unwrap_or_default()
}

/// Sends a global media key (Spotify, YouTube in browsers and most players listen to these).
#[tauri::command]
async fn media_key(key: String) -> Result<(), String> {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::Input::KeyboardAndMouse::*;
        let vk = match key.as_str() {
            "next" => VK_MEDIA_NEXT_TRACK,
            "prev" => VK_MEDIA_PREV_TRACK,
            _ => VK_MEDIA_PLAY_PAUSE,
        };
        let mk = |flags| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
        };
        let inputs = [mk(KEYBD_EVENT_FLAGS(0)), mk(KEYEVENTF_KEYUP)];
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use tauri::async_runtime::block_on;
    // Runs add_transitions_to on a scratch copy given by $SCENE_TEST_JSON (never the live collection), twice for idempotence.
    #[test]
    fn transitions_added_once() {
        let Ok(p) = std::env::var("SCENE_TEST_JSON") else { return };
        let p = std::path::PathBuf::from(p);
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("stingers");
        super::add_transitions_to(&p, Some(&dir)).unwrap();
        let first: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        super::add_transitions_to(&p, Some(&dir)).unwrap();
        let second: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        let t = first["transitions"].as_array().unwrap();
        for x in t {
            println!("{} | {} | {}", x["name"], x["id"], x["settings"]);
        }
        assert_eq!(t.len(), second["transitions"].as_array().unwrap().len(), "second run must add nothing");
        assert!(t.iter().any(|x| x["id"] == "obs_stinger_transition"));
    }
    // Safe smoke test: reads OBS info, lists $AUDIO_TEST_DIR, lists app audio sessions. Never touches OBS.
    #[test]
    fn smoke() {
        let i = block_on(super::obs_info());
        println!("obs installed={} running={} ws={} port={} pw_len={}", i.installed, i.running, i.ws_enabled, i.port, i.password.len());
        assert!(i.installed);
        if let Ok(dir) = std::env::var("AUDIO_TEST_DIR") {
            let t = block_on(super::list_audio(dir)).unwrap();
            for x in &t {
                println!("track {} title={} artist={} isrc={} label={} dur={:.1}", x.file, x.title, x.artist, x.isrc, x.label, x.duration);
            }
            assert!(t.iter().all(|x| !x.file.ends_with(".txt")));
            assert!(block_on(super::read_audio(t[0].path.clone())).is_ok());
            assert!(block_on(super::read_audio("C:\\Windows\\win.ini".into())).is_err());
        }
        let apps = block_on(super::app_audio_list()).unwrap();
        println!("apps {:?}", apps.iter().map(|a| format!("{}={:.2}", a.name, a.volume)).collect::<Vec<_>>());
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            obs_info, obs_launch, obs_setup, obs_install,
            list_audio, read_audio, app_audio_list, app_audio_set, media_key, gpu_names,
            stinger_dir, stinger_manifest
        ])
        .run(tauri::generate_context!())
        .expect("error while running JhemsStream");
}
