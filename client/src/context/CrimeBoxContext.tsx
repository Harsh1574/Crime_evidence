"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useAuth } from "./AuthContext";
import { api, apiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

export type Permission = "read-write" | "read-only" | null;

export interface CrimeBox {
  id: string;
  name: string;
  caseId: string;
  privateKey?: string; // Only returned on creation
  publicKey?: string;  // Only returned on creation
  createdAt: number;
}

interface CrimeBoxContextType {
  activeBox: CrimeBox | null;
  permission: Permission;
  createBox: (name: string, caseId: string) => Promise<{ privateKey: string; publicKey: string } | null>;
  joinBox: (key: string) => Promise<boolean>;
  leaveBox: () => void;
  // boxes: CrimeBox[]; // Removed as we don't list all boxes anymore
}

const CrimeBoxContext = createContext<CrimeBoxContextType | undefined>(undefined);

export function CrimeBoxProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const toast = useToast();
  const [activeBox, setActiveBox] = useState<CrimeBox | null>(null);
  const [permission, setPermission] = useState<Permission>(null);

  // Restore session from sessionStorage if available (Session Isolation)
  useEffect(() => {
    const storedBox = sessionStorage.getItem("active_crime_box");
    const storedPerm = sessionStorage.getItem("active_crime_box_perm");
    if (storedBox && storedPerm) {
      setActiveBox(JSON.parse(storedBox));
      setPermission(storedPerm as Permission);
    }
  }, []);

  const createBox = async (name: string, caseId: string) => {
    try {
      const response = await api.post("/api/v1/boxes", { name, caseId });
      if (response.data.success) {
        const { box } = response.data;

        // Auto-join the creator as read-write
        setActiveBox(box);
        setPermission("read-write");

        sessionStorage.setItem("active_crime_box", JSON.stringify(box));
        sessionStorage.setItem("active_crime_box_perm", "read-write");

        toast.success(`Crime Box "${box.name}" created. Share the keys with your team.`);

        // Persist keys separately so Head Officer can view them after joining
        sessionStorage.setItem("active_crime_box_keys", JSON.stringify({
          privateKey: box.privateKey,
          publicKey: box.publicKey,
        }));

        return {
          privateKey: box.privateKey,
          publicKey: box.publicKey
        };
      }
      return null;
    } catch (error) {
      toast.error(apiError(error, "Failed to create Crime Box. Case ID might already exist."));
      return null;
    }
  };

  const joinBox = async (key: string): Promise<boolean> => {
    try {
      const response = await api.post("/api/v1/boxes/join", { key });

      if (response.data.success) {
        const { box, permission: perm } = response.data;
        setActiveBox(box);
        setPermission(perm);

        // Persist session
        sessionStorage.setItem("active_crime_box", JSON.stringify(box));
        sessionStorage.setItem("active_crime_box_perm", perm);
        toast.success(`Joined "${box.name}" with ${perm} access.`);
        return true;
      }
      return false;
    } catch (error) {
      toast.error(apiError(error, "Failed to join Crime Box."));
      return false;
    }
  };

  const leaveBox = () => {
    if (activeBox) toast.info(`You left "${activeBox.name}".`);
    setActiveBox(null);
    setPermission(null);
    sessionStorage.removeItem("active_crime_box");
    sessionStorage.removeItem("active_crime_box_perm");
    sessionStorage.removeItem("active_crime_box_keys"); // Clear keys on leave too
  };

  return (
    <CrimeBoxContext.Provider
      value={{
        activeBox,
        permission,
        createBox,
        joinBox,
        leaveBox,
      }}
    >
      {children}
    </CrimeBoxContext.Provider>
  );
}

export function useCrimeBox() {
  const context = useContext(CrimeBoxContext);
  if (context === undefined) {
    throw new Error("useCrimeBox must be used within a CrimeBoxProvider");
  }
  return context;
}
