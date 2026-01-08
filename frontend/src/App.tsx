
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type, Blob } from '@google/genai';
import { CallStatus, ClientProfile, Recommendation, TranscriptionEntry, CallSummary, Community, User, SupportedLanguage, AnalysisResult, BackendRecommendation, ClientProfileSource } from './types';
import ClientProfileCard from './components/ClientProfileCard';
import RecommendationsCard from './components/RecommendationsCard';
import CallControls from './components/CallControls';
import TranscriptionPanel from './components/TranscriptionPanel';
import SummaryModal from './components/SummaryModal';
import ComparisonModal from './components/ComparisonModal';
import FeedbackModal from './components/FeedbackModal';
import DatabaseManagementCard from './components/DatabaseManagementCard';
import CommunityFormModal from './components/CommunityFormModal';
import { AudioUploadForm } from './components/AudioUploadForm';
import { TextConsultationForm } from './components/TextConsultationForm';
import { ManualEntryModal } from './components/ManualEntryModal';
import { RecommendationAnalysisModal } from './components/RecommendationAnalysisModal';
import { USERS_DATA } from './data/users.data';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const DEBUG = import.meta.env.DEV; // Enable debug logging only in development

const neilUser = USERS_DATA.find((user) => user.name?.toLowerCase().includes('neil'));
const DEFAULT_USER: User = neilUser
  ? { ...neilUser, title: neilUser.title?.trim() ? neilUser.title : undefined }
  : { name: 'Neil', avatar: 'N' };

const updateDashboardFunctionDeclaration: FunctionDeclaration = {
  name: 'updateDashboard',
  description: 'Updates the agent\'s dashboard with the latest client info, recommendations, and guidance.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      clientProfile: {
        type: Type.OBJECT,
        description: 'Object containing extracted client needs. Only include fields for which information has been gathered.',
        properties: {
          name: { type: Type.STRING, description: 'Client\'s full name.' },
          budget: { type: Type.STRING, description: 'Client\'s monthly budget (e.g., "$5000 - $6000")' },
          location: { type: Type.STRING, description: 'Desired city or neighborhood.' },
          careLevel: { type: Type.STRING, description: 'Required level of care (e.g., "Independent Living", "Assisted Living", "Memory Care").' },
          timeline: { type: Type.STRING, description: 'Client\'s move-in timeline (e.g., "Within 3 months").' },
          mobilityNeeds: { type: Type.STRING, description: 'Specific mobility needs (e.g., "Wheelchair accessible", "Walker user").' },
          wheelchairAccessible: { type: Type.BOOLEAN, description: 'Does the client require wheelchair accessibility?' },
          specificDemands: { type: Type.STRING, description: 'Any other specific, unique client requirements or preferences mentioned, such as a private balcony, pet-friendly policies for a large dog, specific dietary needs like kosher meals, etc.' },
        },
        required: [],
      },
      suggestedQuestions: {
        type: Type.ARRAY,
        description: 'A list of 2-3 high-priority questions the agent should ask to gather missing information.',
        items: { type: Type.STRING },
      },
      communityRecommendations: {
        type: Type.ARRAY,
        description: 'A list of the top 3-5 recommended communities based on the current profile. ALWAYS provide at least 3 communities when making recommendations. For each, include key details extracted from the knowledge base.',
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: 'Name of the senior living community.' },
            reason: { type: Type.STRING, description: 'A brief reason why this community is a good match based on the client\'s needs.' },
            price: { type: Type.STRING, description: 'The base price or pricing details, formatted as a string (e.g., "$6000/month" or "Starts at $6,000").' },
            careLevels: { type: Type.ARRAY, description: 'The relevant care levels offered by the community.', items: { type: Type.STRING } },
            amenities: { type: Type.ARRAY, description: 'A list of 2-3 key amenities that are relevant to the client.', items: { type: Type.STRING } },
            address: { type: Type.STRING, description: 'The full street address of the community.' },
            description: { type: Type.STRING, description: 'A brief description of the community.' },
          },
          required: ['name', 'reason', 'price', 'careLevels', 'amenities', 'address', 'description'],
        },
      },
      agentGuidance: {
        type: Type.ARRAY,
        description: 'A list of 2-3 concise, real-time coaching tips for the agent. Examples: "Client mentioned their daughter lives nearby, great rapport-building opportunity!", "Budget seems flexible, probe for potential upsell to a premium suite.", "Clarify if they need a pet-friendly community for their small dog."',
        items: { type: Type.STRING },
      },
    },
    required: ['clientProfile'],
  },
};

type TranscriptionTracker = { lastText: string; updatedAt: number };
type NoiseProfile = { floor: number; ceiling: number; lastSpeechTs: number };
type SilenceTracker = { lastAudioTime: number; silenceStart: number; turnEnded: boolean; turnEndedAt: number };

const INITIAL_TRANSCRIPTION_TRACKING: Record<'user' | 'model', TranscriptionTracker> = {
  user: { lastText: '', updatedAt: 0 },
  model: { lastText: '', updatedAt: 0 },
};

const INITIAL_NOISE_PROFILE: NoiseProfile = { floor: 0.0012, ceiling: 0.02, lastSpeechTs: 0 };
const INITIAL_SILENCE_TRACKER: SilenceTracker = { lastAudioTime: 0, silenceStart: 0, turnEnded: false, turnEndedAt: 0 };

const AUDIO_BUFFER_SIZE = 1024;
const MIN_SPEECH_THRESHOLD = 0.0012; // Reduced sensitivity to avoid picking up background noise
const MAX_SILENCE_BEFORE_DROP = 2500; // Increased to allow more natural pauses
const END_TURN_SILENCE_MS = 1500; // 1.5 seconds - gives users more time to think without triggering AI response
const END_TURN_CONFIRMATION_MS = 300; // Slightly longer confirmation window for smoother turn-taking
type EnhancedMediaTrackConstraints = MediaTrackConstraints & { voiceIsolation?: boolean };
type MediaTrackSupportedConstraintsWithVoiceIsolation = MediaTrackSupportedConstraints & { voiceIsolation?: boolean };

type LiveSession = {
  sendRealtimeInput: (input: { media?: Blob; endOfTurn?: boolean }) => void;
  sendToolResponse: (payload: { functionResponses: Array<{ id: string; name: string; response: Record<string, unknown> }> }) => void;
  close: () => Promise<void>;
};

type ApiCommunityRecord = {
  CommunityID: number;
  ZIP: string | number;
  'Care Level'?: string;
  'Monthly Fee'?: number;
  'Work with Placement?'?: string;
  'Est. Waitlist Length'?: string;
};

type CommunitiesResponse = {
  communities: ApiCommunityRecord[];
};

type UpdateDashboardArgs = {
  clientProfile?: ClientProfileSource;
  suggestedQuestions?: string[];
  communityRecommendations?: BackendRecommendation[];
  agentGuidance?: string[];
};

declare global {
  interface Window {
    GEMINI_API_KEY?: string;
    __keepAliveInterval?: number | null;
    __audioFallbackInterval?: number | null;
    webkitAudioContext?: typeof AudioContext;
  }
}

// Audio Helper Functions
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

