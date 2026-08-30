// Palamede launcher — finestra di avvio/controllo dell'officina.
// Compilato con csc.exe del .NET Framework (già presente in Windows),
// nessuna dipendenza esterna.
//
// L'eseguibile INCORPORA palamede.bundle (frontend dist + hub + backends +
// scripts + llama.cpp): al primo avvio lo estrae nella propria cartella e
// poi lancia i servizi nascosti. I modelli (pesi) NON sono nel bundle:
// vengono copiati da LM Studio (Ornith) o segnalati se mancanti.
//
// Design: tema "officina a inchiostro" (come il frontend web): sumi-ink
// scuro, accenti ocra/vermiglio, titolo in serif, log in Consolas.
// UI smooth: double-buffer, flush del log a batch, fade-in all'apertura,
// progress bar durante l'estrazione del bundle. La finestra scala con la
// risoluzione dello schermo (pronta per 2K/4K) e con i DPI del monitor.
//
// Uso:  Palamede.exe            (avvia + apre browser)
//       Palamede.exe -nobrowser (avvia senza aprire il browser)
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
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

    // ── piccolo LED di stato (cerchio con glow) ──────────────────────────
    class Led : Control
    {
        Color _c = Palette.Dim;
        bool _glow = false;
        public Color Color { get { return _c; } set { _c = value; Invalidate(); } }
        public bool Glow { get { return _glow; } set { _glow = value; Invalidate(); } }

        public Led()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Size = new Size(12, 12);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle r = ClientRectangle;
            int c = Math.Min(r.Width, r.Height) / 2;
            r = new Rectangle(r.X + (r.Width - c) / 2, r.Y + (r.Height - c) / 2, c, c);
            if (_glow)
            {
                using (var soft = new SolidBrush(Color.FromArgb(60, _c)))
                    e.Graphics.FillEllipse(soft, r.X - 3, r.Y - 3, r.Width + 6, r.Height + 6);
            }
            using (var b = new SolidBrush(_c))
                e.Graphics.FillEllipse(b, r);
        }
    }

    // ── barra di avanzamento stile "binario a inchiostro" ────────────────
    class Bar : Control
    {
        int _value = 0;
        public int Value { get { return _value; } set { _value = Math.Max(0, Math.Min(100, value)); Invalidate(); } }

        public Bar()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            Height = 8;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle r = ClientRectangle;
            int rad = r.Height / 2;
            using (var track = new SolidBrush(Palette.Ink3))
            using (var path = Rounded.Rect(r, rad))
                e.Graphics.FillPath(track, path);
            if (_value <= 0) return;
            int w = Math.Max(rad * 2, (int)(r.Width * _value / 100.0));
            Rectangle fill = new Rectangle(r.X, r.Y, w, r.Height);
            using (var path = Rounded.Rect(fill, rad))
            using (var g = new LinearGradientBrush(fill, Palette.Ochre, Palette.OchreLight, LinearGradientMode.Horizontal))
                e.Graphics.FillPath(g, path);
        }
    }

    // ── helper path arrotondati ───────────────────────────────────────────
    static class Rounded
    {
        public static GraphicsPath Rect(Rectangle r, int rad)
        {
            int d = rad * 2;
            var gp = new GraphicsPath();
            gp.AddArc(r.X, r.Y, d, d, 180, 90);
            gp.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            gp.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            gp.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            gp.CloseFigure();
            return gp;
        }
    }

    // ── palette coerente col frontend (sumi-ink / ocra / vermiglio) ──────
    static class Palette
    {
        public static readonly Color Ink    = Color.FromArgb(20, 16, 11);
        public static readonly Color Ink2   = Color.FromArgb(28, 23, 16);
        public static readonly Color Ink3   = Color.FromArgb(38, 32, 23);
        public static readonly Color Line   = Color.FromArgb(58, 49, 38);
        public static readonly Color Paper  = Color.FromArgb(236, 228, 210);
        public static readonly Color Dim    = Color.FromArgb(169, 158, 138);
        public static readonly Color Faint  = Color.FromArgb(122, 112, 95);
        public static readonly Color Ochre  = Color.FromArgb(208, 138, 46);
        public static readonly Color OchreLight = Color.FromArgb(232, 168, 82);
        public static readonly Color Moss   = Color.FromArgb(127, 163, 124);
        public static readonly Color Seal   = Color.FromArgb(178, 63, 39);
    }

    class LauncherForm : Form
    {
        TextBox _log;
        Button _openBtn;
        Button _stopBtn;
        Led _statusLed;
        Label _statusText;
        Bar _progress;
        bool _autoOpen = true;
        bool _stopped = false;
        float _scale = 1f;
        Image _sealImg;
        MemoryStream _sealStream;

        // log a batch: le righe si accumulano e vengono svuotate dal timer
        // ogni ~100 ms → niente flicker con centinaia di righe in rapida
        // sequenza (estrazione bundle, polling porti).
        readonly StringBuilder _logBuf = new StringBuilder();
        readonly Timer _flushTimer;
        readonly Timer _fadeTimer;
        double _opacityStep;

        public LauncherForm(string[] args)
        {
            foreach (string a in args)
                if (string.Equals(a, "-nobrowser", StringComparison.OrdinalIgnoreCase))
                    _autoOpen = false;

            // scala UI: basata sull'altezza dello schermo (2K/4K più grande)
            try
            {
                _scale = Math.Max(1f, Math.Min(1.6f, (float)Screen.PrimaryScreen.Bounds.Height / 1000f));
            }
            catch { _scale = 1f; }

            Text = "Palamede — officina locale";
            Width = (int)(560 * _scale);
            Height = (int)(470 * _scale);
            MinimumSize = new Size((int)(520 * _scale), (int)(430 * _scale));
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Palette.Ink;
            ForeColor = Palette.Paper;
            Font = new Font("Segoe UI", 9.5f * _scale);
            FormBorderStyle = FormBorderStyle.Sizable;
            MaximizeBox = true;
            DoubleBuffered = true;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);

            // DPI scaling (si somma alla scala di risoluzione)
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96F, 96F);

            // icona della finestra: risorsa embedded (Palamede.icon)
            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Palamede.icon"))
                if (s != null) Icon = new Icon(s);

            int m = (int)(16 * _scale);        // margine esterno
            int logY = (int)(86 * _scale);

            _log = new TextBox {
                Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical,
                BackColor = Palette.Ink2, ForeColor = Palette.Paper,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Consolas", Math.Max(8.5f, 9f * _scale)),
                Location = new Point(m, logY),
                Size = new Size(Width - 2 * m, (int)(270 * _scale)),
                Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom,
            };

            _progress = new Bar {
                Location = new Point(m, logY + _log.Height + (int)(10 * _scale)),
                Size = new Size(Width - 2 * m, (int)(7 * _scale)),
                Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right,
            };

            int bw = (int)(150 * _scale), bh = (int)(34 * _scale);
            int by = Height - (int)(72 * _scale);
            _openBtn = MakeButton("Apri officina", Palette.Ochre, Palette.Ink,
                Palette.OchreLight, Palette.Ochre);
            _openBtn.Enabled = false;
            _openBtn.Location = new Point(Width - m - bw, by);
            _openBtn.Size = new Size(bw, bh);
            _openBtn.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;

            _stopBtn = MakeButton("Ferma tutto", Palette.Ink3, Palette.Paper,
                Palette.Ink2, Palette.Line);
            _stopBtn.Location = new Point(Width - m - bw - (int)(12 * _scale) - bw, by);
            _stopBtn.Size = new Size(bw, bh);
            _stopBtn.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;

            _openBtn.Click += (s, e) => OpenBrowser();
            _stopBtn.Click += (s, e) => StopAll();

            _statusLed = new Led {
                Location = new Point(m, Height - (int)(44 * _scale)),
                Size = new Size(12, 12),
                Anchor = AnchorStyles.Bottom | AnchorStyles.Left,
            };
            _statusText = new Label {
                Text = "avvio…",
                ForeColor = Palette.Dim,
                AutoSize = true,
                Location = new Point(m + (int)(22 * _scale), Height - (int)(48 * _scale)),
                Anchor = AnchorStyles.Bottom | AnchorStyles.Left,
            };

            Controls.AddRange(new Control[] { _log, _progress, _openBtn, _stopBtn, _statusLed, _statusText });

            // flush del log a batch (anti-flicker)
            _flushTimer = new Timer { Interval = 100 };
            _flushTimer.Tick += (s, e) => FlushLog();
            _flushTimer.Start();

            // fade-in morbido all'apertura
            Opacity = 0;
            _fadeTimer = new Timer { Interval = 16 };
            _fadeTimer.Tick += (s, e) =>
            {
                _opacityStep += 0.06;
                Opacity = Math.Min(1.0, _opacityStep);
                if (Opacity >= 1.0) _fadeTimer.Stop();
            };
            _fadeTimer.Start();

            Shown += async (s, e) => await StartAll();

            // Chiudendo la finestra si ferma TUTTO: i modelli escono dalla
            // VRAM (llama-server, modello server, sd-server, hub). Lo script
            // gira detached, poi aspettiamo qualche secondo perché le GPU
            // vengano davvero liberate prima che l'exe esca.
            FormClosing += (s, e) =>
            {
                _flushTimer.Stop();
                StopAll();
                System.Threading.Thread.Sleep(2500);
            };
        }

        Button MakeButton(string text, Color bg, Color fg, Color hoverBg, Color border)
        {
            var b = new Button {
                Text = text, UseVisualStyleBackColor = false,
                FlatStyle = FlatStyle.Flat, BackColor = bg, ForeColor = fg,
                Cursor = Cursors.Hand,
                Font = new Font("Segoe UI", 9.5f * _scale, FontStyle.Bold),
            };
            b.FlatAppearance.BorderSize = 1;
            b.FlatAppearance.BorderColor = border;
            b.FlatAppearance.MouseOverBackColor = hoverBg;
            b.FlatAppearance.MouseDownBackColor = bg;
            return b;
        }

        // ── log a batch ──
        void Log(string msg)
        {
            lock (_logBuf) _logBuf.AppendLine(msg);
        }

        void FlushLog()
        {
            if (InvokeRequired) { BeginInvoke((Action)FlushLog); return; }
            string chunk;
            lock (_logBuf)
            {
                if (_logBuf.Length == 0) return;
                chunk = _logBuf.ToString();
                _logBuf.Length = 0;
            }
            _log.AppendText(chunk);
            _log.SelectionStart = _log.TextLength;
            _log.ScrollToCaret();
        }

        void SetStatus(string text, Color c, bool glow)
        {
            if (InvokeRequired) { BeginInvoke((Action)(() => SetStatus(text, c, glow))); return; }
            _statusText.Text = text;
            _statusLed.Color = c;
            _statusLed.Glow = glow;
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
                _progress.Value = 100;
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
                    int lastPct = -1;
                    foreach (var e in zip.Entries)
                    {
                        string full = Path.Combine(Root, e.FullName);
                        string dir = Path.GetDirectoryName(full);
                        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                        if (e.Name.Length == 0) { n++; continue; }
                        using (var src = e.Open())
                        using (var dst = File.Create(full))
                            src.CopyTo(dst);
                        n++;
                        // progress a step del 2% (niente ridisegni continui)
                        int pct = total > 0 ? (int)((long)n * 100 / total) : 0;
                        int step = pct - (pct % 2);
                        if (step != lastPct)
                        {
                            lastPct = step;
                            int p = step;
                            BeginInvoke((Action)(() => _progress.Value = p));
                        }
                    }
                    return n;
                }).ContinueWith(t =>
                {
                    if (t.IsFaulted) { Log("  estrazione fallita: " + t.Exception.GetBaseException().Message); }
                    else
                    {
                        Log("  estrazione completata (" + t.Result + "/" + total + ")");
                        _progress.Value = 100;
                    }
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

        // bonsai è in formato Diffusers (qmodel.pt / safetensors / model_index.json),
        // NON è un GGUF: il marker valido è il model_index.json della cartella.
        bool HasBonsai()
        {
            return File.Exists(Path.Combine(Root, @"models\bonsai-image-4B-ternary-gemlite\model_index.json"));
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

            if (!HasBonsai())
                Log("  ATTENZIONE: modelli immagini mancanti (bonsai) — esegui scripts\\copy-models.ps1");
            if (!Directory.Exists(root + "\\reference\\bonsai\\.venv"))
                Log("  ATTENZIONE: reference\\bonsai\\.venv mancante — il backend immagini non partira'");
        }

        // ── avvio ──────────────────────────────────────────────────────────
        async Task StartAll()
        {
            Log("Palamede — avvio officina");
            SetStatus("avvio…", Palette.Ochre, true);
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
                SetStatus("pronto → http://127.0.0.1:4600", Palette.Moss, false);
                if (_autoOpen) OpenBrowser();
            }
            else
            {
                Log("  ERRORE: non pronto (backend=" + b + " hub=" + h + ")");
                Log("  guarda i log in outputs\\backend.log e outputs\\hub.log");
                SetStatus("errore: non pronto", Palette.Seal, true);
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
            SetStatus("fermato", Palette.Faint, false);
        }

        // ── header dipinto (seal ruotato + titolo serif + riga ocra) ──────
        // L'immagine del seal è incorporata come risorsa "Palamede.png"
        // (build-launcher.ps1 la embeda dal PNG palamede_icon.png).
        // NB: Image.FromStream richiede lo stream vivo per tutta la vita
        // dell'immagine: teniamo il MemoryStream come campo, mai dispose.
        Image SealImage()
        {
            if (_sealImg != null) return _sealImg;
            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Palamede.png"))
                if (s != null)
                {
                    _sealStream = new MemoryStream();
                    s.CopyTo(_sealStream);
                    _sealStream.Position = 0;
                    _sealImg = Image.FromStream(_sealStream);
                }
            return _sealImg;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAlias;

            // gradiente scuro sotto la barra del titolo
            int hdr = (int)(72 * _scale);
            using (var grad = new LinearGradientBrush(
                new Rectangle(0, 0, Width, hdr), Palette.Ink2, Palette.Ink, LinearGradientMode.Vertical))
                g.FillRectangle(grad, 0, 0, Width, hdr);

            // seal ruotato (immagine dell'icona, come il frontend)
            int s = (int)(34 * _scale);
            int sx = (int)(16 * _scale), sy = (int)(20 * _scale);
            g.TranslateTransform(sx + s / 2f, sy + s / 2f);
            g.RotateTransform(-3f);
            g.TranslateTransform(-s / 2f, -s / 2f);
            // NB: l'immagine è CACHATA in _sealImg (SealImage) e vive per tutta
            // la vita della form: NON disporla qui dentro. Un `using` la
            // distruggerebbe dopo il primo paint e il successivo DrawImage
            // fallirebbe con "Parametro non valido" (RawFormat su handle morto).
            var img = SealImage();
            if (img != null)
            {
                g.DrawImage(img, 0, 0, s, s);
            }
            else
            {
                // fallback (risorsa mancante): quadrato vermiglio con la "P"
                using (var b = new SolidBrush(Palette.Seal))
                    g.FillRectangle(b, 0, 0, s, s);
                using (var f = new Font("Georgia", 15f * _scale, FontStyle.Bold))
                using (var tb = new SolidBrush(Palette.Paper))
                    g.DrawString("P", f, tb, s * 0.30f, s * 0.12f);
            }
            g.ResetTransform();

            // titolo serif + sottotitolo
            using (var f = new Font("Georgia", 17f * _scale, FontStyle.Bold))
            using (var b = new SolidBrush(Palette.Ochre))
                g.DrawString("Palamede", f, b, (int)(62 * _scale), (int)(13 * _scale));
            using (var f = new Font("Segoe UI", 9f * _scale))
            using (var b = new SolidBrush(Palette.Dim))
                g.DrawString("avvio e controllo dell'officina", f, b, (int)(63 * _scale), (int)(42 * _scale));

            // riga di separazione ocra tenue
            using (var p = new Pen(Color.FromArgb(60, Palette.Ochre)))
                g.DrawLine(p, (int)(16 * _scale), (int)(72 * _scale), Width - (int)(16 * _scale), (int)(72 * _scale));
        }
    }
}