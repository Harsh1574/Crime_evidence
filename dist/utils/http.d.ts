/**
 * Shared HTTP helpers for route handlers.
 */
import { Response } from "express";
/** Send a ServiceError with its own status, anything else as a 500 */
export declare function sendError(res: Response, err: any, fallbackMessage: string): void;
//# sourceMappingURL=http.d.ts.map