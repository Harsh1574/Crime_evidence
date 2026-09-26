"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

interface User {
    id: string;
    username: string;
    fullName: string;
    role: string;
    department?: string;
    roleDisplayName?: string;
    permissions?: string[];
    readOnly?: boolean;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    login: (token: string, user: User) => void;
    logout: () => Promise<void>;
    /** True when the user's role has the permission (from demo_config.json) */
    can: (permission: string) => boolean;
    /** True when the role has at least one of the permissions */
    canAny: (...permissions: string[]) => boolean;
    isAuthenticated: boolean;
    isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();
    const toast = useToast();

    const storeUser = (u: User) => {
        setUser(u);
        sessionStorage.setItem("user", JSON.stringify(u));
    };

    useEffect(() => {
        // Check sessionStorage for existing session (Tab Specific)
        const storedToken = sessionStorage.getItem("token");
        const storedUser = sessionStorage.getItem("user");

        if (storedToken && storedUser) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setToken(storedToken);
            setUser(JSON.parse(storedUser));
            // Set default auth header for axios
            axios.defaults.headers.common["Authorization"] = `Bearer ${storedToken}`;
            // Refresh profile + permissions (also detects revoked / expired tokens)
            api.get("/api/v1/auth/me")
                .then((r) => storeUser(r.data.user))
                .catch(() => undefined)
                .finally(() => setIsLoading(false));
            return;
        }
        setIsLoading(false);
    }, []);

    const login = (newToken: string, newUser: User) => {
        setToken(newToken);
        storeUser(newUser);
        sessionStorage.setItem("token", newToken);
        axios.defaults.headers.common["Authorization"] = `Bearer ${newToken}`;
        // Redirect to dynamic user dashboard
        router.push(`/dashboard/${newUser.id}`);
    };

    const logout = async () => {
        // Revoke the token server-side so it cannot be reused
        try {
            await api.post("/api/v1/auth/logout");
        } catch {
            // Token already invalid — nothing to revoke
        }
        setToken(null);
        setUser(null);
        sessionStorage.removeItem("token");
        sessionStorage.removeItem("user");
        sessionStorage.removeItem("active_crime_box");
        sessionStorage.removeItem("active_crime_box_perm");
        sessionStorage.removeItem("active_crime_box_keys");
        delete axios.defaults.headers.common["Authorization"];
        toast.success("Your session token has been revoked on the server.", "Signed out");
        router.push("/login");
    };

    const can = useCallback((permission: string) => !!user?.permissions?.includes(permission), [user]);
    const canAny = useCallback((...permissions: string[]) => permissions.some((p) => !!user?.permissions?.includes(p)), [user]);

    return (
        <AuthContext.Provider
            value={{
                user,
                token,
                login,
                logout,
                can,
                canAny,
                isAuthenticated: !!token,
                isLoading,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
