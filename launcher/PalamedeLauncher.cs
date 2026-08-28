// Palamede launcher — piccola finestra di avvio/controllo dell'officina.
// Compilato con csc.exe del .NET Framework (già presente in Windows),
// nessuna dipendenza esterna.
//
// L'eseguibile INCORPORA palamede.bundle (frontend dist + hub + backends +
// scripts + llama.cpp): al primo avvio lo estrae nella propria cartella e
// poi lancia i servizi nascosti. I modelli (pesi) NON sono nel bundle:
// vengono copiati da LM Studio (Ornith) o segnalati se mancanti.
//
// Uso:  Palamede.exe            (avvia + apre browser)
//       Palamede.exe -nobrowser (avvia senza aprire il browser)
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace PalamedeLauncher
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new LauncherForm(args));
        }
    }

    class LauncherForm : Form
    {
        TextBox _log;
        Button _openBtn;
        Button _stopBtn;
        bool _autoOpen = true;
        bool _stopped = false;

        static readonly Color Ink   = Color.FromArgb(20, 16, 11);
        static readonly Color Ink2  = Color.FromArgb(28, 23, 16);
        static readonly Color Paper = Color.FromArgb(236, 228, 210);
        static readonly Color Dim   = Color.FromArgb(169, 158, 138);
        static readonly Color Ochre = Color.FromArgb(208, 138, 46);

        public LauncherForm(string[] args)
        {
            foreach (string a in args)
                if (string.Equals(a, "-nobrowser", StringComparison.OrdinalIgnoreCase))
                    _autoOpen = false;

            Text = "Palamede — officina locale";
            Width = 500; Height = 396;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Ink; ForeColor = Paper;
            Font = new Font("Segoe UI", 9.5f);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;

            var title = new Label {
                Text = "Palamede",
                Font = new Font("Segoe UI", 15f, FontStyle.Bold),
                ForeColor = Ochre,
                Location = new Point(16, 12), AutoSize = true,
            };
            var sub = new Label {
                Text = "avvio e controllo dell'officina di generazione",
                ForeColor = Dim,
                Location = new Point(16, 42), AutoSize = true,
            };
            _log = new TextBox {
                Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical,
                BackColor = Ink2, ForeColor = Paper,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Consolas", 9f),
                Location = new Point(16, 70), Size = new Size(456, 210),
            };
            _openBtn = new Button {
                Text = "Apri officina", Enabled = false,
                Location = new Point(16, 296), Size = new Size(146, 34),
                BackColor = Ochre, ForeColor = Ink,
                FlatStyle = FlatStyle.Flat,
            };
            _stopBtn = new Button {
                Text = "Ferma tutto",
                Location = new Point(172, 296), Size = new Size(146, 34),
                BackColor = Color.FromArgb(40, 33, 24), ForeColor = Paper,
                FlatStyle = FlatStyle.Flat,
            };
            _openBtn.Click += (s, e) => OpenBrowser();
            _stopBtn.Click += (s, e) => StopAll();

            Controls.AddRange(new Control[] { title, sub, _log, _openBtn, _stopBtn });
            Shown += async (s, e) => await StartAll();

            // Chiudendo la finestra si ferma TUTTO: i modelli escono dalla
            // VRAM (llama-server, modello server, sd-server, hub). Lo script
            // gira detached, poi aspettiamo qualche secondo perché le GPU
            // vengano davvero liberate prima che l'exe esca.
            FormClosing += (s, e) =>
            {
                StopAll();
                System.Threading.Thread.Sleep(2500);
            };
        }

        void Log(string msg)
        {
            if (InvokeRequired) { BeginInvoke((Action)(() => Log(msg))); return; }
            _log.AppendText(msg + Environment.NewLine);
            _log.SelectionStart = _log.TextLength;
            _log.ScrollToCaret();
        }

        static bool PortOpen(int port)
        {
            try { using (var c = new TcpClient()) { c.Connect("127.0.0.1", port); return true; } }
            catch { return false; }
        }

        void SpawnPs(string script)
        {
            // Finestra nascosta: nessuna console visibile, i log vanno su
            // file (outputs/backend.log, outputs/hub.log) grazie a -Hidden.
            var psi = new ProcessStartInfo {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\" -Hidden",
                WindowStyle = ProcessWindowStyle.Hidden,
                UseShellExecute = true,
            };
            Process.Start(psi);
        }

        string Root
        {
            get
            {
                string exe = new Uri(Assembly.GetExecutingAssembly().CodeBase).LocalPath;
                return Path.GetDirectoryName(exe); // l'exe vive alla radice del progetto
            }
        }

        // ── bundle incorporato: estrazione se cambiato ─────────────────────
        string BundleStamp()
        {
            using (var sha = SHA256.Create())
            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Palamede.bundle"))
            {
                if (s == null) return null;
                byte[] h = sha.ComputeHash(s);
                var sb = new StringBuilder();
                foreach (byte b in h) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }

        async Task EnsureBundle()
        {
            string stamp = BundleStamp();
            if (stamp == null) { Log("  (nessun bundle: uso i file su disco)"); return; }
            string stampFile = Path.Combine(Root, "runtime.stamp");
            if (File.Exists(stampFile) && File.ReadAllText(stampFile).Trim() == stamp)
            {
                Log("  codice aggiornato (bundle ok)");
                return;
            }
            Log("  estraggo il codice dall'exe… (prima esecuzione o codice nuovo)");
            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Palamede.bundle"))
            using (var zip = new ZipArchive(s, ZipArchiveMode.Read))
            {
                int total = zip.Entries.Count;
                await Task.Run(() =>
                {
                    int n = 0;
                    foreach (var e in zip.Entries)
                    {
                        string full = Path.Combine(Root, e.FullName);
                        string dir = Path.GetDirectoryName(full);
                        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                        if (e.Name.Length == 0) { n++; continue; }
                        using (var src = e.Open())
                        using (var dst = File.Create(full))
                            src.CopyTo(dst);
                        if ((++n % 600) == 0) Log("  …" + n + "/" + total + " file");
                    }
                    return n;
                }).ContinueWith(t =>
                {
                    if (t.IsFaulted) Log("  estrazione fallita: " + t.Exception.GetBaseException().Message);
                    else Log("  estrazione completata (" + t.Result + "/" + total + ")");
                }, TaskScheduler.FromCurrentSynchronizationContext());
            }
            File.WriteAllText(stampFile, stamp);
        }

        // ── modelli: copiati da LM Studio se mancanti ─────────────────────
        void CopyDir(string src, string dst)
        {
            if (!Directory.Exists(src)) return;
            Directory.CreateDirectory(dst);
            foreach (string f in Directory.GetFiles(src))
                File.Copy(f, Path.Combine(dst, Path.GetFileName(f)), true);
            foreach (string d in Directory.GetDirectories(src))
                CopyDir(d, Path.Combine(dst, Path.GetFileName(d)));
        }

        bool HasModel(string relDir)
        {
            string full = Path.Combine(Root, relDir);
            return Directory.Exists(full) && Directory.GetFiles(full, "*.gguf", SearchOption.AllDirectories).Length > 0;
        }

        void EnsureModels()
        {
            string root = Root;
            string lm = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
                        + "\\.lmstudio\\models\\ornith-ai";

            if (!HasModel(@"models\ornith-1.5-35b") || !HasModel(@"models\ornith-1.5-9b"))
            {
                Log("  modelli chat mancanti: copio da LM Studio…");
                if (!Directory.Exists(lm)) { Log("  LM Studio non trovato: scarica i modelli ornith in models/"); }
                else
                {
                    if (!HasModel(@"models\ornith-1.5-35b") && Directory.Exists(lm + "\\Ornith-1.5-35B-A3B-GGUF"))
                    { CopyDir(lm + "\\Ornith-1.5-35B-A3B-GGUF", root + "\\models\\ornith-1.5-35b"); Log("  copiati: Ornith 1.5 35B-A3B"); }
                    if (!HasModel(@"models\ornith-1.5-9b") && Directory.Exists(lm + "\\Ornith-1.5-9B-GGUF"))
                    { CopyDir(lm + "\\Ornith-1.5-9B-GGUF", root + "\\models\\ornith-1.5-9b"); Log("  copiati: Ornith 1.5 9B"); }
                }
            }

            if (!HasModel(@"models\bonsai-image-4B-ternary-gemlite"))
                Log("  ATTENZIONE: modelli immagini mancanti (bonsai) — esegui scripts\\copy-models.ps1");
            if (!Directory.Exists(root + "\\reference\\bonsai\\.venv"))
                Log("  ATTENZIONE: reference\\bonsai\\.venv mancante — il backend immagini non partira'");
        }

        // ── avvio ──────────────────────────────────────────────────────────
        async Task StartAll()
        {
            Log("Palamede — avvio officina");
            string root = Root;
            await EnsureBundle();
            EnsureModels();

            bool b = PortOpen(8000), h = PortOpen(4600);
            if (b) Log("  modello server già attivo (:8000)");
            else   { Log("  avvio modello server (:8000)…"); SpawnPs(root + "\\scripts\\start-backend.ps1"); }
            if (h) Log("  hub già attivo (:4600)");
            else   { Log("  avvio hub (:4600)…"); SpawnPs(root + "\\scripts\\start-hub.ps1"); }

            DateTime deadline = DateTime.Now.AddSeconds(120);
            while (DateTime.Now < deadline && !(b && h))
            {
                await Task.Delay(700);
                if (!b) b = PortOpen(8000);
                if (!h) h = PortOpen(4600);
            }

            if (b && h)
            {
                Log("  pronto -> http://127.0.0.1:4600");
                _openBtn.Enabled = true;
                if (_autoOpen) OpenBrowser();
            }
            else
            {
                Log("  ERRORE: non pronto (backend=" + b + " hub=" + h + ")");
                Log("  guarda i log in outputs\\backend.log e outputs\\hub.log");
                MessageBox.Show(
                    "Palamede non e' riuscita ad avviarsi.\n" +
                    "Guarda i log in outputs\\backend.log e outputs\\hub.log\n" +
                    "e verifica i prerequisiti (scripts/setup.ps1).",
                    "Palamede");
            }
        }

        void OpenBrowser()
        {
            try { Process.Start("http://127.0.0.1:4600"); } catch { }
        }

        void StopAll()
        {
            if (_stopped) return;
            _stopped = true;
            SpawnPs(Root + "\\scripts\\stop-all.ps1");
            Log("fermati: modello server, hub e chat (VRAM liberata)");
            _openBtn.Enabled = false;
        }
    }
}