import React, { useState, useEffect } from "react";
import {
  Button, Input, Label, Select, Checkbox, Card, SectionHeader, Slider, Badge, Switch,
} from "@/components/ui/primitives";
import { Save, RotateCcw, FolderOpen, FileText, Package, Terminal, RefreshCw } from "lucide-react";

// Same language list as DownloadTab/SearchTab. Duplicated rather than
// importing to avoid pulling unrelated module deps; one row to add when
// a new language ships, lives in three places.
const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "pt-br", label: "Portuguese (BR)" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "ru", label: "Russian" },
  { value: "ar", label: "Arabic" },
  { value: "tr", label: "Turkish" },
];

// Default values for settings.searchOpts. Mirrors DEFAULT_OPTS in
// SearchTab.jsx. Both surfaces (Settings + Search) read/write this
// namespace so changing in one is reflected in the other.
//
// `collapseSplits` was here historically (Phase 3) but moved to the top-level
// settings.collapseSplits in 2026-05-08 because the same toggle now affects
// download behavior, not just search-display diagnostics. See section 8 of
// snappy-forging-waffle.md.
const DEFAULT_SEARCH_OPTS = {
  searchLanguage: "en",
  seededOnly: true,
  multiSource: false,
  multiSourceQualityMin: 0.65,
  searchTimeout: 20,
  searchMinMatch: 0.55,
  searchParallelism: 6,
};

// ── DEFAULT VALUES ──
// These are used in dev mode (running from source with npm run electron:dev).
// In packaged mode (installed .exe), main.js overrides these automatically
// with the bundled Python paths, so these defaults won't matter.
const DEV_DEFAULTS = {
  pythonCmd: "python",
  scriptPath: String.raw`C:\Users\legoc\OneDrive\Belgeler\AIO-Webtoon-Downloader\aio-dl.py`,
  workingDir: String.raw`C:\Users\legoc\OneDrive\Belgeler\AIO-Webtoon-Downloader`,
};

