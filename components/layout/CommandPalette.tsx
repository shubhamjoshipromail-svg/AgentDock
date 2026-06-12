"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type Command = {
  id: string;
  label: string;
  group?: string;
  hint?: string;
  run: () => void;
};

// Hand-built ⌘K palette. Filters a static action list; arrow keys move the
// selection, Enter runs it, Esc closes. A workstation signature.
export function CommandPalette({
  open,
  onOpenChange,
  commands
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global ⌘K / Ctrl-K toggle.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      } else if (event.key === "Escape" && open) {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((command) => command.label.toLowerCase().includes(q) || command.group?.toLowerCase().includes(q));
  }, [commands, query]);

  if (!open) return null;

  const runAt = (index: number) => {
    const command = filtered[index];
    if (command) {
      command.run();
      onOpenChange(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runAt(active);
    }
  };

  return (
    <div className="cmdkOverlay" onClick={() => onOpenChange(false)} role="presentation">
      <div className="cmdkPanel" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          className="cmdkInput"
          value={query}
          placeholder="Type a command…"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          aria-label="Command palette search"
        />
        <ul className="cmdkList" role="listbox">
          {filtered.length === 0 && <li className="cmdkEmpty">No matching command</li>}
          {filtered.map((command, index) => (
            <li
              key={command.id}
              className={index === active ? "cmdkItem active" : "cmdkItem"}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => runAt(index)}
            >
              <span className="cmdkLabel">{command.label}</span>
              {command.hint && <span className="cmdkHint">{command.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
