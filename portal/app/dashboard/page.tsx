"use client";

import { Upload, Phone, PhoneCall, Calendar, Clock, TrendingUp, Activity } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
    getRecentCalls,
    getRecentReports,
    getAppointmentsByClinic,
} from "@/lib/queries";
import { getPatient } from "@/lib/queries";

const activityIcon: Record<string, React.ReactNode> = {
    call_completed: <PhoneCall className="w-4 h-4 text-teal-400" />,
    callback_scheduled: <Clock className="w-4 h-4 text-violet-400" />,
    report_uploaded: <Upload className="w-4 h-4 text-blue-400" />,
    appointment_booked: <Calendar className="w-4 h-4 text-emerald-400" />,
};

interface ActivityItem {
    id: string;
    type: string;
    patient: string;
    detail: string;
    time: string;
    timestamp: number;
}

function timeAgo(dateInput: Date | { toDate: () => Date } | string | null | undefined) {
    if (!dateInput) return "just now";

    let date: Date;
    if (typeof dateInput === "object" && dateInput !== null && "toDate" in dateInput) {
        date = dateInput.toDate();
    } else {
        date = new Date(dateInput as string | number);
    }
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

export default function DashboardPage() {
    const { profile } = useAuth();
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        uploadsToday: 0,
        callsQueued: 0,
        callbacksScheduled: 0,
        appointmentsBooked: 0,
    });
    const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);

    useEffect(() => {
        async function fetchData() {
            if (!profile?.clinicId) return;

            try {
                // 1. Fetch data
                const [calls, reports, appointments] = await Promise.all([
                    getRecentCalls(profile.clinicId),
                    getRecentReports(profile.clinicId),
                    getAppointmentsByClinic(profile.clinicId),
                ]);

                // 2. Compute stats
                const todayStr = new Date().toISOString().split("T")[0];
                const uploadsToday = reports.filter((r) => r.reportDate === todayStr || r.createdAt?.toDate?.()?.toISOString().startsWith(todayStr)).length;
                const callsQueued = calls.filter((c) => c.status === "QUEUED").length;
                const callbacksScheduled = calls.filter((c) => c.status === "CALLBACK_SCHEDULED").length;
                const appointmentsBooked = appointments.filter((a) => a.status === "CONFIRMED").length;

                setStats({ uploadsToday, callsQueued, callbacksScheduled, appointmentsBooked });

                // 3. Build activity feed & resolve patient names
                const merged: ActivityItem[] = [];

                // Helper to fetch name and cache it (super simple cache to avoid spamming DB)
                const nameCache: Record<string, string> = {};
                const getName = async (id: string) => {
                    if (nameCache[id]) return nameCache[id];
                    const p = await getPatient(id);
                    nameCache[id] = p?.fullName || "Unknown Patient";
                    return nameCache[id];
                };

                for (const call of calls) {
                    if (call.status === "COMPLETED" || call.status === "CALLBACK_SCHEDULED") {
                        const isCallback = call.status === "CALLBACK_SCHEDULED";
                        const timeObj = call.endedAt || call.startedAt || call.scheduledFor;
                        const timestamp = timeObj
                            ? (typeof timeObj === 'string' ? new Date(timeObj).getTime() : timeObj.toMillis())
                            : 0;

                        const scheduledStr = isCallback && call.scheduledFor
                            ? (typeof call.scheduledFor === "string" ? call.scheduledFor : call.scheduledFor.toDate().toLocaleString())
                            : "";

                        merged.push({
                            id: call.callId,
                            type: isCallback ? "callback_scheduled" : "call_completed",
                            patient: await getName(call.patientId),
                            detail: call.outcome || call.notes || (isCallback ? `Callback scheduled for ${scheduledStr}` : "Call finished"),
                            time: timeAgo(timeObj),
                            timestamp,
                        });
                    }
                }

                for (const report of reports) {
                    const timestamp = report.createdAt
                        ? (typeof report.createdAt === 'string' ? new Date(report.createdAt).getTime() : report.createdAt.toMillis())
                        : new Date(report.reportDate).getTime();
                    merged.push({
                        id: report.reportId,
                        type: "report_uploaded",
                        patient: await getName(report.patientId),
                        detail: `${report.reportType} report uploaded`,
                        time: timeAgo(report.createdAt || report.reportDate),
                        timestamp,
                    });
                }

                merged.sort((a, b) => b.timestamp - a.timestamp);
                setRecentActivity(merged.slice(0, 10));

            } catch (err) {
                console.error("Dashboard error:", err);
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, [profile?.clinicId]);

    const KPI_CARDS = [
        { label: "Uploads today", value: stats.uploadsToday.toString(), icon: Upload, color: "bg-[#F0F9FF] text-blue-600", iconBg: "bg-blue-100", trend: "+12%" },
        { label: "Calls queued", value: stats.callsQueued.toString(), icon: Phone, color: "bg-[#F0FDFA] text-[#25C1B1]", iconBg: "bg-[#25C1B1]/10", trend: "0%" },
        { label: "Callbacks scheduled", value: stats.callbacksScheduled.toString(), icon: Calendar, color: "bg-[#F5F3FF] text-violet-600", iconBg: "bg-violet-100", trend: "+2" },
        { label: "Appointments booked", value: stats.appointmentsBooked.toString(), icon: PhoneCall, color: "bg-[#ECFDF5] text-emerald-600", iconBg: "bg-emerald-100", trend: "+5" },
    ];

    return (
        <div className="space-y-10">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-extrabold text-[#002D4C] tracking-tight">Dashboard</h2>
                    <p className="text-slate-500 font-medium mt-1">
                        {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
                    </p>
                </div>
                <div className="flex items-center gap-2.5 px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full text-xs font-bold uppercase tracking-widest shadow-sm">
                    <Activity className="w-4 h-4 animate-pulse" />
                    System Status: Operational
                </div>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {KPI_CARDS.map(({ label, value, icon: Icon, color, iconBg, trend }) => (
                    <div
                        key={label}
                        className="bg-white border border-[#E1E8ED] rounded-[32px] p-8 shadow-sm hover:shadow-xl hover:shadow-[#002D4C]/5 transition-all group"
                    >
                        <div className={`w-12 h-12 rounded-2xl ${iconBg} flex items-center justify-center mb-6 transition-transform group-hover:scale-110`}>
                            <Icon className="w-6 h-6" />
                        </div>
                        <div className="space-y-1">
                            <p className="text-4xl font-black text-[#002D4C] tracking-tighter">{value}</p>
                            <p className="text-sm font-bold text-slate-400 uppercase tracking-wider">{label}</p>
                        </div>
                        <div className="mt-6 pt-6 border-t border-slate-50 flex items-center gap-2 text-xs font-bold text-emerald-600">
                            <TrendingUp className="w-4 h-4" />
                            <span>{trend}</span>
                            <span className="text-slate-400 font-medium">vs last week</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                {/* Recent Activity */}
                <div className="xl:col-span-2 bg-white border border-[#E1E8ED] rounded-[32px] p-8 shadow-sm">
                    <div className="mb-8">
                        <h3 className="text-xl font-extrabold text-[#002D4C] tracking-tight">Real-time Activity</h3>
                    </div>

                    <div className="space-y-4">
                        {loading ? (
                            <div className="py-12 flex flex-col items-center justify-center space-y-4">
                                <Loader2 className="w-8 h-8 text-[#25C1B1] animate-spin" />
                                <p className="text-slate-400 font-medium animate-pulse">Syncing with medical systems...</p>
                            </div>
                        ) : recentActivity.length === 0 ? (
                            <div className="py-12 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                                <p className="text-slate-400 font-medium">No activity recorded today</p>
                            </div>
                        ) : (
                            recentActivity.map((item) => (
                                <div
                                    key={item.id}
                                    className="flex items-center gap-5 p-5 rounded-2xl bg-white border border-[#F1F5F9] hover:border-[#25C1B1]/30 hover:bg-slate-50/50 transition-all group"
                                >
                                    <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center shrink-0 group-hover:bg-[#25C1B1]/10 transition-colors">
                                        <div className="text-[#002D4C]/40 group-hover:text-[#25C1B1] transition-colors">
                                            {activityIcon[item.type]}
                                        </div>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <p className="text-base font-bold text-[#002D4C]">{item.patient}</p>
                                            <span className="w-1 h-1 bg-slate-300 rounded-full" />
                                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{item.time}</span>
                                        </div>
                                        <p className="text-sm text-slate-500 font-medium mt-0.5 truncate">{item.detail}</p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="bg-white border border-[#E1E8ED] rounded-[32px] p-8 shadow-sm">
                    <h4 className="text-base font-bold text-[#002D4C] mb-3">Hackathon Flow</h4>
                    <p className="text-sm text-slate-500 font-medium leading-relaxed">
                        Upload a report, review the generated summary, trigger a mock or phone call, and let the live agent handle explanation plus appointment booking.
                    </p>
                </div>
            </div>
        </div>
    );
}

import { Loader2 } from "lucide-react";
