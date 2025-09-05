import { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Chat } from "@google/genai";
import { Persona, Source } from '../types';
import { personaConfigs } from '../config/personaConfig';

const API_KEY = process.env.API_KEY;

export type ConversationState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';
export type TranscriptEntry = {
    speaker: 'user' | 'ai';
    text: string;
    sources?: Source[];
};

// --- Audio Cue Helpers ---
let audioCtx: AudioContext | null = null;
const getAudioContext = () => {
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        } catch (e) {
            console.error("AudioContext not supported by this browser.", e);
        }
    }
    return audioCtx;
};

const playTone = (freq: number, duration: number, volume: number = 0.2) => {
    const context = getAudioContext();
    if (!context) return;
    
    if (context.state === 'suspended') {
        context.resume();
    }

    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(freq, context.currentTime);
    gainNode.gain.setValueAtTime(volume, context.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.00001, context.currentTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);

    oscillator.start(context.currentTime);
    oscillator.stop(context.currentTime + duration);
};
// --- End Audio Cue Helpers ---


export const useVoiceAssistant = () => {
    const [conversationState, setConversationState] = useState<ConversationState>('idle');
    const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [activePersona, setActivePersona] = useState<Persona>(Persona.Default);

    const aiRef = useRef<GoogleGenAI | null>(null);
    const chatRef = useRef<Chat | null>(null);
    const recognitionRef = useRef<any | null>(null);
    const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
    const utteranceQueue = useRef<SpeechSynthesisUtterance[]>([]);
    const modulationCycleRef = useRef(0);
    
    const createChatSession = useCallback((persona: Persona) => {
      if (!aiRef.current) return;
      const config = personaConfigs[persona];
      chatRef.current = aiRef.current.chats.create({
        model: 'gemini-2.5-flash',
        config: {
          systemInstruction: config.systemInstruction,
          tools: [{ googleSearch: {} }],
        }
      });
    }, []);

    const stopAll = useCallback(() => {
        if (recognitionRef.current) {
            recognitionRef.current.abort();
        }
        if (speechSynthesis.speaking) {
            speechSynthesis.cancel();
        }
        utteranceQueue.current = [];
    }, []);

    const speak = useCallback((text: string) => {
        if (!text) {
            setConversationState('idle');
            return;
        };

        const speakQueue = () => {
            if (utteranceQueue.current.length > 0) {
                const utterance = utteranceQueue.current.shift();
                if (utterance) {
                    speechSynthesis.speak(utterance);
                }
            } else {
                playTone(400, 0.07);
                setConversationState('idle');
            }
        };

        setConversationState('speaking');
        playTone(600, 0.05);
        modulationCycleRef.current = 0;

        const cleanedText = text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/#+\s/g, '');
        const sentences = cleanedText.match(/[^.!?]+[.!?]*|[\s\S]+/g) || [];

        utteranceQueue.current = sentences.map(sentence => {
            const utterance = new SpeechSynthesisUtterance(sentence.trim());
            if (voiceRef.current) {
                utterance.voice = voiceRef.current;
            }
            
            const cycle = modulationCycleRef.current;
            const pitchModulation = Math.sin(cycle * 0.6) * 0.05;
            const rateModulation = Math.cos(cycle * 0.4) * 0.08;
            
            utterance.pitch = 1.0 + pitchModulation;
            utterance.rate = 1.05 + rateModulation;
            modulationCycleRef.current += 1;

            utterance.onend = speakQueue;
            utterance.onerror = (event) => {
                console.error("SpeechSynthesis Error:", event.error);
                speakQueue();
            };
            return utterance;
        });

        speakQueue();
    }, []);

    const processAndRespond = useCallback(async (text: string) => {
        setConversationState('processing');
        
        const checkForPersonaSwitch = (text: string): Persona | null => {
            const lowerText = text.toLowerCase().trim().replace(/[.,?]/g, '');
            const match = lowerText.match(/^(switch to|change to|use the|use)\s*(the\s*)?(socratic|simple|expert|default)/);
            if (match) {
                const personaName = match[3];
                if (personaName === 'socratic') return Persona.Socratic;
                if (personaName === 'simple') return Persona.Simple;
                if (personaName === 'expert') return Persona.Expert;
                if (personaName === 'default') return Persona.Default;
            }
            return null;
        };

        const newPersona = checkForPersonaSwitch(text);
        if (newPersona) {
            setActivePersona(newPersona);
            createChatSession(newPersona);
            const confirmationText = `Alright, switched to the ${personaConfigs[newPersona].name} persona.`;
            setTranscript(prev => [...prev, { speaker: 'ai', text: confirmationText }]);
            speak(confirmationText);
            return;
        }

        if (!chatRef.current) {
            setError("Chat session not initialized.");
            setConversationState('error');
            return;
        }

        try {
            const response = await chatRef.current.sendMessage({ message: text });
            let aiText = response.text;
            const sources: Source[] = [];
            const groundingMetadata = response.candidates?.[0]?.groundingMetadata;

            if (groundingMetadata?.groundingChunks) {
                const uniqueUris = new Set<string>();
                for (const chunk of groundingMetadata.groundingChunks) {
                    if (chunk.web && chunk.web.uri && !uniqueUris.has(chunk.web.uri)) {
                        sources.push({
                            content: chunk.web.uri,
                            title: chunk.web.title || chunk.web.uri,
                            type: 'web_link',
                        });
                        uniqueUris.add(chunk.web.uri);
                    }
                }
            }

            if ((!aiText || !aiText.trim()) && sources.length > 0) {
                aiText = "I found some relevant information. Please see the sources for details.";
            }

            setTranscript(prev => [...prev, { speaker: 'ai', text: aiText, sources }]);
            const spokenText = sources.length > 0
              ? aiText + " I've also found some sources, which I've added to the transcript."
              : aiText;
            speak(spokenText);
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : "An unknown error occurred.";
            console.error("Gemini API Error:", e);
            setError(`Error getting response: ${errorMessage}`);
            setConversationState('error');
        }
    }, [createChatSession, speak]);
    
    // Effect for one-time initialization of APIs
    useEffect(() => {
        if (!API_KEY) {
            setError("API_KEY environment variable not set");
            setConversationState('error');
            return;
        }
        aiRef.current = new GoogleGenAI({ apiKey: API_KEY });
        createChatSession(Persona.Default);

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setError("Speech recognition is not supported by your browser.");
            setConversationState('error');
            return;
        }
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = false;
        recognitionRef.current.interimResults = false;

        const loadVoices = () => {
            const availableVoices = speechSynthesis.getVoices();
            if (availableVoices.length === 0) return;
            const usEnglishVoices = availableVoices.filter(v => v.lang.startsWith('en-US'));
            voiceRef.current =
                usEnglishVoices.find(v => /neural/i.test(v.name)) ||
                usEnglishVoices.find(v => /google/i.test(v.name)) ||
                usEnglishVoices.find(v => v.localService) ||
                usEnglishVoices[0];
        };
        speechSynthesis.addEventListener('voiceschanged', loadVoices);
        loadVoices();
        
        return () => {
            stopAll();
            speechSynthesis.removeEventListener('voiceschanged', loadVoices);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Effect to keep recognition event handlers up-to-date with the latest state
    useEffect(() => {
        if (!recognitionRef.current) return;
        
        recognitionRef.current.onstart = () => {
            setConversationState('listening');
            setError(null);
        };

        recognitionRef.current.onresult = (event: any) => {
            const userText = event.results[0][0].transcript;
            if (userText) {
                setTranscript(prev => [...prev, { speaker: 'user', text: userText }]);
                processAndRespond(userText);
            }
        };

        recognitionRef.current.onerror = (event: any) => {
            console.error("Speech Recognition Error:", event.error);
            if (event.error === 'not-allowed') {
                setError("Microphone access denied. Please enable it in your browser settings and tap the orb to try again.");
            } else if (event.error !== 'aborted') {
                setError(`Speech recognition error: ${event.error}`);
            }
            setConversationState('error');
        };

        recognitionRef.current.onend = () => {
            setConversationState(currentState => (currentState === 'listening' ? 'idle' : currentState));
        };
    }, [processAndRespond]);

    const startListening = useCallback(() => {
        if (conversationState !== 'idle' && conversationState !== 'error') return;
        if (!recognitionRef.current) return;
        
        stopAll();
        setError(null);
        
        recognitionRef.current.start();
    }, [conversationState, stopAll]);

    const toggleConversation = useCallback(() => {
        getAudioContext();

        switch (conversationState) {
            case 'idle':
            case 'error':
                startListening();
                break;
            case 'listening':
                recognitionRef.current?.stop();
                break;
            default:
                stopAll();
                setConversationState('idle');
                break;
        }
    }, [conversationState, startListening, stopAll]);


    return { conversationState, transcript, error, toggleConversation, activePersona };
};