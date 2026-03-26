"use client";

import { useState, use, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Phone, Calendar, Clock, FileText, Upload, History, HeartPulse, ChevronRight } from "lucide-react";
import CallPanel from "@/components/call/CallPanel";
import { RoleGuard } from "@/components/RoleGuard";
import { getPatient, getCallsByPatient, Patient, Call } from "@/lib/queries";
import { getPatientReports, Report } from "@/lib/api";
import type { Timestamp } from "firebase/firestore";

type DateType = Date | Timestamp | string | null | undefined;

function formatDuration(start: DateType, end: DateType): string {
    if (!start || !end) return "--";
    const s = typeof start === 'object' && 'toDate' in start ? start.toDate().getTime() : new Date(start as string | number).getTime();
    const e = typeof end === 'object' && 'toDate' in end ? end.toDate().getTime() : new Date(end as string | number).getTime();
    const diffSec = Math.floor((e - s) / 1000);
    if (diffSec < 0) return "--";
    const m = Math.floor(diffSec / 60);
    const ss = diffSec % 60;
    return `${m}:${ss.toString().padStart(2, "0")}`;
}

function formatDate(dateInput: DateType): string {
    if (!dateInput) return "";
    const date = typeof dateInput === 'object' && 'toDate' in dateInput ? dateInput.toDate() : new Date(dateInput as string | number);
    return date.toISOString().split("T")[0];
}

