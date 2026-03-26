"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../AuthProvider";
import { auth } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import {
    LayoutDashboard,
    Users,
    Calendar,
    CalendarClock,
    HeartPulse,
    LogOut,
    Settings,
    Menu,
    X
} from "lucide-react";

const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/patients", label: "Patients", icon: Users },
    { href: "/appointments", label: "Appointments", icon: Calendar },
    { href: "/availability", label: "Availability", icon: CalendarClock },
    { href: "/settings", label: "Settings", icon: Settings, adminOnly: true },
];

export default function Navbar() {
    const pathname = usePathname();
    const { profile } = useAuth();
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    if (pathname === "/login") return null;

    const handleLogout = async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Error signing out:", error);
        }
    };

    const filteredNavItems = navItems.filter(item => {
        if (!profile) return false;
        if (item.adminOnly && profile.role !== "ADMIN") return false;
        return true;
    });

    return (
        <nav className="border-b border-[#E1E8ED] bg-white/90 backdrop-blur-md sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-20">
                    {/* Logo */}
                    <Link href="/dashboard" className="flex items-center gap-3 group shrink-0">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-[18px] bg-[#25C1B1] flex items-center justify-center shadow-lg shadow-[#25C1B1]/30 group-hover:scale-105 transition-all duration-500">
                            <HeartPulse className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
                        </div>
                        <span className="text-lg sm:text-xl font-black text-[#002D4C] tracking-tighter">
                            med<span className="text-[#25C1B1]">voice</span>
                        </span>
                    </Link>

                    {/* Desktop Nav links */}
                    <div className="hidden md:flex items-center gap-1 xl:gap-2">
                        {filteredNavItems.map(({ href, label, icon: Icon }) => {
                            const active = pathname.startsWith(href);
                            return (
                                <Link
                                    key={href}
                                    href={href}
                                    className={`flex items-center gap-2 px-4 xl:px-6 py-2.5 rounded-full text-sm font-bold transition-all duration-300
                                    ${active
                                            ? "bg-[#002D4C] text-white shadow-xl shadow-[#002D4C]/20 scale-105"
                                            : "text-[#002D4C]/50 hover:text-[#002D4C] hover:bg-slate-50"
                                        }`}
                                >
                                    <Icon className="w-4 h-4" />
                                    {label}
                                </Link>
                            );
                        })}
                    </div>

                    {/* Profile & Logout (Desktop) */}
                    <div className="hidden md:flex items-center gap-4 xl:gap-6 pl-4 xl:pl-6 border-l border-slate-100">
                        <div className="text-right">
                            <p className="text-xs sm:text-sm font-black text-[#002D4C] leading-none mb-1">
                                {profile?.displayName || "Medical Staff"}
                            </p>
                            <p className="text-[10px] text-[#25C1B1] font-black uppercase tracking-widest leading-none">
                                {profile?.role}
                            </p>
                        </div>
                        <button
                            onClick={handleLogout}
                            className="p-2.5 rounded-xl bg-slate-50 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all duration-300 group"
                        >
                            <LogOut className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
                        </button>
                    </div>

                    {/* Mobile Menu Button */}
                    <div className="md:hidden flex items-center gap-4">
                        <button
                            onClick={handleLogout}
                            className="p-2 rounded-xl bg-slate-50 text-slate-400"
                        >
                            <LogOut className="w-5 h-5" />
                        </button>
                        <button
                            onClick={() => setIsMenuOpen(!isMenuOpen)}
                            className="p-2 rounded-xl bg-[#002D4C] text-white shadow-lg shadow-[#002D4C]/20"
                        >
                            {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                        </button>
                    </div>
                </div>
            </div>

            {/* Mobile Menu Content */}
            {isMenuOpen && (
                <div className="md:hidden border-t border-slate-100 bg-white/95 backdrop-blur-xl animate-in slide-in-from-top duration-300">
                    <div className="px-4 py-6 space-y-2">
                        {filteredNavItems.map(({ href, label, icon: Icon }) => {
                            const active = pathname.startsWith(href);
                            return (
                                <Link
                                    key={href}
                                    href={href}
                                    onClick={() => setIsMenuOpen(false)}
                                    className={`flex items-center gap-4 px-6 py-4 rounded-2xl text-base font-bold transition-all duration-300
                                    ${active
                                            ? "bg-[#002D4C] text-white shadow-lg shadow-[#002D4C]/20"
                                            : "text-[#002D4C]/50 hover:text-[#002D4C] hover:bg-slate-50"
                                        }`}
                                >
                                    <Icon className="w-5 h-5" />
                                    {label}
                                </Link>
                            );
                        })}

                        <div className="pt-4 mt-4 border-t border-slate-100 px-6">
                            <p className="text-sm font-black text-[#002D4C]">
                                {profile?.displayName || "Medical Staff"}
                            </p>
                            <p className="text-[10px] text-[#25C1B1] font-black uppercase tracking-widest mt-1">
                                {profile?.role}
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </nav>
    );
}
