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
/** Find a specific role by name (case-insensitive, so "PROSECUTOR" matches "prosecutor") */
export function findRole(roleName) {
    const wanted = roleName?.toLowerCase();
    return getRoles().find((r) => r.name.toLowerCase() === wanted);
}
/** Canonical role name as written in the config, or undefined if unknown */
export function normalizeRoleName(roleName) {
    return findRole(roleName)?.name;
}
/** Names of every role that has the given permission */
export function getRolesWithPermission(permission) {
    return getRoles().filter((r) => r.permissions.includes(permission)).map((r) => r.name);
}
/** True when the role is flagged read-only in the config */
export function isReadOnlyRole(roleName) {
    return findRole(roleName)?.read_only === true;
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
/** Canonical status name from the config (case-insensitive, so "ANALYZED" → "Analyzed") */
export function normalizeStatus(status) {
    const wanted = status?.toLowerCase();
    return getValidStatuses().find((s) => s.toLowerCase() === wanted);
}
/** Check if a status string is currently valid */
export function isValidStatus(status) {
    return normalizeStatus(status) !== undefined;
}
/** Get the JWT secret (JWT_SECRET env var, then security config, then dev fallback) */
export function getJwtSecret() {
    if (process.env.JWT_SECRET)
        return process.env.JWT_SECRET;
    const config = readConfig();
    return config.security?.jwt_secret ?? "crime-evidence-dev-secret-change-in-production";
}
/** Get session timeout in minutes */
export function getSessionTimeout() {
    return getSecurityConfig().session_timeout_min ?? 30;
}
/** Valid status transitions for evidence lifecycle */
// "Disposed" is only reachable through the JUDGE-approved disposal workflow.
export const VALID_STATUS_TRANSITIONS = {
    "Collected": ["Processing", "Analyzed", "Archived", "Destroyed"],
    "Processing": ["Analyzed", "Archived"],
    "Analyzed": ["Processing", "Presented", "Archived", "Released", "Destroyed"],
    "Presented": ["Archived", "Released", "Destroyed"],
    "Archived": ["Collected", "Released", "Destroyed"], // Can restore from archive
    "Released": [], // Terminal state
    "Disposed": [], // Terminal state
    "Destroyed": [], // Terminal state
};
/** Check if a status transition is valid */
export function isValidStatusTransition(fromStatus, toStatus) {
    const allowed = VALID_STATUS_TRANSITIONS[normalizeStatus(fromStatus) ?? fromStatus];
    if (!allowed)
        return false;
    return allowed.includes(normalizeStatus(toStatus) ?? toStatus);
}
/** Maximum upload size in bytes (storage.max_file_size_mb, default 500 MB) */
export function readStorageLimitBytes() {
    const config = readConfig();
    const mb = Number(config.storage?.max_file_size_mb ?? 500);
    return Math.max(1, mb) * 1024 * 1024;
}
//# sourceMappingURL=config.js.map