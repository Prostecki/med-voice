"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, Plus, Phone, FileText, ChevronRight, User } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { getPatientsByClinic, getReportsByPatient, Patient, createPatient } from "@/lib/queries";
import { RoleGuard } from "@/components/RoleGuard";

interface PatientWithReports extends Patient {
    pendingReportsCount: number;
}

export default function PatientsPage() {
    const { profile } = useAuth();
    const [search, setSearch] = useState("");
    const [showCreate, setShowCreate] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [patients, setPatients] = useState<PatientWithReports[]>([]);
    const [loading, setLoading] = useState(true);

    const [formData, setFormData] = useState({
        fullName: "",
        phone: "",
        preferredLanguage: "EN",
        timezone: "Europe/Stockholm"
    });

    async function fetchPatients() {
        if (!profile?.clinicId) return;
        setLoading(true);
        try {
            const fetchedPatients = await getPatientsByClinic(profile.clinicId);

            const patientsWithReports = await Promise.all(
                fetchedPatients.map(async (p) => {
                    const reports = await getReportsByPatient(p.patientId);
                    const pendingCount = reports.filter(r => r.status === "UPLOADED" || !r.status).length;
                    return { ...p, pendingReportsCount: pendingCount };
                })
            );

            patientsWithReports.sort((a, b) => {
                if (b.pendingReportsCount !== a.pendingReportsCount) {
                    return b.pendingReportsCount - a.pendingReportsCount;
                }
                return a.fullName.localeCompare(b.fullName);
            });

            setPatients(patientsWithReports);
        } catch (err) {
            console.error("Error fetching patients:", err);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        fetchPatients();
    }, [profile?.clinicId]);

    const handleRegister = async () => {
        if (!profile?.clinicId || !formData.fullName || !formData.phone) return;
        setSubmitting(true);
        try {
            await createPatient({
                ...formData,
                clinicId: profile.clinicId
            });
            setShowCreate(false);
            setFormData({
                fullName: "",
                phone: "",
                preferredLanguage: "EN",
                timezone: "Europe/Stockholm"
            });
            await fetchPatients();
        } catch (err) {
            console.error("Error registering patient:", err);
            alert("Failed to register patient");
        } finally {
            setSubmitting(false);
        }
    };

    const filtered = patients.filter((p) =>
        p.fullName.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-extrabold text-[#002D4C] tracking-tight">Patients</h2>
                    <p className="text-[#002D4C]/60 text-sm mt-1 font-medium">{patients.length} active patients</p>
                </div>
                <RoleGuard allowedRoles={["ADMIN", "STAFF"]}>
                    <button
                        onClick={() => setShowCreate(true)}
                        className="flex items-center gap-2 px-6 py-3 rounded-full bg-[#25C1B1] text-white text-sm font-bold hover:bg-[#1EAD9F] transition-all shadow-lg shadow-[#25C1B1]/20 hover:scale-105 active:scale-95"
                    >
                        <Plus className="w-5 h-5" />
                        New Patient
                    </button>
                </RoleGuard>
            </div>

            {/* Search */}
            <div className="relative group">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-[#25C1B1] transition-colors" />
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search patients by name..."
                    className="w-full pl-12 pr-6 py-4 bg-white border border-[#E1E8ED] rounded-2xl text-[15px] text-[#002D4C] placeholder-slate-400 shadow-sm focus:outline-none focus:ring-4 focus:ring-[#25C1B1]/10 focus:border-[#25C1B1] transition-all"
                />
            </div>

            {/* List */}
            <div className="grid grid-cols-1 gap-4">
                {loading ? (
                    <div className="p-12 text-center text-slate-400 animate-pulse font-medium">Loading medical records...</div>
                ) : (
                    filtered.map((patient) => (
                        <Link key={patient.patientId} href={`/patients/${patient.patientId}`}>
                            <div className="flex items-center gap-5 p-5 bg-white border border-[#E1E8ED] rounded-2xl hover:border-[#25C1B1]/30 hover:shadow-xl hover:shadow-[#002D4C]/5 transition-all cursor-pointer group relative overflow-hidden">
                                {/* Accent line on hover */}
                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#25C1B1] opacity-0 group-hover:opacity-100 transition-opacity" />

                                <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center shrink-0 group-hover:bg-[#25C1B1]/10 transition-colors">
                                    <User className="w-6 h-6 text-slate-400 group-hover:text-[#25C1B1]" />
                                </div>

                                <div className="flex-1 min-w-0">
                                    <p className="text-base font-bold text-[#002D4C] group-hover:text-[#25C1B1] transition-colors">{patient.fullName}</p>
                                    <p className="text-xs text-[#002D4C]/40 mt-1 font-black uppercase tracking-widest">{patient.phone} · Lang: {patient.preferredLanguage}</p>
                                </div>

                                <div className="flex items-center gap-4">
                                    {patient.pendingReportsCount > 0 && (
                                        <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.15em] text-amber-700 bg-amber-50 border border-amber-100 rounded-full px-4 py-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                            {patient.pendingReportsCount} Pending Analysis
                                        </span>
                                    )}
                                    <ChevronRight className="w-6 h-6 text-slate-200 group-hover:text-[#002D4C] group-hover:translate-x-1 transition-all" />
                                </div>
                            </div>
                        </Link>
                    )))}
                {!loading && filtered.length === 0 && (
                    <div className="text-center py-20 bg-white border border-dashed border-slate-200 rounded-3xl">
                        <User className="w-12 h-12 mx-auto mb-4 text-slate-200" />
                        <p className="text-slate-500 font-medium">No results found for "{search}"</p>
                    </div>
                )}
            </div>

            {/* Create modal */}
            {showCreate && (
                <div className="fixed inset-0 bg-[#002D4C]/40 backdrop-blur-md flex items-center justify-center z-50 p-6 overflow-y-auto">
                    <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl relative overflow-hidden my-auto">
                        <div className="absolute top-0 left-0 right-0 h-2 bg-[#25C1B1]" />
                        <h3 className="text-2xl font-extrabold text-[#002D4C] mb-6">Patient Registration</h3>
                        <div className="space-y-5">
                            <div>
                                <label className="block text-sm font-bold text-[#002D4C] mb-2">Full Name</label>
                                <input
                                    value={formData.fullName}
                                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl text-[15px] text-[#002D4C] placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-[#25C1B1]/10 focus:border-[#25C1B1] transition-all"
                                    placeholder="e.g. Erik Andersson"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-[#002D4C] mb-2">Mobile Phone</label>
                                <input
                                    value={formData.phone}
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl text-[15px] text-[#002D4C] placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-[#25C1B1]/10 focus:border-[#25C1B1] transition-all"
                                    placeholder="+46 7X XXX XX XX"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-[#002D4C] mb-2">Preferred Language</label>
                                    <select
                                        value={formData.preferredLanguage}
                                        onChange={(e) => setFormData({ ...formData, preferredLanguage: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl text-[15px] text-[#002D4C] focus:outline-none focus:ring-4 focus:ring-[#25C1B1]/10 focus:border-[#25C1B1] transition-all appearance-none"
                                    >
                                        <option value="EN">English (EN)</option>
                                        <option value="SV">Swedish (SV)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-[#002D4C] mb-2">Timezone</label>
                                    <input
                                        value={formData.timezone}
                                        onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl text-[15px] text-[#002D4C] focus:outline-none focus:ring-4 focus:ring-[#25C1B1]/10 focus:border-[#25C1B1] transition-all"
                                        placeholder="Europe/Stockholm"
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-4 mt-8">
                            <button
                                onClick={() => setShowCreate(false)}
                                disabled={submitting}
                                className="flex-1 py-3 rounded-full border border-slate-200 text-[#002D4C] text-sm font-bold hover:bg-slate-50 transition-all active:scale-95 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleRegister}
                                disabled={submitting || !formData.fullName || !formData.phone}
                                className="flex-1 py-3 rounded-full bg-[#002D4C] text-white text-sm font-bold hover:opacity-90 transition-all shadow-lg shadow-[#002D4C]/10 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {submitting ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
                                {submitting ? "Registering..." : "Register"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
