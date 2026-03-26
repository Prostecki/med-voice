"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useRouter, usePathname } from "next/navigation";

interface UserProfile {
    userId: string;
    clinicId: string;
    role: "ADMIN" | "STAFF";
    displayName: string;
}

interface AuthContextType {
    user: User | null;
    profile: UserProfile | null;
    loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    profile: null,
    loading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            setUser(firebaseUser);

            if (firebaseUser) {
                // Fetch user profile from mv_users
                try {
                    const docRef = doc(db, "mv_users", firebaseUser.uid);
                    const snap = await getDoc(docRef);
                    if (snap.exists()) {
                        setProfile(snap.data() as UserProfile);
                    } else {
                        console.warn("User profile not found in mv_users");
                    }
                } catch (err) {
                    console.error("Error fetching user profile:", err);
                }
            } else {
                setProfile(null);
                // Redirect to login if not authenticated and not already on the login page
                if (pathname !== "/login" && pathname !== "/") {
                    router.push("/login");
                }
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, [pathname, router]);

    return (
        <AuthContext.Provider value={{ user, profile, loading }}>
            {loading ? (
                <div className="min-h-screen bg-[#F7F9FA] flex flex-col items-center justify-center gap-4">
                    <div className="w-12 h-12 rounded-full border-4 border-slate-100 border-t-[#25C1B1] animate-spin" />
                    <p className="text-[#002D4C] font-black tracking-widest text-[10px] uppercase animate-pulse">Initializing Portal</p>
                </div>
            ) : (
                children
            )}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
