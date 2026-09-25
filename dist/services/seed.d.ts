/**
 * Demo users — one per role used in the setup/acceptance walkthrough.
 * Idempotent: existing usernames are left untouched.
 */
export declare const DEMO_USERS: {
    username: string;
    password: string;
    role: string;
    fullName: string;
    email: string;
    department: string;
    badgeNumber: string;
}[];
export declare function seedDemoUsers(): Promise<{
    created: {
        username: string;
        role: string;
        password: string;
    }[];
    skipped: string[];
}>;
//# sourceMappingURL=seed.d.ts.map