function formatTime(dateInput: DateType): string {
    if (!dateInput) return "--:--";
    const date = typeof dateInput === 'object' && 'toDate' in dateInput ? dateInput.toDate() : new Date(dateInput as string | number);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const resolvedParams = use(params);
    const [patient, setPatient] = useState<Patient | null>(null);
    const [reports, setReports] = useState<Report[]>([]);
    const [calls, setCalls] = useState<Call[]>([]);
    const [loading, setLoading] = useState(true);
    const [callOpen, setCallOpen] = useState<"mock" | "phone" | "schedule" | null>(null);

    useEffect(() => {
        async function loadData() {
            try {
                const id = resolvedParams.id;
                const [pData, rData, cData] = await Promise.all([
                    getPatient(id),
                    getPatientReports(id),
                    getCallsByPatient(id),
                ]);

                // Sort by date descending
                rData.sort((a, b) => {
                    const tA = a.createdAt
                        ? (typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : 0)
                        : new Date(a.date || a.reportDate || 0).getTime();
                    const tB = b.createdAt
                        ? (typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : 0)
                        : new Date(b.date || b.reportDate || 0).getTime();
                    return tB - tA;
                });

                cData.sort((a, b) => {
                    const getT = (call: Call) => {
                        const t = call.endedAt || call.startedAt || call.scheduledFor;
                        if (!t) return 0;
                        return typeof t === 'string' ? new Date(t).getTime() : t.toMillis();
                    };
                    return getT(b) - getT(a);
                });

                setPatient(pData);
                setReports(rData);
                setCalls(cData);
            } catch (err) {
                console.error("Error loading patient data:", err);
            } finally {
                setLoading(false);
            }
        }
        loadData();
    }, [resolvedParams.id]);

    if (loading) {
        return <div className="p-10 text-center text-[#002D4C]/40 animate-pulse font-medium">Loading medical record...</div>;
    }

    if (!patient) {
        return <div className="p-10 text-center text-[#002D4C]/40">Patient not found</div>;
    }

    return (
        <div className="max-w-5xl mx-auto space-y-8">
            {/* Back */}
            <Link href="/patients" className="inline-flex items-center gap-2 text-sm font-bold text-[#002D4C]/60 hover:text-[#002D4C] transition-colors group">
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                Back to Patients
            </Link>

            {/* Patient Header */}
            <div className="bg-white border border-[#E1E8ED] rounded-[40px] p-10 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-8 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-2 h-full bg-[#25C1B1]" />
                <div className="pl-6 flex-1 min-w-0 pr-4">
                    <h1 className="text-4xl font-bold text-[#002D4C] tracking-tight truncate">{patient.fullName}</h1>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 text-slate-500 font-semibold text-sm">
                        <span className="flex items-center gap-2"><Phone className="w-4 h-4 text-[#25C1B1]" /> {patient.phone}</span>
                        <span className="w-1 h-1 bg-slate-300 rounded-full hidden sm:block" />
                        <span className="flex items-center gap-2 text-[#25C1B1] opacity-80 uppercase tracking-widest text-[10px] font-bold">Record #{patient.patientId.slice(0, 4)}</span>
                        <span className="w-1 h-1 bg-slate-300 rounded-full hidden sm:block" />
                        <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-slate-400" /> {patient.timezone || "UTC"}</span>
                        <span className="w-1 h-1 bg-slate-300 rounded-full hidden sm:block" />
                        <span className="bg-[#F7F9FA] px-3 py-1 rounded-full text-[10px] font-bold text-[#002D4C]/60 uppercase tracking-widest">Lang: {patient.preferredLanguage}</span>
                    </div>
                </div>
                <div className="flex flex-wrap gap-4 pl-6 md:pl-0 w-full md:w-auto shrink-0">
                    <RoleGuard allowedRoles={["ADMIN", "STAFF"]}>
                        <button
                            onClick={() => setCallOpen("mock")}
                            className="flex-1 md:flex-none flex items-center justify-center gap-2.5 px-8 py-4 rounded-full bg-[#25C1B1] text-white text-sm font-bold hover:bg-[#1EAD9F] transition-all shadow-lg shadow-[#25C1B1]/20 hover:scale-[1.02] active:scale-95 whitespace-nowrap"
                        >
                            <HeartPulse className="w-4 h-4" />
                            Mock Browser Call
                        </button>
                    </RoleGuard>
                    <RoleGuard allowedRoles={["ADMIN", "STAFF"]}>
                        <button
                            onClick={() => setCallOpen("phone")}
                            className="flex-1 md:flex-none flex items-center justify-center gap-2.5 px-8 py-4 rounded-full bg-[#25C1B1] text-white text-sm font-bold hover:bg-[#1EAD9F] transition-all shadow-lg shadow-[#25C1B1]/20 hover:scale-[1.02] active:scale-95 whitespace-nowrap"
                        >
                            <Phone className="w-4 h-4" />
                            Call Patient
                        </button>
                    </RoleGuard>
                    <RoleGuard allowedRoles={["ADMIN", "STAFF"]}>
                        <button
                            onClick={() => setCallOpen("schedule")}
                            className="flex-1 md:flex-none flex items-center justify-center gap-2.5 px-8 py-4 rounded-full bg-[#002D4C] text-white text-sm font-bold hover:opacity-90 transition-all shadow-lg shadow-[#002D4C]/10 active:scale-95 whitespace-nowrap"
                        >
                            <Calendar className="w-4 h-4" />
                            Schedule
                        </button>
                    </RoleGuard>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-10">
                {/* Reports Section */}
                <div className="lg:col-span-3 space-y-8">
                    <div className="flex items-center justify-between px-2">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2x bg-[#25C1B1]/10 flex items-center justify-center shadow-sm">
                                <FileText className="w-6 h-6 text-[#25C1B1]" />
                            </div>
                            <h3 className="text-2xl font-bold text-[#002D4C] tracking-tight">
                                Medical Reports
                            </h3>
                        </div>
                        <RoleGuard allowedRoles={["ADMIN", "STAFF"]}>
                            <Link
                                href={`/patients/${resolvedParams.id}/reports/upload`}
                                className="flex items-center gap-2.5 px-6 py-2.5 bg-white text-[#25C1B1] rounded-full text-sm font-bold hover:bg-[#25C1B1] hover:text-white transition-all border border-slate-100 shadow-sm"
                            >
                                <Upload className="w-4 h-4" />
                                Upload New
                            </Link>
                        </RoleGuard>
                    </div>

                    <div className="space-y-5">
                        {reports.length === 0 ? (
                            <div className="p-20 bg-white border border-dashed border-slate-200 rounded-[40px] text-center">
                                <FileText className="w-16 h-16 mx-auto mb-6 text-slate-100" />
                                <p className="text-slate-400 font-bold text-lg">No clinical data uploaded</p>
                            </div>
                        ) : (
                            reports.map((r) => (
                                <div key={r.report_id} className="flex items-center gap-6 p-8 bg-white border border-[#F1F5F9] rounded-[32px] hover:border-[#25C1B1]/40 hover:shadow-xl hover:shadow-[#002D4C]/5 transition-all group">
                                    <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center shrink-0 group-hover:bg-[#25C1B1]/10 transition-colors shadow-inner">
                                        <FileText className="w-7 h-7 text-slate-300 group-hover:text-[#25C1B1]" />
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-lg font-bold text-[#002D4C] tracking-tight">{(r.report_type || r.reportType)} Analysis</p>
                                        <p className="text-[11px] text-slate-400 font-bold uppercase tracking-[0.2em] mt-1.5">{formatDate(r.createdAt || r.date || r.reportDate)}</p>
                                    </div>
                                    <span className={`text-[11px] uppercase tracking-widest rounded-full px-5 py-2 font-bold border ${(!r.status || r.status === "UPLOADED")
                                        ? "bg-amber-50 text-amber-700 border-amber-100"
                                        : r.status === "ANALYZED"
                                            ? "bg-blue-50 text-blue-700 border-blue-100"
                                            : "bg-emerald-50 text-emerald-700 border-emerald-100"
                                        }`}>
                                        {r.status || "UPLOADED"}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Sidebar */}
                <div className="lg:col-span-2 flex flex-col gap-10">
                    {/* Interaction History */}
                    <div className="bg-white border border-slate-100 rounded-[38px] p-8 shadow-sm flex-1 flex flex-col min-h-0">
                        <div className="flex items-center justify-between mb-8 px-2">
                            <div className="flex items-center gap-3">
                                <h2 className="text-xl font-bold text-[#002D4C] tracking-tight">Interaction History</h2>
                                <span className="px-2.5 py-1 bg-slate-50 border border-slate-100 rounded-full text-[10px] font-bold text-slate-400 uppercase tracking-widest">{calls.length}</span>
                            </div>
                            <History className="w-5 h-5 text-slate-100" />
                        </div>

                        <div className="space-y-2 overflow-y-auto pr-2 custom-scrollbar flex-1 min-h-0">
                            {calls.length === 0 ? (
                                <p className="text-sm font-medium text-slate-300 italic text-center py-10">No recent activity logged.</p>
                            ) : (
                                calls.map(call => (
                                    <div key={call.callId} className="group flex items-center gap-4 p-4 rounded-3xl border border-transparent hover:border-slate-50 hover:bg-slate-50/50 transition-all duration-300">
                                        {/* Left: Dot */}
                                        <div className={`w-2 h-2 rounded-full shrink-0 ${call.status === "COMPLETED" ? "bg-[#25C1B1]" :
                                            call.status === "FAILED" ? "bg-red-400" :
                                                call.status === "CALLBACK_SCHEDULED" ? "bg-[#002D4C]" : "bg-slate-200"
                                            }`} />

                                        {/* Center: Title & Subtext */}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-[#002D4C] leading-none mb-2 group-hover:text-[#25C1B1] transition-colors truncate">
                                                {call.status === "CALLBACK_SCHEDULED" ? "Callback scheduled" : "AI Health Outreach"}
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none shrink-0">{formatDate(call.startedAt || call.scheduledFor)}</span>
                                                {call.status === "CALLBACK_SCHEDULED" && (
                                                    <span className="text-[9px] text-amber-600 font-extrabold uppercase tracking-widest px-1.5 py-0.5 bg-amber-50 rounded-md leading-none">Pending</span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Right: Metadata */}
                                        <div className="flex items-center gap-4 shrink-0">
                                            <div className="text-right flex flex-col items-end gap-1.5 min-w-[70px]">
                                                <div className="flex items-center gap-1.5 opacity-70">
                                                    <Clock className="w-3 h-3 text-slate-400" />
                                                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600 whitespace-nowrap">
                                                        {formatTime(call.startedAt || call.scheduledFor)}
                                                    </span>
                                                </div>
                                                {call.startedAt && call.endedAt && (
                                                    <p className="text-[10px] font-extrabold text-emerald-600 uppercase tracking-widest tabular-nums leading-none">
                                                        {formatDuration(call.startedAt, call.endedAt)}
                                                    </p>
                                                )}
                                            </div>
                                            <ChevronRight className="w-4 h-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 text-[#25C1B1]" />
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Call Panel modal (Redesigned) */}
            {callOpen && (
                <div
                    className="fixed inset-0 bg-[#002D4C]/60 backdrop-blur-xl flex items-center justify-center z-50 p-4"
                    onClick={() => setCallOpen(null)}
                >
                    <div
                        className="w-full max-w-xl animate-in fade-in zoom-in duration-300"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="relative">
                            <CallPanel
                                patientId={resolvedParams.id}
                                patientPhone={patient.phone}
                                clinicId={patient.clinicId}
                                reports={reports as any}
                                onClose={() => setCallOpen(null)}
                                initialMode={callOpen === "mock" ? "live" : "trigger"}
                                initialScheduleMode={callOpen === "schedule" ? "later" : "now"}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
