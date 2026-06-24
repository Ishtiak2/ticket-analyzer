import { useCallback, useState } from "react";
import { TicketForm } from "./components/TicketForm";
import { TicketList } from "./components/TicketList";
import type { Ticket } from "./types/ticket";

/**
 * Single-page app per PRD §3: form on top, ticket list below.
 *
 * The form and list don't share a global store — `refreshKey` is the
 * minimal state we lift. The list refetches whenever it changes.
 */
function App() {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleCreated = useCallback((_created: Ticket) => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "2rem",
        maxWidth: "720px",
        margin: "0 auto",
      }}
    >
      <h1>Ticket Analyzer</h1>
      <p style={{ color: "#555" }}>
        Submit a support ticket and the backend will classify its sentiment.
      </p>

      <section style={{ marginBottom: "2rem" }}>
        <h2>New ticket</h2>
        <TicketForm onCreated={handleCreated} />
      </section>

      <section>
        <h2>Recent tickets</h2>
        <TicketList refreshKey={refreshKey} />
      </section>
    </main>
  );
}

export default App;
