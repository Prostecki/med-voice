"use client";

import { useState } from "react";
import { Mail, Lock, Building2, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";

const CLINICS = ["City Medical Center", "Clinic on Lenina", "North District Hospital"];

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [clinic, setClinic] = useState(CLINICS[0]);
    const [showPass, setShowPass] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        try {
            await signInWithEmailAndPassword(auth, email, password);
            window.location.href = "/dashboard";
        } catch {
            setError("Invalid credentials. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#F7F9FA] flex items-center justify-center px-6 py-12 relative overflow-hidden">
            {/* Background elements for depth */}
            <div className="absolute top-0 right-0 -mt-20 -mr-20 w-[600px] h-[600px] bg-[#25C1B1]/5 rounded-full blur-[100px]" />
            <div className="absolute bottom-0 left-0 -mb-20 -ml-20 w-[400px] h-[400px] bg-[#002D4C]/5 rounded-full blur-[80px]" />

            <div className="w-full max-w-md relative z-10">
                {/* Logo Area */}
                <div className="text-center mb-10">
                    <div className="w-20 h-20 rounded-3xl bg-[#25C1B1] flex items-center justify-center mx-auto mb-6 shadow-xl shadow-[#25C1B1]/30 hover:scale-105 transition-transform duration-500">
                        <Building2 className="w-10 h-10 text-white" />
                    </div>
                    <h1 className="text-4xl font-black text-[#002D4C] tracking-tighter">
                        med<span className="text-[#25C1B1]">voice</span>
                    </h1>
                    <p className="text-slate-400 font-bold uppercase tracking-[0.2em] text-[10px] mt-2">Clinical Portal Access</p>
                </div>

                <form
                    onSubmit={handleSubmit}
                    className="bg-white border border-[#E1E8ED] rounded-[40px] p-10 space-y-8 shadow-2xl shadow-[#002D4C]/5"
                >
                    <div className="space-y-6">
                        {/* Email */}
                        <div>
                            <label className="block text-xs font-black text-[#002D4C] uppercase tracking-widest mb-3 px-1">Medical Email</label>
                            <div className="relative group">
                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300 group-focus-within:text-[#25C1B1] transition-colors" />
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="doctor@clinic.com"
                                    required
                                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-[15px] text-[#002D4C] font-semibold placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-[#25C1B1]/10 focus:border-[#25C1B1] transition-all"
                                />
                            </div>
                        </div>

                        {/* Password */}
                        <div>
                            <label className="block text-xs font-black text-[#002D4C] uppercase tracking-widest mb-3 px-1">Secure Password</label>
                            <div className="relative group">
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300 group-focus-within:text-[#25C1B1] transition-colors" />
                                <input
                                    type={showPass ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                    className="w-full pl-12 pr-12 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-[15px] text-[#002D4C] font-semibold placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-[#25C1B1]/10 focus:border-[#25C1B1] transition-all"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPass(!showPass)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-[#002D4C] transition-colors"
                                >
                                    {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>

                        {/* Clinic Selection */}
                        <div>
                            <label className="block text-xs font-black text-[#002D4C] uppercase tracking-widest mb-3 px-1">Select Facility</label>
                            <div className="relative group">
                                <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300 group-focus-within:text-[#25C1B1] transition-colors" />
                                <select
                                    value={clinic}
                                    onChange={(e) => setClinic(e.target.value)}
                                    className="w-full pl-12 pr-10 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-[15px] text-[#002D4C] font-semibold focus:outline-none focus:ring-4 focus:ring-[#25C1B1]/10 focus:border-[#25C1B1] transition-all appearance-none cursor-pointer"
                                >
                                    {CLINICS.map((c) => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-300">
                                    <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg>
                                </div>
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-3 bg-red-50 border border-red-100 text-red-600 rounded-2xl p-4 animate-in fade-in slide-in-from-top-2">
                            <Lock className="w-5 h-5 shrink-0" />
                            <p className="text-sm font-bold">{error}</p>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-5 rounded-full bg-[#002D4C] text-white font-black text-base hover:opacity-95 disabled:opacity-50 transition-all shadow-xl shadow-[#002D4C]/10 active:scale-[0.98] group flex items-center justify-center gap-3"
                    >
                        {loading ? (
                            <Loader2 className="w-6 h-6 animate-spin text-[#25C1B1]" />
                        ) : (
                            <>
                                Sign in to System
                                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </>
                        )}
                    </button>

                    <p className="text-center text-slate-400 text-xs font-semibold">
                        Authorized medical personnel only.
                        <Link href="#" className="text-[#25C1B1] ml-1 hover:underline">Support</Link>
                    </p>
                </form>
            </div>
        </div>
    );
}

import { Loader2, ArrowRight } from "lucide-react";
