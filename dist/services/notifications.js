/**
 * Notification + activity feed helpers shared by the route modules.
 */
import { prisma } from "../lib/prisma.js";
import { getRolesWithPermission } from "../utils/config.js";
function linkFor(userId, input) {
    if (input.evidenceId)
        return `/dashboard/${userId}/evidence/${input.evidenceId}`;
    if (input.caseId)
        return `/dashboard/${userId}/cases/${input.caseId}`;
    return null;
}
/** Notify a set of users (duplicates and empty IDs are ignored) */
export async function notifyUsers(userIds, input) {
    const unique = [...new Set(userIds.filter((id) => !!id))];
    if (unique.length === 0)
        return;
    await prisma.notification.createMany({
        data: unique.map((userId) => ({
            userId,
            type: input.type,
            title: input.title,
            message: input.message,
            link: linkFor(userId, input),
        })),
    });
}
/** Active users whose role has the given permission */
export async function usersWithPermission(permission) {
    const roles = getRolesWithPermission(permission);
    if (roles.length === 0)
        return [];
    const users = await prisma.user.findMany({
        where: { isActive: true, role: { in: roles } },
        select: { id: true },
    });
    return users.map((u) => u.id);
}
/** Notify every active user whose role has the given permission */
export async function notifyPermissionHolders(permission, input, excludeUserId) {
    const ids = (await usersWithPermission(permission)).filter((id) => id !== excludeUserId);
    await notifyUsers(ids, input);
}
/** Add an entry to the dashboard activity feed */
export async function logActivity(actor, action, entityType, entityId, entityLabel) {
    await prisma.activityLog.create({
        data: {
            actorId: actor.id,
            actorName: actor.username,
            action,
            entityType,
            entityId,
            entityLabel: entityLabel ?? null,
        },
    });
}
//# sourceMappingURL=notifications.js.map