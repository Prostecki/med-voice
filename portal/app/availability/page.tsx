"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Stethoscope, UserRound } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { getAvailableSlotsByClinic, getProvidersByClinic, type AvailabilitySlot, type Provider } from "@/lib/queries";

function asDate(value: Date | { toDate: () => Date } | string | null | undefined): Date | null {
    if (!value) return null;
    if (typeof value === "object" && "toDate" in value) return value.toDate();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export default function AvailabilityPage() {
    const { profile } = useAuth();
    const [loading, setLoading] = useState(true);
    const [providers, setProviders] = useState<Provider[]>([]);
    const [slots, setSlots] = useState<AvailabilitySlot[]>([]);

    useEffect(() => {
        async function load() {
            if (!profile?.clinicId) return;
            setLoading(true);
            try {
                const [providerData, slotData] = await Promise.all([
                    getProvidersByClinic(profile.clinicId),
                    getAvailableSlotsByClinic(profile.clinicId),
                ]);
                slotData.sort((a, b) => {
                    const aDate = asDate(a.slotStart)?.getTime() || 0;
                    const bDate = asDate(b.slotStart)?.getTime() || 0;
                    return aDate - bDate;
                });
                providerData.sort((a, b) => a.displayName.localeCompare(b.displayName));
                setProviders(providerData);
                setSlots(slotData);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [profile?.clinicId]);

    const slotsByProvider = slots.reduce<Record<string, AvailabilitySlot[]>>((acc, slot) => {
        const key = slot.providerName;
        acc[key] = acc[key] || [];
        acc[key].push(slot);
        return acc;
    }, {});

    return (
        <div className="max-w-6xl mx-auto space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-extrabold text-[#002D4C] tracking-tight">Doctors And Free Slots</h2>
                    <p className="text-slate-500 font-medium mt-1">Seeded providers and the next available appointment windows.</p>
                </div>
                <div className="px-4 py-2 rounded-full bg-slate-50 border border-slate-100 text-xs font-bold uppercase tracking-widest text-slate-500">
                    {providers.length} providers
                </div>
            </div>

            {loading ? (
                <div className="p-16 bg-white border border-slate-100 rounded-[32px] text-center text-slate-400 font-bold">
                    Loading provider availability...
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {providers.map((provider) => {
                        const providerSlots = (slotsByProvider[provider.displayName] || []).slice(0, 5);
                        return (
                            <div key={provider.providerId} className="bg-white border border-[#E1E8ED] rounded-[32px] p-8 shadow-sm">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <div className="flex items-center gap-3">
                                            <div className="w-12 h-12 rounded-2xl bg-[#25C1B1]/10 flex items-center justify-center">
                                                <UserRound className="w-6 h-6 text-[#25C1B1]" />
                                            </div>
                                            <div>
                                                <h3 className="text-xl font-black text-[#002D4C] tracking-tight">{provider.displayName}</h3>
                                                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 mt-1">{provider.specialty}</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 text-[10px] font-bold uppercase tracking-widest">
                                        {providerSlots.length} open
                                    </div>
                                </div>

                                <div className="mt-6 space-y-3">
                                    {providerSlots.length === 0 ? (
                                        <div className="p-4 rounded-2xl bg-slate-50 text-slate-400 font-semibold text-sm">
                                            No free slots currently seeded for this provider.
                                        </div>
                                    ) : (
                                        providerSlots.map((slot) => {
                                            const start = asDate(slot.slotStart);
                                            return (
                                                <div key={slot.slotId} className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100">
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center border border-slate-100">
                                                            <CalendarClock className="w-5 h-5 text-[#25C1B1]" />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="text-sm font-bold text-[#002D4C] truncate">
                                                                {start?.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                                                            </p>
                                                            <p className="text-xs text-slate-500 font-semibold">
                                                                {start?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                                        <Stethoscope className="w-3 h-3" />
                                                        {slot.specialty}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
