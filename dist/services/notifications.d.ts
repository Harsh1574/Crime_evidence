/**
 * Notification + activity feed helpers shared by the route modules.
 */
export interface NotificationInput {
    type: string;
    title: string;
    message: string;
    /** Evidence ID to deep-link to (link is built per recipient) */
    evidenceId?: string;
    /** Case ID to deep-link to (used when there is no evidenceId) */
    caseId?: string;
}
/** Notify a set of users (duplicates and empty IDs are ignored) */
export declare function notifyUsers(userIds: (string | null | undefined)[], input: NotificationInput): Promise<void>;
/** Active users whose role has the given permission */
export declare function usersWithPermission(permission: string): Promise<string[]>;
/** Notify every active user whose role has the given permission */
export declare function notifyPermissionHolders(permission: string, input: NotificationInput, excludeUserId?: string): Promise<void>;
/** Add an entry to the dashboard activity feed */
export declare function logActivity(actor: {
    id: string;
    username: string;
}, action: string, entityType: string, entityId: string, entityLabel?: string | null): Promise<void>;
//# sourceMappingURL=notifications.d.ts.map