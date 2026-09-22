/**
 * Typed config helpers — reads demo_config.json at runtime.
 * All API routes use these instead of hardcoded values.
 */
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
/** Get all role definitions with their permissions */
export declare function getRoles(): RoleConfig[];
/** Find a specific role by name */
export declare function findRole(roleName: string): RoleConfig | undefined;
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
/** Check if a status string is currently valid */
export declare function isValidStatus(status: string): boolean;
/** Get the JWT secret (from security config or fallback) */
export declare function getJwtSecret(): string;
/** Get session timeout in minutes */
export declare function getSessionTimeout(): number;
/** Valid status transitions for evidence lifecycle */
export declare const VALID_STATUS_TRANSITIONS: Record<string, string[]>;
/** Check if a status transition is valid */
export declare function isValidStatusTransition(fromStatus: string, toStatus: string): boolean;
//# sourceMappingURL=config.d.ts.map