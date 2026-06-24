// Thin fetch wrapper around the backend API. Components should never call
// `fetch` directly; doing so leaks error-handling and base-URL concerns.
//
// All requests go to {VITE_API_BASE_URL}/tickets. In the container, the
// frontend nginx proxies /api → http://backend:8000/, so the compiled
// `VITE_API_BASE_URL` is `/api`. In dev (`npm run dev`) the .env value
// also points at `/api` and Vite's own dev-server proxy handles the hop.

import type { Ticket, TicketCreate } from "../types/ticket";

const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";

/** Thrown for any non-2xx response. Carries the parsed backend message. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface FastApiErrorBody {
  detail?: unknown;
}

function parseErrorMessage(status: number, body: unknown): string {
  // FastAPI's default error shape is { detail: string | array }.
  // We do the best we can with either form.
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as FastApiErrorBody).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      // Validation errors: [{loc, msg, type, input}, ...]
      return detail
        .map((d) => {
          if (d && typeof d === "object" && "msg" in d) {
            const loc = Array.isArray((d as { loc?: unknown }).loc)
              ? ((d as { loc: unknown[] }).loc.join("."))
              : "";
            return loc ? `${loc}: ${(d as { msg: string }).msg}` : (d as { msg: string }).msg;
          }
          return JSON.stringify(d);
        })
        .join("; ");
    }
    return JSON.stringify(detail);
  }
  return `Request failed with status ${status}`;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });

  // 204 No Content (not used by this API, but cheap to handle).
  if (res.status === 204) {
    return undefined as T;
  }

  // Try to parse JSON regardless of status — FastAPI always returns JSON
  // for error responses, and we want a useful message for the form.
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, parseErrorMessage(res.status, body));
  }

  return body as T;
}

export function createTicket(payload: TicketCreate): Promise<Ticket> {
  return request<Ticket>("/tickets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getTickets(): Promise<Ticket[]> {
  return request<Ticket[]>("/tickets", { method: "GET" });
}
