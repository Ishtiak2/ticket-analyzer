import { useCallback, useMemo, useState } from "react";
import { TicketForm } from "./components/TicketForm";
import { TicketList } from "./components/TicketList";
import type { Ticket } from "./types/ticket";
import { IconSpark } from "./components/icons";

/**
 * App shell — header, two-column layout (form + list), live stats.
 * The form and list don't share a global store; we lift just a
 * `refreshKey` so the list refetches after a successful submit.
 */
function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [tickets, setTickets] = useState<Ticket[]>([]);

  const handleCreated = useCallback((created: Ticket) => {
    setTickets((prev) => [created, ...prev]);
    setRefreshKey((k) => k + 1);
  }, []);

  const stats = useMemo(() => {
    const total = tickets.length;
    const positive = tickets.filter((t) => t.sentiment === "POSITIVE").length;
    const negative = total - positive;
    return { total, positive, negative };
  }, [tickets]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <IconSpark size={16} />
          </span>
          <span>Ticket Analyzer</span>
        </div>
        <div className="status-pill" title="Backend reachable via /api">
          <span className="status-dot" />
          <span>Live</span>
        </div>
      </header>

      <main className="app-main">
        {/* Left column — submit + stats */}
        <section>
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-head">
              <div>
                <div className="card-title">New ticket</div>
                <div className="card-subtitle">
                  Classify sentiment on submit.
                </div>
              </div>
            </div>
            <div className="card-body">
              <TicketForm onCreated={handleCreated} />
            </div>
          </div>

          <div className="stats">
            <div className="stat">
              <div className="stat-label">Total</div>
              <div className="stat-value">{stats.total}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Positive</div>
              <div className="stat-value">{stats.positive}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Negative</div>
              <div className="stat-value">{stats.negative}</div>
            </div>
          </div>
        </section>

        {/* Right column — recent tickets */}
        <section>
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Recent tickets</div>
                <div className="card-subtitle">
                  Newest first. Persisted in Postgres.
                </div>
              </div>
            </div>
            <TicketList
              refreshKey={refreshKey}
              onLoaded={setTickets}
            />
          </div>
        </section>
      </main>

      <footer className="app-footer">
        bKash · SUST CSE Carnival 2026 · Workshop build
      </footer>
    </div>
  );
}

export default App;
