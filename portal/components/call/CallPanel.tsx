"use client";

import { useState, useRef, useEffect } from "react";
import { Mic, MicOff, AlertCircle, Loader2, X, Phone, Clock, Calendar, CheckCircle2, ChevronRight, Info, FileText, HeartPulse } from "lucide-react";
import { Report, createCall } from "@/lib/queries";
import { scheduleCallback, triggerTwilioCall } from "@/lib/api";
import { Timestamp } from "firebase/firestore";

type SessionStatus = "Disconnected" | "Connecting..." | "Live" | "Error" | "Submitting...";
type MessageRole = "user" | "agent";

interface Message {
    id: string;
    role: MessageRole;
    text: string;
}

function formatDate(dateInput: any): string {
    if (!dateInput) return "";
    const date = typeof dateInput === 'object' && 'toDate' in dateInput ? dateInput.toDate() : new Date(dateInput as string | number);
    return date.toISOString().split("T")[0];
}

interface CallPanelProps {
    patientId: string;
    patientPhone: string;
    clinicId: string;
    reports: Report[];
    onClose?: () => void;
    initialMode?: "trigger" | "live";
    initialScheduleMode?: "now" | "later";
}

export default function CallPanel({ patientId, patientPhone, clinicId, reports, onClose, initialMode = "trigger", initialScheduleMode = "now" }: CallPanelProps) {
    const [mode, setMode] = useState<"trigger" | "live">(initialMode);
    const [selectedReportId, setSelectedReportId] = useState(reports[0]?.reportId || reports[0]?.report_id || "");
    const [scheduleMode, setScheduleMode] = useState<"now" | "later">(initialScheduleMode);
    const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().split("T")[0]);
    const [scheduledTime, setScheduledTime] = useState(
        new Date(new Date().getTime() + 30 * 60000).toTimeString().slice(0, 5)
    );
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [confirmNowCall, setConfirmNowCall] = useState(false);

    // Live Voice Assistant State
    const [isActive, setIsActive] = useState(false);
    const [status, setStatus] = useState<SessionStatus>("Disconnected");
    const [transcript, setTranscript] = useState<Message[]>([]);
    const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
    const [activeCallId, setActiveCallId] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const playbackQueueRef = useRef<Float32Array[]>([]);
    const isProcessingRef = useRef(false);
    const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const gainNodeRef = useRef<GainNode | null>(null);
    const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [transcript]);

    useEffect(() => {
        setConfirmNowCall(false);
    }, [scheduleMode, selectedReportId, patientPhone]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopSession();
        };
    }, []);

    const addMessage = (role: MessageRole, text: string) => {
        setTranscript((prev) => [
            ...prev,
            { id: Math.random().toString(36).substring(7), role, text },
        ]);
    };

    const processPlaybackQueue = async () => {
        // If already processing, just return — the current run will pick up new items
        if (isProcessingRef.current) return;
        if (!audioCtxRef.current) {
            console.warn("[CallPanel] processPlaybackQueue called but no AudioContext");
            return;
        }

        isProcessingRef.current = true;
        try {
            const audioCtx = audioCtxRef.current;
            if (audioCtx.state === 'suspended') {
                console.log("[CallPanel] Resuming suspended AudioContext...");
                await audioCtx.resume();
            }

            // Keep draining as long as there are items
            while (playbackQueueRef.current.length > 0) {
                // Catch up if we've fallen behind
                if (nextStartTimeRef.current < audioCtx.currentTime) {
                    nextStartTimeRef.current = audioCtx.currentTime + 0.02;
                }

                const chunk = playbackQueueRef.current.shift()!;
                if (!chunk || chunk.length === 0) continue;

                try {
                    const buffer = audioCtx.createBuffer(1, chunk.length, 24000);
                    buffer.getChannelData(0).set(chunk);

                    const source = audioCtx.createBufferSource();
                    source.buffer = buffer;
                    currentSourceRef.current = source;
                    // Connect to GainNode (not directly to destination)
                    const targetNode = gainNodeRef.current || audioCtx.destination;
                    source.connect(targetNode);
                    activeSourcesRef.current.push(source);
                    // Clean up ended sources from the array
                    source.onended = () => {
                        activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
                        if (audioCtxRef.current && audioCtxRef.current.currentTime >= nextStartTimeRef.current - 0.1) {
                            setIsAgentSpeaking(false);
                        }
                    };

                    const startTime = nextStartTimeRef.current;
                    source.start(startTime);
                    nextStartTimeRef.current += buffer.duration;
                    setIsAgentSpeaking(true);
                } catch (e) {
                    console.error("[CallPanel] Scheduling error:", e);
                }
            }
        } finally {
            isProcessingRef.current = false;
        }

        // Re-check: items may have arrived while we were in the finally block
        if (playbackQueueRef.current.length > 0) {
            processPlaybackQueue();
        }
    };

    const startSession = async () => {
        setStatus("Connecting...");
        try {
            if (!selectedReportId) {
                setStatus("Error");
                addMessage("agent", "Select an analyzed report before starting the mock call.");
                return;
            }

            const callId = await createCall({
                clinicId,
                patientId,
                reportId: selectedReportId,
                status: "CONNECTED",
                notes: "Mock browser call started from Med-Voice UI.",
            });
            setActiveCallId(callId);

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            // Setup Audio Context IMMEDIATELY upon user gesture (before async ws connection)
            const audioCtx = new AudioContext({ sampleRate: 24000 });
            audioCtxRef.current = audioCtx;
            if (audioCtx.state === 'suspended') {
                await audioCtx.resume();
            }

            // Create a master GainNode for interrupt control
            const gainNode = audioCtx.createGain();
            gainNode.connect(audioCtx.destination);
            gainNodeRef.current = gainNode;

            // Connect WebSocket
            const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "wss://med-voice-backend-sqtgj6feba-ew.a.run.app/api/agents/voice";
            const ws = new WebSocket(
                `${wsUrl}?user_id=${encodeURIComponent(patientId)}&session_id=${encodeURIComponent(callId)}&call_id=${encodeURIComponent(callId)}&report_id=${encodeURIComponent(selectedReportId)}`
            );
            wsRef.current = ws;

            ws.onopen = async () => {
                setIsActive(true);
                setStatus("Live");
                setTranscript([{
                    id: "init",
                    role: "agent",
                    text: "Mock call connected. The live agent will use the stored report summary for this patient."
                }]);

                // Use AudioWorklet instead of deprecated ScriptProcessorNode
                // We create an inline blob to avoid serving a separate file from public/
                const workletCode = `
                class PCMProcessor extends AudioWorkletProcessor {
                    process(inputs, outputs, parameters) {
                        try {
                            const input = inputs[0];
                            if (input && input.length > 0) {
                                const channelData = input[0];
                                const pcm16 = new Int16Array(channelData.length);
                                for (let i = 0; i < channelData.length; i++) {
                                    const s = Math.max(-1, Math.min(1, channelData[i]));
                                    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                                }
                                this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
                            }
                        } catch (e) {
                            // Silently fail in worklet to avoid crash
                        }
                        return true; 
                    }
                }
                registerProcessor('pcm-processor', PCMProcessor);
                `;

                const blob = new Blob([workletCode], { type: "application/javascript" });
                const workletUrl = URL.createObjectURL(blob);

                await audioCtx.audioWorklet.addModule(workletUrl);

                // Extra check: ensure context is still running before creating node
                if ((audioCtx.state as string) === 'closed') {
                    console.warn("AudioContext closed before worklet could be initialized.");
                    return;
                }

                let workletNode: AudioWorkletNode;
                try {
                    workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor');
                    workletNodeRef.current = workletNode;
                } catch (e) {
                    console.error("Failed to create AudioWorkletNode:", e);
                    setStatus("Error");
                    return;
                }

                if ((audioCtx.state as string) === 'closed') return;
                const source = audioCtx.createMediaStreamSource(stream);

                workletNode.port.onmessage = (e) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        const pcm16Buffer = e.data;
                        const bytes = new Uint8Array(pcm16Buffer);
                        let binary = '';
                        for (let i = 0; i < bytes.byteLength; i++) {
                            binary += String.fromCharCode(bytes[i]);
                        }
                        const b64Data = btoa(binary);

                        ws.send(JSON.stringify({
                            type: "realtime_input",
                            data: b64Data
                        }));
                    }
                };

                source.connect(workletNode);
                // Do NOT connect worklet to destination as it's a recorder 
                // but we need it to be part of the graph so it processes
                // wait, if it's not connected to destination, some browsers might not process it?
                // Actually, connecting to a null destination or just leaving it is sometimes enough.
                // We'll leave it disconnected from destination but connected from source.

                // Keep references to prevent GC
                (window as any)._audioSource = source;
            };

            ws.onmessage = async (event) => {
                const msg = JSON.parse(event.data);
                console.log(`[CallPanel] WS message: type=${msg.type}, audioCtx=${audioCtxRef.current?.state}`);
                if (msg.type === "interrupt") {
                    console.log(`[CallPanel] INTERRUPT: stopping ${activeSourcesRef.current.length} active sources`);
                    playbackQueueRef.current = [];
                    nextStartTimeRef.current = 0;
                    // Stop ALL active sources, not just the last one
                    for (const src of activeSourcesRef.current) {
                        try { src.stop(); } catch (e) { }
                    }
                    activeSourcesRef.current = [];
                    currentSourceRef.current = null;
                    // Disconnect and recreate GainNode to instantly kill any residual scheduled audio
                    if (gainNodeRef.current && audioCtxRef.current) {
                        gainNodeRef.current.disconnect();
                        const newGain = audioCtxRef.current.createGain();
                        newGain.connect(audioCtxRef.current.destination);
                        gainNodeRef.current = newGain;
                    }
                    isProcessingRef.current = false;
                    setIsAgentSpeaking(false);
                    return;
                }

                if (msg.type === "text") {
                    addMessage("agent", msg.text);
                } else if (msg.type === "audio") {
                    // Convert base64 to Float32Array
                    const binaryStr = atob(msg.data);
                    const bytes = new Uint8Array(binaryStr.length);
                    for (let i = 0; i < binaryStr.length; i++) {
                        bytes[i] = binaryStr.charCodeAt(i);
                    }

                    // Direct construction on the buffer with byte offset/length check
                    const numSamples = Math.floor(bytes.byteLength / 2);
                    const int16Array = new Int16Array(bytes.buffer, 0, numSamples);
                    const float32Array = new Float32Array(numSamples);

                    for (let i = 0; i < numSamples; i++) {
                        float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7FFF);
                    }

                    playbackQueueRef.current.push(float32Array);
                    console.log(`[CallPanel] Audio chunk queued: ${float32Array.length} samples, queue size: ${playbackQueueRef.current.length}, processing: ${isProcessingRef.current}`);
                    processPlaybackQueue();
                }
            };

            ws.onclose = () => {
                stopSession();
            };

        } catch (err) {
            console.error("Failed to start session", err);
            setStatus("Error");
            setIsActive(false);
        }
    };

    const stopSession = () => {
        setIsActive(false);
        setStatus("Disconnected");
        setIsAgentSpeaking(false);

        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        if (audioCtxRef.current) {
            audioCtxRef.current.close();
            audioCtxRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        if ((window as any)._audioProcessor) {
            (window as any)._audioProcessor.disconnect();
            (window as any)._audioSource.disconnect();
        }
        playbackQueueRef.current = [];
    };

    const handleTriggerCall = async () => {
        if (scheduleMode === "now" && !confirmNowCall) {
            setConfirmNowCall(true);
            return;
        }

        setStatus("Submitting...");
        try {
            const status = scheduleMode === "now" ? "QUEUED" : "CALLBACK_SCHEDULED";
            let scheduledFor = null;

            if (scheduleMode === "later") {
                const combined = new Date(`${scheduledDate}T${scheduledTime}`);
                scheduledFor = Timestamp.fromDate(combined);
            }

            if (scheduleMode === "now") {
                const callId = await createCall({
                    clinicId,
                    patientId,
                    reportId: selectedReportId,
                    status,
                    scheduledFor,
                    notes: `Triggered via Portal outreach panel. Mode: ${scheduleMode}`,
                });

                await triggerTwilioCall(patientPhone, patientId, callId, selectedReportId, clinicId);
            } else {
                const combined = new Date(`${scheduledDate}T${scheduledTime}`).toISOString();
                await scheduleCallback({
                    patientId,
                    clinicId,
                    reportId: selectedReportId,
                    scheduledAt: combined,
                });
            }

            setIsSubmitted(true);
            setTimeout(() => onClose?.(), 2500);
        } catch (err) {
            console.error("Error triggering call:", err);
            setStatus("Error");
        }
    };

    const getBadgeColor = () => {
        switch (status) {
            case "Live": return "bg-emerald-50 text-emerald-600 border-emerald-100";
            case "Connecting...": return "bg-amber-50 text-amber-600 border-amber-100";
            case "Error": return "bg-red-50 text-red-600 border-red-100";
            default: return "bg-slate-50 text-slate-400 border-slate-200";
        }
    };

    if (isSubmitted) {
        return (
            <div className="w-full bg-white border border-slate-200 rounded-[40px] shadow-2xl p-16 text-center animate-in fade-in zoom-in duration-500">
                <div className="w-24 h-24 bg-[#25C1B1]/10 rounded-full flex items-center justify-center mx-auto mb-8">
                    <CheckCircle2 className="w-12 h-12 text-[#25C1B1]" />
                </div>
                <h2 className="text-3xl font-black text-[#002D4C] mb-3 tracking-tight">Request Confirmed</h2>
                <p className="text-slate-500 font-medium text-lg leading-relaxed">
                    {scheduleMode === "now"
                        ? "The AI agent has been initialized for an immediate outreach session."
                        : `The patient is scheduled for an automated call on ${scheduledDate} at ${scheduledTime}.`}
                </p>
                <div className="mt-10 h-1 w-24 bg-slate-100 rounded-full mx-auto" />
            </div>
        );
    }

    return (
        <div className="w-full bg-white border border-slate-200 rounded-[44px] shadow-[0_40px_80px_-16px_rgba(0,45,76,0.2)] flex flex-col max-h-[95vh] h-[820px] overflow-hidden relative">
            {/* Simple Header */}
            <div className="bg-slate-50/80 border-b border-slate-100 px-10 py-5 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-5">
                    <div className="w-12 h-12 rounded-[22px] bg-[#25C1B1]/10 flex items-center justify-center text-[#25C1B1] shadow-sm">
                        {mode === "trigger" ? <Phone className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                    </div>
                    <div>
                        <h3 className="text-2xl font-black text-[#002D4C] tracking-tight">
                            {mode === "trigger" ? (scheduleMode === "now" ? "Twilio Outbound Call" : "Schedule Callback") : "Mock Browser Call"}
                        </h3>
                        <p className="text-[11px] text-[#002D4C]/40 font-black uppercase tracking-[0.25em] mt-1">
                            {mode === "trigger" ? (scheduleMode === "now" ? "Explicit Phone Invocation" : "Cloud Tasks Callback") : "Summary-Driven Live Test"}
                        </p>
                    </div>
                </div>
                <button onClick={onClose} className="p-3 rounded-full hover:bg-white text-slate-300 transition-all hover:text-[#002D4C] shadow-sm">
                    <X className="w-7 h-7" />
                </button>
            </div>

            {mode === "trigger" ? (
                <div className="flex-1 flex flex-col p-8 md:p-10 bg-white min-h-0 overflow-hidden">
                    <div className="mb-6 shrink-0">
                        <p className="text-slate-500 font-medium text-lg leading-relaxed">
                            {scheduleMode === "now"
                                ? "Trigger an explicit Twilio phone call for this patient using the selected analyzed report."
                                : "Schedule a real callback through Cloud Tasks for this patient using the selected analyzed report."}
                        </p>
                    </div>

                    {scheduleMode === "now" && confirmNowCall && (
                        <div className="mb-6 rounded-[28px] border border-amber-100 bg-amber-50 px-6 py-5 shrink-0">
                            <p className="text-sm font-bold text-amber-700">
                                You are initiating a Twilio call to <span className="font-black">{patientPhone || "the patient number on file"}</span>. Click again to confirm and place the call.
                            </p>
                        </div>
                    )}

                    <div className="space-y-8 flex-1 overflow-y-auto pr-4 custom-scrollbar -mr-2 min-h-0">
                        {/* Report Selection */}
                        <div className="space-y-6">
                            <div className="flex items-center gap-3">
                                <label className="text-[11px] font-black text-[#002D4C] uppercase tracking-[0.25em] opacity-40">Clinical Context</label>
                                <div className="h-px flex-1 bg-slate-100" />
                                <Info className="w-4 h-4 text-slate-300" />
                            </div>
                            <div className="grid grid-cols-1 gap-4">
                                {reports.length === 0 ? (
                                    <div className="p-12 border-2 border-dashed border-slate-100 rounded-[32px] bg-slate-50/30 text-center">
                                        <p className="text-base text-slate-400 font-bold italic">No medical reports available for discussion.</p>
                                    </div>
                                ) : (
                                    reports.map((r, idx) => {
                                        // Use index as fallback for key if both IDs are missing
                                        const rId = r.reportId || r.report_id || `report-${idx}`;
                                        const isSelected = selectedReportId === rId;
                                        const rType = r.reportType || r.report_type || "General";
                                        const rDate = r.reportDate || r.date || "";

                                        return (
                                            <button
                                                key={rId}
                                                onClick={() => setSelectedReportId(rId)}
                                                className={`flex items-center justify-between p-6 rounded-[32px] border-2 transition-all duration-500 text-left relative group ${isSelected ? "border-[#25C1B1] bg-[#25C1B1]/5 shadow-2xl shadow-[#25C1B1]/5" : "border-slate-50 hover:border-slate-200 hover:bg-slate-50/50 opacity-60 hover:opacity-100"}`}
                                            >
                                                <div className="flex items-center gap-6">
                                                    <div className={`w-14 h-14 rounded-[22px] flex items-center justify-center transition-all duration-500 shadow-sm ${isSelected ? "bg-[#25C1B1] text-white rotate-0" : "bg-white text-slate-300 group-hover:rotate-6 group-hover:text-slate-400"}`}>
                                                        <FileText className="w-7 h-7" />
                                                    </div>
                                                    <div>
                                                        <p className={`text-lg font-black tracking-tight mb-0.5 ${isSelected ? "text-[#002D4C]" : "text-slate-400"}`}>{rType} Analysis</p>
                                                        <p className="text-[12px] text-slate-400 font-bold uppercase tracking-widest">{formatDate(r.createdAt || rDate)}</p>
                                                    </div>
                                                </div>
                                                {isSelected && (
                                                    <div className="w-8 h-8 rounded-full bg-[#25C1B1] flex items-center justify-center shadow-xl shadow-[#25C1B1]/30">
                                                        <CheckCircle2 className="w-5 h-5 text-white" />
                                                    </div>
                                                )}
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        {/* Timing & Deployment */}
                        <div className="space-y-5">
                            <div className="flex items-center gap-3">
                                <label className="text-[11px] font-black text-[#002D4C] uppercase tracking-[0.25em] opacity-40">Timing & Deployment</label>
                                <div className="h-px flex-1 bg-slate-100" />
                            </div>
                            <div className="flex gap-5 p-2.5 bg-slate-50/80 rounded-[34px]">
                                <button
                                    onClick={() => setScheduleMode("now")}
                                    className={`flex-1 py-5 px-6 rounded-[26px] flex items-center justify-center gap-3.5 transition-all duration-500 font-black text-sm tracking-tight ${scheduleMode === "now" ? "bg-[#002D4C] text-white shadow-2xl shadow-[#002D4C]/30 scale-[1.02]" : "text-[#002D4C]/40 hover:text-[#002D4C] hover:bg-slate-100"}`}
                                >
                                    <Clock className={`w-5 h-5 ${scheduleMode === "now" ? "text-[#25C1B1]" : "opacity-30"}`} />
                                    Initiate Now
                                </button>
                                <button
                                    onClick={() => setScheduleMode("later")}
                                    className={`flex-1 py-5 px-6 rounded-[26px] flex items-center justify-center gap-3.5 transition-all duration-500 font-black text-sm tracking-tight ${scheduleMode === "later" ? "bg-[#002D4C] text-white shadow-2xl shadow-[#002D4C]/30 scale-[1.02]" : "text-[#002D4C]/40 hover:text-[#002D4C] hover:bg-slate-100"}`}
                                >
                                    <Calendar className={`w-5 h-5 ${scheduleMode === "later" ? "text-[#25C1B1]" : "opacity-30"}`} />
                                    Schedule
                                </button>
                            </div>
                        </div>

                        {scheduleMode === "later" && (
                            <div className="p-10 bg-slate-50/50 rounded-[40px] border border-slate-100 animate-in slide-in-from-top-6 duration-700 ring-2 ring-white ring-inset">
                                <label className="text-[11px] font-black text-[#002D4C] uppercase tracking-[0.25em] opacity-40 block mb-6 px-1">Scheduled Deployment</label>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between px-2">
                                            <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Date</span>
                                            <Calendar className="w-3.5 h-3.5 text-slate-200" />
                                        </div>
                                        <input
                                            type="date"
                                            value={scheduledDate}
                                            min={new Date().toISOString().split("T")[0]}
                                            onChange={(e) => setScheduledDate(e.target.value)}
                                            className="w-full bg-white border border-slate-100 rounded-3xl py-4 px-6 text-base font-bold text-[#002D4C] focus:ring-2 focus:ring-[#25C1B1]/20 focus:border-[#25C1B1] outline-none transition-all shadow-sm"
                                        />
                                    </div>
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between px-2">
                                            <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Time</span>
                                            <Clock className="w-3.5 h-3.5 text-slate-200" />
                                        </div>
                                        <input
                                            type="time"
                                            value={scheduledTime}
                                            onChange={(e) => setScheduledTime(e.target.value)}
                                            className="w-full bg-white border border-slate-100 rounded-3xl py-4 px-6 text-base font-bold text-[#002D4C] focus:ring-2 focus:ring-[#25C1B1]/20 focus:border-[#25C1B1] outline-none transition-all shadow-sm"
                                        />
                                    </div>
                                </div>
                                <div className="mt-8 pt-6 border-t border-slate-100/50 flex items-center gap-3 px-2">
                                    <div className="w-2 h-2 rounded-full bg-[#25C1B1]" />
                                    <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest leading-none">AI Agent will be deployed at the exact time</p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="mt-8 pt-8 border-t border-slate-100 flex items-center gap-8 bg-white shrink-0">
                        <button
                            onClick={onClose}
                            className="text-[12px] font-black text-[#002D4C]/30 hover:text-[#002D4C] transition-colors uppercase tracking-[0.2em] pl-4"
                        >
                            Dismiss
                        </button>
                        <button
                            disabled={!selectedReportId || status === "Submitting..."}
                            onClick={handleTriggerCall}
                            className="flex-1 flex items-center justify-center gap-4 py-5 bg-[#25C1B1] text-white rounded-[32px] text-lg font-black shadow-[0_24px_48px_-12px_rgba(37,193,177,0.4)] hover:scale-[1.03] hover:bg-[#1EAD9F] active:scale-95 transition-all disabled:opacity-30 disabled:grayscale disabled:scale-100"
                        >
                            {status === "Submitting..." ? (
                                <Loader2 className="w-6 h-6 animate-spin" />
                            ) : (
                                <ChevronRight className="w-7 h-7" />
                            )}
                            {scheduleMode === "now"
                                ? (confirmNowCall ? `Confirm Call To ${patientPhone || "Patient"}` : "Call Patient Now")
                                : `Schedule Callback For ${scheduledTime}`}
                        </button>
                    </div>
                </div>
            ) : (
                /* LIVE ASSISTANT MODE */
                <div className="flex-1 flex flex-col h-full bg-white">
                    <div className="px-12 py-10 border-b border-slate-100 bg-slate-50/30 flex justify-between items-center">
                        <div className={`flex items-center px-5 py-2.5 rounded-full border text-xs font-black tracking-widest uppercase transition-all duration-500 shadow-sm ${getBadgeColor()}`}>
                            {status === "Connecting..." && <Loader2 className="w-4 h-4 animate-spin mr-3" />}
                            {status === "Error" && <AlertCircle className="w-4 h-4 mr-3" />}
                            {status === "Live" && <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 mr-3 animate-pulse" />}
                            {status}
                        </div>
                        <div className="text-[10px] text-slate-400 font-black uppercase tracking-[0.3em]">
                            {activeCallId ? `Call ${activeCallId.slice(0, 8).toUpperCase()}` : "Encrypted Session"}
                        </div>
                    </div>

                    {/* Transcript */}
                    <div ref={scrollRef} className="flex-1 overflow-y-auto px-12 py-10 space-y-8 bg-slate-50/50">
                        {transcript.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-slate-300 text-center px-12 py-20">
                                <div className="w-32 h-32 rounded-full bg-white flex items-center justify-center mb-10 shadow-2xl shadow-[#002D4C]/5 border border-slate-100/50 group">
                                    <Mic className="w-14 h-14 opacity-20 group-hover:opacity-40 transition-opacity duration-700" />
                                </div>
                                <h4 className="text-2xl font-black text-[#002D4C]/40 tracking-tight">System Ready for Input</h4>
                                <p className="text-base font-medium mt-3 text-slate-400 max-w-[280px] leading-relaxed">Initiate the microphone to begin direct clinical modeling.</p>
                            </div>
                        ) : (
                            transcript.map((msg) => (
                                <div key={msg.id} className={`flex w-full animate-in fade-in slide-in-from-bottom-4 duration-500 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                                    {msg.role === "agent" && (
                                        <div className="w-12 h-12 rounded-[18px] bg-[#002D4C] flex items-center justify-center mr-5 mt-1 shrink-0 shadow-2xl shadow-[#002D4C]/20 border-2 border-white">
                                            <HeartPulse className="w-6 h-6 text-[#25C1B1]" />
                                        </div>
                                    )}
                                    <div className={`max-w-[75%] rounded-[32px] px-8 py-5 text-[16px] font-medium leading-relaxed ${msg.role === "user"
                                        ? "bg-[#25C1B1] text-white rounded-tr-none shadow-[0_20px_40px_-10px_rgba(37,193,177,0.3)]"
                                        : "bg-white text-[#002D4C] rounded-tl-none border border-slate-100 shadow-[0_20px_40px_-10px_rgba(0,45,76,0.05)]"
                                        }`}>
                                        {msg.text}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Controls */}
                    <div className="relative pt-12 pb-24 px-12 bg-white border-t border-slate-100 flex flex-col items-center">
                        <div className="absolute top-0 left-0 right-0 h-24 -mt-24 overflow-hidden flex items-end justify-center gap-3 pb-8 pointer-events-none">
                            {isAgentSpeaking && [0.4, 0.7, 1, 0.6, 0.3, 0.8, 0.5, 0.9, 0.4, 0.6, 0.2].map((_, i) => (
                                <div
                                    key={i}
                                    className="w-3 bg-[#25C1B1] rounded-full"
                                    style={{ height: "12px", animation: "audioWave 0.7s ease-in-out infinite alternate", animationDelay: `${i * 0.12}s` }}
                                />
                            ))}
                        </div>

                        <div className="relative flex items-center justify-center w-full">
                            {isActive && status === "Live" && (
                                <>
                                    <div className="absolute rounded-full bg-[#25C1B1]/5 w-40 h-40 animate-ping" style={{ animationDuration: "3.5s" }} />
                                    <div className="absolute rounded-full bg-[#25C1B1]/10 w-64 h-64 animate-pulse" />
                                </>
                            )}
                            <button
                                onClick={isActive ? stopSession : startSession}
                                className={`relative z-20 w-32 h-32 rounded-full flex items-center justify-center border-8 transition-all duration-700 shadow-[0_32px_64px_-16px_rgba(0,45,76,0.3)] active:scale-90 hover:scale-[1.05]
                                    ${isActive && status === "Live"
                                        ? "bg-red-500 border-red-50 text-white shadow-red-500/40"
                                        : "bg-[#002D4C] border-slate-100 text-white shadow-[#002D4C]/30"
                                    }`}
                            >
                                {isActive ? <Mic className="w-12 h-12" /> : <MicOff className="w-12 h-12 opacity-30 hover:opacity-100 transition-opacity duration-500" />}
                            </button>
                        </div>
                        <p className="text-[12px] font-black text-slate-300 uppercase tracking-[0.3em] mt-10 transition-all duration-500">{isActive ? "System Listening..." : "Tap to Speak"}</p>
                    </div>
                </div>
            )}
        </div>
    );
}
