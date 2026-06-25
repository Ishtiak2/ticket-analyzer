import { useEffect, useState } from "react";
import { ApiError, getTickets } from "../api/client";
import type { Ticket } from "../types/ticket";
import { IconAlert, IconInbox, IconRefresh } from "./icons";

interface TicketListProps {
  /** Bump this number to force a re-fetch (parent owns it). */
  refreshKey: number;
  /** Receives the freshly-loaded list — lets the parent show live stats. */
  onLoaded?: (tickets: Ticket[]) => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; tickets: Ticket[] };

/**
 * Renders the persisted ticket list. Backend returns tickets newest-first
 * (created_at DESC, id DESC), so we render as-is.
 */
export function TicketList({ refreshKey, onLoaded }: TicketListProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState({ kind: "loading" });
      try {
        const tickets = await getTickets();
        if (!cancelled) {
          setState({ kind: "ready", tickets });
          onLoaded?.(tickets);
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof ApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Failed to load tickets.";
          setState({ kind: "error", message });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, onLoaded]);

  if (state.kind === "loading") {
    return (
      <ul className="list" aria-busy="true" aria-label="Loading tickets">
        {[0, 1, 2].map((i) => (
          <li className="skeleton" key={i}>
            <span className="sk-line w-60" />
            <span className="sk-line w-90" />
            <span className="sk-line w-40" />
          </li>
        ))}
      </ul>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="state" role="alert">
        <IconAlert size={20} />
        <div className="state-title">Couldn't load tickets</div>
        <div>{state.message}</div>
        <button
          className="btn btn-ghost"
          onClick={() => setState({ kind: "loading" })}
        >
          <IconRefresh size={14} />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  if (state.tickets.length === 0) {
    return (
      <div className="state">
        <IconInbox size={22} />
        <div className="state-title">No tickets yet</div>
        <div>Submit one using the form on the left.</div>
      </div>
    );
  }

  return (
    <ul className="list">
      {state.tickets.map((t) => (
        <TicketRow key={t.id} ticket={t} />
      ))}
    </ul>
  );
}

function TicketRow({ ticket }: { ticket: Ticket }) {
  const isPositive = ticket.sentiment === "POSITIVE";
  return (
    <li className="ticket">
      <div className="ticket-row">
        <div className="ticket-title">{ticket.title}</div>
        <time className="ticket-time" dateTime={ticket.created_at}>
          {formatTimestamp(ticket.created_at)}
        </time>
      </div>
      <p className="ticket-msg">{ticket.message}</p>
      <div className="ticket-meta">
        <span
          className={`chip ${isPositive ? "chip--pos" : "chip--neg"}`}
          title={`Model confidence ${ticket.confidence.toFixed(3)}`}
        >
          <span className="chip-dot" />
          {ticket.sentiment.charAt(0) + ticket.sentiment.slice(1).toLowerCase()}
        </span>
        <span className="chip">
          conf {ticket.confidence.toFixed(2)}
        </span>
        {ticket.category && (
          <span className="chip">{ticket.category}</span>
        )}
      </div>
    </li>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
