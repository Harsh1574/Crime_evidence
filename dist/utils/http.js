/**
 * Shared HTTP helpers for route handlers.
 */
import { ServiceError } from "../services/evidence.js";
/** Send a ServiceError with its own status, anything else as a 500 */
export function sendError(res, err, fallbackMessage) {
    if (err instanceof ServiceError) {
        res.status(err.status).json({ error: err.message, ...err.extra });
        return;
    }
    res.status(500).json({ error: fallbackMessage, details: err?.message });
}
//# sourceMappingURL=http.js.map