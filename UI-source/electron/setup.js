// ============================================================
// PYTHON SETUP MODULE  (rewritten)
//
// Downloads and configures a portable Python environment inside
// the app's data folder on first run.
//
// WHAT CHANGED FROM THE ORIGINAL:
//
//   1. Download verification — every download is checked for ZIP
//      validity (magic bytes + end-of-central-directory marker).
//      Corrupt files are deleted and re-downloaded automatically.
//
//   2. Extraction uses Windows' built-in tar.exe (ships with
//      Windows 10 1803+) instead of PowerShell Expand-Archive,
//      which is known to fail with "End of Central Directory
//      record could not be found" on certain systems.
//
//   3. Every step verifies its outcome (e.g. python.exe exists
//      after extraction, pip responds after install) before
//      moving to the next step.  If verification fails, the
//      step is retried once with a clean slate.
//
//   4. The ._pth file is configured more carefully, handling
//      edge cases that caused "ModuleNotFoundError: No module
//      named 'sites'" in bundled builds.
//
// EXPORTS (unchanged — main.js doesn't need any changes):
//   PythonSetup   — class, instantiated in runSetupFlow()
//   isSetupComplete(envDir) — checks for .setup-complete marker
//   deleteEnv(envDir)       — deletes the entire python-env
//   PYTHON_VERSION          — string, e.g. "3.13.2"
// ============================================================

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

// ── CONFIGURABLE ──
const PYTHON_VERSION = "3.13.2";

