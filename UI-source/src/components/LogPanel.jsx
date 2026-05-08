import React, { useState, useRef, useEffect, useMemo } from "react";
import { Button, Input, Switch, Label } from "@/components/ui/primitives";
import { Trash2, Copy, ArrowDownToLine, Search, Check, Pause, X } from "lucide-react";
import { cn } from "@/lib/utils";

// Color classes for each log level
const LEVEL_COLORS = {
  error: "text-red-500 dark:text-red-400",
  warning: "text-yellow-600 dark:text-yellow-400",
  success: "text-green-600 dark:text-green-400",
  verbose: "text-muted-foreground/60",
  info: "text-foreground",
};

// Stable empty array — prevents creating a new [] reference every render
// which would cause useMemo to think logs changed and trigger infinite re-renders
const EMPTY_LOGS = [];

export default function LogPanel({ logs: rawLogs, onClearLogs, settings, onSaveSettings }) {
  const [filter, setFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const logEndRef = useRef(null);
  const containerRef = useRef(null);
  // Track the previous log count so we only auto-scroll when new lines arrive
  const prevLogCountRef = useRef(0);

  // Stabilize: if rawLogs is null/undefined/not-an-array, use the stable empty array
  // This prevents a new [] reference each render which would cause infinite re-render
  const logs = useMemo(() => {
    if (!rawLogs || !Array.isArray(rawLogs)) return EMPTY_LOGS;
    return rawLogs;
  }, [rawLogs]);

  const verboseAlways = settings?.verboseAlways !== false;

  // Filter logs by:
  //   1. Verbose toggle — when off, drop entries classified as "verbose" by
  //      downloader.js:classifyLogLevel (indented detail / dimmed lines).
  //      The toggle still controls --verbose for future spawns; OFF means
  //      "stop emitting verbose AND hide the dimmed lines that piled up
  //      from earlier runs."
  //   2. Text search — substring match against entry.line.
  // Dividers (level==="divider") always render regardless of verbose state —
  // they're punctuation, not log content.
  const filteredLogs = useMemo(() => {
    let result = logs;
    if (!verboseAlways) {
      result = result.filter((entry) => entry.level !== "verbose");
    }
    if (filter.trim()) {
      const lower = filter.toLowerCase();
      result = result.filter((entry) => entry.line?.toLowerCase().includes(lower));
    }
    return result;
  }, [logs, filter, verboseAlways]);

  // Auto-scroll ONLY when new log lines are added (not on every render)
  useEffect(() => {
    if (filteredLogs.length > prevLogCountRef.current && autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
    prevLogCountRef.current = filteredLogs.length;
  }, [filteredLogs.length, autoScroll]);

  // Detect when user scrolls up manually
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
    // Only update state if the value actually changed (prevents unnecessary re-renders)
    setAutoScroll((prev) => {
      if (prev === isNearBottom) return prev;
      return isNearBottom;
    });
  };

  const handleCopy = () => {
    const text = filteredLogs.map((e) => `[${e.timestamp}] ${e.line}`).join("\n");
    navigator.clipboard?.writeText(text);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Controls bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-card/50 flex-shrink-0 flex-wrap">
        {/* Search filter */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter logs…"
            className="pl-8 h-8 text-xs"
          />
        </div>

        {/* Verbose toggle */}
        <div className="flex items-center gap-2">
          <Switch
            id="verbose"
            checked={verboseAlways}
            onCheckedChange={(v) => onSaveSettings?.({ verboseAlways: v })}
          />
          <Label htmlFor="verbose" className="text-xs cursor-pointer whitespace-nowrap">
            Verbose
          </Label>
        </div>

        {/* Auto-scroll toggle */}
        <div className="flex items-center gap-2">
          <Switch id="autoscroll" checked={autoScroll} onCheckedChange={setAutoScroll} />
          <Label htmlFor="autoscroll" className="text-xs cursor-pointer whitespace-nowrap">
            Auto-scroll
          </Label>
        </div>

        {/* Action buttons */}
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={handleCopy} title="Copy all logs">
            <Copy className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onClearLogs} title="Clear logs">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAutoScroll(true);
              logEndRef.current?.scrollIntoView({ behavior: "smooth" });
            }}
            title="Scroll to bottom"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Log output area — scrollable */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-2 bg-background"
      >
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            {logs.length === 0
              ? "No logs yet — start a download to see output here"
              : "No lines match your filter"}
          </div>
        ) : (
          <div>
            {filteredLogs.map((entry, i) => {
              // Divider entries punctuate the log between download runs.
              // Injected by useDownloader.onDownloadComplete with level
              // "divider" + status / title / duration. Render as a centered
              // gradient hr — visually punctuates without competing with the
              // log content. Status chooses icon + color from the existing
              // success/warning/destructive palette.
              if (entry.level === "divider") {
                const Icon =
                  entry.status === "completed" ? Check
                    : entry.status === "cancelled" ? Pause
                    : X;
                const color =
                  entry.status === "completed"
                    ? "text-green-600 dark:text-green-400"
                    : entry.status === "cancelled"
                      ? "text-yellow-600 dark:text-yellow-400"
                      : "text-red-600 dark:text-red-400";
                return (
                  <div key={i} className="flex items-center gap-3 my-3 select-none">
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
                    <div className={cn("flex items-center gap-1.5 text-[10px] font-medium tabular-nums whitespace-nowrap", color)}>
                      <Icon className="w-3 h-3" />
                      <span className="font-semibold">{entry.title}</span>
                      <span className="text-muted-foreground/60">·</span>
                      <span>{entry.status}</span>
                      {entry.duration && (
                        <>
                          <span className="text-muted-foreground/60">·</span>
                          <span>{entry.duration}</span>
                        </>
                      )}
                    </div>
                    <div className="flex-1 h-px bg-gradient-to-l from-transparent via-border to-transparent" />
                  </div>
                );
              }
              return (
                <div
                  key={i}
                  className={cn(
                    "log-text py-[1px] leading-relaxed break-all",
                    LEVEL_COLORS[entry.level] || LEVEL_COLORS.info
                  )}
                >
                  <span className="text-muted-foreground/40 select-none mr-2">
                    {entry.timestamp}
                  </span>
                  {entry.line}
                </div>
              );
            })}
          </div>
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}