export default function SettingsTab({ settings, onSave }) {
  // Local copy of settings so changes don't apply until you click Save
  const [local, setLocal] = useState({
    pythonCmd: DEV_DEFAULTS.pythonCmd,
    scriptPath: DEV_DEFAULTS.scriptPath,
    workingDir: DEV_DEFAULTS.workingDir,
    verboseAlways: true,
    // Global chapter-collapse toggle. Affects:
    //   - Search-display "X main / Y entries" diagnostic counts.
    //   - Actual download behavior — split clusters (e.g. 1.1/1.2/1.3/1.4)
    //     merge into one combined chapter file; redundant duplicate uploads
    //     of the same chapter are pruned. See sites/chapter_merger.py
    //     :group_chapters_for_download for the full 6-rule cluster table.
    // Persisted as settings.collapseSplits; useDownloader.queueDownload and
    // .runSearch inject this into args/opts before IPC.
    collapseSplits: true,
    // Inter-chapter image prefetch worker count (Phase G7, 2026-05-08).
    // While chapter N is encoding (CPU-bound), a background thread
    // downloads chapter N+1's images. -1 = match Image Workers (default).
    // 0 = disable prefetch entirely. Positive N = use exactly N workers.
    // Drop to 4 (or 0) when the upstream CDN is throttling and the extra
    // concurrent burst from N+1's downloads compounds throttling.
    prefetchImageWorkers: -1,
    // How often the UI refreshes logs & progress (in milliseconds).
    // Lower = more responsive. Default: 100ms (10 updates/sec).
    logUpdateInterval: 100,
    // When true, update checks scan actual files on disk instead of
    // trusting .aio_series.json. Saved as a top-level setting.
    useFileBasedChapterCheck: false,
    // Whether the app is running from an installed .exe (bundled mode)
    // or from source (dev mode). Set by main.js, read-only here.
    isPackaged: false,
    defaults: {
      format: "pdf",
      quality: 85,
      scaling: 100,
      keepChapters: false,
      noFinalFile: false,
      keepImages: false,
      noProcessing: false,
      noCleanup: false,
      imageWorkers: 3,
      httpTimeout: 30,
      httpMaxRetries: 6,
      jobs: 1,
      // Multi-source fallback default (added 2026-05-07). DownloadTab's
      // useEffect spreads settings.defaults into its form on mount, so
      // setting these here makes them survive both tab switches and
      // session restarts. Per-job overrides in DownloadTab don't save back.
      multiSource: false,
      multiSourceQualityMin: 0.65,
      // CBZ byte-preservation default (added 2026-05-07). When ON (default),
      // CBZ output uses the original wire bytes from the CDN (lossless,
      // fastest, smallest archives). Setting this to false emits
      // --no-cbz-preserve-originals which forces decode/re-encode even at
      // --scaling 100. The downloader.js boolMap handles the negative-form
      // flag emission. Only meaningful for --format cbz.
      cbzPreserveOriginals: true,
    },
    // Per-search defaults — read by SearchTab on mount via the same
    // settings.searchOpts namespace. Surfaced here so the user has one
    // central place to configure both download and search defaults.
    searchOpts: { ...DEFAULT_SEARCH_OPTS },
  });

  // Load settings when they arrive from Electron
  useEffect(() => {
    if (settings) {
      setLocal((prev) => ({
        ...prev,
        ...settings,
        defaults: { ...prev.defaults, ...(settings.defaults || {}) },
        searchOpts: { ...prev.searchOpts, ...(settings.searchOpts || {}) },
      }));
    }
  }, [settings]);

  const set = (key, value) => setLocal((prev) => ({ ...prev, [key]: value }));
  const setDefault = (key, value) =>
    setLocal((prev) => ({
      ...prev,
      defaults: { ...prev.defaults, [key]: value },
    }));
  const setSearchOpt = (key, value) =>
    setLocal((prev) => ({
      ...prev,
      searchOpts: { ...prev.searchOpts, [key]: value },
    }));

  const handleSave = () => {
    // Don't save isPackaged — it's read-only from main.js
    const { isPackaged, ...saveable } = local;
    onSave(saveable);
  };

  const handleReset = () => {
    setLocal((prev) => ({
      // Keep isPackaged from the current state (it's set by main.js)
      pythonCmd: prev.isPackaged ? prev.pythonCmd : DEV_DEFAULTS.pythonCmd,
      scriptPath: prev.isPackaged ? prev.scriptPath : DEV_DEFAULTS.scriptPath,
      workingDir: prev.isPackaged ? prev.workingDir : DEV_DEFAULTS.workingDir,
      isPackaged: prev.isPackaged,
      verboseAlways: true,
      collapseSplits: true,
      prefetchImageWorkers: -1,
      logUpdateInterval: 100,
      useFileBasedChapterCheck: false,
      defaults: {
        format: "pdf",
        quality: 85,
        scaling: 100,
        keepChapters: false,
        noFinalFile: false,
        keepImages: false,
        noProcessing: false,
        noCleanup: false,
        imageWorkers: 3,
        httpTimeout: 30,
        httpMaxRetries: 6,
        jobs: 1,
        cbzPreserveOriginals: true,
        multiSource: false,
        multiSourceQualityMin: 0.65,
      },
      searchOpts: { ...DEFAULT_SEARCH_OPTS },
    }));
  };

  const browseScript = async () => {
    if (!window.electronAPI) return;
    const path = await window.electronAPI.pickFile([
      { name: "Python Scripts", extensions: ["py"] },
    ]);
    if (path) set("scriptPath", path);
  };

  const browseWorkingDir = async () => {
    if (!window.electronAPI) return;
    const path = await window.electronAPI.pickFolder();
    if (path) set("workingDir", path);
  };

  const [confirmReinstall, setConfirmReinstall] = useState(false);
  const handleReinstall = async () => {
    if (!window.electronAPI?.reinstallPython) return;
    if (!confirmReinstall) {
      setConfirmReinstall(true);
      setTimeout(() => setConfirmReinstall(false), 4000);
      return;
    }
    setConfirmReinstall(false);
    await window.electronAPI.reinstallPython();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-1">
        {/* Paths */}
        <SectionHeader>Paths</SectionHeader>

        {/* ── BUNDLED MODE: Show a simple info card instead of editable paths ── */}
        {local.isPackaged ? (
          <Card className="p-3 space-y-2 bg-emerald-500/10 border-emerald-500/30">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-500" />
              <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                Bundled Python
              </span>
              <Badge variant="secondary" className="text-[10px] ml-auto">Installed Mode</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Python, Playwright, and all dependencies were set up automatically.
              No external Python installation needed.
            </p>
            {/* Still show the working directory so users know where mangas are saved */}
            <div className="pt-1">
              <Label className="text-xs">Output Directory (mangas saved here)</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={local.workingDir}
                  onChange={(e) => set("workingDir", e.target.value)}
                  className="flex-1 font-mono text-xs"
                />
                <Button variant="outline" size="sm" onClick={browseWorkingDir}>
                  <FolderOpen className="w-3.5 h-3.5" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                The "mangas" folder will be created inside this directory.
              </p>
            </div>
            {/* Reinstall button — re-downloads Python from scratch */}
            <div className="pt-1">
              <Button
                variant="outline"
                size="sm"
                className={confirmReinstall
                  ? "text-xs gap-1.5 text-destructive border-destructive/50 hover:text-destructive hover:border-destructive/50"
                  : "text-xs gap-1.5 text-muted-foreground hover:text-destructive hover:border-destructive/50"
                }
                onClick={handleReinstall}
                onBlur={() => setConfirmReinstall(false)}
              >
                <RefreshCw className="w-3 h-3" />
                {confirmReinstall ? "Click again to confirm reinstall" : "Reinstall Python Environment"}
              </Button>
            </div>
          </Card>
        ) : (
          /* ── DEV MODE: Full editable paths ── */
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">
                Dev mode — using system Python
              </span>
            </div>

            <div>
              <Label className="text-xs">Python Command</Label>
              <Input
                value={local.pythonCmd}
                onChange={(e) => set("pythonCmd", e.target.value)}
                placeholder="python"
                className="mt-1 font-mono text-sm"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Usually just "python". Change if you use a virtualenv or custom path.
              </p>
            </div>

            <div>
              <Label className="text-xs">aio-dl.py Location</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={local.scriptPath}
                  onChange={(e) => set("scriptPath", e.target.value)}
                  className="flex-1 font-mono text-xs"
                />
                <Button variant="outline" size="sm" onClick={browseScript}>
                  <FileText className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            <div>
              <Label className="text-xs">Working Directory</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={local.workingDir}
                  onChange={(e) => set("workingDir", e.target.value)}
                  className="flex-1 font-mono text-xs"
                />
                <Button variant="outline" size="sm" onClick={browseWorkingDir}>
                  <FolderOpen className="w-3.5 h-3.5" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Where aio-dl.py runs. The "mangas" output folder will be created here.
              </p>
            </div>
          </div>
        )}

        {/* Default Format & Quality */}
        <SectionHeader>Default Format &amp; Quality</SectionHeader>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <Label className="text-xs">Format</Label>
            <Select
              value={local.defaults.format}
              onChange={(e) => setDefault("format", e.target.value)}
              className="mt-1"
            >
              <option value="pdf">PDF</option>
              <option value="epub">EPUB</option>
              <option value="cbz">CBZ</option>
              <option value="none">None (images only)</option>
            </Select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs">Quality</Label>
              <Badge variant="secondary">{local.defaults.quality}</Badge>
            </div>
            <Slider
              value={local.defaults.quality}
              onValueChange={(v) => setDefault("quality", v)}
              min={1}
              max={100}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs">Scaling</Label>
              <Badge variant="secondary">{local.defaults.scaling}%</Badge>
            </div>
            <Slider
              value={local.defaults.scaling}
              onValueChange={(v) => setDefault("scaling", v)}
              min={1}
              max={100}
            />
          </div>
        </div>

        {/* CBZ byte-preservation toggle (Phase F, 2026-05-07).
            Only meaningful when --format cbz; the flag is benign on other
            formats (aio-dl ignores it). When ON (default), CBZ output keeps
            the original wire bytes from the CDN — lossless, fastest,
            smallest. Turn off to force decode/re-encode (uses --quality and
            --scaling). downloader.js emits --no-cbz-preserve-originals only
            when this is === false. */}
        <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-border/50">
          <div className="flex-1">
            <Label className="text-xs cursor-pointer">CBZ: preserve original image bytes</Label>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              When on, CBZ archives the original CDN wire bytes (WebP/JPEG/PNG)
              losslessly. Turn off to force decode + re-encode (slower,
              respects --quality and --scaling).
            </p>
          </div>
          <Switch
            checked={local.defaults.cbzPreserveOriginals !== false}
            onCheckedChange={(v) => setDefault("cbzPreserveOriginals", v)}
          />
        </div>

        {/* Default Toggles */}
        <SectionHeader>Default Toggles</SectionHeader>
        <div className="grid grid-cols-2 gap-3">
          {[
            ["keepChapters", "Keep chapters"],
            ["noFinalFile", "No final file"],
            ["keepImages", "Keep images"],
            ["noProcessing", "No processing"],
            ["noCleanup", "No cleanup"],
          ].map(([key, label]) => (
            <div key={key} className="flex items-center gap-2">
              <Checkbox
                checked={local.defaults[key]}
                onCheckedChange={(v) => setDefault(key, v)}
              />
              <Label className="text-xs cursor-pointer">{label}</Label>
            </div>
          ))}
        </div>

        {/* Default Multi-source Fallback ─────────────────────────────
            DownloadTab's useEffect spreads settings.defaults onto its form on
            mount, so toggling here changes the New tab's default state for
            every new download. Per-job overrides in DownloadTab don't write
            back to settings — that's the same pattern as format/quality. */}
        <SectionHeader>Default Multi-source Fallback</SectionHeader>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Switch
              checked={!!local.defaults.multiSource}
              onCheckedChange={(v) => setDefault("multiSource", v)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <Label className="text-xs cursor-pointer">
                Use alternate sources when the primary fails
              </Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Adds ~30-60s of cross-site discovery before each download.
                When the primary CDN throttles or 404s a page, the chapter
                falls over to the next source automatically.
              </p>
            </div>
          </div>
          {local.defaults.multiSource && (
            <div className="pl-12 animate-slide-up">
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs">Alternative quality floor</Label>
                <Badge variant="secondary" className="font-mono tabular-nums">
                  {(local.defaults.multiSourceQualityMin ?? 0.65).toFixed(2)}
                </Badge>
              </div>
              <Slider
                value={local.defaults.multiSourceQualityMin ?? 0.65}
                onValueChange={(v) => setDefault("multiSourceQualityMin", v)}
                min={0.3}
                max={0.95}
                step={0.05}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Sources below this seed/measured quality won't be used as
                fallbacks. Default 0.65 keeps unknown-language Madara extras out.
              </p>
            </div>
          )}
        </div>

        {/* Default Chapter Behavior — moved 2026-05-08 from "Default Search
            Options" because it now affects download behavior, not just the
            search-display "X main / Y entries" diagnostic. The same toggle
            also drives sites/chapter_merger.py:group_chapters_for_download
            on the Python side. SearchTab's inline toggle reads/writes the
            same settings.collapseSplits, so changing one updates both. */}
        <SectionHeader>Default Chapter Behavior</SectionHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <Label className="text-xs cursor-pointer">Collapse split chapters</Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                When sources split chapter 1 into 1.1/1.2/1.3/1.4 (no integer 1),
                combine them into a single Chapter 1 file. When integer 1 exists
                alongside the splits, they're treated as redundant duplicates and
                dropped. True partials like 1.5 alongside Ch 1 are preserved.
                Affects both downloads and the search-coverage display. Turn off
                for series that legitimately use decimal numbering.
              </p>
            </div>
            <Switch
              checked={local.collapseSplits !== false}
              onCheckedChange={(v) => set("collapseSplits", v)}
            />
          </div>

          {/* Inter-chapter image prefetch — Phase G7. */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <Label className="text-xs cursor-pointer">Prefetch workers for next chapter</Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Background workers that download chapter N+1's images while
                chapter N is encoding. <span className="font-mono">-1</span> = match Image Workers (default). <span className="font-mono">0</span> =
                disable prefetch entirely. Positive number = exact worker count. Drop to
                4 (or 0) when the upstream CDN is rate-limiting (Cloudflare 5xx storms)
                — the extra concurrent burst from N+1 can compound throttling. Typically
                saves 2-5s per chapter on MangaFire-style long-strip encodes when on.
              </p>
            </div>
            <Input
              type="number"
              min={-1}
              max={32}
              step={1}
              value={local.prefetchImageWorkers ?? -1}
              onChange={(e) => {
                // The Python --prefetch-image-workers flag is argparse
                // type=int. A decimal value here (e.g. user typing 3.7 in
                // the spinner) would round-trip to settings.json and crash
                // the next spawn with "invalid int". Truncate to integer
                // and clamp to the input range.
                const raw = e.target.value;
                if (raw === "" || raw === "-") {
                  set("prefetchImageWorkers", -1);
                  return;
                }
                const parsed = Number(raw);
                if (!Number.isFinite(parsed)) {
                  set("prefetchImageWorkers", -1);
                  return;
                }
                const truncated = Math.trunc(parsed);
                const clamped = Math.max(-1, Math.min(32, truncated));
                set("prefetchImageWorkers", clamped);
              }}
              className="w-20 shrink-0 font-mono tabular-nums"
            />
          </div>
        </div>

        {/* Default Network */}
        <SectionHeader>Default Network Settings</SectionHeader>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Image Workers</Label>
            <Input
              type="number"
              min={1}
              max={10}
              step={1}
              value={local.defaults.imageWorkers}
              onChange={(e) => {
                // Number("") returns 0; argparse would crash on 0 for
                // a "min=1" field. Truncate to int and clamp into the
                // [min, max] range; fall back to a sensible default
                // when the parse can't yield a finite value.
                const v = Number(e.target.value);
                if (!Number.isFinite(v)) { setDefault("imageWorkers", 3); return; }
                setDefault("imageWorkers", Math.min(10, Math.max(1, Math.trunc(v))));
              }}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">HTTP Timeout</Label>
            <Input
              type="number"
              min={5}
              step={1}
              value={local.defaults.httpTimeout}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v) || v < 5) { setDefault("httpTimeout", 30); return; }
                setDefault("httpTimeout", Math.trunc(v));
              }}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Max Retries</Label>
            <Input
              type="number"
              min={0}
              step={1}
              value={local.defaults.httpMaxRetries}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v) || v < 0) { setDefault("httpMaxRetries", 6); return; }
                setDefault("httpMaxRetries", Math.trunc(v));
              }}
              className="mt-1"
            />
          </div>
        </div>

        {/* Default Search Options ─────────────────────────────────
            Same settings.searchOpts namespace SearchTab reads/writes from.
            Surfacing them here gives the user one central place; SearchTab's
            inline toggles still update settings.searchOpts on every change,
            so the two surfaces stay in sync. */}
        <SectionHeader>Default Search Options</SectionHeader>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <Label className="text-xs">Search language</Label>
            <Select
              value={local.searchOpts?.searchLanguage ?? "en"}
              onChange={(e) => setSearchOpt("searchLanguage", e.target.value)}
              className="mt-1"
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <Label className="text-xs cursor-pointer">Curated sites only</Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                ~3× faster; skips long-tail aggregators
              </p>
            </div>
            <Switch
              checked={!!local.searchOpts?.seededOnly}
              onCheckedChange={(v) => setSearchOpt("seededOnly", v)}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <Label className="text-xs cursor-pointer">Multi-source by default</Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Pre-fetch alternative sources when searching
              </p>
            </div>
            <Switch
              checked={!!local.searchOpts?.multiSource}
              onCheckedChange={(v) => setSearchOpt("multiSource", v)}
            />
          </div>
          {local.searchOpts?.multiSource && (
            <div className="col-span-2 animate-slide-up">
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs">Search alternative quality floor</Label>
                <Badge variant="secondary" className="font-mono tabular-nums">
                  {(local.searchOpts?.multiSourceQualityMin ?? 0.65).toFixed(2)}
                </Badge>
              </div>
              <Slider
                value={local.searchOpts?.multiSourceQualityMin ?? 0.65}
                onValueChange={(v) => setSearchOpt("multiSourceQualityMin", v)}
                min={0.3}
                max={0.95}
                step={0.05}
              />
            </div>
          )}
          <div>
            <Label className="text-xs">Per-site timeout (s)</Label>
            <Input
              type="number"
              min={5}
              max={60}
              value={local.searchOpts?.searchTimeout ?? 20}
              onChange={(e) => setSearchOpt("searchTimeout", Number(e.target.value) || 20)}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Min title-match</Label>
            <Input
              type="number"
              min={0.3}
              max={1.0}
              step={0.05}
              value={local.searchOpts?.searchMinMatch ?? 0.55}
              onChange={(e) => setSearchOpt("searchMinMatch", Number(e.target.value) || 0.55)}
              className="mt-1 font-mono"
            />
          </div>
          <div>
            <Label className="text-xs">Parallel sites</Label>
            <Input
              type="number"
              min={1}
              max={16}
              value={local.searchOpts?.searchParallelism ?? 6}
              onChange={(e) => setSearchOpt("searchParallelism", Number(e.target.value) || 6)}
              className="mt-1"
            />
          </div>
        </div>

        {/* Library */}
        <SectionHeader>Library</SectionHeader>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={local.useFileBasedChapterCheck ?? false}
            onCheckedChange={(v) => set("useFileBasedChapterCheck", v)}
          />
          <Label className="text-xs cursor-pointer">
            Check chapters against files on device (instead of download history)
          </Label>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1 ml-6">
          <strong>Off (default):</strong> Uses the saved download history (.aio_series.json) to
          know which chapters you have. Faster, but won't notice deleted files.
          <br />
          <strong>On:</strong> Scans your actual files and extracts chapter numbers from filenames.
          Catches missing or deleted files, but only works with individual chapter files
          or combined files with chapter ranges in the name.
        </p>

        {/* Verbose */}
        <SectionHeader>Logging</SectionHeader>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={local.verboseAlways}
            onCheckedChange={(v) => set("verboseAlways", v)}
          />
          <Label className="text-xs cursor-pointer">
            Always use verbose mode (--verbose flag on every download)
          </Label>
        </div>

        {/* Log update interval */}
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <Label className="text-xs">Log Update Speed</Label>
            <Badge variant="secondary">{local.logUpdateInterval}ms</Badge>
          </div>
          <Slider
            value={local.logUpdateInterval}
            onValueChange={(v) => set("logUpdateInterval", v)}
            min={50}
            max={2000}
            step={50}
          />
          <div className="flex justify-between mt-1 px-0.5">
            <span className="text-[10px] text-muted-foreground">50ms (fastest)</span>
            <span className="text-[10px] text-muted-foreground">2000ms (lightest)</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            How often logs and progress bars refresh. Lower = more responsive, higher = less CPU.
          </p>
        </div>
      </div>

      {/* Save/Reset buttons */}
      <div className="flex-shrink-0 p-4 border-t bg-background/80 backdrop-blur-sm flex gap-2">
        <Button onClick={handleSave} className="flex-1 gap-2">
          <Save className="w-4 h-4" />
          Save Settings
        </Button>
        <Button variant="outline" onClick={handleReset}>
          <RotateCcw className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
