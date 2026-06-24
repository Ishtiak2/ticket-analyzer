// Mirrors the backend Pydantic schemas exactly. Keep this in sync with:
//   backend/app/schemas.py  →  TicketCreate, TicketOut
//
// The naming is snake_case to match the JSON the backend returns
// (created_at, sentiment, confidence) — we deliberately do NOT remap to
// camelCase in this codebase; one source of truth, no transform layer.

/** Request body for POST /tickets. */
export interface TicketCreate {
  title: string;
  message: string;
  category?: string | null;
}

/** Response shape for both GET /tickets and POST /tickets. */
export interface Ticket {
  id: number;
  title: string;
  message: string;
  category: string | null;
  sentiment: "POSITIVE" | "NEGATIVE";
  confidence: number;
  created_at: string; // ISO-8601 timestamp from the backend
}
