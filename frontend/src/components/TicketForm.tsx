import { useState, type FormEvent } from "react";
import { ApiError, createTicket } from "../api/client";
import type { Ticket, TicketCreate } from "../types/ticket";
import { IconSend } from "./icons";

interface TicketFormProps {
  /** Called after a successful POST. Parent uses this to refetch the list. */
  onCreated: (created: Ticket) => void;
}

/**
 * Controlled form for creating a ticket.
 *
 * Validation mirrors the backend (Pydantic):
 *   title:    1–255 chars
 *   message:  1–4000 chars
 *   category: optional, ≤100 chars
 *
 * Backend is the source of truth — `ApiError` surfaces its 422 detail.
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
      setSuccess(`Classified as ${created.sentiment.toLowerCase()}.`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unknown error submitting ticket."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label className="field-label" htmlFor="t-title">Title</label>
        <input
          id="t-title"
          className="input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={255}
          required
          disabled={submitting}
          placeholder="Brief summary"
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="t-message">Message</label>
        <textarea
          id="t-message"
          className="textarea"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={4000}
          required
          rows={4}
          disabled={submitting}
          placeholder="Describe the issue or feedback…"
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="t-category">Category</label>
        <input
          id="t-category"
          className="input"
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          maxLength={100}
          disabled={submitting}
          placeholder="Optional — e.g. billing, bug, feature"
        />
      </div>

      <div className="form-actions">
        <span
          className={`form-feedback ${error ? "error" : success ? "success" : ""}`}
          role={error ? "alert" : "status"}
        >
          {error ?? success ?? ""}
        </span>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={!canSubmit}
        >
          {submitting ? (
            <>
              <span className="spinner" aria-hidden />
              <span>Submitting</span>
            </>
          ) : (
            <>
              <IconSend size={15} />
              <span>Submit ticket</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}
