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

/** Find a specific role by name */
export function findRole(roleName: string): RoleConfig | undefined {
    return getRoles().find((r) => r.name === roleName);
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

/** Check if a status string is currently valid */
export function isValidStatus(status: string): boolean {
    return getValidStatuses().includes(status);
}

/** Get the JWT secret (from security config or fallback) */
export function getJwtSecret(): string {
    const config = readConfig();
    return config.security?.jwt_secret ?? "crime-evidence-dev-secret-change-in-production";
}

/** Get session timeout in minutes */
export function getSessionTimeout(): number {
    return getSecurityConfig().session_timeout_min ?? 30;
}

/** Valid status transitions for evidence lifecycle */
export const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
    "Collected": ["Analyzed", "Archived", "Destroyed"],
    "Analyzed": ["Presented", "Archived", "Destroyed"],
    "Presented": ["Archived", "Destroyed"],
    "Archived": ["Collected", "Destroyed"], // Can restore from archive
    "Destroyed": [], // Terminal state
};

/** Check if a status transition is valid */
export function isValidStatusTransition(fromStatus: string, toStatus: string): boolean {
    const allowed = VALID_STATUS_TRANSITIONS[fromStatus];
    if (!allowed) return false;
    return allowed.includes(toStatus);
}
