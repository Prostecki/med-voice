"use client";

import React from "react";
import { useAuth } from "./AuthProvider";

type Role = "ADMIN" | "STAFF";

interface RoleGuardProps {
    children: React.ReactNode;
    allowedRoles: Role[];
    fallback?: React.ReactNode;
}

/**
 * RoleGuard conditionally renders children only if the logged-in user
 * has one of the allowed roles.
 */
export function RoleGuard({ children, allowedRoles, fallback = null }: RoleGuardProps) {
    const { profile, loading } = useAuth();

    if (loading) return null;

    if (!profile || !allowedRoles.includes(profile.role)) {
        return <>{fallback}</>;
    }

    return <>{children}</>;
}
