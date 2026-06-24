import { useState, type FormEvent } from "react";
import { ApiError, createTicket } from "../api/client";
import type { Ticket, TicketCreate } from "../types/ticket";

interface TicketFormProps {
  /** Called after a successful POST. The parent uses this to refetch the list. */
  onCreated: (created: Ticket) => void;
}

/**
 * Controlled form for creating a ticket.
 *
 * Validation rules mirror the backend (Pydantic):
 *   title:    1–255 chars
 *   message:  1–4000 chars
 *   category: optional, ≤100 chars
 *
 * We do *not* re-validate client-side beyond basic HTML maxlength; the
 * backend is the source of truth and ApiError surfaces its 422 detail.
 */
export function TicketForm({ onCreated }: TicketFormProps) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canSubmit =
    !submitting &&
    title.trim().length > 0 &&
    message.trim().length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const payload: TicketCreate = {
      title: title.trim(),
      message: message.trim(),
      category: category.trim() ? category.trim() : null,
    };

    try {
      const created = await createTicket(payload);
      onCreated(created);
      setTitle("");
      setMessage("");
      setCategory("");
      setSuccess(`Saved — sentiment: ${created.sentiment} (${created.confidence})`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Unknown error submitting ticket.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <span>Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={255}
          required
          disabled={submitting}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <span>Message</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={4000}
          required
          rows={4}
          disabled={submitting}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <span>Category (optional)</span>
        <input
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          maxLength={100}
          disabled={submitting}
        />
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <button type="submit" disabled={!canSubmit}>
          {submitting ? "Submitting…" : "Submit ticket"}
        </button>
        {error && (
          <span style={{ color: "#b00020" }} role="alert">
            {error}
          </span>
        )}
        {success && !error && (
          <span style={{ color: "#0a7f2e" }} role="status">
            {success}
          </span>
        )}
      </div>
    </form>
  );
}
