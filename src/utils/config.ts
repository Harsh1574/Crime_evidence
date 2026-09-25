/**
 * Typed config helpers — reads demo_config.json at runtime.
 * All API routes use these instead of hardcoded values.
 */

import { readConfig } from "../server.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoleConfig {
    name: string;
    display_name: string;
    permissions: string[];
    /** Read-only roles are refused every write request (POST/PUT/PATCH/DELETE). */
    read_only?: boolean;
}

export interface SecurityConfig {
    mfa_enabled: boolean;
    session_timeout_min: number;
    encryption_algorithm: string;
    tls_version: string;
    [key: string]: any;
}

export interface LifecycleConfig {
    statuses: string[];
    retention_days: number;
    auto_archive: boolean;
    destruction_requires_approval: boolean;
    certificate_of_destruction: boolean;
}

// ---------------------------------------------------------------------------
// Getters — always read from disk (no caching)
// ---------------------------------------------------------------------------

/** Get all role definitions with their permissions */
export function getRoles(): RoleConfig[] {
    const config = readConfig();
    return config.roles ?? [];
}

/** Find a specific role by name (case-insensitive, so "PROSECUTOR" matches "prosecutor") */
export function findRole(roleName: string): RoleConfig | undefined {
    const wanted = roleName?.toLowerCase();
    return getRoles().find((r) => r.name.toLowerCase() === wanted);
}

/** Canonical role name as written in the config, or undefined if unknown */
export function normalizeRoleName(roleName: string): string | undefined {
    return findRole(roleName)?.name;
}

/** Names of every role that has the given permission */
export function getRolesWithPermission(permission: string): string[] {
    return getRoles().filter((r) => r.permissions.includes(permission)).map((r) => r.name);
}

/** True when the role is flagged read-only in the config */
export function isReadOnlyRole(roleName: string): boolean {
    return findRole(roleName)?.read_only === true;
}

/** Get permissions for a specific role */
export function getPermissions(roleName: string): string[] {
    const role = findRole(roleName);
    return role?.permissions ?? [];
}

/** Check if a role has a specific permission */
export function hasPermission(roleName: string, permission: string): boolean {
    return getPermissions(roleName).includes(permission);
}

/** Check if a role has ALL of the specified permissions */
export function hasAllPermissions(roleName: string, permissions: string[]): boolean {
    const rolePerms = getPermissions(roleName);
    return permissions.every((p) => rolePerms.includes(p));
}

/** Get all valid role names */
export function getValidRoleNames(): string[] {
    return getRoles().map((r) => r.name);
}

/** Get security configuration */
export function getSecurityConfig(): SecurityConfig {
    const config = readConfig();
    return config.security;
}

/** Get evidence lifecycle configuration */
export function getLifecycleConfig(): LifecycleConfig {
    const config = readConfig();
    return config.evidence_lifecycle;
}

/** Get valid evidence statuses — the single source of truth */
export function getValidStatuses(): string[] {
    return getLifecycleConfig().statuses;
}

/** Canonical status name from the config (case-insensitive, so "ANALYZED" → "Analyzed") */
export function normalizeStatus(status: string): string | undefined {
    const wanted = status?.toLowerCase();
    return getValidStatuses().find((s) => s.toLowerCase() === wanted);
}

/** Check if a status string is currently valid */
export function isValidStatus(status: string): boolean {
    return normalizeStatus(status) !== undefined;
}

/** Get the JWT secret (JWT_SECRET env var, then security config, then dev fallback) */
export function getJwtSecret(): string {
    if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
    const config = readConfig();
    return config.security?.jwt_secret ?? "crime-evidence-dev-secret-change-in-production";
}

/** Get session timeout in minutes */
export function getSessionTimeout(): number {
    return getSecurityConfig().session_timeout_min ?? 30;
}

/** Valid status transitions for evidence lifecycle */
// "Disposed" is only reachable through the JUDGE-approved disposal workflow.
export const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
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
export function isValidStatusTransition(fromStatus: string, toStatus: string): boolean {
    const allowed = VALID_STATUS_TRANSITIONS[normalizeStatus(fromStatus) ?? fromStatus];
    if (!allowed) return false;
    return allowed.includes(normalizeStatus(toStatus) ?? toStatus);
}

/** Maximum upload size in bytes (storage.max_file_size_mb, default 500 MB) */
export function readStorageLimitBytes(): number {
    const config = readConfig();
    const mb = Number(config.storage?.max_file_size_mb ?? 500);
    return Math.max(1, mb) * 1024 * 1024;
}
