import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';
import { PostConversationCTA } from './PostConversationCTA';

// Audio helper functions
const encode = (bytes: Uint8Array) => {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const decode = (base64: string) => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

const createBlob = (data: Float32Array): Blob => {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] < 0 ? data[i] * 0x8000 : data[i] * 0x7FFF;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
};

const decodeAudioData = async (
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> => {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
};

type LiveSession = {
  sendRealtimeInput: (input: { media?: Blob; endOfTurn?: boolean }) => void;
  close: () => Promise<void>;
};

type ConversationState = 'welcome' | 'active' | 'ended';

interface ClientLandingPageProps {
  calendlyUrl: string;
  companyName?: string;
  onCallbackRequest?: (phone: string, preferredTime: string, clientName: string) => Promise<void>;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

// Silence detection settings (tuned for client experience)
const AUDIO_BUFFER_SIZE = 1024;
const MIN_SPEECH_THRESHOLD = 0.0012;
const MAX_SILENCE_BEFORE_DROP = 2500;
const END_TURN_SILENCE_MS = 1500;

interface TranscriptionEntry {
  speaker: 'user' | 'model';
  text: string;
}

/**
 * Client-Facing Landing Page
 * Simplified AI conversation flow for potential clients
 */
export const ClientLandingPage: React.FC<ClientLandingPageProps> = ({
  calendlyUrl,
  companyName = "Senior Living Advisors",
  onCallbackRequest,
}) => {
  const [conversationState, setConversationState] = useState<ConversationState>('welcome');
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcription, setTranscription] = useState<TranscriptionEntry[]>([]);
  const [clientName, setClientName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Audio refs
  const sessionRef = useRef<LiveSession | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextStartTimeRef = useRef(0);
  const isSessionActiveRef = useRef(false);
  const transcriptionRef = useRef<HTMLDivElement>(null);

  // Noise tracking
  const noiseProfileRef = useRef({ floor: 0.0012, ceiling: 0.02, lastSpeechTs: 0 });
  const silenceTrackerRef = useRef({ lastAudioTime: 0, silenceStart: 0, turnEnded: false, turnEndedAt: 0 });

  // System instruction for client-facing mode
  const systemInstruction = useMemo(() => `You are a warm, friendly Senior Living Advisor helping potential clients explore their options. You're having a genuine conversation to understand their needs.

**YOUR ROLE:**
- Help clients discover what type of senior living might work for them
- Be warm, patient, and empathetic - this is an emotional decision for families
- Keep the conversation natural and not like an interrogation
- You are NOT a salesperson - you're a helpful guide

**WHAT TO GATHER (naturally, through conversation):**
- Their name (for personalization)
- Who needs care (themselves or a loved one)
- General care level needed (Independent Living, Assisted Living, Memory Care)
- Preferred location or area
- Approximate budget range (if comfortable sharing)
- Timeline for considering a move
- Any special requirements (pets, dietary, mobility)

**CONVERSATION STYLE:**
- Use warm, conversational language
- Acknowledge what they share before asking follow-ups
- Don't ask too many questions at once
- Be patient with pauses - let them think
- Speak clearly and at a comfortable pace

**IMPORTANT:**
- Do NOT mention internal systems, dashboards, or technical processes
- Do NOT use jargon or industry terminology without explaining
- Do NOT be pushy or salesy
- When you have enough info to help, let them know you've captured their needs and they can schedule a call with an advisor to discuss personalized options

**END OF CONVERSATION:**
When you have gathered the key information (name, care type, location, and timeline), warmly thank them and let them know:
"I've captured all your preferences! When you're ready, you can book a free consultation with one of our advisors who will walk you through personalized options that match what you're looking for."

Keep responses conversational and under 3-4 sentences typically.`, []);

  // Update transcription
  const updateTranscription = useCallback((speaker: 'user' | 'model', rawText: string) => {
    if (!rawText) return;
    
    // Extract name if mentioned
    if (speaker === 'user') {
      const nameMatch = rawText.match(/(?:my name is|i'm|i am|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
      if (nameMatch && !clientName) {
        setClientName(nameMatch[1]);
      }
    }

    setTranscription(prev => {
      const last = prev[prev.length - 1];
      if (last?.speaker === speaker) {
        return [...prev.slice(0, -1), { speaker, text: last.text + rawText }];
      }
      return [...prev, { speaker, text: rawText }];
    });
  }, [clientName]);

  // Auto-scroll transcription
  useEffect(() => {
    if (transcriptionRef.current) {
      transcriptionRef.current.scrollTop = transcriptionRef.current.scrollHeight;
    }
  }, [transcription]);

  // Start conversation
  const handleStartConversation = useCallback(async () => {
    setError(null);
    setIsConnecting(true);

    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('API configuration error. Please contact support.');
      }

      const ai = new GoogleGenAI({ apiKey });

      // Request microphone
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000,
        },
      });
      mediaStreamRef.current = stream;

      // Create audio contexts
      const AudioContextConstructor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      inputAudioContextRef.current = new AudioContextConstructor({ sampleRate: 16000 });
      outputAudioContextRef.current = new AudioContextConstructor({ sampleRate: 24000 });

      if (inputAudioContextRef.current.state === 'suspended') {
        await inputAudioContextRef.current.resume();
      }
      if (outputAudioContextRef.current.state === 'suspended') {
        await outputAudioContextRef.current.resume();
      }

      // Connect to Gemini Live
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.0-flash-exp',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Aoede' },
            },
          },
          systemInstruction: systemInstruction,
        },
        callbacks: {
          onopen: async () => {
            isSessionActiveRef.current = true;
            setConversationState('active');
            setIsConnecting(false);

            try {
              sessionRef.current = await sessionPromise as unknown as LiveSession;
            } catch {
              isSessionActiveRef.current = false;
              return;
            }

            // Setup audio processing
            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(AUDIO_BUFFER_SIZE, 1, 1);
            processorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              if (!isSessionActiveRef.current || !sessionRef.current) return;

              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              
              // Calculate RMS
              let sumSquares = 0;
              for (let i = 0; i < inputData.length; i++) {
                sumSquares += inputData[i] * inputData[i];
              }
              const rmsLevel = Math.sqrt(sumSquares / inputData.length);
              
              const noiseProfile = noiseProfileRef.current;
              noiseProfile.floor = Math.max(MIN_SPEECH_THRESHOLD / 4, (noiseProfile.floor * 0.98) + (rmsLevel * 0.02));
              const threshold = Math.max(noiseProfile.floor * 4.5, MIN_SPEECH_THRESHOLD);
              const isSpeech = rmsLevel > threshold;
              
              const tracker = silenceTrackerRef.current;
              const now = Date.now();

              if (isSpeech) {
                tracker.lastAudioTime = now;
                tracker.silenceStart = 0;
                tracker.turnEnded = false;
              } else if (tracker.lastAudioTime && !tracker.silenceStart) {
                tracker.silenceStart = now;
              }

              const timeSinceLastAudio = tracker.lastAudioTime ? (now - tracker.lastAudioTime) : Infinity;
              const silenceDuration = tracker.silenceStart ? (now - tracker.silenceStart) : 0;
              const shouldEndTurn = !isSpeech && tracker.silenceStart && silenceDuration > END_TURN_SILENCE_MS;

              if (shouldEndTurn && !tracker.turnEnded) {
                tracker.turnEnded = true;
                tracker.turnEndedAt = now;
              }

              const shouldSendAudio = isSpeech || timeSinceLastAudio < MAX_SILENCE_BEFORE_DROP || shouldEndTurn;

              if (!shouldSendAudio) return;

              try {
                const pcmBlob = createBlob(inputData);
                sessionRef.current.sendRealtimeInput({
                  media: pcmBlob,
                  ...(shouldEndTurn ? { endOfTurn: true } : {})
                });
              } catch {
                // Ignore send errors
              }
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current!.destination);
          },

          onmessage: async (message: LiveServerMessage) => {
            // Handle transcription
            if (message.serverContent?.inputTranscription?.text) {
              updateTranscription('user', message.serverContent.inputTranscription.text);
            }
            if (message.serverContent?.outputTranscription?.text) {
              updateTranscription('model', message.serverContent.outputTranscription.text);
            }

            // Handle audio output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              const outputAudioContext = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioContext.currentTime);
              
              const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContext, 24000, 1);
              const source = outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputAudioContext.destination);
              source.addEventListener('ended', () => sourcesRef.current.delete(source));
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            // Handle interruption
            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(source => source.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },

          onerror: () => {
            isSessionActiveRef.current = false;
            setError('Connection lost. Please try again.');
            setConversationState('welcome');
            setIsConnecting(false);
          },

          onclose: () => {
            isSessionActiveRef.current = false;
          },
        },
      }) as unknown as Promise<LiveSession>;

      await sessionPromise;
    } catch (err) {
      console.error('Failed to start conversation:', err);
      setError(err instanceof Error ? err.message : 'Failed to start conversation');
      setIsConnecting(false);
    }
  }, [systemInstruction, updateTranscription]);

  // End conversation
  const handleEndConversation = useCallback(() => {
    isSessionActiveRef.current = false;

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch { /* ignore */ }
      sessionRef.current = null;
    }

    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }

    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    sourcesRef.current.forEach(source => source.stop());
    sourcesRef.current.clear();

    setConversationState('ended');
  }, []);

  // Callback request handler
  const handleCallbackRequest = async (phone: string, preferredTime: string) => {
    if (onCallbackRequest) {
      await onCallbackRequest(phone, preferredTime, clientName);
    } else {
      // Default: push to Google Sheets via API
      try {
        await fetch(`${API_BASE_URL}/api/update-crm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientProfile: {
              name: clientName || 'Unknown',
              phone,
              preferredCallbackTime: preferredTime,
              source: 'client-self-service',
            },
            recommendations: [],
          }),
        });
      } catch (error) {
        console.error('Failed to save callback request:', error);
        throw error;
      }
    }
  };

  // Start new conversation
  const handleStartNew = () => {
    setTranscription([]);
    setClientName('');
    setError(null);
    setConversationState('welcome');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-md">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            <span className="text-lg font-bold text-gray-900">{companyName}</span>
          </div>
          {conversationState === 'active' && (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-2 px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                Live
              </span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Welcome State */}
        {conversationState === 'welcome' && (
          <div className="text-center py-12">
            <div className="max-w-2xl mx-auto">
              {/* Hero */}
              <div className="mb-8">
                <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-xl">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </div>
                <h1 className="text-4xl font-black text-gray-900 mb-4">
                  Find Your Perfect<br />Senior Living Community
                </h1>
                <p className="text-xl text-gray-600 max-w-lg mx-auto">
                  Have a conversation with our AI advisor to explore options that match your needs. Takes just 3-5 minutes.
                </p>
              </div>

              {/* Error message */}
              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
                  {error}
                </div>
              )}

              {/* Start Button */}
              <button
                onClick={handleStartConversation}
                disabled={isConnecting}
                className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 text-white text-lg font-semibold rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-200 transform hover:scale-105 disabled:transform-none"
              >
                {isConnecting ? (
                  <>
                    <svg className="animate-spin h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Connecting...
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                    Start Conversation
                  </>
                )}
              </button>

              {/* Features */}
              <div className="mt-12 grid grid-cols-3 gap-6 text-center">
                <div className="p-4">
                  <div className="w-12 h-12 mx-auto mb-3 bg-blue-100 rounded-xl flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-gray-900">Quick & Easy</h3>
                  <p className="text-sm text-gray-600">Just 3-5 minutes</p>
                </div>
                <div className="p-4">
                  <div className="w-12 h-12 mx-auto mb-3 bg-green-100 rounded-xl flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-gray-900">No Pressure</h3>
                  <p className="text-sm text-gray-600">Explore at your pace</p>
                </div>
                <div className="p-4">
                  <div className="w-12 h-12 mx-auto mb-3 bg-purple-100 rounded-xl flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-gray-900">Personalized</h3>
                  <p className="text-sm text-gray-600">Tailored to you</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Active Conversation */}
        {conversationState === 'active' && (
          <div className="space-y-4">
            {/* Transcription */}
            <div 
              ref={transcriptionRef}
              className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 h-[400px] overflow-y-auto"
            >
              {transcription.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <div className="flex justify-center space-x-2 mb-4">
                      <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                    <p>Listening... Start speaking!</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {transcription.map((entry, idx) => (
                    <div
                      key={idx}
                      className={`flex ${entry.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                          entry.speaker === 'user'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-900'
                        }`}
                      >
                        <p className="text-sm font-medium mb-1 opacity-70">
                          {entry.speaker === 'user' ? 'You' : 'Advisor'}
                        </p>
                        <p>{entry.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="flex justify-center gap-4">
              <button
                onClick={handleEndConversation}
                className="inline-flex items-center gap-2 px-6 py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl shadow-lg transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
                End Conversation
              </button>
            </div>

            {/* Tips */}
            <div className="text-center text-sm text-gray-500">
              <p>💡 Tip: Speak naturally. The advisor will guide you through the process.</p>
            </div>
          </div>
        )}

        {/* Conversation Ended - Show CTA */}
        {conversationState === 'ended' && (
          <div className="py-8">
            <PostConversationCTA
              clientName={clientName}
              calendlyUrl={calendlyUrl}
              onRequestCallback={handleCallbackRequest}
              onStartNewConversation={handleStartNew}
            />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="py-6 text-center text-sm text-gray-500">
        <p>© {new Date().getFullYear()} {companyName}. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default ClientLandingPage;
