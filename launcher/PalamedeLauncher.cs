// Palamede launcher — piccola finestra di avvio/controllo dell'officina.
// Compilato con csc.exe del .NET Framework (già presente in Windows),
// nessuna dipendenza esterna. Il lavoro vero resta negli script .ps1:
// l'exe li lancia in finestre minimizzate, aspetta che le porte siano
// pronte, apre il browser e permette di fermare tutto con un click.
//
// Uso:  Palamede.exe            (avvia + apre browser)
//       Palamede.exe -nobrowser (avvia senza aprire il browser)
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Reflection;
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
            Width = 480; Height = 372;
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
                Location = new Point(16, 70), Size = new Size(436, 196),
            };
            _openBtn = new Button {
                Text = "Apri officina", Enabled = false,
                Location = new Point(16, 282), Size = new Size(140, 34),
                BackColor = Ochre, ForeColor = Ink,
                FlatStyle = FlatStyle.Flat,
            };
            _stopBtn = new Button {
                Text = "Ferma tutto",
                Location = new Point(166, 282), Size = new Size(140, 34),
                BackColor = Color.FromArgb(40, 33, 24), ForeColor = Paper,
                FlatStyle = FlatStyle.Flat,
            };
            _openBtn.Click += (s, e) => OpenBrowser();
            _stopBtn.Click += (s, e) => StopAll();

            Controls.AddRange(new Control[] { title, sub, _log, _openBtn, _stopBtn });
            Shown += async (s, e) => await StartAll();
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

        async Task StartAll()
        {
            Log("Palamede — avvio officina");
            string root = Root;
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
            SpawnPs(Root + "\\scripts\\stop-all.ps1");
            Log("fermati: modello server e hub");
            _openBtn.Enabled = false;
        }
    }
}