"use client";

import { Settings } from "lucide-react";
import { RoleGuard } from "@/components/RoleGuard";

export default function SettingsPage() {
    return (
        <RoleGuard allowedRoles={["ADMIN"]}>
            <div className="space-y-10">
                <div>
                    <h2 className="text-3xl font-extrabold text-[#002D4C] tracking-tight">Clinic Settings</h2>
                    <p className="text-slate-500 font-medium mt-1">Configuration overview for the Med-Voice deployment.</p>
                </div>

                <div className="bg-white border border-[#E1E8ED] rounded-[32px] p-10 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-2 h-full bg-[#25C1B1]" />

                    <div className="max-w-2xl space-y-8">
                        <div className="flex items-center gap-4 mb-2">
                            <div className="w-12 h-12 rounded-2xl bg-[#25C1B1]/10 flex items-center justify-center text-[#25C1B1]">
                                <Settings className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-[#002D4C]">Deployment Notes</h3>
                                <p className="text-xs text-slate-400 font-black uppercase tracking-widest mt-1">Read-Only</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4">
                            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100">
                                <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Frontend</p>
                                <p className="text-sm font-semibold text-[#002D4C]">Firebase App Hosting via Git connection</p>
                            </div>
                            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100">
                                <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Backend</p>
                                <p className="text-sm font-semibold text-[#002D4C]">FastAPI + ADK live agent on Cloud Run</p>
                            </div>
                            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100">
                                <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Scheduling</p>
                                <p className="text-sm font-semibold text-[#002D4C]">Firestore call records with Cloud Tasks callback trigger</p>
                            </div>
                            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100">
                                <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Voice Model</p>
                                <p className="text-sm font-semibold text-[#002D4C]">Gemini Live 2.5 Flash Native Audio with Sulafat voice in europe-north1</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </RoleGuard>
    );
}
