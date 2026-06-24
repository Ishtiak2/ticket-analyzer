import { useEffect, useState } from "react";
import { ApiError, getTickets } from "../api/client";
import type { Ticket } from "../types/ticket";

interface TicketListProps {
  /** Bump this number to force a re-fetch (parent owns it). */
  refreshKey: number;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; tickets: Ticket[] };

/**
 * Renders the persisted ticket list. The backend already returns tickets
 * sorted newest-first (created_at DESC, id DESC), so we render as-is.
 */
export function TicketList({ refreshKey }: TicketListProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState({ kind: "loading" });
      try {
        const tickets = await getTickets();
        if (!cancelled) {
          setState({ kind: "ready", tickets });
        }
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load tickets.";
        setState({ kind: "error", message });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (state.kind === "loading") {
    return <p>Loading tickets…</p>;
  }

  if (state.kind === "error") {
    return (
      <p style={{ color: "#b00020" }} role="alert">
        {state.message}
      </p>
    );
  }

  if (state.tickets.length === 0) {
    return <p>No tickets yet. Submit one above.</p>;
  }

  return (
    <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {state.tickets.map((t) => (
        <li
          key={t.id}
          style={{
            border: "1px solid #ddd",
            borderRadius: "4px",
            padding: "0.75rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <strong>{t.title}</strong>
            <span style={{ fontSize: "0.85rem", color: "#666" }}>
              {formatTimestamp(t.created_at)}
            </span>
          </div>
          <p style={{ margin: "0.5rem 0" }}>{t.message}</p>
          <div style={{ fontSize: "0.85rem", color: "#444" }}>
            <span
              style={{
                fontWeight: 600,
                color: t.sentiment === "POSITIVE" ? "#0a7f2e" : "#b00020",
              }}
            >
              {t.sentiment}
            </span>
            <span> · confidence {t.confidence.toFixed(3)}</span>
            {t.category && <span> · category: {t.category}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