const normalizeTranscriptionText = (rawText: string) => {
  if (!rawText) return '';
  // Preserve sentence structure - only clean excessive spaces between words, not line breaks
  // Replace multiple spaces with single space, but preserve newlines and sentence boundaries
  return rawText
    .replace(/[ \t]+/g, ' ')  // Replace multiple spaces/tabs with single space
    .replace(/\n\s+/g, '\n')   // Clean spaces after newlines
    .replace(/\s+\n/g, '\n')   // Clean spaces before newlines
    .trim();
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

export default function App() {
  const [currentUser] = useState<User>(DEFAULT_USER);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [hasLaunchedAssistant, setHasLaunchedAssistant] = useState(false);
  const [showVisionPanel, setShowVisionPanel] = useState(false);
  // Tooltip state for interactive diagrams
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  
  // Password protection
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  
  // Video walkthrough modal
  const [showVideoModal, setShowVideoModal] = useState(false);
  
  // Google Sheets auto-push toggle (ON by default)
  const [autoPushToSheet, setAutoPushToSheet] = useState(true);

  const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.IDLE);
  const [isAiMuted, setIsAiMuted] = useState(false);
  const isAiMutedRef = useRef(false);
  const isAgentAssistMode = isAiMuted;
  const [isCallPaused, setIsCallPaused] = useState(false);
  const [isAiThinking, setIsAiThinking] = useState(false); // Tracks when AI is processing a function call
  const selectedLanguage: SupportedLanguage = 'en'; // English only - locked, no other languages allowed
  const [clientProfile, setClientProfile] = useState<ClientProfile>({});
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [agentGuidance, setAgentGuidance] = useState<string[]>([]);
  const [transcription, setTranscription] = useState<TranscriptionEntry[]>([]);
  const [history, setHistory] = useState<CallSummary[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult | null>(null);
  const [showClientEmailModal, setShowClientEmailModal] = useState(false);
  const [showManagerEmailModal, setShowManagerEmailModal] = useState(false);
  const [showTextModal, setShowTextModal] = useState(false);
  const [showAudioModal, setShowAudioModal] = useState(false);
  const [showManualEntryModal, setShowManualEntryModal] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  
  const transcriptionStateRef = useRef<Record<'user' | 'model', TranscriptionTracker>>({
    user: { ...INITIAL_TRANSCRIPTION_TRACKING.user },
    model: { ...INITIAL_TRANSCRIPTION_TRACKING.model },
  });
  const noiseProfileRef = useRef<NoiseProfile>({ ...INITIAL_NOISE_PROFILE });
  const silenceTrackerRef = useRef<SilenceTracker>({ ...INITIAL_SILENCE_TRACKER });
  
  // Buffered transcription system - accumulate text and only display after turn complete
  const transcriptionBufferRef = useRef<Record<'user' | 'model', string>>({ user: '', model: '' });
  const flushTimeoutRef = useRef<Record<'user' | 'model', ReturnType<typeof setTimeout> | null>>({ user: null, model: null });
  const lastSpeakerRef = useRef<'user' | 'model' | null>(null);
  const FLUSH_DELAY_MS = 400; // Wait 400ms of silence before displaying text (reduced for better responsiveness)
  
  const resetTranscriptionTracking = useCallback(() => {
    transcriptionStateRef.current.user = { ...INITIAL_TRANSCRIPTION_TRACKING.user };
    transcriptionStateRef.current.model = { ...INITIAL_TRANSCRIPTION_TRACKING.model };
    transcriptionBufferRef.current = { user: '', model: '' };
    if (flushTimeoutRef.current.user) clearTimeout(flushTimeoutRef.current.user);
    if (flushTimeoutRef.current.model) clearTimeout(flushTimeoutRef.current.model);
    flushTimeoutRef.current = { user: null, model: null };
    lastSpeakerRef.current = null;
  }, []);
  
  const resetAudioTracking = useCallback(() => {
    Object.assign(noiseProfileRef.current, INITIAL_NOISE_PROFILE);
    Object.assign(silenceTrackerRef.current, INITIAL_SILENCE_TRACKER);
  }, []);
  
  const applyTranscriptionSnapshot = useCallback((entries: TranscriptionEntry[]) => {
    const sanitized = entries.map(entry => ({
      speaker: entry.speaker,
      text: normalizeTranscriptionText(entry.text),
    }));
    setTranscription(sanitized);
    resetTranscriptionTracking();
    const timestamp = Date.now();
    sanitized.forEach(entry => {
      if (!entry.text) return;
      transcriptionStateRef.current[entry.speaker] = { lastText: entry.text, updatedAt: timestamp };
    });
  }, [resetTranscriptionTracking]);
  
  // Flush buffered text to the UI with normalization
  const flushBuffer = useCallback((speaker: 'user' | 'model') => {
    let bufferedText = transcriptionBufferRef.current[speaker].trim();
    if (!bufferedText) return;
    
    // Post-processing normalization for clean display
    // FIXED: Preserve abbreviations (U.S.A) and numbers ($5,000) while normalizing spacing
    bufferedText = bufferedText
      .replace(/\s+/g, ' ')                    // Normalize multiple spaces to single space
      .replace(/\s+([.,!?;:])/g, '$1')        // Remove space before punctuation
      // Smart punctuation spacing: preserve abbreviations and numbers
      .replace(/([!?;:])\s*([a-zA-Z])/g, '$1 $2')  // Space after !?;: (never abbreviations)
      .replace(/\.\s{2,}([a-z])/g, '. $1')    // Normalize multiple spaces after period + lowercase
      .replace(/\.\s{2,}([A-Z])/g, '. $1')    // Normalize multiple spaces after period + uppercase
      // Don't add space after period if followed by uppercase (likely abbreviation like U.S.A)
      // Don't add space after comma if between digits (preserve numbers like $5,000)
      .replace(/,\s*([a-zA-Z])/g, ', $1')     // Space after comma + letter
      .replace(/\.{2,}/g, '...')              // Normalize multiple dots to ellipsis
      .replace(/\s+\./g, '.')                 // Remove space before period
      .replace(/\(\s+/g, '(')                 // Remove space after opening paren
      .replace(/\s+\)/g, ')')                 // Remove space before closing paren
      .trim();
    
    if (!bufferedText) return;
    
    setTranscription(prev => {
      const previous = prev[prev.length - 1];
      
      // If same speaker, update the last entry
      if (previous?.speaker === speaker) {
        const updated = [...prev];
        updated[updated.length - 1] = { speaker, text: bufferedText };
        return updated;
      }
      
      // Different speaker - add new entry
      return [...prev, { speaker, text: bufferedText }];
    });
    
    // Clear the buffer after flushing
    transcriptionBufferRef.current[speaker] = '';
    transcriptionStateRef.current[speaker] = { lastText: bufferedText, updatedAt: Date.now() };
  }, []);
  
  const updateTranscriptionEntry = useCallback((speaker: 'user' | 'model', rawText?: string) => {
    // Show what the server sent, keep it raw, and preserve the conversation flow.
    if (typeof rawText !== 'string' || rawText.length === 0) return;
    
    // Clean stray backslashes and escape sequences that shouldn't appear in display text
    const cleanedText = rawText
      .replace(/\\(?![nrt"'\\])/g, '') // Remove backslashes not followed by n, r, t, ", ', or \
      .replace(/\\\s+/g, ' '); // Replace backslash + whitespace with just whitespace
    
    setTranscription(prev => {
      const last = prev[prev.length - 1];
      if (last?.speaker === speaker) {
        // Continue the same speaker's line by concatenating raw chunks
        return [...prev.slice(0, -1), { speaker, text: last.text + cleanedText }];
      }
      // New speaker or first entry: add a new line
      return [...prev, { speaker, text: cleanedText }];
    });
  }, []);

const safeString = (value?: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const normalizeClientProfile = (source?: ClientProfileSource): ClientProfile => {
  if (!source) return {};
  const budgetValue = source.budget ?? source.client_budget ?? source.monthlyBudget;
  let budget: string | undefined;
  if (typeof budgetValue === 'number') {
    budget = `$${budgetValue.toLocaleString()}`;
  } else if (typeof budgetValue === 'string') {
    budget = safeString(budgetValue);
  }

  const specific =
    safeString(source.specificDemands) ||
    safeString(source.special_needs?.other) ||
    safeString(source.notes);

  const wheelchair =
    typeof source.wheelchairAccessible === 'boolean'
      ? source.wheelchairAccessible
      : typeof source.wheelchair_accessible === 'boolean'
      ? source.wheelchair_accessible
      : undefined;

  return {
    name: safeString(source.name) || safeString(source.client_name),
    budget,
    location: safeString(source.location) || safeString(source.location_preference),
    careLevel: safeString(source.careLevel) || safeString(source.care_level),
    timeline: safeString(source.timeline),
    specificDemands: specific,
    wheelchairAccessible: wheelchair,
  };
};

const handleAnalysisResults = useCallback((result: AnalysisResult | null, source: 'analysis' | 'live' = 'analysis') => {
    if (!result) return;

    setAnalysisResults(result);

    const clientInfo = result.client_info || {};
    const normalizedProfile = normalizeClientProfile(clientInfo);
    // Merge to preserve any newer fields gathered during the conversation
    setClientProfile(prev => ({ ...prev, ...normalizedProfile }));

    const backendRecommendations: BackendRecommendation[] = Array.isArray(result.recommendations)
      ? result.recommendations
      : [];
    const formattedRecommendations: Recommendation[] = backendRecommendations.map((rec, index) => {
      const monthlyFee = rec.key_metrics?.monthly_fee;
      const careLevel = rec.key_metrics?.care_level;
      const zip = rec.key_metrics?.zip_code;
      const communityName =
        rec.community_name ||
        rec.name ||
        (rec.community_id ? `Community ${rec.community_id}` : `Recommendation ${index + 1}`);

      return {
        name: communityName,
        reason:
          rec.explanations?.holistic_reason ||
          rec.explanations?.availability_reason ||
          rec.reason ||
          'High-ranking match for this client.',
        price:
          typeof monthlyFee === 'number'
            ? `$${monthlyFee.toLocaleString()}`
            : safeString(rec.price) ?? undefined,
        address: zip ? `ZIP ${zip}` : safeString(rec.address),
        description: rec.explanations?.business_reason || safeString(rec.description) || 'Generated via AI ranking engine.',
        careLevels: careLevel ? [careLevel] : rec.careLevels || [],
        amenities: rec.amenities || [],
      };
    });

    if (source === 'analysis') {
      // Only replace if we have recommendations; keep existing otherwise
      setRecommendations(prev => (formattedRecommendations.length ? formattedRecommendations : prev));
    } else {
      setRecommendations(prev => (formattedRecommendations.length ? formattedRecommendations : prev));
    }
  }, []);
  
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [isComparisonModalOpen, setIsComparisonModalOpen] = useState(false);
  const [communitiesToCompare, setCommunitiesToCompare] = useState<Community[]>([]);
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [isCommunityModalOpen, setIsCommunityModalOpen] = useState(false);
  const [communityToEdit, setCommunityToEdit] = useState<Community | null>(null);

  const [summaryText, setSummaryText] = useState('');
  const [view, setView] = useState<'dashboard' | 'database'>('dashboard');

  const sessionRef = useRef<LiveSession | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | AudioWorkletNode | AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextStartTimeRef = useRef(0);
  const isCallPausedRef = useRef(false);
  const isSessionActiveRef = useRef(false);
  const audioIntervalRef = useRef<number | null>(null);

  const languageNames = useMemo(() => ({
    en: 'English',
    hi: 'Hindi (हिन्दी)',
    es: 'Spanish (Español)'
  }), []);

  // Recommendation readiness helpers
  const hasMinProfileForRecs = Boolean(
    clientProfile.budget && clientProfile.location && clientProfile.careLevel
  );
  const hasAtLeastThreeRecs = recommendations.length >= 3;
  
  // Auto-push to Google Sheets for live calls when recommendations update
  const prevRecommendationsLengthRef = useRef(0);
  useEffect(() => {
    // Only auto-push for live calls when:
    // 1. Auto-push is ON
    // 2. We have new recommendations (length increased from 0 to 3+)
    // 3. Call status is IDLE or STOPPED (after call ends)
    if (
      autoPushToSheet && 
      recommendations.length >= 3 && 
      prevRecommendationsLengthRef.current === 0 &&
      callStatus === CallStatus.IDLE &&
      clientProfile.name // Ensure we have client data
    ) {
      // Auto-push after a short delay to ensure all data is ready
      const timer = setTimeout(() => {
        console.log('[AUTO-PUSH] Triggering automatic Google Sheets export...');
        handlePushToGoogleSheet();
      }, 1000);
      
      return () => clearTimeout(timer);
    }
    
    prevRecommendationsLengthRef.current = recommendations.length;
  }, [recommendations.length, autoPushToSheet, callStatus, clientProfile.name]);

  // Map our language codes to Gemini API language codes
  const geminiLanguageCodes = useMemo(() => ({
    en: 'en-US',
    hi: 'hi-IN',
    es: 'es-ES'
  }), []);

  const communitiesListString = useMemo(() => {
    return communities.map(
      c => `- ${c.name} (Location: ${c.location}, Address: ${c.address}, Description: ${c.description}, Care: ${c.careLevels.join('/')}, Price: ${c.pricingDetails}, Amenities: [${c.amenities.join(', ')}], Partner: ${c.isPartner ? 'Yes' : 'No'}, Wheelchair Accessible: ${c.wheelchairAccessible}, Availability: ${c.availability})`
    ).join('\n');
  }, [communities]);

  const ACTIVE_AI_SYSTEM_INSTRUCTION = useMemo(() => `You are a warm, friendly Senior Living Placement Advisor. You're a real person having a genuine conversation to help families find the perfect senior living community. You care deeply about your clients and want to make this important decision as easy and comfortable as possible.

**YOUR PERSONALITY AND COMMUNICATION STYLE:**
- Speak naturally and conversationally, like a helpful friend who's an expert in this field
- Use complete, well-formed sentences with proper spacing and punctuation
- Be warm, respectful, and empathetic - this is an emotional decision for families
- Build genuine rapport before diving into requirements
- Never sound rushed, robotic, or like you're reading from a script
- Speak clearly and pause naturally between thoughts
- Use occasional natural filler words ("well," "you know," "I see") sparingly to sound human

**CRITICAL: TEXT FORMATTING AND CLARITY:**
- ALWAYS speak in complete, properly formatted sentences
- Use proper spacing between words
- Never output broken text like "Greattomeetyou" - it should be "Great to meet you"
- Never output JSON responses or technical formatting like {"answer":"..."}
- Speak as if you're having a phone conversation - clear, natural, respectful
- If you make a mistake, smoothly continue - don't restart sentences

**LANGUAGE REQUIREMENTS:**
${selectedLanguage === 'en' ? `
- Speak ONLY in English (en-US)
- Use natural American English conversation patterns
- All responses must be in clear, professional English
` : `
- Speak ONLY in ${languageNames[selectedLanguage]}
- Use natural conversation patterns in ${languageNames[selectedLanguage]}
- All responses must be in ${languageNames[selectedLanguage]}
`}

**CONVERSATION APPROACH:**
- Respond naturally to what the client actually says - don't follow a script or template
- Listen carefully to what they share upfront, then build your response around that
- If they provide information immediately (location, care type, budget, urgency), acknowledge ALL of it before asking follow-up questions
- Only ask for information you don't already have - never repeat questions about details they've already shared
- Be conversational, adaptive, and genuinely helpful - not formulaic or robotic
- Match their energy and communication style

**INFORMATION TO GATHER (Adapt based on what's already shared):**
When not already provided, naturally gather:
- Their name (for personalization)
- Who needs care (themselves or a loved one)
- Type of care needed (Independent Living, Assisted Living, Memory Care)
- Location preference (city, region, or ZIP code)
- Budget range (if comfortable sharing)
- Timeline for moving
- Special needs or preferences (medical, social, amenities)

**RESPONSE PATTERNS - Be Adaptive:**
- If they share multiple details upfront → Acknowledge everything they said, then ask about missing key details
  Example: "Great! So you're looking for assisted living in Rochester. Let me help you find the perfect place. Is this for yourself or a loved one?"
- If they're vague or just greeting → Welcome them warmly and ask an open question
  Example: "Hi! I'm here to help you find the perfect senior living community. What brings you here today?"
- If they seem unsure → Be patient and guide them gently through what you need to know
- If they're in a hurry → Be efficient while staying warm and helpful

**DASHBOARD UPDATES (Behind the Scenes):**
- Call \`updateDashboard\` ONLY after you finish speaking your complete response, NOT while speaking
- IMPORTANT: Do NOT interrupt your speech to update the dashboard - finish talking first, then update
- Batch multiple pieces of information into a SINGLE update call (e.g., if client shares name, location, and budget, update all three in one call)
- Aim for 1-2 dashboard updates per conversation exchange, NOT multiple rapid updates
- Update \`clientProfile\` with all new details gathered in that exchange: name, location, budget, care level, timeline, special needs
- Provide \`suggestedQuestions\` (2-3 questions) for missing information
- Generate \`communityRecommendations\` ONLY when you have ALL 4 KEY PIECES of information:
  1. Budget (monthly budget range)
  2. Location (city, area, or ZIP code)
  3. Care Type (Independent Living, Assisted Living, or Memory Care)
  4. Timeline (move-in timeline)
  - CRITICAL: ALWAYS provide 3-5 communities when generating recommendations, not just 1
  - CRITICAL: Use exact community names from the knowledge base (e.g., "Community 12345")
- Provide \`agentGuidance\` with helpful coaching tips for the human agent
- NEVER mention the dashboard or technical terms to the client
- CRITICAL FOR SMOOTH EXPERIENCE: Fewer, batched updates = smoother conversation flow

**RECOMMENDATIONS:**
- Generate recommendations ONLY once you have ALL 4 required pieces: budget, location, care type, and timeline
- ALWAYS provide 3-5 communities (not just 1!) that best match the client's needs
- Be enthusiastic but not pushy when presenting options
- Explain WHY each recommendation fits their specific needs
- Prioritize: location match, budget fit, care level, availability, partner status

**WHAT TO AVOID:**
- DON'T follow scripted conversation templates - respond to what they actually say
- DON'T ask multiple questions in one breath - space them out naturally
- DON'T sound like an interrogation - this is a conversation, not a form
- DON'T repeat questions they already answered
- DON'T ignore information they provide upfront
- DON'T output technical data, JSON, or debugging information
- DON'T use broken text formatting - always use proper spacing
- DON'T be overly formal or robotic - be friendly and approachable
- DON'T rush through the conversation - take time to connect

**Available Communities Knowledge Base:**
${communitiesListString}`, [selectedLanguage, languageNames, communitiesListString]);

  const fetchCommunities = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/communities`);
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data: CommunitiesResponse = await response.json();
      const mappedCommunities = data.communities.map((c: ApiCommunityRecord) => {
        // Safely map availability to expected type
        let availability: 'Immediate' | 'Waitlist' | 'Available Soon' = 'Waitlist';
        const waitlistStatus = c['Est. Waitlist Length'];
        if (waitlistStatus === 'Available') {
          availability = 'Immediate';
        } else if (waitlistStatus === 'Available Soon') {
          availability = 'Available Soon';
        } else {
          availability = 'Waitlist';
        }

        return {
          id: c.CommunityID,
          name: `Community ${c.CommunityID}`,
          location: `ZIP ${c.ZIP}`,
          address: `${c.ZIP}, USA`,
          description: c['Care Level'] ? `A community offering ${c['Care Level']}` : 'Community entry',
          careLevels: c['Care Level'] ? [c['Care Level']] : [],
          basePrice: typeof c['Monthly Fee'] === 'number' ? c['Monthly Fee'] : 0,
          pricingDetails: `Starts at $${c['Monthly Fee'] || 0}`,
          isPartner: c['Work with Placement?'] === 'Yes',
          amenities: [],
          lat: 0,
          lng: 0,
          wheelchairAccessible: true,
          hasKitchen: false,
          availability,
        };
      });
      setCommunities(mappedCommunities);
    } catch (error) {
      console.error("Failed to fetch communities:", error);
      alert('Error: Could not load community data from the backend.');
    }
  }, []);


  

  useEffect(() => {
    if (!hasLaunchedAssistant) return;
      setIsHistoryLoading(true);
    fetchCommunities()
      .finally(() => {
        setIsHistoryLoading(false);
      });
      // Mock history fetching is removed, CRM will handle history.
      setHistory([]); 
  }, [hasLaunchedAssistant, fetchCommunities]);

  const resetState = useCallback(() => {
      setClientProfile({});
      setRecommendations([]);
      setSuggestedQuestions([]);
      setAgentGuidance([]);
      setAnalysisResults(null);
      setIsAiThinking(false);
      applyTranscriptionSnapshot([]);
      resetAudioTracking();
  }, [applyTranscriptionSnapshot, resetAudioTracking]);

  const generateSummaryText = (): string => {
    let summary = `Call Summary - ${new Date().toLocaleString()}\n\n`;

    summary += '--- CLIENT PROFILE ---\n';
    if (Object.keys(clientProfile).length > 0) {
      summary += `Name: ${clientProfile.name || 'Not specified'}\n`;
      summary += `Budget: ${clientProfile.budget || 'Not specified'}\n`;
      summary += `Location: ${clientProfile.location || 'Not specified'}\n`;
      summary += `Care Level: ${clientProfile.careLevel || 'Not specified'}\n`;
      summary += `Timeline: ${clientProfile.timeline || 'Not specified'}\n`;
      summary += `Mobility Needs: ${clientProfile.mobilityNeeds || 'Not specified'}\n`;
      let wheelchairStatus = 'Not specified';
      if (clientProfile.wheelchairAccessible === true) {
        wheelchairStatus = 'Yes';
      } else if (clientProfile.wheelchairAccessible === false) {
        wheelchairStatus = 'No';
      }
      summary += `Wheelchair Accessible: ${wheelchairStatus}\n`;
      summary += `Specific Demands: ${clientProfile.specificDemands || 'Not specified'}\n`;
    } else {
      summary += 'No client profile information was gathered.\n';
    }

    summary += '\n--- FINAL RECOMMENDATIONS ---\n';
    if (recommendations.length > 0) {
      recommendations.forEach((rec, index) => {
        summary += `${index + 1}. ${rec.name}\n`;
        summary += `   - Reason: ${rec.reason}\n`;
        summary += `   - Price: ${rec.price}\n`;
        summary += `   - Address: ${rec.address}\n`;
        summary += `   - Description: ${rec.description}\n`;
        summary += `   - Care Levels: ${rec.careLevels?.join(', ')}\n`;
        summary += `   - Key Amenities: ${rec.amenities?.join(', ')}\n\n`;
      });
    } else {
      summary += 'No final recommendations were provided.\n';
    }
    
    return summary;
  };

  const handleSaveSummary = async () => {
    const text = generateSummaryText();
    setSummaryText(text);
    setIsSummaryModalOpen(true);
    // History is now managed by CRM, but we can keep a temporary session history if needed.
    // For now, saving to local state for viewing purposes.
    const newSummary: CallSummary = { date: new Date().toISOString(), summary: text };
    setHistory(prev => [newSummary, ...prev]);
  };
  
  const handleCloseSummaryModal = () => {
    setIsSummaryModalOpen(false);
    setSummaryText('');
  };

  const handleViewHistorySummary = (summary: string) => {
    setSummaryText(summary);
    setIsSummaryModalOpen(true);
  };

  const handleOpenComparisonModal = (selectedCommunities: Community[]) => {
    setCommunitiesToCompare(selectedCommunities);
    setIsComparisonModalOpen(true);
  };
  const handleCloseComparisonModal = () => setIsComparisonModalOpen(false);

  const handlePushToGoogleSheet = async () => {
    try {
      // Validate that we have data to push
      if (!clientProfile || Object.keys(clientProfile).length === 0) {
        alert('Error: No client profile data available. Please gather client information first.');
        return;
      }

      if (!recommendations || recommendations.length === 0) {
        alert('Error: No recommendations available. Please generate recommendations first.');
        return;
      }

      const summary = generateSummaryText();

      // Format recommendations to include required ranking structure for Google Sheets
      const formattedRecommendations = recommendations.map((rec, index) => ({
        name: rec.name,
        reason: rec.reason,
        price: rec.price,
        address: rec.address,
        description: rec.description,
        careLevels: rec.careLevels,
        amenities: rec.amenities,
        // Add required ranking structure for Google Sheets compatibility
        final_rank: index + 1,
        community_id: `live_call_${index + 1}`,
        combined_rank_score: (index + 1) * 10, // Simple ranking for live calls
        key_metrics: {
          monthly_fee: rec.price ? parseInt(rec.price.replace(/[^0-9]/g, '')) || 0 : 0,
          distance_miles: 0, // Not available in live calls
          est_waitlist: 'Available',
          care_level: rec.careLevels?.[0] || '',
          zip_code: rec.address?.replace(/\D/g, '') || undefined,
        },
        rankings: {
          business_rank: null,
          total_cost_rank: null,
          distance_rank: null,
          availability_rank: null,
          budget_efficiency_rank: null,
          couple_rank: null,
          amenity_rank: null,
          holistic_rank: index + 1,
        },
        explanations: {
          business_reason: null,
          total_cost_reason: null,
          distance_reason: null,
          availability_reason: null,
          budget_efficiency_reason: null,
          couple_reason: null,
          amenity_reason: null,
          holistic_reason: rec.reason || 'Recommended based on client requirements'
        }
      }));

      const payload = {
        clientProfile,
        recommendations: formattedRecommendations,
        summary
      };

      console.log('Pushing to Google Sheets:', payload);

      const response = await fetch(`${API_BASE_URL}/api/update-crm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Successfully pushed to Google Sheet! Consultation ID: ${result.consultation_id}`);
      } else {
        const errorText = await response.text();
        console.error('Google Sheets push failed:', errorText);
        alert(`Error: Failed to push to Google Sheet. ${errorText}`);
      }
    } catch (error) {
      console.error('Error pushing to Google Sheet:', error);
      const hint =
        error instanceof TypeError
          ? `\nPlease confirm the backend server at ${API_BASE_URL || 'http://localhost:5050'} is running and reachable.`
          : '';
      const message = error instanceof Error ? error.message : String(error);
      alert(`Error pushing to Google Sheet: ${message}${hint}`);
    }
  };

  const handleSendEmailToClient = () => {
    setShowClientEmailModal(true);
  };

  const handleSendEmailToManager = () => {
    setShowManagerEmailModal(true);
  };

  const handleOpenFeedbackModal = () => setIsFeedbackModalOpen(true);
  const handleCloseFeedbackModal = () => setIsFeedbackModalOpen(false);

  const handleCloseClientEmailModal = () => setShowClientEmailModal(false);
  const handleCloseManagerEmailModal = () => setShowManagerEmailModal(false);

  const handleManualProfileSave = async (profile: ClientProfile) => {
    // Update client profile with manually entered data
    setClientProfile(profile);

    // Generate recommendations based on the manual profile
    try {
      // Create a simple text description from the profile for the backend
      const profileText = `
Client Name: ${profile.name || 'Unknown'}
Budget: ${profile.budget || 'Not specified'}
Location: ${profile.location || 'Not specified'}
Care Level: ${profile.careLevel || 'Not specified'}
Timeline: ${profile.timeline || 'Not specified'}
Mobility Needs: ${profile.mobilityNeeds || 'Not specified'}
Wheelchair Accessible: ${profile.wheelchairAccessible ? 'Yes' : 'No'}
Specific Demands: ${profile.specificDemands || 'None'}
      `.trim();

      const response = await fetch(`${API_BASE_URL}/api/process-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: profileText,
          language: 'english',
          push_to_crm: autoPushToSheet  // Use toggle state
        })
      });

      if (response.ok) {
        const result = await response.json();
        handleAnalysisResults(result);
        alert('Profile saved and recommendations generated!');
      } else {
        const errorText = await response.text();
        alert(`Error generating recommendations: ${errorText}`);
      }
    } catch (error) {
      console.error('Error generating recommendations:', error);
      alert('Failed to generate recommendations. Please check your backend connection.');
    }
  };

  const generateClientEmailContent = () => {
    const summary = generateSummaryText();
    const clientName = clientProfile.name || 'Valued Client';

    return `Subject: Summary of Our Recent Call & Senior Living Recommendations

Dear ${clientName},

Thank you for speaking with me about your senior living needs. Here's a summary of our conversation and the recommendations I prepared for you:

${summary}

If any of the information we discussed has changed, or if you need me to explore additional options, please don't hesitate to reply to this email. I'm here to help you find the perfect senior living community.

Best regards,
${currentUser.name}
${currentUser.title}`;
  };

  const generateManagerEmailContent = () => {
    const summary = generateSummaryText();
    const clientName = clientProfile.name || 'Unknown Client';

    return `Subject: Review Request - Consultation with ${clientName}

Dear Manager,

Please review the following consultation summary:

Client: ${clientName}
Consultation Summary:
${summary}

Is anything else I need to edit or follow up on?

Best regards,
${currentUser.name}`;
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert('Email content copied to clipboard!');
    } catch (error) {
      console.warn('[Clipboard] Falling back to legacy copy handler:', error);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      alert('Email content copied to clipboard!');
    }
  };


  const handleStartCall = useCallback(async () => {
    resetState();
    setIsCallPaused(false);
    isCallPausedRef.current = false;
    setCallStatus(CallStatus.CONNECTING);

    try {
      // Use Gemini SDK directly like Google Studio
      // Try multiple sources for API key
      const apiKey =
        (import.meta.env.VITE_GEMINI_API_KEY || '').trim() ||
        window.GEMINI_API_KEY ||
        (document.querySelector('meta[name="gemini-api-key"]') as HTMLMetaElement)?.content;
      
      if (!apiKey) {
        throw new Error("API key not available");
      }
      
      // Debug: Show masked API key (first 10 chars + last 4 chars)
      const maskedKey = apiKey.length > 14 
        ? `${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`
        : '***';
      if (DEBUG) {
        console.log('[DEBUG] API Key loaded:', maskedKey);
        console.log('[DEBUG] API Key source:', 
          import.meta.env.VITE_GEMINI_API_KEY ? 'VITE_GEMINI_API_KEY' :
          window.GEMINI_API_KEY ? 'window.GEMINI_API_KEY' :
          'meta tag');
        console.log('[DEBUG] Creating GoogleGenAI client...');
      }
      const ai = new GoogleGenAI({ apiKey });
      
      // Request microphone access
      if (DEBUG) console.log('[DEBUG] Requesting microphone access...');
      const baseAudioConstraints: EnhancedMediaTrackConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        channelCount: 1,
        sampleRate: 16000,
      };
      const supportedConstraints = navigator.mediaDevices.getSupportedConstraints() as MediaTrackSupportedConstraintsWithVoiceIsolation;
      if (supportedConstraints.voiceIsolation) {
        baseAudioConstraints.voiceIsolation = true;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: baseAudioConstraints,
      });
      mediaStreamRef.current = stream;
      if (DEBUG) console.log('[DEBUG] Microphone access granted, stream active:', stream.active);
      const primaryTrack = stream.getAudioTracks()[0];
      if (primaryTrack?.applyConstraints) {
        try {
          await primaryTrack.applyConstraints({
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          });
        } catch (constraintError) {
          if (DEBUG) console.warn('[DEBUG] Unable to apply advanced audio constraints:', constraintError);
        }
      }

      // Create audio contexts
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) {
        throw new Error('Web Audio API not supported in this browser');
      }
      inputAudioContextRef.current = new AudioContextConstructor({ sampleRate: 16000 });
      outputAudioContextRef.current = new AudioContextConstructor({ sampleRate: 24000 });
      
      // Resume audio contexts if suspended (browser requirement)
      if (inputAudioContextRef.current.state === 'suspended') {
        if (DEBUG) console.log('[DEBUG] Resuming input audio context...');
        await inputAudioContextRef.current.resume();
      }
      if (outputAudioContextRef.current.state === 'suspended') {
        if (DEBUG) console.log('[DEBUG] Resuming output audio context...');
        await outputAudioContextRef.current.resume();
      }
      if (DEBUG) console.log('[DEBUG] Audio contexts ready. Input state:', inputAudioContextRef.current.state, 'Output state:', outputAudioContextRef.current.state);
      
      const systemInstruction = ACTIVE_AI_SYSTEM_INSTRUCTION;

      if (DEBUG) console.log(`[DEBUG] Configuring Gemini with language: ${selectedLanguage} (${geminiLanguageCodes[selectedLanguage]})`);

      // Store session object directly when promise resolves
      // --- FIX: robust session ref assignment with only one source of truth and no race issues ---
      // All session assignments/reads now use sessionRef.current reliably

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.0-flash-exp',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: selectedLanguage === 'en' ? 'Aoede' : selectedLanguage === 'hi' ? 'Sage' : 'Aoede',
              }
            },
          },
          tools: [{ functionDeclarations: [updateDashboardFunctionDeclaration] }],
          systemInstruction: systemInstruction,
        },
        callbacks: {
          onopen: async () => {
            if (DEBUG) console.log('[DEBUG] Session opened, setting up audio...');
            isSessionActiveRef.current = true;
            setCallStatus(CallStatus.ACTIVE);

            // Resolve session and store in sessionRef.current for all other accesses
            try {
              sessionRef.current = await sessionPromise as unknown as LiveSession;
              if (DEBUG) console.log('[DEBUG] Session stored and ready for audio');
            } catch (err) {
              if (DEBUG) console.error('[DEBUG] Error storing session:', err);
              isSessionActiveRef.current = false;
              return;
            }

            // Ensure audio context is running before building the graph
            for (let i = 0; inputAudioContextRef.current!.state !== 'running' && i < 3; i++) {
              try {
                if (DEBUG) console.log('[DEBUG] Attempting to resume suspended audio context...');
                await inputAudioContextRef.current!.resume();
                // Type assertion needed: TypeScript doesn't realize state can change after resume()
                if ((inputAudioContextRef.current!.state as AudioContextState) === 'running') break;
                await new Promise(res => setTimeout(res, 40));
              } catch (e) {
                if (DEBUG) console.error('[DEBUG] Could not resume audio context:', e);
              }
            }
            if (DEBUG) console.log('[DEBUG] Audio context state:', inputAudioContextRef.current!.state);

            // Setup audio node graph
            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(AUDIO_BUFFER_SIZE, 1, 1);
            processorRef.current = scriptProcessor;

            const highPassFilter = inputAudioContextRef.current!.createBiquadFilter();
            highPassFilter.type = 'highpass';
            highPassFilter.frequency.value = 120;
            const dynamicsCompressor = inputAudioContextRef.current!.createDynamicsCompressor();
            dynamicsCompressor.threshold.value = -50;
            dynamicsCompressor.knee.value = 32;
            dynamicsCompressor.ratio.value = 12;
            dynamicsCompressor.attack.value = 0.003;
            dynamicsCompressor.release.value = 0.25;
            const outputGain = inputAudioContextRef.current!.createGain();
            outputGain.gain.value = 0;

            let audioChunkCount = 0;
            let lastAudioChunkTime = Date.now();
            let firstChunkReceived = false;
            let audioCheckTimeout: NodeJS.Timeout | null = null;

            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              if (!firstChunkReceived && audioCheckTimeout) {
                clearTimeout(audioCheckTimeout);
                audioCheckTimeout = null;
              }
              lastAudioChunkTime = Date.now();

              if (!isSessionActiveRef.current) return;

              // Always get session from ref
              const session = sessionRef.current;
              if (!session) {
                if (audioChunkCount === 0) {
                  if (DEBUG) console.warn('[DEBUG] ⚠️ Audio chunk arrived but session not ready yet');
                }
                return;
              }
              const inputBuffer = audioProcessingEvent.inputBuffer;
              const inputData = inputBuffer.getChannelData(0);

              if (!firstChunkReceived) {
                firstChunkReceived = true;
                if (DEBUG) {
                  console.log('[DEBUG] 🎤 ✅ FIRST AUDIO CHUNK RECEIVED!');
                  console.log('[DEBUG] 🎤 First audio chunk - inputBuffer sampleRate:', inputBuffer.sampleRate);
                  console.log('[DEBUG] 🎤 First audio chunk - inputBuffer length:', inputBuffer.length);
                  console.log('[DEBUG] 🎤 First audio chunk - inputData length:', inputData.length);
                  console.log('[DEBUG] 🎤 First audio chunk - inputData sample:', inputData[0]);
                  console.log('[DEBUG] ✅ ScriptProcessorNode is firing! Audio capture is working.');
                }
              }

              let sumSquares = 0;
              let maxSample = 0;
              for (let i = 0; i < inputData.length; i++) {
                const sample = inputData[i];
                const abs = Math.abs(sample);
                sumSquares += sample * sample;
                if (abs > maxSample) maxSample = abs;
              }
              const rmsLevel = Math.sqrt(sumSquares / inputData.length);
              const noiseProfile = noiseProfileRef.current;
              noiseProfile.floor = Math.max(
                MIN_SPEECH_THRESHOLD / 4,
                (noiseProfile.floor * 0.98) + (rmsLevel * 0.02)
              );
              const threshold = Math.max(noiseProfile.floor * 4.5, MIN_SPEECH_THRESHOLD);
              const isSpeech = rmsLevel > threshold;
              const tracker = silenceTrackerRef.current;
              const now = Date.now();

              if (isSpeech) {
                tracker.lastAudioTime = now;
                tracker.silenceStart = 0;
                tracker.turnEnded = false;
                tracker.turnEndedAt = 0;
                noiseProfile.lastSpeechTs = now;
              } else if (tracker.lastAudioTime && !tracker.silenceStart) {
                tracker.silenceStart = now;
              }

              audioChunkCount++;
              if (audioChunkCount === 1) {
                if (DEBUG) console.log('[DEBUG] ✅ First audio chunk processed! Audio capture is working.');
              }
              if (audioChunkCount % 100 === 0) {
                if (DEBUG) console.log(`[DEBUG] Audio RMS: ${rmsLevel.toFixed(5)}, threshold: ${threshold.toFixed(5)}, chunks: ${audioChunkCount}`);
              }

              const pcmBlob = createBlob(inputData);

              const timeSinceLastAudio = tracker.lastAudioTime ? (now - tracker.lastAudioTime) : Infinity;
              const silenceDuration = tracker.silenceStart ? (now - tracker.silenceStart) : 0;

              const shouldEndTurn = !isSpeech && tracker.silenceStart && silenceDuration > END_TURN_SILENCE_MS;
              const timeSinceTurnEnded = tracker.turnEnded ? (now - tracker.turnEndedAt) : Infinity;
              const shouldSendEndOfTurn = shouldEndTurn && (!tracker.turnEnded || timeSinceTurnEnded < END_TURN_CONFIRMATION_MS);

              const CONTINUE_AUDIO_AFTER_TURN_MS = 800;
              const shouldContinueAfterTurn = tracker.turnEnded && timeSinceTurnEnded < CONTINUE_AUDIO_AFTER_TURN_MS;
              const shouldSendEndOfTurnDuringContinuation = shouldContinueAfterTurn && timeSinceTurnEnded < END_TURN_CONFIRMATION_MS;

              if (shouldEndTurn && !tracker.turnEnded) {
                tracker.turnEnded = true;
                tracker.turnEndedAt = now;
                if (audioChunkCount % 20 === 0) {
                  if (DEBUG) console.log(`[DEBUG] 🎯 Ending turn - silence duration: ${silenceDuration}ms`);
                }
              }

              const shouldSendAudio =
                isSpeech ||
                timeSinceLastAudio < MAX_SILENCE_BEFORE_DROP ||
                shouldSendEndOfTurn ||
                shouldContinueAfterTurn;

              if (!shouldSendAudio) {
                if (audioChunkCount % 200 === 0) {
                  if (DEBUG) console.log('[DEBUG] ⏸️ Skipping gated audio chunk (silence maintained)');
                }
                return;
              }

              try {
                const shouldSendEndOfTurnNow = shouldSendEndOfTurn || shouldSendEndOfTurnDuringContinuation;
                session.sendRealtimeInput({
                  media: pcmBlob,
                  ...(shouldSendEndOfTurnNow ? { endOfTurn: true } : {})
                });
              } catch (error: unknown) {
                const err = error as { message?: string };
                if (err?.message?.includes('CLOSING') || err?.message?.includes('CLOSED')) {
                  if (DEBUG) console.warn('[DEBUG] Session closed while sending audio');
                  isSessionActiveRef.current = false;
                  return;
                }
                if (DEBUG) {
                  console.error('[DEBUG] Could not send audio:', error);
                  console.error('[DEBUG] Error details:', err?.message);
                }
              }
            };

            source.connect(highPassFilter);
            highPassFilter.connect(dynamicsCompressor);
            dynamicsCompressor.connect(scriptProcessor);
            scriptProcessor.connect(outputGain);
            outputGain.connect(inputAudioContextRef.current!.destination);

            if (DEBUG) {
              console.log('[DEBUG] Audio graph connected: source -> HPF -> compressor -> processor -> gain(0) -> destination');
              console.log('[DEBUG] Audio context state after connect:', inputAudioContextRef.current!.state);
            }

            if (inputAudioContextRef.current!.state !== 'running') {
              if (DEBUG) console.error('[DEBUG] ❌ Audio context still not running after connect!');
              try {
                await inputAudioContextRef.current!.resume();
                await new Promise(resolve => setTimeout(resolve, 100));
                if (DEBUG) console.log('[DEBUG] Audio context state after final resume:', inputAudioContextRef.current!.state);
              } catch (e) {
                console.error('[DEBUG] Failed to resume audio context:', e);
              }
            }

            audioCheckTimeout = setTimeout(() => {
              if (!firstChunkReceived) {
                if (DEBUG) {
                  console.error('[DEBUG] ❌ ERROR: ScriptProcessorNode did not fire within 2 seconds!');
                  const track = stream.getAudioTracks()[0];
                  if (track) {
                    console.error('[DEBUG] Track enabled:', track.enabled);
                    console.error('[DEBUG] Track muted:', track.muted);
                    console.error('[DEBUG] Track readyState:', track.readyState);
                  }
                }
              }
            }, 2000);

            const track = stream.getAudioTracks()[0];
            if (DEBUG) {
              console.log('[DEBUG] Audio processing ready. Stream tracks:', stream.getAudioTracks().length);
              console.log('[DEBUG] Audio track settings:', track?.getSettings());
              console.log('[DEBUG] Audio track enabled:', track?.enabled);
              console.log('[DEBUG] Audio track muted:', track?.muted);
              console.log('[DEBUG] Audio track readyState:', track?.readyState);
              console.log('[DEBUG] Using ScriptProcessorNode for audio capture');
              console.log('[DEBUG] Audio graph: source -> HPF -> compressor -> processor -> gain(0) -> destination');
              console.log('[DEBUG] ScriptProcessorNode inputs:', scriptProcessor.numberOfInputs);
              console.log('[DEBUG] ScriptProcessorNode outputs:', scriptProcessor.numberOfOutputs);
              console.log('[DEBUG] ScriptProcessorNode connected:', scriptProcessor.numberOfInputs > 0 && scriptProcessor.numberOfOutputs > 0);
            }

            if (track && DEBUG) {
              track.onmute = () => console.warn('[DEBUG] ⚠️ Audio track muted!');
              track.onunmute = () => console.log('[DEBUG] ✅ Audio track unmuted');
            }

            // Initial test chunk and keep-alive loop
            const sendInitialChunk = async () => {
              let attempts = 0;
              while (!sessionRef.current && attempts < 20) {
                await new Promise(resolve => setTimeout(resolve, 10));
                attempts++;
              }
              const session = sessionRef.current;
              if (!session) {
                if (DEBUG) console.error('[DEBUG] ❌ Session not available after 200ms - WebSocket may close');
                return;
              }

              try {
                const testData = new Float32Array(4096).fill(0);
                const testBlob = createBlob(testData);
                session.sendRealtimeInput({ media: testBlob });
                if (DEBUG) console.log('[DEBUG] ✅ Initial test chunk sent successfully');

                const keepAliveInterval = setInterval(() => {
                  const currentSession = sessionRef.current;
                  if (!currentSession || !isSessionActiveRef.current) {
                    clearInterval(keepAliveInterval);
                    return;
                  }
                  if (audioChunkCount > 10) {
                    clearInterval(keepAliveInterval);
                    if (DEBUG) console.log('[DEBUG] Keep-alive stopped - real audio is flowing');
                    return;
                  }
                  try {
                    const keepAliveData = new Float32Array(4096).fill(0);
                    const keepAliveBlob = createBlob(keepAliveData);
                    currentSession.sendRealtimeInput({ media: keepAliveBlob });
                  } catch (e: unknown) {
                    const err = e as { message?: string };
                    if (err?.message?.includes('CLOSING') || err?.message?.includes('CLOSED')) {
                      clearInterval(keepAliveInterval);
                      return;
                    }
                    if (DEBUG) console.warn('[DEBUG] Keep-alive chunk failed:', err?.message);
                  }
                }, 50);

                window.__keepAliveInterval = keepAliveInterval as unknown as number;
              } catch (e: unknown) {
                const err = e as { message?: string; stack?: string };
                console.error('[DEBUG] Failed to send initial chunk:', e);
                if (err?.message?.includes('CLOSING') || err?.message?.includes('CLOSED')) {
                  console.error('[DEBUG] WebSocket already closing - connection failed');
                } else {
                  console.error('[DEBUG] Error details:', err?.message, err?.stack);
                }
              }
            };
            sendInitialChunk();

            setTimeout(() => {
              const timeSinceLastChunk = Date.now() - lastAudioChunkTime;
              if (audioChunkCount === 0 || timeSinceLastChunk > 2000) {
                if (DEBUG) {
                  console.error('[DEBUG] ❌ ERROR: No audio chunks processed!');
                  console.error('[DEBUG] Audio chunks processed:', audioChunkCount);
                  console.error('[DEBUG] Time since last chunk:', timeSinceLastChunk, 'ms');
                  console.error('[DEBUG] Audio context state:', inputAudioContextRef.current!.state);
                  console.error('[DEBUG] Stream active:', stream.active);
                  const tracks = stream.getAudioTracks();
                  console.error('[DEBUG] Stream tracks:', tracks.map(t => ({
                    enabled: t.enabled,
                    muted: t.muted,
                    readyState: t.readyState,
                    label: t.label
                  })));
                  console.error('[DEBUG] ScriptProcessorNode connected:', scriptProcessor.numberOfInputs, 'inputs,', scriptProcessor.numberOfOutputs, 'outputs');
                }
                if (inputAudioContextRef.current!.state === 'suspended') {
                  console.log('[DEBUG] Attempting to resume audio context...');
                  inputAudioContextRef.current!.resume().then(() => {
                    console.log('[DEBUG] Audio context resumed');
                  }).catch((e) => {
                    console.error('[DEBUG] Failed to resume audio context:', e);
                  });
                }
                console.log('[DEBUG] Setting up fallback: sending test chunks every 100ms...');
                const fallbackInterval = setInterval(() => {
                  if (!isSessionActiveRef.current || !sessionRef.current) {
                    clearInterval(fallbackInterval);
                    return;
                  }
                  try {
                    const testData = new Float32Array(4096).fill(0);
                    const testBlob = createBlob(testData);
                    sessionRef.current.sendRealtimeInput({ media: testBlob });
                    if (audioChunkCount === 0) {
                      if (DEBUG) console.log('[DEBUG] Fallback chunk sent (ScriptProcessorNode not firing)');
                    }
                  } catch (e) {
                    if (DEBUG) console.error('[DEBUG] Fallback chunk failed:', e);
                    clearInterval(fallbackInterval);
                  }
                }, 100);

                window.__audioFallbackInterval = fallbackInterval as unknown as number;
              } else {
                if (DEBUG) {
                  console.log(`[DEBUG] ✅ Audio capture confirmed - processed ${audioChunkCount} chunks`);
                  console.log(`[DEBUG] ✅ Last chunk received ${timeSinceLastChunk}ms ago`);
                }
              }
            }, 1000);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (isCallPausedRef.current) {
              if (DEBUG) console.log('[DEBUG] ⏸️ Call is paused, ignoring message');
              return;
            }
            if (message.setupComplete) {
              if (DEBUG) console.log('[DEBUG] ✅ Setup complete! Session is ready for conversation.');
            }

            if (message.toolCall?.functionCalls) {
              // Show thinking indicator while processing function calls
              setIsAiThinking(true);
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'updateDashboard' && fc.args) {
                  const {
                    clientProfile: newProfile,
                    suggestedQuestions: newQuestions,
                    communityRecommendations: newRecs,
                    agentGuidance: newGuidance,
                  } = fc.args as UpdateDashboardArgs;

                  if (newProfile) {
                    const normalized = normalizeClientProfile(newProfile);
                    if (Object.keys(normalized).length) {
                      setClientProfile(prev => ({ ...prev, ...normalized }));
                    }
                  }
                  if (newQuestions) {
                    setSuggestedQuestions(newQuestions);
                  }
                  if (newRecs) {
                    // Filter and map to ensure all required fields are present
                    const validRecs: Recommendation[] = newRecs
                      .filter(rec => rec.name) // Only keep recommendations with a name
                      .map(rec => ({
                        name: rec.name!,
                        reason: rec.reason || 'Recommended based on your needs',
                        price: rec.price,
                        careLevels: rec.careLevels,
                        amenities: rec.amenities,
                        address: rec.address,
                        description: rec.description,
                      }));
                    // Only update if we actually received recs; avoid wiping existing list with empty payloads
                    if (validRecs.length) {
                      setRecommendations(validRecs);
                    }
                  }
                  if (newGuidance) {
                    setAgentGuidance(newGuidance);
                  }
                  handleAnalysisResults({
                    client_info: newProfile,
                    recommendations: Array.isArray(newRecs) ? newRecs.map((rec, index) => ({
                      community_name: rec.name || `Community ${index + 1}`,
                      final_rank: index + 1,
                      combined_rank_score: 0,
                      key_metrics: {
                        monthly_fee: rec.key_metrics?.monthly_fee,
                        distance_miles: rec.key_metrics?.distance_miles,
                        est_waitlist: rec.key_metrics?.est_waitlist,
                        care_level: rec.key_metrics?.care_level ?? rec.careLevels?.[0],
                        zip_code: rec.key_metrics?.zip_code || rec.address?.replace(/\D/g, '') || undefined,
                      },
                      explanations: rec.explanations ?? { holistic_reason: rec.reason },
                      rankings: rec.rankings ?? {},
                    })) : [],
                    performance_metrics: undefined
                  }, 'live');

                  if (sessionRef.current) {
                    try {
                      sessionRef.current.sendToolResponse({
                        functionResponses: [{
                          id: fc.id || 'tool-response-1',
                          name: fc.name || 'updateDashboard',
                          response: { result: "Dashboard updated successfully." }
                        }]
                      });
                    } catch (error) {
                      if (DEBUG) console.debug('[DEBUG] Could not send tool response:', error);
                    }
                  }
                }
              }
              // Hide thinking indicator after all function calls processed
              setIsAiThinking(false);
            }
            // User (client) transcription - just pass through, Google sends accumulated text
            if (message.serverContent?.inputTranscription?.text) {
              const rawText = message.serverContent.inputTranscription.text;
              if (typeof rawText === 'string' && rawText.length > 0) {
                updateTranscriptionEntry('user', rawText);
              }
            }
            // Assistant (model) transcription - just pass through, Google sends accumulated text
            if (message.serverContent?.outputTranscription?.text) {
              const rawText = message.serverContent.outputTranscription.text;
              if (typeof rawText === 'string' && rawText.length > 0) {
                updateTranscriptionEntry('model', rawText);
              }
            }
            if (message.serverContent?.generationComplete) {
              // No action needed
            }
            if (message.serverContent?.turnComplete) {
              // No action needed
            }
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (!isAiMutedRef.current && base64Audio && outputAudioContextRef.current) {
              const outputAudioContext = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioContext.currentTime);

              const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContext, 24000, 1);

              const source = outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputAudioContext.destination);

              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
              });

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              for (const source of sourcesRef.current.values()) {
                source.stop();
                sourcesRef.current.delete(source);
              }
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            if (DEBUG) {
              console.error('[DEBUG] ❌ Session error:', e);
              console.error('[DEBUG] Error type:', e.type);
              console.error('[DEBUG] Error message:', e.message);
              console.error('[DEBUG] Error details:', JSON.stringify(e, null, 2));
            }
            isSessionActiveRef.current = false;
            setCallStatus(CallStatus.ERROR);
            alert(`Session error: ${e.message || 'Unknown error'}`);
            handleEndCall();
          },
          onclose: (event?: CloseEvent) => {
            if (DEBUG) console.log('[DEBUG] Session closed.');
            isSessionActiveRef.current = false;

            if (event) {
              if (event.code !== undefined) {
                if (DEBUG) {
                  console.log('[DEBUG] Close code:', event.code);
                  console.log('[DEBUG] Close reason:', event.reason || 'No reason provided');
                  console.log('[DEBUG] Was clean:', event.wasClean);
                }

                if (event.code !== 1000 && event.code !== 1001) {
                  if (DEBUG) console.error('[DEBUG] ❌ Abnormal WebSocket closure! Code:', event.code, 'Reason:', event.reason);
                  setCallStatus(CallStatus.ERROR);
                } else {
                  if (DEBUG) console.log('[DEBUG] Normal WebSocket closure');
                  setCallStatus(CallStatus.IDLE);
                }
              } else {
                if (DEBUG) console.log('[DEBUG] Close event:', event);
                setCallStatus(CallStatus.IDLE);
              }
            } else {
              setCallStatus(CallStatus.IDLE);
            }

            if (window.__keepAliveInterval) {
              clearInterval(window.__keepAliveInterval);
              window.__keepAliveInterval = null;
            }
          },
        },
      }) as unknown as Promise<LiveSession>;
      if (DEBUG) console.log('[DEBUG] Session promise created, waiting for connection...');

      sessionPromise.then((session) => {
        if (!sessionRef.current) {
          sessionRef.current = session;
          if (DEBUG) console.log('[DEBUG] Session stored from promise resolution');
        }
      }).catch((err) => {
        if (DEBUG) console.error('[DEBUG] Session promise rejected:', err);
        isSessionActiveRef.current = false;
        setCallStatus(CallStatus.ERROR);
      });
      
      // Wait for promise to resolve (but don't block onopen callback)
      await sessionPromise;
      if (DEBUG) console.log('[DEBUG] Session promise resolved');
    } catch (error) {
      if (DEBUG) console.error('[DEBUG] Failed to start call:', error);
      setCallStatus(CallStatus.ERROR);
      alert(`Failed to start call: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [
    ACTIVE_AI_SYSTEM_INSTRUCTION,
    selectedLanguage,
    geminiLanguageCodes,
    resetState,
    updateTranscriptionEntry,
  ]);


  const handleEndCall = useCallback((setIdleOnEnd = true) => {
    // Mark session as inactive FIRST to prevent new sends
    isSessionActiveRef.current = false;
    
    // Disconnect processor to stop audio processing before closing session
    if(processorRef.current) {
        try {
          if ('port' in processorRef.current && processorRef.current.port) {
            processorRef.current.port.close();
          }
          if ('disconnect' in processorRef.current) {
            processorRef.current.disconnect();
          }
        } catch {
          // Ignore errors when disconnecting
        }
        processorRef.current = null;
    }
    
    // Clear audio processing interval
    if (audioIntervalRef.current !== null) {
      clearInterval(audioIntervalRef.current);
      audioIntervalRef.current = null;
    }
    
    // Clear fallback interval if it exists
    if (window.__audioFallbackInterval) {
      clearInterval(window.__audioFallbackInterval);
      window.__audioFallbackInterval = null;
    }
    
    // Clear keep-alive interval if it exists
    if (window.__keepAliveInterval) {
      clearInterval(window.__keepAliveInterval);
      window.__keepAliveInterval = null;
    }
    
    // Then close the session
    if (sessionRef.current) {
      try {
        sessionRef.current.close();
      } catch (error) {
        // Session might already be closed, ignore
        if (DEBUG) console.debug('[DEBUG] Session already closed:', error);
      }
      sessionRef.current = null;
    }
    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }
    if(mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
    }
    sourcesRef.current.forEach(source => source.stop());
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    
    setIsCallPaused(false);
    isCallPausedRef.current = false;
    setIsAiThinking(false);
    
    resetAudioTracking();
    resetTranscriptionTracking();
    
    if (setIdleOnEnd) {
      setCallStatus(CallStatus.IDLE);
    }
  }, [resetAudioTracking, resetTranscriptionTracking]);
  
  const handleTogglePause = useCallback(() => {
    if (callStatus !== CallStatus.ACTIVE) return;

    const newPausedState = !isCallPausedRef.current;
    isCallPausedRef.current = newPausedState;
    setIsCallPaused(newPausedState);

    if (newPausedState) {
        // When pausing, stop any currently playing AI audio.
        if (outputAudioContextRef.current) {
            sourcesRef.current.forEach(source => source.stop());
            sourcesRef.current.clear();
            nextStartTimeRef.current = 0;
        }
    }
  }, [callStatus]);

  const handleToggleMute = useCallback(() => {
    if (callStatus !== CallStatus.ACTIVE) return;
    const newMode = !isAiMuted;
    setIsAiMuted(newMode);
    isAiMutedRef.current = newMode;
    if (newMode) {
      // stop any audio currently playing
      if (outputAudioContextRef.current) {
        sourcesRef.current.forEach(source => source.stop());
        sourcesRef.current.clear();
        nextStartTimeRef.current = 0;
      }
    }
  }, [callStatus, isAiMuted]);

  const handleOpenCommunityModal = (community: Community | null) => {
    setCommunityToEdit(community);
    setIsCommunityModalOpen(true);
  }

  const handleCloseCommunityModal = () => {
    setCommunityToEdit(null);
    setIsCommunityModalOpen(false);
  }

  const handleSaveCommunity = async (communityData: Omit<Community, 'id'>) => {
    const url = communityToEdit ? `${API_BASE_URL}/api/communities/${communityToEdit.id}` : `${API_BASE_URL}/api/communities`;
    const method = communityToEdit ? 'PUT' : 'POST';
    
    // Map frontend Community type to backend Excel format
    const backendData = {
        "Name": communityData.name,
        "Care Level": communityData.careLevels[0],
        "Monthly Fee": communityData.basePrice,
        "ZIP": communityData.location.replace('ZIP ', ''),
        "Work with Placement?": communityData.isPartner,
        "Est. Waitlist Length": communityData.availability,
    };

    try {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(backendData)
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to save community');
        }
        await fetchCommunities(); // Refresh data
        handleCloseCommunityModal();
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        alert(`Error saving community: ${message}`);
    }
  };
  
  const handleDeleteCommunity = async (communityId: number) => {
    if(window.confirm(`Are you sure you want to delete community #${communityId}? This action cannot be undone.`)) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/communities/${communityId}`, { method: 'DELETE' });
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to delete community');
            }
            await fetchCommunities(); // Refresh data
        } catch (error) {
             const message = error instanceof Error ? error.message : 'Unknown error';
             alert(`Error deleting community: ${message}`);
        }
    }
  };

  // Password validation handler
  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const correctPassword = import.meta.env.VITE_APP_PASSWORD || 'Shivam@9654';
    
    if (passwordInput === correctPassword) {
      setIsAuthenticated(true);
      setPasswordError(false);
      setPasswordInput('');
    } else {
      setPasswordError(true);
      setTimeout(() => setPasswordError(false), 3000);
    }
  };

  // Password screen - shows first
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#F8F7F2] via-white to-[#e3ecff] flex items-center justify-center p-6">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
            {/* Lock Icon */}
            <div className="w-16 h-16 mx-auto mb-6 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            
            {/* Title */}
            <h2 className="text-2xl font-black text-gray-900 text-center mb-2">Access Required</h2>
            <p className="text-sm text-gray-600 text-center mb-6">Enter password to continue</p>
            
            {/* Password Form */}
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Enter password"
                  className={`w-full px-4 py-3 rounded-xl border-2 ${
                    passwordError 
                      ? 'border-red-400 bg-red-50' 
                      : 'border-gray-200 bg-gray-50'
                  } focus:outline-none focus:border-blue-500 focus:bg-white transition-all text-gray-900 placeholder-gray-400`}
                  autoFocus
                />
                {passwordError && (
                  <p className="mt-2 text-xs text-red-600 font-medium">Incorrect password. Please try again.</p>
                )}
              </div>
              
              <button
                type="submit"
                className="w-full py-3 px-6 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-semibold rounded-xl shadow-md hover:shadow-lg transition-all duration-200 transform hover:scale-105"
              >
                Unlock
              </button>
            </form>
            
            {/* Contact Section */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <p className="text-sm text-gray-600 text-center mb-3">Need access?</p>
              <p className="text-base font-semibold text-gray-900 text-center mb-4">Contact Shivam</p>
              <div className="flex justify-center gap-3">
                <a
                  href="https://www.linkedin.com/in/shivamsharma-ai/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#0A66C2] hover:bg-[#004182] text-white rounded-lg text-sm font-medium transition-all shadow-sm hover:shadow-md"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                  LinkedIn
                </a>
                <a
                  href="https://www.shivam.website/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-lg text-sm font-medium transition-all shadow-sm hover:shadow-md"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                  </svg>
                  Website
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!hasLaunchedAssistant || showVisionPanel) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#F8F7F2] via-white to-[#e3ecff]">
        <div className="max-w-6xl mx-auto px-6 py-12">
          {/* Header with Back Button */}
          {showVisionPanel && (
            <div className="mb-8">
              <button
                onClick={() => setShowVisionPanel(false)}
                className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-2 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to options
              </button>
            </div>
          )}

          {/* Hero Section - Project Focus */}
          <div className="text-center mb-12">
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black text-gray-900 tracking-tight mb-4">
              AI Senior Living<br />Placement Assistant
            </h1>
            <p className="text-xl sm:text-2xl text-gray-600 font-medium max-w-3xl mx-auto mb-8">
              AI‑Powered Client Intake and Community Matching System
            </p>
            {/* REMOVED: "Built by" section */}
          </div>

          {!showVisionPanel && (
            <>
              {/* Action Buttons Row - Perfectly Aligned */}
              <div className="max-w-5xl mx-auto">
                <div className="flex justify-center gap-4 my-8">
                  {/* Watch Product Walkthrough */}
                  <button
                    onClick={() => setShowVideoModal(true)}
                    className="group relative flex items-center justify-center gap-2 rounded-xl border-2 border-red-100 bg-white px-6 py-3 text-sm font-semibold text-red-600 hover:border-red-200 hover:bg-red-50 transition-all duration-200 shadow-md hover:shadow-lg w-64"
                  >
                    <svg className="w-5 h-5 text-red-500 group-hover:scale-110 transition-transform flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                    </svg>
                    <span>Watch Walkthrough</span>
                  </button>

                  {/* View Source Code */}
                  <a
                    href="https://github.com/Shivyyyy-git/AI-Sales-Assistant-NEW"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative flex items-center justify-center gap-2 rounded-xl border-2 border-slate-100 bg-white px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-200 hover:bg-slate-50 transition-all duration-200 shadow-md hover:shadow-lg w-64"
                  >
                    <svg className="w-5 h-5 text-slate-500 group-hover:text-slate-700 transition-colors flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                    <span>View Source Code</span>
                  </a>
                </div>
              </div>

              <div className="grid gap-5 md:grid-cols-2 max-w-5xl mx-auto items-stretch">
              {/* Primary Action Card - Launch Assistant */}
              <button
                onClick={() => {
                  setHasLaunchedAssistant(true);
                  setShowVisionPanel(false);
                }}
                className="group relative rounded-3xl border-2 border-blue-200 bg-white hover:shadow-2xl transition-all duration-400 p-9 text-left hover:-translate-y-1 cursor-pointer overflow-hidden h-full flex flex-col"
                style={{ animation: 'breath 3.6s ease-in-out infinite' }}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-indigo-50 opacity-90 group-hover:opacity-100 transition-opacity duration-400" />
                <div className="relative z-10 flex-1 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <span className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-700 text-[11px] font-semibold uppercase tracking-wide rounded-full border border-blue-200">
                    Live AI Workflow
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="cta-start-pill">
                      <span className="cta-start-pill__label">Start here</span>
                    </span>
                    <svg className="h-7 w-7 text-blue-600 group-hover:translate-x-1.5 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </div>
                </div>
                  <h2 className="text-2xl font-black text-gray-900 mb-2">Launch the AI Placement Assistant</h2>
                  <p className="text-gray-700 text-sm leading-relaxed">
                    Start a live consult. The AI steers the conversation, captures client needs in real time, and ranks matching communities.
                  </p>
                </div>
              </button>

              {/* Secondary Action Card - View Playbook */}
              <button
                onClick={() => setShowVisionPanel(true)}
                className="group rounded-3xl border border-gray-200 bg-white/95 backdrop-blur shadow-lg hover:shadow-2xl hover:border-gray-300 transition-all duration-400 p-9 text-left transform hover:-translate-y-0.5 cursor-pointer h-full flex flex-col"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="inline-flex items-center gap-2 px-3 py-1 bg-slate-50 text-slate-700 text-[11px] font-semibold uppercase tracking-wide rounded-full border border-slate-200">
                    Vision & Playbook
                  </span>
                  <svg className="h-7 w-7 text-gray-600 group-hover:translate-x-1.5 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </div>
                <h2 className="text-2xl font-black text-gray-900 mb-2">Product Vision & Playbook</h2>
                <p className="text-gray-700 text-sm leading-relaxed">
                  Explore the operating model, adoption guide, roadmap, and revenue strategy in one place—concise, actionable, and partner-first.
                </p>
              </button>
              </div>

              {/* NEW FOOTER: Credits */}
              <div className="mt-8 pt-6 border-t border-gray-200/60 text-center space-y-2">
                <div className="flex items-center justify-center gap-2 text-sm font-medium text-blue-600">
                  <span>Built by Shivam Sharma</span>
                  <a 
                    href="https://www.shivam.website/" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 transition-colors animate-pulse hover:animate-none"
                    title="Personal Website"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                  </a>
                  <a 
                    href="https://www.linkedin.com/in/shivamsharma-ai/" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 transition-colors animate-pulse hover:animate-none"
                    title="LinkedIn Profile"
                  >
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                    </svg>
                  </a>
                </div>
                <p className="text-gray-900 text-xs font-medium">
                  Faculty Advisor: Professor Elizabeth Mohr • Client Partner: Neil Russell, Culina Health
                </p>
              </div>
            </>
          )}

          {showVisionPanel && (
            <div className="min-h-screen">
              {/* Header Section - Elegant & Subtle */}
              <div className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-8">
                <div className="max-w-6xl mx-auto">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-2">Product Vision & Technical Documentation</h2>
                      <p className="text-gray-600 text-sm">Complete system architecture, workflow, and operational guidelines</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href="https://github.com/Shivyyyy-git/AI-Sales-Assistant-NEW"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 rounded-lg text-white text-xs font-semibold transition-all shadow-sm hover:shadow-md"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                        </svg>
                        GitHub
                      </a>
                      <a
                        href="https://docs.google.com/spreadsheets/d/1y3gAWKmK7wBOEZAPRistz1poyfvm9HFUMl1NzBaWQSY/edit?gid=911061880#gid=911061880"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-[#0F9D58] hover:bg-[#0c8547] rounded-lg text-white text-xs font-semibold transition-all shadow-sm hover:shadow-md"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <rect x="3" y="3" width="18" height="18" rx="2" fill="white"/>
                          <path d="M7 7h10M7 12h10M7 17h10M7 7v10M12 7v10M17 7v10" stroke="#0F9D58" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                        Google Sheets
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              {/* Full Page Content - No Dialog Box */}
              <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-12">
                {/* System Architecture - Elegant & Subtle */}
                <section className="bg-white rounded-xl p-8 border border-gray-200 shadow-md hover:shadow-lg transition-shadow duration-300">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center border border-gray-200">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">System Architecture</p>
                      <h3 className="text-2xl font-black text-gray-900">How Everything Connects</h3>
                    </div>
                  </div>
                  
                  {/* Professional Architecture Diagram - Elegant & Well-Connected */}
                  <div className="bg-gradient-to-br from-slate-50 to-gray-50 rounded-xl p-8 relative">
                    
                    <div className="grid grid-cols-4 gap-8 items-center max-w-5xl mx-auto relative">
                      
                      {/* Column 1: Inputs */}
                      <div className="space-y-3 relative">
                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider text-center mb-4">Inputs</h4>
                        
                        {/* PROMINENT Connecting line from Inputs to Gemini AI */}
                        <div className="absolute left-full top-1/2 w-8 h-1 bg-gray-800 transform -translate-y-1/2" style={{zIndex: 1}}></div>
                        
                        <div className="group bg-white rounded-lg p-3 shadow-sm border-2 border-gray-200 hover:border-blue-400 hover:shadow-md transition-all duration-300 relative">
                          <p className="text-sm font-semibold text-gray-800">Live Voice</p>
                          <p className="text-xs text-gray-500">Real-time bidirectional audio</p>
                        </div>
                        <div className="group bg-white rounded-lg p-3 shadow-sm border-2 border-gray-200 hover:border-blue-400 hover:shadow-md transition-all duration-300 relative">
                          <p className="text-sm font-semibold text-gray-800">Text Entry</p>
                          <p className="text-xs text-gray-500">Manual or paste transcripts</p>
                        </div>
                        <div className="group bg-white rounded-lg p-3 shadow-sm border-2 border-gray-200 hover:border-blue-400 hover:shadow-md transition-all duration-300 relative">
                          <p className="text-sm font-semibold text-gray-800">Audio File</p>
                          <p className="text-xs text-gray-500">Upload & transcribe</p>
                        </div>
                      </div>
                      
                      {/* Column 2: AI Processing */}
                      <div className="flex justify-center relative">
                        {/* PROMINENT Connecting line from Gemini AI to Ranking Engine */}
                        <div className="absolute left-full top-1/2 w-8 h-1 bg-gray-800 transform -translate-y-1/2" style={{zIndex: 1}}></div>
                        
                        <div className="group bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl p-6 shadow-md hover:shadow-lg text-white text-center relative w-full transform hover:scale-105 transition-all duration-300">
                          <div className="absolute inset-0 bg-white/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                          <div className="relative">
                            <div className="w-14 h-14 mx-auto mb-3 bg-white/10 rounded-xl flex items-center justify-center group-hover:bg-white/20 transition-all duration-300">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                              </svg>
                            </div>
                            <h4 className="font-black text-lg mb-1">Gemini AI</h4>
                            <p className="text-xs opacity-90 mb-3">Multi-modal Processing Engine</p>
                            <div className="flex flex-wrap gap-1.5 justify-center text-[10px]">
                              <span className="px-2 py-0.5 bg-white/15 rounded-full">Transcription</span>
                              <span className="px-2 py-0.5 bg-white/15 rounded-full">Extraction</span>
                              <span className="px-2 py-0.5 bg-white/15 rounded-full">Analysis</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Column 3: Business Logic */}
                      <div className="flex justify-center relative">
                        {/* PROMINENT Connecting line from Ranking Engine to Outputs */}
                        <div className="absolute left-full top-1/2 w-8 h-1 bg-gray-800 transform -translate-y-1/2" style={{zIndex: 1}}></div>
                        
                        <div className="group bg-white rounded-xl p-5 shadow-sm border-2 border-gray-200 hover:border-blue-400 hover:shadow-md w-full relative transform hover:scale-105 transition-all duration-300">
                          <div className="w-12 h-12 mx-auto mb-3 bg-blue-50 group-hover:bg-blue-100 rounded-xl flex items-center justify-center transition-colors duration-300">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                          </div>
                          <h4 className="font-bold text-gray-800 text-center text-sm mb-2">Ranking Engine</h4>
                          <div className="space-y-1.5 text-xs text-gray-600">
                            <p className="flex items-center gap-2"><span className="w-2 h-2 bg-blue-400 rounded-full"></span>Budget Match</p>
                            <p className="flex items-center gap-2"><span className="w-2 h-2 bg-blue-400 rounded-full"></span>Location Proximity</p>
                            <p className="flex items-center gap-2"><span className="w-2 h-2 bg-blue-400 rounded-full"></span>Care Level Fit</p>
                            <p className="flex items-center gap-2"><span className="w-2 h-2 bg-gray-400 rounded-full"></span>Partner Priority</p>
                          </div>
                        </div>
                      </div>
                      
                      {/* Column 4: Outputs */}
                      <div className="space-y-3">
                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider text-center mb-4">Outputs</h4>
                        <div className="group bg-white rounded-lg p-3 shadow-sm border-2 border-gray-200 hover:border-blue-400 hover:shadow-md transition-all duration-300">
                          <p className="text-sm font-semibold text-gray-800">Live Dashboard</p>
                          <p className="text-xs text-gray-500">Real-time UI updates</p>
                        </div>
                        <div className="group bg-white rounded-lg p-3 shadow-sm border-2 border-gray-200 hover:border-blue-400 hover:shadow-md transition-all duration-300">
                          <p className="text-sm font-semibold text-gray-800">CRM Export</p>
                          <p className="text-xs text-gray-500">Google Sheets integration</p>
                        </div>
                        <div className="group bg-white rounded-lg p-3 shadow-sm border-2 border-gray-200 hover:border-blue-400 hover:shadow-md transition-all duration-300">
                          <p className="text-sm font-semibold text-gray-800">Email Summary</p>
                          <p className="text-xs text-gray-500">Automated client recap</p>
                        </div>
                      </div>
                    </div>
                    
                    {/* Elegant Information Cards Below */}
                    <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-white rounded-lg p-5 border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all duration-300">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                          </div>
                          <h5 className="font-black text-gray-900 text-sm">Gemini AI Engine</h5>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed">Google's Gemini processes voice, text, and audio files with real-time transcription, natural language understanding, and structured data extraction. Supports English and Spanish with intelligent entity recognition.</p>
                      </div>
                      <div className="bg-white rounded-lg p-5 border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all duration-300">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                          </div>
                          <h5 className="font-black text-gray-900 text-sm">Smart Ranking Algorithm</h5>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed">Python-based scoring system rates communities (0-100) using weighted factors: budget compatibility, geographic distance via Google Maps API, care level requirements, and partner status with commission prioritization.</p>
                      </div>
                      <div className="bg-white rounded-lg p-5 border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all duration-300">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </div>
                          <h5 className="font-black text-gray-900 text-sm">Integrated CRM Export</h5>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed">One-click export to Google Sheets via Sheets API with formatted columns for client profile, ranked recommendations, partner badges, consultation timestamp, and unique session IDs for commission tracking and follow-up management.</p>
                      </div>
                    </div>
                  </div>
                </section>

                {/* User Journey - Elegant Timeline */}
                <section className="bg-white rounded-xl p-8 border border-gray-200 shadow-md hover:shadow-lg transition-shadow duration-300">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center border border-gray-200">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">User Journey</p>
                      <h3 className="text-2xl font-black text-gray-900">End-to-End Workflow</h3>
                    </div>
                  </div>
                  
                  {/* Clean 5-Step Process with Subtle Design */}
                  <div className="bg-gradient-to-br from-slate-50 to-gray-50 rounded-xl p-8">
                    <div className="relative max-w-5xl mx-auto">
                      {/* Subtle Connection Line */}
                      <div className="hidden lg:block absolute top-12 left-0 right-0 h-1 bg-gray-300 opacity-40"></div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-6 relative">
                        {[
                          { num: 1, title: 'Start', desc: 'Select input method' },
                          { num: 2, title: 'Capture', desc: 'Client data input' },
                          { num: 3, title: 'Process', desc: 'AI extracts info' },
                          { num: 4, title: 'Rank', desc: 'Match communities' },
                          { num: 5, title: 'Action', desc: 'Export results' }
                        ].map((step, idx) => (
                          <div key={idx} className="flex flex-col items-center text-center">
                            <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md flex items-center justify-center mb-4 transform hover:scale-105 hover:shadow-lg transition-all duration-300">
                              <span className="text-white font-black text-3xl">{step.num}</span>
                            </div>
                            <h4 className="font-black text-gray-900 text-base mb-1">{step.title}</h4>
                            <p className="text-xs text-gray-600">{step.desc}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {/* Detailed Description Below */}
                    <div className="mt-8 bg-white rounded-lg p-5 border border-gray-200">
                      <p className="text-sm text-gray-700 leading-relaxed">
                        The system guides users through a <strong className="text-gray-900">five-step workflow</strong>: 
                        <span className="text-gray-800"> (1)</span> Choose input method (live voice, text, or audio file), 
                        <span className="text-gray-800"> (2)</span> Capture client consultation data, 
                        <span className="text-gray-800"> (3)</span> Gemini AI processes and extracts structured information, 
                        <span className="text-gray-800"> (4)</span> Ranking engine scores and matches communities, 
                        <span className="text-gray-800"> (5)</span> Agent reviews recommendations and exports to CRM.
                      </p>
                    </div>
                  </div>
                </section>

                {/* Quick Operations Reference - Elegant */}
                <section className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-6 text-white shadow-md">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center border border-white/10">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Operations Guide</p>
                      <h3 className="text-2xl font-black">Quick Command Reference</h3>
                    </div>
                  </div>
                  <p className="text-sm text-gray-300 mb-6">Essential commands and features for efficient operation</p>
                      
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-white/5 backdrop-blur-sm rounded-lg p-4 border border-white/10 hover:bg-white/10 transition-colors">
                          <h5 className="font-bold text-white mb-3">Key Actions</h5>
                          <ul className="text-xs space-y-2 text-gray-300">
                            <li className="flex items-start gap-2"><span className="text-gray-400 mt-0.5">•</span><span>Start Call → Begin consultation</span></li>
                            <li className="flex items-start gap-2"><span className="text-gray-400 mt-0.5">•</span><span>End Call → Stop & generate summary</span></li>
                            <li className="flex items-start gap-2"><span className="text-gray-400 mt-0.5">•</span><span>Compare → Side-by-side view</span></li>
                            <li className="flex items-start gap-2"><span className="text-gray-400 mt-0.5">•</span><span>Push to CRM → Export to Sheets</span></li>
                          </ul>
                        </div>
                        <div className="bg-white/5 backdrop-blur-sm rounded-lg p-4 border border-white/10 hover:bg-white/10 transition-colors">
                          <h5 className="font-bold text-white mb-3">Dashboard Panels</h5>
                          <ul className="text-xs space-y-2 text-gray-300">
                            <li className="flex items-start gap-2"><span className="text-gray-400 mt-0.5">•</span><span>Client Profile → Auto-filled info</span></li>
                            <li className="flex items-start gap-2"><span className="text-gray-400 mt-0.5">•</span><span>Recommendations → Top matches</span></li>
                            <li className="flex items-start gap-2"><span className="text-gray-400 mt-0.5">•</span><span>Agent Guidance → AI suggestions</span></li>
                            <li className="flex items-start gap-2"><span className="text-gray-400 mt-0.5">•</span><span>Transcription → Live text</span></li>
                          </ul>
                        </div>
                        <div className="bg-white/5 backdrop-blur-sm rounded-lg p-4 border border-white/10 hover:bg-white/10 transition-colors">
                          <h5 className="font-bold text-white mb-3">Partner System</h5>
                          <ul className="text-xs space-y-2 text-gray-300">
                            <li className="flex items-start gap-2"><span className="inline-flex items-center gap-1 bg-green-500/20 text-green-300 text-xs px-2 py-0.5 rounded-full border border-green-400/30">★ Partner</span><span className="text-xs">Higher commission</span></li>
                            <li className="flex items-start gap-2"><span className="text-gray-400 mt-0.5">•</span><span>Mention even if #2 or #3</span></li>
                            <li className="flex items-start gap-2"><span className="text-gray-400 mt-0.5">•</span><span>Tracked in CRM export</span></li>
                            <li className="flex items-start gap-2"><span className="text-gray-400 mt-0.5">•</span><span>Green highlight = priority</span></li>
                          </ul>
                        </div>
                      </div>
                    </section>
                    {/* Complete Workflow Guide */}
                    <section className="bg-white rounded-xl p-8 border border-gray-200 shadow-md hover:shadow-lg transition-shadow duration-300">
                      <div className="flex items-center gap-3 mb-8">
                        <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center border border-gray-200">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Step-by-Step</p>
                          <h3 className="text-2xl font-black text-gray-900">Complete Workflow Guide</h3>
                        </div>
                      </div>
                      
                      <div className="relative space-y-8 sm:space-y-12 pl-4">
                        {/* Vertical Line */}
                        <div className="absolute left-8 top-4 bottom-4 w-0.5 bg-slate-200 -ml-0.5"></div>

                        {/* Step 1 */}
                        <div className="relative flex gap-6">
                          <div className="flex-shrink-0 w-16 h-16 bg-white rounded-full border-4 border-blue-50 flex items-center justify-center shadow-sm relative z-10">
                            <span className="text-2xl text-blue-600 font-bold">1</span>
                          </div>
                          <div className="flex-1 pt-2">
                            <h4 className="font-bold text-slate-900 text-lg mb-2">Start Consultation</h4>
                            <p className="text-slate-600 mb-3 text-sm leading-relaxed">
                              Select your language preference (English/Spanish) and click <strong className="text-blue-600">Start Call</strong>. The system initializes the Gemini AI engine and requests microphone permissions.
                            </p>
                            <div className="flex gap-2">
                              <span className="px-2 py-1 bg-blue-50 text-blue-600 text-xs rounded font-medium">Mic Active</span>
                              <span className="px-2 py-1 bg-green-50 text-green-600 text-xs rounded font-medium">✓ AI Ready</span>
                            </div>
                          </div>
                        </div>
                        
                        {/* Step 2 */}
                        <div className="relative flex gap-6">
                          <div className="flex-shrink-0 w-16 h-16 bg-white rounded-full border-4 border-cyan-50 flex items-center justify-center shadow-sm relative z-10">
                            <span className="text-2xl text-cyan-600 font-bold">2</span>
                          </div>
                          <div className="flex-1 pt-2">
                            <h4 className="font-bold text-slate-900 text-lg mb-2">Live Intelligence</h4>
                            <p className="text-slate-600 mb-3 text-sm leading-relaxed">
                              As the conversation flows, the dashboard updates in real-time. The AI extracts key data points (Budget, Location, Care Level) and suggests relevant follow-up questions.
                            </p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              {['Name', 'Budget', 'Location', 'Care'].map(label => (
                                <div key={label} className="bg-slate-50 border border-slate-100 px-3 py-1.5 rounded text-center">
                                  <span className="text-xs font-semibold text-slate-500">{label}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                        
                        {/* Step 3 */}
                        <div className="relative flex gap-6">
                          <div className="flex-shrink-0 w-16 h-16 bg-white rounded-full border-4 border-purple-50 flex items-center justify-center shadow-sm relative z-10">
                            <span className="text-2xl text-purple-600 font-bold">3</span>
                          </div>
                          <div className="flex-1 pt-2">
                            <h4 className="font-bold text-slate-900 text-lg mb-2">Smart Ranking</h4>
                            <p className="text-slate-600 mb-3 text-sm leading-relaxed">
                              The engine instantly ranks 50,000+ communities. Partner facilities are prioritized and highlighted. Use the <strong className="text-purple-600">Compare</strong> tool to evaluate options side-by-side.
                            </p>
                            <div className="inline-flex items-center gap-2 bg-purple-50 px-3 py-1.5 rounded-lg border border-purple-100">
                              <span className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></span>
                              <span className="text-xs font-medium text-purple-700">Real-time Matching</span>
                            </div>
                          </div>
                        </div>
                        
                        {/* Step 4 */}
                        <div className="relative flex gap-6">
                          <div className="flex-shrink-0 w-16 h-16 bg-white rounded-full border-4 border-emerald-50 flex items-center justify-center shadow-sm relative z-10">
                            <span className="text-2xl text-emerald-600 font-bold">4</span>
                          </div>
                          <div className="flex-1 pt-2">
                            <h4 className="font-bold text-slate-900 text-lg mb-2">Action & Export</h4>
                            <p className="text-slate-600 mb-3 text-sm leading-relaxed">
                              Conclude the session to generate a professional summary. One-click export pushes all data to your CRM (Google Sheets) for commission tracking.
                            </p>
                            <div className="flex gap-2">
                              <span className="px-2 py-1 bg-emerald-50 text-emerald-600 text-xs rounded font-medium">CRM Export</span>
                              <span className="px-2 py-1 bg-emerald-50 text-emerald-600 text-xs rounded font-medium">Email Client</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Pro Tips */}
                      <div className="mt-8 bg-gradient-to-r from-slate-50 to-blue-50 rounded-xl p-5 border border-slate-200">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-orange-500 rounded-lg flex items-center justify-center shadow-sm">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                          </div>
                          <h4 className="font-bold text-slate-900 text-lg">Pro Tips for Power Users</h4>
                        </div>
                        <div className="grid md:grid-cols-2 gap-4">
                          <div className="bg-white rounded-lg p-4 border border-slate-200 hover:shadow-md transition-shadow">
                            <h5 className="font-semibold text-gray-900 mb-2">Transfer to Agent Mode</h5>
                            <p className="text-sm text-gray-600">Use this for silent coaching—the AI provides text guidance while you take over the conversation. Perfect for experienced consultants.</p>
                          </div>
                          <div className="bg-white rounded-lg p-4 border border-slate-200 hover:shadow-md transition-shadow">
                            <h5 className="font-semibold text-gray-900 mb-2">Database Management</h5>
                            <p className="text-sm text-gray-600">Add new communities via CSV upload or manual entry. Update partner status anytime to reflect new agreements.</p>
                          </div>
                        </div>
                      </div>
                    </section>

                    {/* Data Management Guide */}
                    <section className="bg-white rounded-xl p-6 border-2 border-slate-200 shadow-lg">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="w-12 h-12 bg-gradient-to-br from-slate-600 to-slate-800 rounded-xl flex items-center justify-center shadow-lg">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Database</p>
                          <h3 className="text-2xl font-black text-gray-900">Community Data Management</h3>
                        </div>
                      </div>
                      
                      <div className="grid md:grid-cols-2 gap-6">
                        <div className="bg-slate-50 rounded-lg p-5 border border-slate-200">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-8 h-8 bg-slate-600 rounded-lg flex items-center justify-center">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                              </svg>
                            </div>
                            <h4 className="font-bold text-gray-900">CSV Upload</h4>
                          </div>
                          <ol className="text-sm text-gray-600 space-y-2">
                            <li className="flex gap-2"><span className="font-bold text-slate-500">1.</span> Go to Database tab</li>
                            <li className="flex gap-2"><span className="font-bold text-slate-500">2.</span> Click "Download Template"</li>
                            <li className="flex gap-2"><span className="font-bold text-slate-500">3.</span> Fill in community data</li>
                            <li className="flex gap-2"><span className="font-bold text-slate-500">4.</span> Upload completed CSV</li>
                            <li className="flex gap-2"><span className="font-bold text-slate-500">5.</span> Review & confirm import</li>
                          </ol>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-5 border border-slate-200">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-8 h-8 bg-slate-600 rounded-lg flex items-center justify-center">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </div>
                            <h4 className="font-bold text-gray-900">Manual Entry</h4>
                          </div>
                          <ol className="text-sm text-gray-600 space-y-2">
                            <li className="flex gap-2"><span className="font-bold text-slate-500">1.</span> Go to Database tab</li>
                            <li className="flex gap-2"><span className="font-bold text-slate-500">2.</span> Click "Add Community"</li>
                            <li className="flex gap-2"><span className="font-bold text-slate-500">3.</span> Fill required fields</li>
                            <li className="flex gap-2"><span className="font-bold text-slate-500">4.</span> Set Partner status if applicable</li>
                            <li className="flex gap-2"><span className="font-bold text-slate-500">5.</span> Save community</li>
                          </ol>
                        </div>
                      </div>
                    </section>
                    {/* FAQ Section */}
                    <section className="bg-white rounded-xl p-4 sm:p-6 border border-indigo-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
                      <div className="flex items-center gap-3 mb-4 sm:mb-6">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-7 sm:w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-indigo-600 uppercase tracking-wider">Troubleshooting</p>
                          <h3 className="text-xl sm:text-2xl font-black text-gray-900">Frequently Asked Questions</h3>
                        </div>
                      </div>
                      
                      <div className="space-y-3 sm:space-y-4">
                        {[
                          {
                            q: "My microphone isn't working. What should I do?",
                            a: "Ensure you've granted browser microphone permissions. Check your system settings and try refreshing the page. If using Chrome, click the lock icon in the address bar to verify mic access."
                          },
                          {
                            q: "Why aren't recommendations appearing?",
                            a: "Recommendations require at least a budget OR location to be extracted. Ensure the client has mentioned their preferences. You can also manually enter data using the 'Manual Entry' option."
                          },
                          {
                            q: "How do I update a community's partner status?",
                            a: "Go to the Database tab, find the community, click Edit, and toggle the 'Partner' checkbox. Changes take effect immediately for new consultations."
                          },
                          {
                            q: "Can I use the system in languages other than English?",
                            a: "Yes! The system supports English and Spanish. Select your language before starting a call. Hindi support is coming soon."
                          },
                          {
                            q: "How is the CRM export formatted?",
                            a: "Exports go to Google Sheets with columns for client info, top recommendations, partner status, and consultation timestamp. Each consultation gets a unique ID."
                          },
                          {
                            q: "What audio formats are supported for upload?",
                            a: "The system accepts .m4a, .wav, .mp3, and .webm files up to 50MB. For best results, use clear audio without background noise."
                          }
                        ].map((faq, i) => (
                          <details key={i} className="group bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg border border-indigo-200 overflow-hidden hover:border-indigo-300 transition-colors">
                            <summary className="flex items-center justify-between p-3 sm:p-4 cursor-pointer hover:bg-indigo-100/50 transition-colors">
                              <span className="font-semibold text-gray-900 pr-4 text-sm sm:text-base">{faq.q}</span>
                              <svg className="w-5 h-5 text-indigo-600 transform group-open:rotate-180 transition-transform flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </summary>
                            <div className="px-3 sm:px-4 pb-3 sm:pb-4 text-gray-700 text-xs sm:text-sm border-t border-indigo-200 pt-3">
                              {faq.a}
                            </div>
                          </details>
                        ))}
                      </div>
                    </section>

                    {/* Glossary Section */}
                    <section className="bg-white rounded-xl p-4 sm:p-6 border border-purple-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
                      <div className="flex items-center gap-3 mb-4 sm:mb-6">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-purple-600 to-fuchsia-600 rounded-xl flex items-center justify-center shadow-lg">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-7 sm:w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-purple-600 uppercase tracking-wider">Definitions</p>
                          <h3 className="text-xl sm:text-2xl font-black text-gray-900">Glossary of Terms</h3>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                        {[
                          { term: "Partner Community", def: "A senior living community with a formal referral agreement. Placements here earn higher commissions." },
                          { term: "Care Level", def: "The type of care required: Independent Living, Assisted Living, Memory Care, or Skilled Nursing." },
                          { term: "Ranking Score", def: "A composite score (0-100) based on budget match, location proximity, care fit, and partner status." },
                          { term: "CRM Export", def: "Sending consultation data to Google Sheets for tracking and follow-up management." },
                          { term: "Agent Guidance", def: "Real-time AI suggestions for questions to ask and talking points during consultations." },
                          { term: "Transfer to Agent", def: "Mode where AI stops speaking but continues providing text-based guidance to the consultant." },
                          { term: "Client Profile", def: "Extracted information about the client including name, budget, location, care needs, and timeline." },
                          { term: "Commission Tracking", def: "Automatic logging of partner community placements for revenue reporting." }
                        ].map((item, i) => (
                          <div key={i} className="bg-gradient-to-br from-purple-50 to-fuchsia-50 rounded-lg p-4 border border-purple-200 hover:border-purple-300 transition-colors">
                            <h5 className="font-bold text-purple-900 mb-1 text-sm sm:text-base">{item.term}</h5>
                            <p className="text-xs sm:text-sm text-gray-700">{item.def}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                    {/* Feature Matrix */}
                    <section className="bg-white rounded-xl p-4 sm:p-6 border border-blue-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
                      <div className="flex items-center gap-3 mb-4 sm:mb-6">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-7 sm:w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-blue-600 uppercase tracking-wider">Feature Status</p>
                          <h3 className="text-xl sm:text-2xl font-black text-gray-900">What's Available Now</h3>
                        </div>
                      </div>
                      
                      <div className="overflow-x-auto -mx-4 sm:mx-0">
                        <table className="w-full text-xs sm:text-sm min-w-[600px]">
                          <thead>
                            <tr className="bg-gradient-to-r from-blue-50 to-indigo-50">
                              <th className="text-left p-2 sm:p-3 font-bold text-gray-900">Feature</th>
                              <th className="text-center p-2 sm:p-3 font-bold text-gray-900">Status</th>
                              <th className="text-left p-2 sm:p-3 font-bold text-gray-900">Description</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {[
                              { feature: "Live Voice Consultation", status: "live", desc: "Real-time AI-powered client intake" },
                              { feature: "Text/Transcript Processing", status: "live", desc: "Paste transcripts for instant analysis" },
                              { feature: "Audio File Upload", status: "live", desc: "Upload recordings for transcription" },
                              { feature: "Smart Recommendations", status: "live", desc: "AI-ranked community matching" },
                              { feature: "Partner Prioritization", status: "live", desc: "Highlight high-commission options" },
                              { feature: "CRM Export (Google Sheets)", status: "live", desc: "One-click data export" },
                              { feature: "Multi-language (EN/ES)", status: "live", desc: "English and Spanish support" },
                              { feature: "Community Database CRUD", status: "live", desc: "Add, edit, delete communities" },
                              { feature: "CSV Bulk Upload", status: "live", desc: "Import communities via CSV" },
                              { feature: "Side-by-Side Compare", status: "live", desc: "Compare multiple communities" },
                              { feature: "Mobile Agent Assist", status: "coming", desc: "SMS-based silent coaching" },
                              { feature: "Automated Follow-ups", status: "coming", desc: "AI email concierge" },
                              { feature: "Market Intelligence", status: "planned", desc: "Gap analysis & opportunities" },
                              { feature: "Commission Dashboard", status: "planned", desc: "Revenue analytics & tracking" },
                            ].map((item, i) => (
                              <tr key={i} className="hover:bg-gray-50">
                                <td className="p-3 font-medium text-gray-900">{item.feature}</td>
                                <td className="p-3 text-center">
                                  {item.status === 'live' && (
                                    <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-full">
                                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                      Live
                                    </span>
                                  )}
                                  {item.status === 'coming' && (
                                    <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-xs font-bold px-2.5 py-1 rounded-full">
                                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                      Coming Soon
                                    </span>
                                  )}
                                  {item.status === 'planned' && (
                                    <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 text-xs font-bold px-2.5 py-1 rounded-full">
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                      Planned
                                    </span>
                                  )}
                                </td>
                                <td className="p-3 text-gray-600">{item.desc}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    {/* Roadmap Timeline */}
                    <section className="bg-white rounded-xl p-4 sm:p-6 border border-indigo-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
                      <div className="flex items-center gap-3 mb-4 sm:mb-6">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-indigo-600 uppercase tracking-wider">Future Development</p>
                          <h3 className="text-xl sm:text-2xl font-black text-gray-900">Product Roadmap</h3>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-4 sm:p-5 border border-blue-200 hover:border-blue-300 transition-colors">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                              </svg>
                            </div>
                            <h4 className="font-bold text-gray-900 text-sm sm:text-base">Mobile Agent Assist</h4>
                          </div>
                          <p className="text-xs sm:text-sm text-gray-700 mb-3">Silent coaching mode via SMS/texting. Receive real-time guidance on mobile devices during in-person visits.</p>
                          <span className="text-xs font-bold text-blue-700 bg-blue-100 px-2 py-1 rounded-full">Q1 2026</span>
                        </div>
                        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg p-4 sm:p-5 border border-indigo-200 hover:border-indigo-300 transition-colors">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                            </div>
                            <h4 className="font-bold text-gray-900 text-sm sm:text-base">Automated Follow-Ups</h4>
                          </div>
                          <p className="text-xs sm:text-sm text-gray-700 mb-3">AI-powered concierge sends personalized recap emails, FAQs, virtual tour links, and booking reminders.</p>
                          <span className="text-xs font-bold text-indigo-700 bg-indigo-100 px-2 py-1 rounded-full">Q1 2026</span>
                        </div>
                        <div className="bg-gradient-to-br from-purple-50 to-fuchsia-50 rounded-lg p-4 sm:p-5 border border-purple-200 hover:border-purple-300 transition-colors">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                              </svg>
                            </div>
                            <h4 className="font-bold text-gray-900 text-sm sm:text-base">Market Intelligence</h4>
                          </div>
                          <p className="text-xs sm:text-sm text-gray-700 mb-3">Gap analysis layer that flags market opportunities (e.g., "No pet-friendly partners in East Bay").</p>
                          <span className="text-xs font-bold text-purple-700 bg-purple-100 px-2 py-1 rounded-full">Q2 2026</span>
                        </div>
                        <div className="bg-gradient-to-br from-fuchsia-50 to-pink-50 rounded-lg p-4 sm:p-5 border border-fuchsia-200 hover:border-fuchsia-300 transition-colors">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-8 h-8 bg-fuchsia-600 rounded-lg flex items-center justify-center flex-shrink-0">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </div>
                            <h4 className="font-bold text-gray-900 text-sm sm:text-base">Commission Dashboard</h4>
                          </div>
                          <p className="text-xs sm:text-sm text-gray-700 mb-3">Integrated CRM with real-time partner commission tracking, payout reports, and revenue analytics.</p>
                          <span className="text-xs font-bold text-fuchsia-700 bg-fuchsia-100 px-2 py-1 rounded-full">Q2 2026</span>
                        </div>
                      </div>
                    </section>

                    {/* Business Value Section */}
                    <section className="bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 rounded-xl p-4 sm:p-6 border border-indigo-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
                      <div className="flex items-center gap-3 mb-4 sm:mb-6">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-blue-600 uppercase tracking-wider">Business Value</p>
                          <h3 className="text-xl sm:text-2xl font-black text-gray-900">Partner-First Revenue Strategy</h3>
                        </div>
                      </div>
                      
                      <div className="space-y-3 sm:space-y-4">
                        <div className="bg-white/90 backdrop-blur-sm rounded-lg p-4 sm:p-5 border border-blue-200 hover:border-blue-300 transition-colors shadow-sm">
                          <h4 className="font-bold text-gray-900 mb-2 sm:mb-3 flex items-center gap-2 text-sm sm:text-base">
                            <span className="text-blue-600 text-lg sm:text-xl">⭐</span> Smart Partner Prioritization
                          </h4>
                          <p className="text-gray-700 leading-relaxed text-xs sm:text-sm">
                            The AI balances client needs with partnership economics. Every recommendation displays a <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">★ Partner</span> badge when applicable, making it easy to identify higher-commission opportunities.
                          </p>
                        </div>
                        <div className="bg-white/90 backdrop-blur-sm rounded-lg p-4 sm:p-5 border border-indigo-200 hover:border-indigo-300 transition-colors shadow-sm">
                          <h4 className="font-bold text-gray-900 mb-2 sm:mb-3 flex items-center gap-2 text-sm sm:text-base">
                            <span className="text-indigo-600 text-lg sm:text-xl">💡</span> Upsell Even When Ranked #2 or #3
                          </h4>
                          <p className="text-gray-700 leading-relaxed text-xs sm:text-sm">
                            Agents can confidently mention partner communities even when not ranked #1. The dashboard highlights partner status, and commission tracking rewards all partner placements.
                          </p>
                        </div>
                        <div className="bg-white/90 backdrop-blur-sm rounded-lg p-4 sm:p-5 border border-purple-200 hover:border-purple-300 transition-colors shadow-sm">
                          <h4 className="font-bold text-gray-900 mb-2 sm:mb-3 flex items-center gap-2 text-sm sm:text-base">
                            <span className="text-purple-600 text-lg sm:text-xl">🚀</span> Multiple Activation Paths
                          </h4>
                          <p className="text-gray-700 leading-relaxed text-xs sm:text-sm">
                            Deploy as a kiosk in community lobbies, embed into referral partner portals, or use the ranking engine to benchmark new markets. Scales from individual tools to enterprise systems.
                          </p>
                        </div>
                      </div>
                    </section>
              </div>
            </div>
          )}
        </div>

        {/* Video Walkthrough Modal */}
        {showVideoModal && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4"
            onClick={() => setShowVideoModal(false)}
          >
            <div 
              className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full mx-4 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="bg-gradient-to-r from-red-500 to-red-600 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-white">Product Walkthrough</h3>
                </div>
                <button
                  onClick={() => setShowVideoModal(false)}
                  className="text-white/90 hover:text-white hover:bg-white/20 rounded-lg p-2 transition-all"
                  aria-label="Close video"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Video Container */}
              <div className="relative bg-black" style={{ paddingBottom: '56.25%' }}>
                <iframe
                  className="absolute top-0 left-0 w-full h-full"
                  src="https://www.youtube.com/embed/eCkP7_ZI348?si=8yUjD6J1YUO2jrIT"
                  title="YouTube video player"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-between items-center">
                <p className="text-sm text-gray-600">
                  See the AI Placement Assistant in action
                </p>
                <div className="flex gap-2">
                  <a
                    href="https://www.youtube.com/watch?v=eCkP7_ZI348"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-all shadow-sm hover:shadow-md"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                    </svg>
                    Watch on YouTube
                  </a>
                  <button
                    onClick={() => setShowVideoModal(false)}
                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-all"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const NavButton: React.FC<{
    targetView: 'dashboard' | 'database';
    label: string;
    icon: React.ReactNode;
  }> = ({ targetView, label, icon }) => (
    <button
      onClick={() => setView(targetView)}
      className={`px-3 py-2 text-sm font-semibold rounded-md flex items-center gap-2 transition-colors ${
        view === targetView
          ? 'bg-blue-100 text-blue-600'
          : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="min-h-screen font-sans text-gray-800 bg-gradient-to-br from-[#F8F7F2] via-white to-[#e3ecff] flex flex-col page-bg-soft">
      <header className="bg-white/95 backdrop-blur-lg sticky top-0 z-20 border-b border-gray-200">
        <div className="max-w-screen-xl mx-auto px-3 sm:px-5 lg:px-6 py-3 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="flex items-center gap-3.5 lg:gap-5 flex-shrink-0 min-w-[280px]">
              <button
                onClick={() => {
                  setHasLaunchedAssistant(false);
                  setShowVisionPanel(false);
                }}
                className="flex-shrink-0 flex items-center gap-2 px-3.5 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 active:bg-blue-800 transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                title="Back to home"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span className="hidden sm:inline">Back to Home</span>
                <span className="sm:hidden">Back</span>
              </button>
              
              <div className="flex items-center bg-gray-100/80 rounded-lg p-1 space-x-1 flex-shrink-0">
                        <NavButton
                          targetView="dashboard"
                          label="Live Dashboard"
                          icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" /></svg>}
                        />
                        <NavButton
                          targetView="database"
                          label="Community Database"
                          icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M3 3a1 1 0 000 2h14a1 1 0 100-2H3zM3 7a1 1 0 000 2h14a1 1 0 100-2H3zM3 11a1 1 0 000 2h14a1 1 0 100-2H3zM3 15a1 1 0 000 2h14a1 1 0 100-2H3z" /></svg>}
                        />
                     </div>
                 </div>

            <div className="flex items-center justify-end gap-3 flex-shrink-0">
              {callStatus === CallStatus.IDLE && (
                <>
                  <button
                    onClick={() => setShowAudioModal(true)}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Upload Call
                  </button>
                  <button
                    onClick={() => setShowTextModal(true)}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6M5 7h14a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2z" />
                    </svg>
                    Paste Transcript
                  </button>
                  <button
                    onClick={() => setShowManualEntryModal(true)}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Manual Entry
                  </button>
                </>
              )}
              <CallControls
                status={callStatus}
                isAgentAssistMode={isAgentAssistMode}
                isCallPaused={isCallPaused}
                onStart={handleStartCall}
                onEnd={() => handleEndCall()}
                onToggleAssistMode={handleToggleMute}
                onTogglePause={handleTogglePause}
                onSaveSummary={handleSaveSummary}
                hasData={Object.keys(clientProfile).length > 0 || recommendations.length > 0}
                onClearDashboard={() => resetState()}
              />
              <div className="h-8 w-px bg-gray-200"></div>
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center border-2 border-blue-200">
                  <span className="text-md font-bold text-blue-600">{currentUser.avatar}</span>
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-gray-800">{currentUser.name}</p>
                  {currentUser.title && <p className="text-xs text-gray-500">{currentUser.title}</p>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>
    
      <main className="flex-grow max-w-screen-xl mx-auto px-3 sm:px-5 lg:px-6 py-5 lg:py-6 w-full flex flex-col gap-5 min-h-0">
        {view === 'dashboard' ? (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 flex-grow min-h-0">
            <div className="lg:col-span-3 flex flex-col gap-5 min-h-0">
              <RecommendationsCard 
                recommendations={recommendations}
                allCommunities={communities}
                onCompare={handleOpenComparisonModal}
                onPushToGoogleSheet={handlePushToGoogleSheet}
                onSendEmailToClient={handleSendEmailToClient}
                onSendEmailToManager={handleSendEmailToManager}
                onClear={() => resetState()}
                autoPushToSheet={autoPushToSheet}
                setAutoPushToSheet={setAutoPushToSheet}
              />
              <div className="min-h-0 h-[500px] rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden relative">
                {/* AI Thinking Indicator */}
                {isAiThinking && callStatus === CallStatus.ACTIVE && (
                  <div className="absolute top-2 right-2 z-10 flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-full px-3 py-1 shadow-sm animate-pulse">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                    <span className="text-xs font-medium text-blue-600">Updating...</span>
                  </div>
                )}
                <div className="h-full overflow-y-auto pr-1">
                  <TranscriptionPanel 
                    entries={transcription} 
                    clientProfile={clientProfile} 
                    suggestedQuestions={suggestedQuestions}
                    agentGuidance={agentGuidance}
                    isAgentAssistMode={isAgentAssistMode}
                    communities={communities}
                  />
                </div>
              </div>
            </div>
            <div className="lg:col-span-2 flex flex-col gap-5 min-h-0">
              <div className="flex items-center">
                <button
                  onClick={() => setShowAnalysisModal(true)}
                  disabled={!analysisResults || !analysisResults.recommendations || analysisResults.recommendations.length === 0}
                  className={`w-full py-4 px-6 rounded-xl border-2 transition-all duration-300 flex items-center justify-center gap-3 ${
                    analysisResults && analysisResults.recommendations && analysisResults.recommendations.length > 0
                      ? 'border-blue-500 bg-gradient-to-r from-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 shadow-md hover:shadow-lg cursor-pointer'
                      : 'border-dashed border-gray-300 bg-gray-50 cursor-not-allowed opacity-60'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${
                    analysisResults && analysisResults.recommendations && analysisResults.recommendations.length > 0
                      ? 'text-blue-600'
                      : 'text-gray-400'
                  }`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <span className={`text-base font-semibold ${
                    analysisResults && analysisResults.recommendations && analysisResults.recommendations.length > 0
                      ? 'text-blue-900'
                      : 'text-gray-600'
                  }`}>
                    {analysisResults && analysisResults.recommendations && analysisResults.recommendations.length > 0
                      ? 'View Recommendation'
                      : 'Analysis Pending'}
                  </span>
                </button>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-white shadow-sm flex-grow overflow-hidden">
                <div className="h-full overflow-y-auto pr-2">
                  <ClientProfileCard 
                    profile={clientProfile} 
                    callHistory={history}
                    onViewHistorySummary={handleViewHistorySummary}
                    isHistoryLoading={isHistoryLoading}
                  />
                </div>
              </div>
              {analysisResults?.performance_metrics && (
                <div className="bg-white/90 border border-gray-200 rounded-2xl p-4 shadow-sm text-sm text-gray-600">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-base font-semibold text-gray-900">Pipeline Metrics</h4>
                    <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                      {analysisResults.performance_metrics.api_calls || 0} API calls
                    </span>
                  </div>
                  <dl className="space-y-1.5">
                    <div className="flex justify-between">
                      <dt className="text-gray-500">End-to-End Time</dt>
                      <dd className="text-gray-900">
                        {analysisResults.performance_metrics.timings?.e2e_total
                          ? `${analysisResults.performance_metrics.timings.e2e_total.toFixed(1)}s`
                          : '—'}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Tokens</dt>
                      <dd className="text-gray-900">
                        {analysisResults.performance_metrics.token_counts?.total_tokens?.toLocaleString() || '—'}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Estimated Cost</dt>
                      <dd className="text-gray-900">
                        {analysisResults.performance_metrics.costs?.total_cost
                          ? `$${analysisResults.performance_metrics.costs.total_cost.toFixed(4)}`
                          : '—'}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>
          </div>
        ) : (
          <DatabaseManagementCard
            communities={communities}
            onAdd={() => handleOpenCommunityModal(null)}
            onEdit={(community) => handleOpenCommunityModal(community)}
            onDelete={handleDeleteCommunity}
            onCommunitiesUpdate={fetchCommunities}
            apiBaseUrl={API_BASE_URL}
          />
        )}
      </main>

      <SummaryModal 
        isOpen={isSummaryModalOpen}
        onClose={handleCloseSummaryModal}
        summaryText={summaryText}
      />
      <ComparisonModal
        isOpen={isComparisonModalOpen}
        onClose={handleCloseComparisonModal}
        communities={communitiesToCompare}
      />
      {showAudioModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40 px-4 py-8">
          <div className="bg-white/85 backdrop-blur rounded-[32px] border border-white/60 shadow-2xl shadow-blue-200/70 w-full max-w-3xl max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/50">
              <h2 className="text-xl font-semibold text-gray-900">Upload a Call Recording</h2>
              <button
                onClick={() => setShowAudioModal(false)}
                className="text-gray-500 hover:text-gray-700 p-1 rounded-full hover:bg-gray-100"
                aria-label="Close audio upload"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 bg-gradient-to-b from-white/70 to-white/40">
              <AudioUploadForm
                apiBaseUrl={API_BASE_URL}
                onResults={(results) => {
                  handleAnalysisResults(results);
                }}
                autoPushToSheet={autoPushToSheet}
                setAutoPushToSheet={setAutoPushToSheet}
              />
            </div>
          </div>
        </div>
      )}
      {showTextModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40 px-4 py-8">
          <div className="bg-white/85 backdrop-blur rounded-[32px] border border-white/60 shadow-2xl shadow-blue-200/70 w-full max-w-3xl max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/50">
              <h2 className="text-xl font-semibold text-gray-900">Paste Transcript</h2>
              <button
                onClick={() => setShowTextModal(false)}
                className="text-gray-500 hover:text-gray-700 p-1 rounded-full hover:bg-gray-100"
                aria-label="Close transcript modal"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 bg-gradient-to-b from-white/70 to-white/40">
              <TextConsultationForm
                apiBaseUrl={API_BASE_URL}
                onResults={(results) => {
                  handleAnalysisResults(results);
                }}
                autoPushToSheet={autoPushToSheet}
                setAutoPushToSheet={setAutoPushToSheet}
              />
            </div>
          </div>
        </div>
      )}
      <ManualEntryModal
        isOpen={showManualEntryModal}
        onClose={() => setShowManualEntryModal(false)}
        onSave={handleManualProfileSave}
        initialProfile={clientProfile}
      />
      <RecommendationAnalysisModal
        isOpen={showAnalysisModal}
        onClose={() => setShowAnalysisModal(false)}
        results={analysisResults}
      />
       <FeedbackModal
        isOpen={isFeedbackModalOpen}
        onClose={handleCloseFeedbackModal}
      />
      <CommunityFormModal
        isOpen={isCommunityModalOpen}
        onClose={handleCloseCommunityModal}
        onSubmit={handleSaveCommunity}
        communityToEdit={communityToEdit}
      />

      {/* Video Walkthrough Modal */}
      {showVideoModal && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4"
          onClick={() => setShowVideoModal(false)}
        >
          <div 
            className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-red-500 to-red-600 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-white">Product Walkthrough</h3>
              </div>
              <button
                onClick={() => setShowVideoModal(false)}
                className="text-white/90 hover:text-white hover:bg-white/20 rounded-lg p-2 transition-all"
                aria-label="Close video"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Video Container */}
            <div className="relative bg-black" style={{ paddingBottom: '56.25%' }}>
              <iframe
                className="absolute top-0 left-0 w-full h-full"
                src="https://www.youtube.com/embed/eCkP7_ZI348?si=8yUjD6J1YUO2jrIT"
                title="YouTube video player"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-between items-center">
              <p className="text-sm text-gray-600">
                See the AI Placement Assistant in action
              </p>
              <div className="flex gap-2">
                <a
                  href="https://www.youtube.com/watch?v=eCkP7_ZI348"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-all shadow-sm hover:shadow-md"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                  </svg>
                  Watch on YouTube
                </a>
                <button
                  onClick={() => setShowVideoModal(false)}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-all"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Client Email Modal */}
      {showClientEmailModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-800">Client Email Template</h2>
              <button
                onClick={handleCloseClientEmailModal}
                className="text-gray-500 hover:text-gray-700"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="mb-4">
              <button
                onClick={() => copyToClipboard(generateClientEmailContent())}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
              >
                Copy to Clipboard
              </button>
            </div>
            <div className="bg-gray-50 p-4 rounded border font-mono text-sm whitespace-pre-wrap">
              {generateClientEmailContent()}
            </div>
          </div>
        </div>
      )}

      {/* Manager Email Modal */}
      {showManagerEmailModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-800">Manager Review Email Template</h2>
              <button
                onClick={handleCloseManagerEmailModal}
                className="text-gray-500 hover:text-gray-700"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="mb-4">
              <button
                onClick={() => copyToClipboard(generateManagerEmailContent())}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
              >
                Copy to Clipboard
              </button>
            </div>
            <div className="bg-gray-50 p-4 rounded border font-mono text-sm whitespace-pre-wrap">
              {generateManagerEmailContent()}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white/50 backdrop-blur border-t border-gray-200 mt-auto py-4">
        <div className="max-w-screen-xl mx-auto px-3 sm:px-5 lg:px-6">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-gray-500">
            <div className="flex flex-wrap items-center gap-4 justify-center">
              <span className="font-semibold text-gray-700">Built by:</span>
              <span>Shivam Sharma</span>
            </div>
            <div className="flex flex-wrap items-center gap-4 justify-center">
              <span><span className="font-semibold text-gray-700">Faculty Advisor:</span> Professor Elizabeth Mohr</span>
              <span><span className="font-semibold text-gray-700">Client Partner:</span> Neil Russell, Culine Health</span>
            </div>
          </div>
        </div>
      </footer>

      {/* Feedback Button */}
      <button
        onClick={handleOpenFeedbackModal}
        className="fixed bottom-6 right-6 bg-blue-600 text-white p-3 rounded-full shadow-lg hover:bg-blue-700 transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#F8F7F2] focus:ring-blue-500 z-30"
        aria-label="Provide Feedback"
        title="Provide Feedback"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>
    </div>
  );
}