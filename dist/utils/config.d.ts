/**
 * Typed config helpers — reads demo_config.json at runtime.
 * All API routes use these instead of hardcoded values.
 */
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
/** Get all role definitions with their permissions */
export declare function getRoles(): RoleConfig[];
/** Find a specific role by name (case-insensitive, so "PROSECUTOR" matches "prosecutor") */
export declare function findRole(roleName: string): RoleConfig | undefined;
/** Canonical role name as written in the config, or undefined if unknown */
export declare function normalizeRoleName(roleName: string): string | undefined;
/** Names of every role that has the given permission */
export declare function getRolesWithPermission(permission: string): string[];
/** True when the role is flagged read-only in the config */
export declare function isReadOnlyRole(roleName: string): boolean;
/** Get permissions for a specific role */
export declare function getPermissions(roleName: string): string[];
/** Check if a role has a specific permission */
export declare function hasPermission(roleName: string, permission: string): boolean;
/** Check if a role has ALL of the specified permissions */
export declare function hasAllPermissions(roleName: string, permissions: string[]): boolean;
/** Get all valid role names */
export declare function getValidRoleNames(): string[];
/** Get security configuration */
export declare function getSecurityConfig(): SecurityConfig;
/** Get evidence lifecycle configuration */
export declare function getLifecycleConfig(): LifecycleConfig;
/** Get valid evidence statuses — the single source of truth */
export declare function getValidStatuses(): string[];
/** Canonical status name from the config (case-insensitive, so "ANALYZED" → "Analyzed") */
export declare function normalizeStatus(status: string): string | undefined;
/** Check if a status string is currently valid */
export declare function isValidStatus(status: string): boolean;
/** Get the JWT secret (JWT_SECRET env var, then security config, then dev fallback) */
export declare function getJwtSecret(): string;
/** Get session timeout in minutes */
export declare function getSessionTimeout(): number;
/** Valid status transitions for evidence lifecycle */
export declare const VALID_STATUS_TRANSITIONS: Record<string, string[]>;
/** Check if a status transition is valid */
export declare function isValidStatusTransition(fromStatus: string, toStatus: string): boolean;
/** Maximum upload size in bytes (storage.max_file_size_mb, default 500 MB) */
export declare function readStorageLimitBytes(): number;
//# sourceMappingURL=config.d.ts.map