"use client";

import { useState, use } from "react";
import Link from "next/link";
import { ArrowLeft, Upload, FileText, Plus, Trash2 } from "lucide-react";
import { getPatient, getUploadUrl, processReport } from "@/lib/api";

const FIELDS = ["Hemoglobin", "WBC", "Glucose", "Creatinine", "ALT", "AST"];

export default function ReportUploadPage({ params }: { params: Promise<{ id: string }> }) {
    const resolvedParams = use(params);
    const [file, setFile] = useState<File | null>(null);
    const [customFields, setCustomFields] = useState<{ key: string; value: string }[]>([]);
    const [uploading, setUploading] = useState(false);
    const [done, setDone] = useState(false);

    const addField = () => setCustomFields((f) => [...f, { key: FIELDS[0], value: "" }]);
    const removeField = (i: number) => setCustomFields((f) => f.filter((_, idx) => idx !== i));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file) return;
        setUploading(true);
        
        try {
            // 1. Get patient info for clinic_id
            // 1. Get patient info for clinic_id
            const patient = await getPatient(resolvedParams.id);

            // 2. Get Signed URL
            const { url, gcsPath } = await getUploadUrl({
                filename: file.name,
                content_type: file.type || "application/pdf",
                patient_id: resolvedParams.id,
                clinic_id: patient.clinicId
            });

            // 3. Upload to GCS
            const uploadRes = await fetch(url, {
                method: "PUT",
                body: file,
                headers: { "Content-Type": file.type || "application/pdf" }
            });

            if (!uploadRes.ok) throw new Error("GCS Upload failed");

            // 4. Trigger Analysis
            await processReport({
                patient_id: resolvedParams.id,
                clinic_id: patient.clinicId,
                gcs_path: gcsPath,
                filename: file.name,
                content_type: file.type || "application/pdf"
            });

            setDone(true);
        } catch (error) {
            console.error("Upload error:", error);
            alert("Failed to process report. Please try again.");
        } finally {
            setUploading(false);
        }
    };

    if (done) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-center animate-in zoom-in duration-500">
                <div className="w-24 h-24 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-8 shadow-xl shadow-emerald-500/10">
                    <CheckCircle className="w-12 h-12 text-[#25C1B1]" />
                </div>
                <h3 className="text-3xl font-black text-[#002D4C] tracking-tight">Report Received</h3>
                <p className="text-slate-500 font-medium text-lg mt-3 max-w-sm mx-auto leading-relaxed">
                    We've started analyzing the medical data. Our AI Voice Agent will be ready to discuss it shortly.
                </p>
                <Link
                    href={`/patients/${resolvedParams.id}`}
                    className="mt-10 px-8 py-4 rounded-full bg-[#002D4C] text-white font-bold text-base hover:opacity-90 transition-all shadow-lg active:scale-95"
                >
                    Return to Patient Profile
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto space-y-10">
            <Link href={`/patients/${resolvedParams.id}`} className="group inline-flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-[#002D4C] transition-colors">
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                Back to Case File
            </Link>

            <div>
                <h2 className="text-4xl font-black text-[#002D4C] tracking-tighter">Add Medical Data</h2>
                <p className="text-slate-500 font-medium text-lg mt-2">Upload clinical reports or laboratory results for analysis.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-10">
                {/* File drop zone */}
                <label className={`group relative flex flex-col items-center justify-center gap-4 h-64 rounded-[40px] border-4 border-dashed transition-all cursor-pointer ${file ? "border-[#25C1B1] bg-[#25C1B1]/5" : "border-slate-200 bg-white hover:border-[#25C1B1]/40 hover:bg-slate-50"
                    }`}>
                    <div className={`w-20 h-20 rounded-3xl flex items-center justify-center transition-all ${file ? "bg-[#25C1B1] text-white scale-110" : "bg-slate-50 text-slate-300 group-hover:text-[#25C1B1] group-hover:scale-110"}`}>
                        <Upload className="w-10 h-10" />
                    </div>
                    <div className="text-center px-6">
                        <span className={`text-lg font-black block ${file ? "text-[#25C1B1]" : "text-[#002D4C]"}`}>
                            {file ? file.name : "Drop clinical PDF or Image"}
                        </span>
                        <span className="text-sm font-semibold text-slate-400 mt-1 block">Maximum file size: 20MB</span>
                    </div>
                    <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        className="hidden"
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                </label>

                {/* Structured values */}
                <div className="bg-white border border-[#E1E8ED] rounded-[32px] p-8 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-2">
                            <Activity className="w-5 h-5 text-[#25C1B1]" />
                            <p className="text-lg font-extrabold text-[#002D4C] tracking-tight">Refine Data (Optional)</p>
                        </div>
                        <button type="button" onClick={addField} className="flex items-center gap-1.5 px-4 py-2 bg-[#25C1B1]/10 text-[#25C1B1] border border-[#25C1B1]/20 rounded-full text-xs font-bold hover:bg-[#25C1B1] hover:text-white transition-all">
                            <Plus className="w-3.5 h-3.5" /> Add Metric
                        </button>
                    </div>

                    <div className="space-y-3">
                        {customFields.length === 0 && (
                            <p className="text-slate-400 text-sm font-medium py-4 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                                No additional metrics added
                            </p>
                        )}
                        {customFields.map((field, i) => (
                            <div key={i} className="flex gap-3 animate-in slide-in-from-left-2 duration-300">
                                <div className="flex-1 relative">
                                    <select
                                        value={field.key}
                                        onChange={(e) => setCustomFields((f) => f.map((item, idx) => idx === i ? { ...item, key: e.target.value } : item))}
                                        className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold text-[#002D4C] focus:outline-none focus:ring-4 focus:ring-[#25C1B1]/10 focus:border-[#25C1B1] transition-all appearance-none cursor-pointer"
                                    >
                                        {FIELDS.map((f) => <option key={f}>{f}</option>)}
                                    </select>
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-300">
                                        <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg>
                                    </div>
                                </div>
                                <input
                                    value={field.value}
                                    onChange={(e) => setCustomFields((f) => f.map((item, idx) => idx === i ? { ...item, value: e.target.value } : item))}
                                    placeholder="Value"
                                    className="w-32 px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold text-[#002D4C] placeholder-slate-300 focus:outline-none focus:ring-4 focus:ring-[#25C1B1]/10 focus:border-[#25C1B1] transition-all"
                                />
                                <button type="button" onClick={() => removeField(i)} className="p-4 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all">
                                    <Trash2 className="w-5 h-5" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={!file || uploading}
                    className="w-full py-5 rounded-full bg-[#002D4C] text-white font-black text-lg hover:opacity-95 disabled:opacity-40 transition-all shadow-xl shadow-[#002D4C]/10 active:scale-[0.98] flex items-center justify-center gap-3"
                >
                    {uploading ? (
                        <>
                            <Loader2 className="w-6 h-6 animate-spin text-[#25C1B1]" />
                            Uploading Data...
                        </>
                    ) : (
                        "Analyze and Process Report"
                    )}
                </button>
            </form>
        </div>
    );
}

import { Loader2, CheckCircle, Activity } from "lucide-react";
