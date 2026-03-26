"use client";

import { useEffect, useState } from "react";
import { Calendar, Clock, User, Stethoscope, MapPin, CheckCircle, XCircle } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { getAppointmentsByClinic, getPatient, getClinic } from "@/lib/queries";

interface DisplayAppointment {
    id: string;
    patientName: string;
    doctorName: string;
    specialty: string;
    date: string;
    time: string;
    clinicName: string;
    status: "upcoming" | "completed" | "cancelled";
}

const statusStyle: Record<string, string> = {
    upcoming: "bg-blue-50 text-blue-700 border-blue-100 font-bold",
    completed: "bg-emerald-50 text-emerald-700 border-emerald-100 font-bold",
    cancelled: "bg-red-50 text-red-700 border-red-100 font-bold",
};

export default function AppointmentsPage() {
    const { profile } = useAuth();
    const [loading, setLoading] = useState(true);
    const [appointments, setAppointments] = useState<DisplayAppointment[]>([]);

    useEffect(() => {
        async function load() {
            if (!profile?.clinicId) return;
            setLoading(true);
            try {
                const [clinicData, rawAppts] = await Promise.all([
                    getClinic(profile.clinicId),
                    getAppointmentsByClinic(profile.clinicId)
                ]);

                const formatted: DisplayAppointment[] = await Promise.all(
                    rawAppts.map(async (a) => {
                        const patient = await getPatient(a.patientId);
                        const startDate = a.slotStart && typeof a.slotStart === 'object' && 'toDate' in a.slotStart
                            ? a.slotStart.toDate()
                            : new Date(a.slotStart);
                        const now = new Date();

                        let status: DisplayAppointment["status"] = "upcoming";
                        if (a.status === "CANCELLED") {
                            status = "cancelled";
                        } else if (startDate < now) {
                            status = "completed";
                        }

                        return {
                            id: a.appointmentId,
                            patientName: patient?.fullName || "Unknown Patient",
                            doctorName: a.providerName,
                            specialty: a.specialty,
                            date: startDate.toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric"
                            }),
                            time: startDate.toLocaleTimeString("en-US", {
                                hour: "numeric",
                                minute: "2-digit"
                            }),
                            clinicName: clinicData?.name || "Main Clinic",
                            status: status
                        };
                    })
                );

                setAppointments(formatted);
            } catch (err) {
                console.error("Error loading appointments:", err);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [profile?.clinicId]);

    const upcoming = appointments.filter((a) => a.status === "upcoming");
    const past = appointments.filter((a) => a.status !== "upcoming");

    const AppCard = ({ appt }: { appt: DisplayAppointment }) => (
        <div className="flex flex-col md:flex-row md:items-center gap-6 p-6 bg-white border border-[#E1E8ED] rounded-[32px] hover:border-[#25C1B1]/40 hover:shadow-xl hover:shadow-[#002D4C]/5 transition-all group relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#25C1B1] opacity-0 group-hover:opacity-100 transition-opacity" />

            <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center shrink-0 group-hover:bg-[#25C1B1]/10 transition-colors">
                <Stethoscope className="w-7 h-7 text-slate-400 group-hover:text-[#25C1B1]" />
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <p className="text-lg font-black text-[#002D4C] tracking-tight">{appt.doctorName}</p>
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">• {appt.specialty}</span>
                </div>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3 text-slate-500 font-semibold">
                    <span className="flex items-center gap-1.5 text-sm">
                        <User className="w-4 h-4 text-[#25C1B1]" /> {appt.patientName}
                    </span>
                    <span className="flex items-center gap-1.5 text-sm">
                        <Calendar className="w-4 h-4 text-[#25C1B1]" /> {appt.date}
                    </span>
                    <span className="flex items-center gap-1.5 text-sm">
                        <Clock className="w-4 h-4 text-[#25C1B1]" /> {appt.time}
                    </span>
                    <span className="flex items-center gap-1.5 text-sm hidden sm:flex">
                        <MapPin className="w-4 h-4 text-[#25C1B1]" /> {appt.clinicName}
                    </span>
                </div>
            </div>

            <div className="flex items-center gap-4 shrink-0">
                <span className={`text-[10px] uppercase tracking-widest rounded-full px-4 py-1.5 border ${statusStyle[appt.status]}`}>
                    {appt.status}
                </span>
                <div className="hidden sm:block">
                    {appt.status === "completed" && <CheckCircle className="w-6 h-6 text-[#25C1B1]" />}
                    {appt.status === "cancelled" && <XCircle className="w-6 h-6 text-red-500" />}
                </div>
            </div>
        </div>
    );

    return (
        <div className="max-w-5xl mx-auto space-y-10">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-extrabold text-[#002D4C] tracking-tight">Appointments</h2>
                    <p className="text-slate-500 font-medium mt-1">{upcoming.length} upcoming sessions scheduled</p>
                </div>
            </div>

            {/* Upcoming */}
            <div className="space-y-4">
                <div className="flex items-center gap-3 px-2">
                    <div className="w-2 h-2 rounded-full bg-[#25C1B1] animate-pulse" />
                    <h3 className="text-sm font-black text-[#002D4C] uppercase tracking-[0.2em]">Next Appointments</h3>
                </div>
                {loading ? (
                    <div className="py-20 text-center flex flex-col items-center justify-center gap-4">
                        <Loader2 className="w-10 h-10 text-[#25C1B1] animate-spin" />
                        <p className="text-slate-400 font-bold animate-pulse">Loading schedule...</p>
                    </div>
                ) : upcoming.length === 0 ? (
                    <div className="p-16 bg-white border border-dashed border-slate-200 rounded-[32px] text-center">
                        <Calendar className="w-12 h-12 mx-auto mb-4 text-slate-100" />
                        <p className="text-slate-400 font-bold text-lg">Your schedule is empty</p>
                    </div>
                ) : (
                    upcoming.map((a) => <AppCard key={a.id} appt={a} />)
                )}
            </div>

            {/* Past */}
            {past.length > 0 && (
                <div className="space-y-4 pt-4">
                    <div className="flex items-center gap-3 px-2 opacity-40">
                        <div className="w-2 h-2 rounded-full bg-slate-400" />
                        <h3 className="text-sm font-black text-[#002D4C] uppercase tracking-[0.2em]">Completed Sessions</h3>
                    </div>
                    <div className="grid grid-cols-1 gap-4 opacity-70 grayscale-[0.5] hover:grayscale-0 transition-all duration-500 group">
                        {past.map((a) => <AppCard key={a.id} appt={a} />)}
                    </div>
                </div>
            )}
        </div>
    );
}

import { Loader2 } from "lucide-react";