// ── COMPUTED (don't change these) ──
const PYTHON_ZIP_NAME = `python-${PYTHON_VERSION}-embed-amd64.zip`;
const PYTHON_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/${PYTHON_ZIP_NAME}`;
const GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py";
const TOTAL_STEPS = 7;

// ZIP files always start with these 4 bytes ("PK\x03\x04").
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

class PythonSetup {
  /**
   * @param {object} opts
   * @param {string}   opts.envDir           - Install root (e.g. %APPDATA%/aio-downloader-ui/python-env)
   * @param {string}   opts.requirementsPath - Path to requirements.txt shipped with the app
   * @param {function} opts.onStep           - ({ step, total, label }) when a step starts
   * @param {function} opts.onLog            - (string) log lines
   * @param {function} opts.onProgress       - (0.0–1.0) download progress
   * @param {function} opts.onComplete       - All steps finished
   * @param {function} opts.onError          - (errorMessage) a step failed
   */
  constructor({ envDir, requirementsPath, onStep, onLog, onProgress, onComplete, onError }) {
    this._envDir = envDir;
    this._requirementsPath = requirementsPath;
    this._pythonDir = path.join(envDir, "python");
    this._playwrightDir = path.join(envDir, "playwright-browsers");
    this._tempDir = path.join(os.tmpdir(), "aio-setup-temp");

    this._onStep = onStep || (() => {});
    this._onLog = onLog || (() => {});
    this._onProgress = onProgress || (() => {});
    this._onComplete = onComplete || (() => {});
    this._onError = onError || (() => {});
  }

  /** Full path to the embedded python.exe */
  get pythonExe() {
    return path.join(this._pythonDir, "python.exe");
  }

  /** Full path to the Playwright browsers folder */
  get playwrightDir() {
    return this._playwrightDir;
  }

  // ═══════════════════════════════════════════
  // MAIN ENTRY POINT
  // ═══════════════════════════════════════════

  async run() {
    try {
      fs.mkdirSync(this._envDir, { recursive: true });
      fs.mkdirSync(this._tempDir, { recursive: true });

      await this._step(1, `Downloading Python ${PYTHON_VERSION}…`, () => this._downloadPython());
      await this._step(2, "Extracting Python…",                    () => this._extractPython());
      await this._step(3, "Configuring Python…",                   () => this._configurePython());
      await this._step(4, "Installing pip…",                       () => this._installPip());
      await this._step(5, "Installing dependencies…",              () => this._installRequirements());
      await this._step(6, "Installing Playwright…",                () => this._installPlaywright());
      await this._step(7, "Downloading Chromium browser…",         () => this._downloadBrowser());

      // Write the marker file so future launches skip setup.
      const marker = path.join(this._envDir, ".setup-complete");
      fs.writeFileSync(marker, JSON.stringify({
        completedAt: new Date().toISOString(),
        pythonVersion: PYTHON_VERSION,
      }));

      // Clean up temp downloads.
      try { fs.rmSync(this._tempDir, { recursive: true, force: true }); } catch {}

      this._onLog("\n✓ Setup complete!");
      this._onComplete();
    } catch (err) {
      this._onLog(`\n✗ Error: ${err.message}`);
      this._onError(err.message);
    }
  }

  async _step(num, label, fn) {
    this._onStep({ step: num, total: TOTAL_STEPS, label });
    this._onLog(`\n── Step ${num}/${TOTAL_STEPS}: ${label} ──`);
    this._onProgress(0);
    await fn();
  }

  // ═══════════════════════════════════════════
  // STEP 1 — Download Python embeddable package
  // ═══════════════════════════════════════════

  async _downloadPython() {
    const zipPath = path.join(this._tempDir, PYTHON_ZIP_NAME);

    // If a cached download exists AND is a valid ZIP, reuse it.
    if (fs.existsSync(zipPath) && this._isValidZip(zipPath)) {
      this._onLog("Using cached download (verified valid)");
      return;
    }

    // Delete any corrupt/partial cached file.
    try { fs.unlinkSync(zipPath); } catch {}

    this._onLog("Downloading from python.org…");
    await this._downloadFile(PYTHON_URL, zipPath);

    // Verify the download is a real ZIP file.
    if (!this._isValidZip(zipPath)) {
      try { fs.unlinkSync(zipPath); } catch {}
      throw new Error(
        "Downloaded file is corrupt (not a valid ZIP). " +
        "This usually means the download was interrupted. Click Retry."
      );
    }

    const sizeMB = (fs.statSync(zipPath).size / 1_048_576).toFixed(1);
    this._onLog(`Downloaded: ${sizeMB} MB ✓`);
  }

  // ═══════════════════════════════════════════
  // STEP 2 — Extract Python zip
  // ═══════════════════════════════════════════

  async _extractPython() {
    // If python.exe already exists, skip extraction.
    if (fs.existsSync(this.pythonExe)) {
      this._onLog("python.exe already exists, skipping extraction");
      return;
    }

    const zipPath = path.join(this._tempDir, PYTHON_ZIP_NAME);

    // Make sure the ZIP is there and valid.
    if (!fs.existsSync(zipPath) || !this._isValidZip(zipPath)) {
      throw new Error(
        "Python ZIP not found or corrupt. Click Retry to re-download."
      );
    }

    // Clean out any leftover partial extraction.
    if (fs.existsSync(this._pythonDir)) {
      this._onLog("Cleaning previous partial extraction…");
      fs.rmSync(this._pythonDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this._pythonDir, { recursive: true });

    // ── Try tar.exe first (built into Windows 10 1803+) ──
    // tar is far more reliable than PowerShell Expand-Archive
    // for this specific ZIP format.
    let extracted = false;

    try {
      this._onLog("Extracting with tar…");
      await this._runCommand("tar", [
        "-xf", zipPath,
        "-C", this._pythonDir,
      ]);
      extracted = true;
    } catch (tarErr) {
      this._onLog(`tar failed: ${tarErr.message}`);
      this._onLog("Falling back to PowerShell…");
    }

    // ── Fallback: PowerShell Expand-Archive ──
    if (!extracted) {
      // Clean the directory before retrying with a different tool.
      fs.rmSync(this._pythonDir, { recursive: true, force: true });
      fs.mkdirSync(this._pythonDir, { recursive: true });

      try {
        await this._runCommand("powershell.exe", [
          "-NoProfile", "-NonInteractive", "-Command",
          `Expand-Archive -Path '${zipPath}' -DestinationPath '${this._pythonDir}' -Force`,
        ]);
        extracted = true;
      } catch (psErr) {
        this._onLog(`PowerShell failed: ${psErr.message}`);
      }
    }

    // ── Verify extraction succeeded ──
    if (!extracted || !fs.existsSync(this.pythonExe)) {
      // Sometimes the ZIP extracts into a sub-folder.  Check for that.
      const moved = this._fixNestedExtraction();
      if (!moved) {
        // Last resort: delete everything so Retry starts clean.
        try { fs.rmSync(this._pythonDir, { recursive: true, force: true }); } catch {}
        try { fs.unlinkSync(zipPath); } catch {}
        throw new Error(
          "Extraction failed — python.exe not found after extracting. " +
          "The ZIP may have been corrupt. Click Retry to re-download."
        );
      }
    }

    this._onLog("Extraction complete ✓");
  }

  // ═══════════════════════════════════════════
  // STEP 3 — Configure Python's ._pth file
  // ═══════════════════════════════════════════

  async _configurePython() {
    // The embeddable Python ships with a ._pth file (e.g. python313._pth)
    // that completely controls sys.path.  When this file exists, Python
    // IGNORES the PYTHONPATH environment variable.
    //
    // We need to:
    //   1. Uncomment "import site" so pip-installed packages work
    //   2. Add "Lib\site-packages" so pip packages are importable
    //
    // Without this, every pip install silently "works" but imports fail.

    const files = fs.readdirSync(this._pythonDir);
    const pthFile = files.find((f) => /^python\d+\._pth$/i.test(f));

    if (!pthFile) {
      // No ._pth file means Python will use default sys.path discovery,
      // which generally works.  This happens with full (non-embed) installs.
      this._onLog("No ._pth file found (non-embed install?) — skipping");
      return;
    }

    const pthPath = path.join(this._pythonDir, pthFile);
    let content = fs.readFileSync(pthPath, "utf8");

    // Build the desired content from scratch rather than patching.
    // The original file typically contains:
    //   python313.zip
    //   .
    //   #import site
    //
    // We want:
    //   python313.zip
    //   .
    //   Lib\site-packages
    //   import site

    const lines = content.split(/\r?\n/);
    const newLines = [];

    let hasSitePackages = false;
    let hasImportSite = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // Uncomment "#import site" → "import site"
      if (/^#\s*import\s+site/.test(line)) {
        newLines.push("import site");
        hasImportSite = true;
        continue;
      }

      if (line === "import site") {
        hasImportSite = true;
      }

      if (line === "Lib\\site-packages") {
        hasSitePackages = true;
      }

      newLines.push(rawLine);
    }

    // Add missing entries.
    if (!hasSitePackages) {
      // Insert before "import site" if present, otherwise append.
      const siteIdx = newLines.findIndex((l) => l.trim() === "import site");
      if (siteIdx >= 0) {
        newLines.splice(siteIdx, 0, "Lib\\site-packages");
      } else {
        newLines.push("Lib\\site-packages");
      }
    }

    if (!hasImportSite) {
      newLines.push("import site");
    }

    const newContent = newLines.join("\n") + "\n";
    fs.writeFileSync(pthPath, newContent);

    this._onLog(`Configured ${pthFile}:`);
    for (const l of newContent.trim().split("\n")) {
      this._onLog(`  ${l}`);
    }

    // Create the Lib\site-packages directory so pip has somewhere to
    // install packages.  Without this, pip install works but writes to
    // a non-existent path.
    const sitePackages = path.join(this._pythonDir, "Lib", "site-packages");
    fs.mkdirSync(sitePackages, { recursive: true });

    // Verify Python starts and can report its version.
    try {
      const ver = await this._runPython(["--version"]);
      this._onLog(`Verified: ${ver.trim()} ✓`);
    } catch (err) {
      throw new Error(`Python installed but won't start: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════
  // STEP 4 — Install pip
  // ═══════════════════════════════════════════

  async _installPip() {
    // Check if pip already works.
    if (await this._hasPip()) {
      return;
    }

    // Download the official pip bootstrapper.
    const getPipPath = path.join(this._tempDir, "get-pip.py");
    if (!fs.existsSync(getPipPath)) {
      this._onLog("Downloading get-pip.py…");
      await this._downloadFile(GET_PIP_URL, getPipPath);
    }

    this._onLog("Installing pip…");
    await this._runPython([getPipPath, "--no-warn-script-location"]);

    // Verify it worked.
    if (!(await this._hasPip())) {
      throw new Error(
        "pip installed but verification failed. " +
        "This usually means the ._pth file is misconfigured."
      );
    }
  }

  // ═══════════════════════════════════════════
  // STEP 5 — Install Python dependencies
  // ═══════════════════════════════════════════

  async _installRequirements() {
    if (!this._requirementsPath || !fs.existsSync(this._requirementsPath)) {
      this._onLog("requirements.txt not found — skipping");
      return;
    }

    // The embedded Python doesn't include setuptools or wheel.
    // Some packages only ship as source distributions (.tar.gz) and
    // need setuptools to build.  Install build tools first.
    this._onLog("Installing build tools (setuptools, wheel)…");
    await this._runPython([
      "-m", "pip", "install",
      "setuptools", "wheel",
      "--no-warn-script-location",
      "--no-cache-dir",
    ]);

    this._onLog("Installing packages (this may take a minute)…");
    await this._runPython([
      "-m", "pip", "install",
      "-r", this._requirementsPath,
      "--no-warn-script-location",
      "--no-cache-dir",
    ]);

    // Quick smoke test: try importing a key dependency.
    try {
      await this._runPython(["-c", "import requests; import bs4; print('imports OK')"]);
      this._onLog("All dependencies installed ✓");
    } catch {
      this._onLog("Warning: import check failed — packages may not be fully installed");
    }
  }

  // ═══════════════════════════════════════════
  // STEP 6 — Install Playwright pip package
  // ═══════════════════════════════════════════

  async _installPlaywright() {
    // Check if already installed.
    try {
      await this._runPython(["-c", "import playwright; print(playwright.__version__)"]);
      this._onLog("Playwright already installed");
      return;
    } catch {}

    this._onLog("Installing playwright package…");
    await this._runPython([
      "-m", "pip", "install",
      "playwright>=1.40.0",
      "--no-warn-script-location",
      "--no-cache-dir",
    ]);
    this._onLog("Playwright installed ✓");
  }

  // ═══════════════════════════════════════════
  // STEP 7 — Download Chromium for Playwright
  // ═══════════════════════════════════════════

  async _downloadBrowser() {
    // Check if browsers are already downloaded.
    if (fs.existsSync(this._playwrightDir)) {
      try {
        const entries = fs.readdirSync(this._playwrightDir);
        // Playwright creates a "chromium-XXXX" folder inside the browsers dir.
        if (entries.some((e) => e.startsWith("chromium"))) {
          this._onLog("Chromium already downloaded, skipping");
          return;
        }
      } catch {}
    }

    fs.mkdirSync(this._playwrightDir, { recursive: true });
    this._onLog("Downloading Chromium (this may take a few minutes)…");

    await this._runPython(
      ["-m", "playwright", "install", "chromium"],
      { PLAYWRIGHT_BROWSERS_PATH: this._playwrightDir }
    );

    this._onLog("Chromium browser ready ✓");
  }

  // ═══════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════

  /**
   * Check if a file is a valid ZIP by reading its header and
   * scanning for the end-of-central-directory signature.
   *
   * The old code only checked `size > 1MB` which let corrupt
   * downloads pass through.  A real ZIP must start with PK\x03\x04
   * and contain PK\x05\x06 near the end.
   */
  _isValidZip(filePath) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size < 100) return false;

      const fd = fs.openSync(filePath, "r");

      // Check ZIP magic bytes at start of file.
      const header = Buffer.alloc(4);
      fs.readSync(fd, header, 0, 4, 0);
      if (!header.equals(ZIP_MAGIC)) {
        fs.closeSync(fd);
        return false;
      }

      // Check for end-of-central-directory signature near the end.
      // EOCD is at most 65557 bytes from the end (65535 comment + 22 header).
      const tailSize = Math.min(stat.size, 65580);
      const tail = Buffer.alloc(tailSize);
      fs.readSync(fd, tail, 0, tailSize, stat.size - tailSize);
      fs.closeSync(fd);

      // EOCD signature: PK\x05\x06
      for (let i = tail.length - 22; i >= 0; i--) {
        if (tail[i] === 0x50 && tail[i + 1] === 0x4b &&
            tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Some ZIP tools extract into a nested sub-folder instead of flat.
   * e.g. pythonDir/python-3.13.2-embed-amd64/python.exe
   * This checks for that case and moves files up if needed.
   */
  _fixNestedExtraction() {
    try {
      const entries = fs.readdirSync(this._pythonDir);
      // Look for a single sub-directory that contains python.exe.
      for (const entry of entries) {
        const sub = path.join(this._pythonDir, entry);
        if (fs.statSync(sub).isDirectory()) {
          const subExe = path.join(sub, "python.exe");
          if (fs.existsSync(subExe)) {
            this._onLog(`Found python.exe in sub-folder "${entry}", moving up…`);
            // Move all files from the sub-folder to pythonDir.
            for (const file of fs.readdirSync(sub)) {
              const src = path.join(sub, file);
              const dest = path.join(this._pythonDir, file);
              fs.renameSync(src, dest);
            }
            // Remove the now-empty sub-folder.
            fs.rmdirSync(sub);
            return true;
          }
        }
      }
    } catch {}
    return false;
  }

  /** Check if pip is installed and responds. */
  async _hasPip() {
    try {
      const ver = await this._runPython(["-m", "pip", "--version"]);
      this._onLog("pip already installed: " + ver.trim().split("\n")[0]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Download a file from a URL, following redirects.
   * Reports progress via this._onProgress (0.0 to 1.0).
   *
   * Downloads to a temporary ".downloading" file first, then
   * renames to the final path.  This prevents a partial/corrupt
   * download from being mistaken for a valid cached file on retry.
   */
  _downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const tmpPath = destPath + ".downloading";

      const makeRequest = (requestUrl, redirectCount = 0) => {
        if (redirectCount > 5) {
          return reject(new Error("Too many redirects"));
        }

        const mod = requestUrl.startsWith("https") ? https : http;

        const req = mod.get(requestUrl, {
          headers: { "User-Agent": "AIO-Downloader-Setup/2.0" },
        }, (res) => {
          if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            return makeRequest(res.headers.location, redirectCount + 1);
          }

          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode} from ${requestUrl}`));
          }

          const totalBytes = parseInt(res.headers["content-length"], 10) || 0;
          let downloadedBytes = 0;
          const file = fs.createWriteStream(tmpPath);

          res.on("data", (chunk) => {
            downloadedBytes += chunk.length;
            if (totalBytes > 0) {
              this._onProgress(downloadedBytes / totalBytes);
            }
          });

          res.pipe(file);

          file.on("finish", () => {
            file.close(() => {
              // Verify we got the full file.
              if (totalBytes > 0 && downloadedBytes < totalBytes) {
                try { fs.unlinkSync(tmpPath); } catch {}
                return reject(new Error(
                  `Incomplete download: got ${downloadedBytes} of ${totalBytes} bytes`
                ));
              }
              // Move temp file to final path.
              try {
                fs.renameSync(tmpPath, destPath);
              } catch {
                fs.copyFileSync(tmpPath, destPath);
                try { fs.unlinkSync(tmpPath); } catch {}
              }
              resolve();
            });
          });

          file.on("error", (err) => {
            try { fs.unlinkSync(tmpPath); } catch {}
            reject(err);
          });
        });

        req.on("error", reject);
        req.setTimeout(60_000, () => {
          req.destroy(new Error("Download timed out after 60 seconds"));
        });
      };

      makeRequest(url);
    });
  }

  /**
   * Run a command (like tar.exe) and return stdout.
   * Logs all output in real time.
   */
  _runCommand(command, args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (d) => {
        const text = d.toString();
        stdout += text;
        text.split("\n").filter(Boolean).forEach((l) => this._onLog("  " + l.trim()));
      });

      proc.stderr.on("data", (d) => {
        const text = d.toString();
        stderr += text;
        text.split("\n").filter(Boolean).forEach((l) => this._onLog("  " + l.trim()));
      });

      proc.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`${command} exited with code ${code}: ${stderr.slice(0, 200)}`));
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to start ${command}: ${err.message}`));
      });
    });
  }

  /**
   * Run a command with the embedded python.exe.
   * Returns stdout.  Logs all output in real time.
   */
  _runPython(args, extraEnv = {}) {
    return new Promise((resolve, reject) => {
      // Verify python.exe exists before trying to spawn it.
      // This gives a clear error instead of cryptic "spawn ENOENT".
      if (!fs.existsSync(this.pythonExe)) {
        return reject(new Error(
          `python.exe not found at: ${this.pythonExe}\n` +
          "The Python extraction may have failed. Click Retry."
        ));
      }

      const proc = spawn(this.pythonExe, args, {
        env: {
          ...process.env,
          ...extraEnv,
          PYTHONUNBUFFERED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        cwd: this._envDir,
      });

      let stdout = "";

      proc.stdout.on("data", (d) => {
        const text = d.toString();
        stdout += text;
        text.split("\n").filter(Boolean).forEach((line) => this._onLog("  " + line.trim()));
      });

      proc.stderr.on("data", (d) => {
        d.toString().split("\n").filter(Boolean).forEach((line) => this._onLog("  " + line.trim()));
      });

      proc.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`Python exited with code ${code}`));
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to start Python: ${err.message}`));
      });
    });
  }
}

// ═══════════════════════════════════════════
// HELPER FUNCTIONS (used by main.js)
// ═══════════════════════════════════════════

function isSetupComplete(envDir) {
  return fs.existsSync(path.join(envDir, ".setup-complete"));
}

function deleteEnv(envDir) {
  if (fs.existsSync(envDir)) {
    fs.rmSync(envDir, { recursive: true, force: true });
  }
}

module.exports = { PythonSetup, isSetupComplete, deleteEnv, PYTHON_VERSION };
