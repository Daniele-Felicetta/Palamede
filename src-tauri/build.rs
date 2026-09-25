fn main() {
    // Il frontend compilato (frontend/dist) viene incorporato nel binario da
    // `tauri::generate_context!`, ma tauri-build non lo tiene sotto controllo:
    // senza questa riga `cargo build` considera il crate aggiornato e l'exe
    // resta con la UI vecchia (rebuild solo toccando un sorgente Rust).
    let dist = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../frontend/dist");
    println!("cargo:rerun-if-changed={}", dist.display());
    tauri_build::build()
}