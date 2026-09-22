/**
 * Typed config helpers — reads demo_config.json at runtime.
 * All API routes use these instead of hardcoded values.
 */
import { readConfig } from "../server.js";
// ---------------------------------------------------------------------------
// Getters — always read from disk (no caching)
// ---------------------------------------------------------------------------
/** Get all role definitions with their permissions */
export function getRoles() {
    const config = readConfig();
    return config.roles ?? [];
}
/** Find a specific role by name */
export function findRole(roleName) {
    return getRoles().find((r) => r.name === roleName);
}
/** Get permissions for a specific role */
export function getPermissions(roleName) {
    const role = findRole(roleName);
    return role?.permissions ?? [];
}
/** Check if a role has a specific permission */
export function hasPermission(roleName, permission) {
    return getPermissions(roleName).includes(permission);
}
/** Check if a role has ALL of the specified permissions */
export function hasAllPermissions(roleName, permissions) {
    const rolePerms = getPermissions(roleName);
    return permissions.every((p) => rolePerms.includes(p));
}
/** Get all valid role names */
export function getValidRoleNames() {
    return getRoles().map((r) => r.name);
}
/** Get security configuration */
export function getSecurityConfig() {
    const config = readConfig();
    return config.security;
}
/** Get evidence lifecycle configuration */
export function getLifecycleConfig() {
    const config = readConfig();
    return config.evidence_lifecycle;
}
/** Get valid evidence statuses — the single source of truth */
export function getValidStatuses() {
    return getLifecycleConfig().statuses;
}
/** Check if a status string is currently valid */
export function isValidStatus(status) {
    return getValidStatuses().includes(status);
}
/** Get the JWT secret (from security config or fallback) */
export function getJwtSecret() {
    const config = readConfig();
    return config.security?.jwt_secret ?? "crime-evidence-dev-secret-change-in-production";
}
/** Get session timeout in minutes */
export function getSessionTimeout() {
    return getSecurityConfig().session_timeout_min ?? 30;
}
/** Valid status transitions for evidence lifecycle */
export const VALID_STATUS_TRANSITIONS = {
    "Collected": ["Analyzed", "Archived", "Destroyed"],
    "Analyzed": ["Presented", "Archived", "Destroyed"],
    "Presented": ["Archived", "Destroyed"],
    "Archived": ["Collected", "Destroyed"], // Can restore from archive
    "Destroyed": [], // Terminal state
};
/** Check if a status transition is valid */
export function isValidStatusTransition(fromStatus, toStatus) {
    const allowed = VALID_STATUS_TRANSITIONS[fromStatus];
    if (!allowed)
        return false;
    return allowed.includes(toStatus);
}
//# sourceMappingURL=config.js.map