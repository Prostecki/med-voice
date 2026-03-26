"use client";

import { useState, useEffect, useRef } from "react";
import { Phone, Mic, MicOff, X, User, Clock, Calendar, CheckCircle2, ChevronRight, MessageSquare, HeartPulse, Volume2, VolumeX, AlertCircle, RefreshCw } from "lucide-react";

type DemoStep =
    | "INCOMING_CALL"
    | "REPORT_EXPLANATION"
    | "INTERRUPTION"
    | "CALLBACK_SCHEDULED"
    | "FAST_FORWARD"
    | "CALLBACK_RESUMED"
    | "APPOINTMENT_SELECTION"
    | "CONFIRMED";

interface Message {
    role: "agent" | "user";
    text: string;
}

export default function DemoPatientPhonePage() {
    const [step, setStep] = useState<DemoStep>("INCOMING_CALL");
    const [messages, setMessages] = useState<Message[]>([]);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [debugInfo, setDebugInfo] = useState<string>("Initializing...");
    const [isInitialised, setIsInitialised] = useState(false);

    const scrollRef = useRef<HTMLDivElement>(null);
    const synthRef = useRef<SpeechSynthesis | null>(null);
    const recognitionRef = useRef<any>(null);
    const isHandlingAnswer = useRef(false);

    // Initial setup for TTS and STT (Run once on mount)
    useEffect(() => {
        if (typeof window === "undefined") return;

        synthRef.current = window.speechSynthesis;

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
            setDebugInfo("Voice engine ready");
            const rec = new SpeechRecognition();
            rec.continuous = true;
            rec.interimResults = true;
            rec.lang = "en-US";

            rec.onstart = () => {
                console.log("Recognition started");
                setIsListening(true);
                setDebugInfo("Mic: Listening...");
            };

            rec.onend = () => {
                console.log("Recognition ended");
                setIsListening(false);
                // Auto-restart if we are in an active step and not speaking
                // but we handle this in 'speak' instead to be safer
            };

            rec.onerror = (event: any) => {
                console.error("STT Error:", event.error);
                setDebugInfo(`Mic Error: ${event.error}`);
                setIsListening(false);
            };

            rec.onresult = (event: any) => {
                let currentTranscript = "";
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    const text = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        handleVoiceCommand(text.toLowerCase());
                        setTranscript("");
                    } else {
                        currentTranscript += text;
                        setTranscript(currentTranscript);
                    }
                }
            };

            recognitionRef.current = rec;
            setIsInitialised(true);
        } else {
            setDebugInfo("Browser doesn't support STT");
        }

        return () => {
            synthRef.current?.cancel();
            try { recognitionRef.current?.stop(); } catch (e) { }
        };
    }, []);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, transcript]);

    const getBestVoice = () => {
        const voices = synthRef.current?.getVoices() || [];
        const preferred = voices.find(v => (v.name.includes("Google") || v.name.includes("Samantha")) && v.lang.startsWith("en"));
        return preferred || voices.find(v => v.lang.startsWith("en")) || voices[0];
    };

    const startListening = () => {
        if (!recognitionRef.current || isSpeaking) return;
        try {
            recognitionRef.current.start();
        } catch (e) {
            // Already started, ignore
        }
    };

    const stopListening = () => {
        try {
            recognitionRef.current.stop();
        } catch (e) { }
    }

    const speak = (text: string, onEnd?: () => void) => {
        if (!synthRef.current) return;
        synthRef.current.cancel();
        stopListening(); // Don't listen while speaking

        const cleanText = text.replace(/MV-\d+/, "M V 4 8 2 1");
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.voice = getBestVoice();
        utterance.lang = "en-US";
        utterance.rate = 1.0;

        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => {
            setIsSpeaking(false);
            if (onEnd) onEnd();
            // Resume listening ONLY if not at end steps
            if (step !== "INCOMING_CALL" && step !== "CONFIRMED") {
                setTimeout(startListening, 500); // Small delay to avoid catching own echo
            }
        };

        synthRef.current.speak(utterance);
    };

    const addMessage = (role: "agent" | "user", text: string, shouldSpeak = false) => {
        setMessages(prev => [...prev, { role, text }]);
        if (role === 'agent' && shouldSpeak) {
            speak(text);
        }
    };

    const handleVoiceCommand = (text: string) => {
        console.log("Voice Input:", text);
        setDebugInfo(`Heard: "${text}"`);

        // INTERVENTION: If user says something, move forward
        if (step === "REPORT_EXPLANATION" && (text.includes("meeting") || text.includes("busy") || text.includes("later") || text.includes("stop") || text.includes("wait"))) {
            handleInterrupt();
        }
        else if (step === "INTERRUPTION" && (text.includes("yes") || text.includes("30") || text.includes("okay") || text.includes("fine") || text.includes("sure"))) {
            handleScheduleCallback();
        }
        else if (step === "CALLBACK_RESUMED" && (text.includes("yes") || text.includes("cardiologist") || text.includes("check") || text.includes("slots") || text.includes("ok"))) {
            handleAskAppointments();
        }
        else if (step === "APPOINTMENT_SELECTION" && (text.includes("one") || text.includes("first") || text.includes("thompson"))) {
            handleSelectAppointment("1");
        }
    };

    // MANUAL ACTION WRAPPERS (to ensure click gesture)
    const handleAnswer = async () => {
        if (isHandlingAnswer.current) return;
        isHandlingAnswer.current = true;

        setDebugInfo("Authenticating Mic...");

        try {
            // Force browser mic prompt
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop()); // We just wanted the permission

            setStep("REPORT_EXPLANATION");
            setMessages([]); // Clear any potential duplicates

            const greeting = "Hello, Mark! This is Med-Voice calling from Northside Medical Center. I'm calling to discuss your recent ECG and lab results.";
            addMessage("agent", greeting, true);

            setTimeout(() => {
                setStep(current => {
                    if (current === "REPORT_EXPLANATION") {
                        const report = "I've analyzed your report. Your heart rate is normal, but your hemoglobin level is slightly low at 12.5 grams. This might explain your fatigue. Would you like to hear more or are you busy?";
                        addMessage("agent", report, true);
                    }
                    return current;
                });
            }, 9000);
        } catch (err: any) {
            setDebugInfo(`Access Denied: ${err.message}`);
            // Fallback for demo: continue without mic if blocked
            setStep("REPORT_EXPLANATION");
            addMessage("agent", "Note: Mic blocked. Continuing with text demo.", false);
        } finally {
            isHandlingAnswer.current = false;
        }
    };

    const handleInterrupt = () => {
        setStep("INTERRUPTION");
        addMessage("user", "I'm in a meeting right now.");
        addMessage("agent", "I understand. Should I call you back in 30 minutes?", true);
    };

    const handleScheduleCallback = () => {
        setStep("CALLBACK_SCHEDULED");
        addMessage("user", "Yes, 30 minutes.");
        addMessage("agent", "Great. Scheduled. Speak to you then!", true);
    };

    const handleFastForward = () => {
        setStep("CALLBACK_RESUMED");
        setMessages([]);
        addMessage("agent", "Hi again! Resuming our talk about your hemoglobin. I recommend a cardiologist. Should I check for slots?", true);
    };

    const handleAskAppointments = () => {
        setStep("APPOINTMENT_SELECTION");
        addMessage("user", "Check availability.");
        addMessage("agent", "Option 1: Dr. Thompson, tomorrow 10 AM. Option 2: Dr. Ellis, Friday. Take Option 1?", true);
    };

    const handleSelectAppointment = (option: string) => {
        setStep("CONFIRMED");
        addMessage("user", `Option 1.`);
        addMessage("agent", `Booked! Tomorrow 10 AM. Confirmation MV-4821. Goodbye!`, true);
    };

    return (
        <div className="min-h-screen bg-[#00050A] flex items-center justify-center p-4 selection:bg-[#25C1B1]/30">
            {/* Phone Frame */}
            <div className="w-full max-w-[400px] h-[820px] bg-black rounded-[60px] shadow-[0_40px_100px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col relative border-[12px] border-[#1e293b]">

                {/* Dynamic Island */}
                <div className="absolute top-2 left-1/2 -translate-x-1/2 w-32 h-7 bg-black rounded-full z-50 flex items-center justify-center px-4">
                    <div className="flex gap-1.5 items-center">
                        <div className={`w-1.5 h-1.5 rounded-full ${isListening ? 'bg-emerald-500 animate-pulse' : 'bg-slate-800'}`} />
                        <div className={`w-1 h-1 rounded-full ${isSpeaking ? 'bg-amber-500 animate-pulse' : 'bg-slate-800'}`} />
                    </div>
                </div>

                <div className="flex-1 flex flex-col bg-white">
                    {step === "INCOMING_CALL" ? (
                        <div className="flex-1 flex flex-col items-center justify-between py-24 bg-gradient-to-b from-[#001D3D] to-[#000814] text-white">
                            <div className="text-center">
                                <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-8 relative">
                                    <div className="absolute inset-0 rounded-full bg-[#25C1B1]/20 animate-ping" />
                                    <Phone className="w-12 h-12 text-[#25C1B1]" />
                                </div>
                                <h2 className="text-2xl font-black mb-2">Med-Voice Live</h2>
                                <p className="text-[#25C1B1] font-black uppercase tracking-[0.3em] text-[10px]">Calling Patient...</p>
                            </div>

                            <div className="flex gap-12">
                                <button className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center"><X className="text-white" /></button>
                                <button
                                    onClick={handleAnswer}
                                    className="w-16 h-16 bg-[#25C1B1] rounded-full flex items-center justify-center shadow-xl shadow-[#25C1B1]/40 animate-bounce"
                                >
                                    <Phone className="text-white" />
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Visual Header */}
                            <div className="bg-[#001A2E] p-10 flex flex-col items-center gap-8 relative shrink-0">
                                <div className="flex items-center gap-2.5 h-12">
                                    {Array.from({ length: 18 }).map((_, i) => (
                                        <div
                                            key={i}
                                            className="w-1.5 bg-[#25C1B1] rounded-full transition-all duration-300"
                                            style={{
                                                height: isSpeaking ? `${Math.random() * 100}%` : '6px',
                                                opacity: isSpeaking ? 1 : 0.1
                                            }}
                                        />
                                    ))}
                                </div>
                                <div className="text-center">
                                    <h3 className="text-white font-black text-xl mb-1">Clinic Assistant</h3>
                                    <p className="text-[#25C1B1] text-[9px] font-black uppercase tracking-widest">
                                        {isSpeaking ? "Speaking..." : (isListening ? "Listening..." : "Wait...")}
                                    </p>
                                </div>
                            </div>

                            {/* Transcript Area */}
                            <div ref={scrollRef} className="flex-1 overflow-y-auto px-8 py-8 space-y-6 bg-slate-50">
                                {messages.map((m, i) => (
                                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-500`}>
                                        <div className={`max-w-[85%] px-5 py-3 rounded-[24px] text-sm font-semibold ${m.role === 'user' ? 'bg-[#25C1B1] text-white rounded-tr-none' : 'bg-white text-[#002D4C] border border-slate-100 rounded-tl-none shadow-sm'
                                            }`}>
                                            {m.text}
                                        </div>
                                    </div>
                                ))}
                                {transcript && (
                                    <div className="flex justify-end pr-2 italic text-slate-400 text-xs animate-pulse">
                                        "{transcript}..."
                                    </div>
                                )}
                            </div>

                            {/* Footer / Debug */}
                            <div className="p-8 bg-white border-t border-slate-100">
                                <div className="mb-6 flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-[#25C1B1]">
                                        <div className={`w-1.5 h-1.5 rounded-full ${isListening ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                                        {debugInfo}
                                    </div>
                                    <button
                                        onClick={() => { try { recognitionRef.current?.start(); } catch (e) { } }}
                                        className="p-2 hover:bg-slate-50 rounded-full text-slate-300 transition-colors"
                                        title="Restart Microphone"
                                    >
                                        <RefreshCw className="w-3 h-3" />
                                    </button>
                                </div>

                                {step === "CALLBACK_SCHEDULED" && (
                                    <button
                                        onClick={handleFastForward}
                                        className="w-full py-4 bg-[#002D4C] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl"
                                    >
                                        Pass 30 Minutes
                                    </button>
                                )}

                                {step === "CONFIRMED" && (
                                    <button
                                        onClick={() => window.location.reload()}
                                        className="w-full py-4 bg-emerald-50 text-emerald-600 rounded-2xl text-[10px] font-black uppercase tracking-widest border border-emerald-100"
                                    >
                                        Restart Demo
                                    </button>
                                )}
                            </div>

                            <div className="pb-4 pt-1 flex justify-center"><div className="w-32 h-1 bg-slate-100 rounded-full" /></div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
