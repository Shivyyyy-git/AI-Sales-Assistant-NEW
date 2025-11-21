
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type, Blob } from '@google/genai';
import { CallStatus, ClientProfile, Recommendation, TranscriptionEntry, CallSummary, Community, User, SupportedLanguage } from './types';
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
import { FullRecommendationsDisplay } from './components/FullRecommendationsDisplay';
import { USERS_DATA } from './data/users.data';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

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
        description: 'A list of top 3 recommended communities based on the current profile. For each, include key details extracted from the knowledge base.',
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
const MIN_SPEECH_THRESHOLD = 0.0007; // Lowered for better speech detection sensitivity
const MAX_SILENCE_BEFORE_DROP = 2200;
const END_TURN_SILENCE_MS = 150; // 150ms of silence - ultra-responsive conversational flow
const END_TURN_CONFIRMATION_MS = 150; // Send endOfTurn multiple times for reliability (increased window)
const INFO_HUB_HEIGHT = 'calc(100vh - 360px)';

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

  const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.IDLE);
  const [isAgentAssistMode, setIsAgentAssistMode] = useState(false);
  const [isCallPaused, setIsCallPaused] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>('en');
  const [clientProfile, setClientProfile] = useState<ClientProfile>({});
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [agentGuidance, setAgentGuidance] = useState<string[]>([]);
  const [transcription, setTranscription] = useState<TranscriptionEntry[]>([]);
  const [history, setHistory] = useState<CallSummary[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [analysisResults, setAnalysisResults] = useState<any>(null);
  const [showClientEmailModal, setShowClientEmailModal] = useState(false);
  const [showManagerEmailModal, setShowManagerEmailModal] = useState(false);
  const [showTextModal, setShowTextModal] = useState(false);
  const [showAudioModal, setShowAudioModal] = useState(false);
  
  const transcriptionStateRef = useRef<Record<'user' | 'model', TranscriptionTracker>>({
    user: { ...INITIAL_TRANSCRIPTION_TRACKING.user },
    model: { ...INITIAL_TRANSCRIPTION_TRACKING.model },
  });
  const noiseProfileRef = useRef<NoiseProfile>({ ...INITIAL_NOISE_PROFILE });
  const silenceTrackerRef = useRef<SilenceTracker>({ ...INITIAL_SILENCE_TRACKER });
  
  const resetTranscriptionTracking = useCallback(() => {
    transcriptionStateRef.current.user = { ...INITIAL_TRANSCRIPTION_TRACKING.user };
    transcriptionStateRef.current.model = { ...INITIAL_TRANSCRIPTION_TRACKING.model };
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
  
  const updateTranscriptionEntry = useCallback((speaker: 'user' | 'model', rawText?: string) => {
    if (!rawText || typeof rawText !== 'string' || rawText.length === 0) return;
    
    // Filter out non-English characters (Hindi, etc.) - only allow English letters, numbers, punctuation, and spaces
    // This ensures we only display English transcriptions
    const englishOnlyRegex = /[^\x00-\x7F]/g; // Matches non-ASCII characters
    const filteredText = rawText.replace(englishOnlyRegex, '');
    
    // Skip if filtered text is empty
    if (filteredText.length === 0) return;
    
    const text = filteredText;
    
    const now = Date.now();
    const tracker = transcriptionStateRef.current[speaker];
    const timeSinceLastUpdate = now - tracker.updatedAt;
    
    setTranscription(prev => {
      const previous = prev[prev.length - 1];
      // Optimized windows: rapid fragments (300ms) and continuation (2 seconds)
      // Reduced from 1s/10s to improve performance and reduce lag
      const isRapidFragment = previous?.speaker === speaker && timeSinceLastUpdate < 300;
      const isContinuation = previous?.speaker === speaker && timeSinceLastUpdate < 2000;
      
      if (isContinuation && previous) {
        const prevText = previous.text;
        const newText = text;
        
        // CASE 1: New text contains previous text (complete incremental update) - FAST PATH
        // This is the most common case - Gemini sent a complete update
        if (newText.includes(prevText)) {
          const updated = [...prev];
          updated[updated.length - 1] = { speaker, text: newText };
          return updated;
        }
        
        // CASE 2: Previous text contains new text (fragment is subset) - FAST PATH
        // Quick check: if new is very short or previous is much longer, keep previous
        if (prevText.includes(newText)) {
          if (newText.length < 5 || prevText.length > newText.length * 2) {
            return prev; // Keep previous - it's more complete
          }
          // New might be a correction - prefer if longer
          if (newText.length > prevText.length) {
            const updated = [...prev];
            updated[updated.length - 1] = { speaker, text: newText };
            return updated;
          }
          return prev;
        }
        
        // CASE 3: Rapid fragments - simple concatenation (no expensive overlap check)
        // Only check for rapid fragments to avoid lag
        if (isRapidFragment) {
          // Quick overlap check: only check last 5 chars of previous and first 5 chars of new
          // This is much faster than checking 20 chars
          const prevEnd = prevText.slice(-5);
          const newStart = newText.slice(0, 5);
          
          // Check for common overlap patterns (spaces, short words)
          if (prevEnd === newStart && prevEnd.length > 0) {
            // Overlap found - merge
            const merged = prevText + newText.slice(prevEnd.length);
            const updated = [...prev];
            updated[updated.length - 1] = { speaker, text: merged };
            return updated;
          }
          
          // No overlap - simple concatenation
          const concatenated = prevText + newText;
          const updated = [...prev];
          updated[updated.length - 1] = { speaker, text: concatenated };
          return updated;
        }
        
        // CASE 4: New text is significantly longer - likely complete update
        if (newText.length > prevText.length * 1.5) {
          const updated = [...prev];
          updated[updated.length - 1] = { speaker, text: newText };
          return updated;
        }
        
        // CASE 5: New text is longer - might be correction or complete update
        if (newText.length > prevText.length) {
          const updated = [...prev];
          updated[updated.length - 1] = { speaker, text: newText };
          return updated;
        }
        
        // CASE 6: Previous is longer - keep it (most complete)
        return prev;
      }
      
      // New entry - different speaker or > 2 seconds gap
      return [...prev, { speaker, text }];
    });
    
    // Update tracker with current text and timestamp
    transcriptionStateRef.current[speaker] = { lastText: text, updatedAt: now };
  }, []);

const safeString = (value?: any): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }
  return undefined;
};

const normalizeClientProfile = (source?: any): ClientProfile => {
  if (!source || typeof source !== 'object') return {};
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

const handleAnalysisResults = useCallback((result: any, source: 'analysis' | 'live' = 'analysis') => {
    if (!result) return;

    setAnalysisResults(result);

    const clientInfo = result.client_info || {};
    const normalizedProfile = normalizeClientProfile(clientInfo);
    setClientProfile(normalizedProfile);

    const backendRecommendations = Array.isArray(result.recommendations) ? result.recommendations : [];
    const formattedRecommendations: Recommendation[] = backendRecommendations.map((rec: any, index: number) => {
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
            : typeof rec.price === 'string'
            ? rec.price
            : undefined,
        address: zip ? `ZIP ${zip}` : rec.address,
        description: rec.explanations?.business_reason || rec.description || 'Generated via AI ranking engine.',
        careLevels: careLevel ? [careLevel] : rec.careLevels,
        amenities: rec.amenities || [],
      };
    });

    if (source === 'analysis') {
      setRecommendations(formattedRecommendations);
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

  const sessionRef = useRef<any | null>(null);
  const socketRef = useRef<any | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | AudioWorkletNode | AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<BlobPart[]>([]);
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

  const ACTIVE_AI_SYSTEM_INSTRUCTION = useMemo(() => `You are the "AI Senior Living Placement Assistant," a sophisticated AI partner for a senior living placement consultant on a live call. Your primary role is to actively guide the conversation, ask clarifying questions, and provide verbal suggestions to help the consultant. While you speak, you MUST also use the 'updateDashboard' function to keep the consultant's dashboard updated in real-time.

**CRITICAL CONVERSATION RULES:**
- WAIT for the user to completely finish speaking before you respond
- DO NOT interrupt the user while they are speaking
- Respond quickly and naturally after a brief pause (~150ms) - like a real conversation
- Listen to the complete user message before formulating your response
- Never start speaking while the user is still talking
- Keep responses immediate and conversational - minimize silence gaps

**CRITICAL LANGUAGE REQUIREMENT - ABSOLUTE ENFORCEMENT:**
${selectedLanguage === 'en' ? `
- You MUST ONLY listen to, transcribe, and respond in English (en-US)
- DO NOT transcribe ANY non-English speech (Hindi, Spanish, Chinese, etc.) - completely ignore it
- DO NOT respond to non-English input - treat it as if nothing was said
- If you detect non-English speech, DO NOT transcribe it - wait for English input
- All transcriptions MUST be in English characters ONLY (ASCII characters 0-127)
- All your responses MUST be in English only
- If the user speaks in another language, silently ignore it and wait for English speech
- NEVER output Hindi, Spanish, or any other language characters - ONLY English
- The input audio transcription is set to English - respect this absolutely
- Filter out any non-ASCII characters from transcriptions before displaying them
` : `
- You must ONLY listen to, transcribe, and respond in ${languageNames[selectedLanguage]}
- Completely ignore any speech that is not in ${languageNames[selectedLanguage]}
- All your responses, questions, and dashboard updates must be exclusively in ${languageNames[selectedLanguage]}
`}

**CRITICAL CONVERSATION RULES - NATURAL FLOW:**
- Wait for the user to finish speaking before responding (natural pause detection)
- DO NOT interrupt the user while they are speaking
- Respond immediately and naturally after a very brief pause (~150ms) - like a real conversation
- Keep responses concise, quick, and natural - minimize silence between turns
- Be engaging and conversational, not robotic
- Respond as quickly as possible once the user stops speaking

**Core Directives:**
1.  **Be a Proactive Conversationalist:** Don't just listen. Your first goal is to politely ask for and capture the client's name. Actively participate. If the client mentions a need, verbally acknowledge it and naturally flow to the next topic. Keep your responses conversational, natural, and engaging - like talking to a friend. Avoid repeating questions you've already asked. Respond quickly and naturally after the user finishes speaking. **IMPORTANT: Always wait for the user to finish speaking before responding.**
2.  **Speak and Update Simultaneously:** As you process the conversation, generate helpful spoken responses for the consultant AND call the \`updateDashboard\` function ONCE per turn when you have new information. For example, if the client says "I need a place in Sunnyvale," you should say something like, "Okay, Sunnyvale is a great area. What's your budget looking like for that location?" while calling \`updateDashboard\` with the location "Sunnyvale."
3.  **Real-time Dashboard Management:**
    *   **Extract & Update Instantly**: The moment you identify NEW details (name, location, budget, care needs, accessibility needs, or other specific demands), call \`updateDashboard\` to populate the \`clientProfile\`. Only call updateDashboard when you have genuinely new information to share.
    *   **Suggest Questions Dynamically**: Update \`suggestedQuestions\` with 2-3 high-priority questions that haven't been answered yet. Don't repeat questions the client has already answered.
    *   **Generate & Refine Recommendations Wisely**: Generate initial recommendations when you have enough information (at least location OR care level). Refine recommendations when you learn significant new details (budget change, care level clarification, mobility requirements). Don't update recommendations for minor conversation filler. Prioritize: location, budget, wheelchair accessibility, partner status, and 'Immediate' availability for urgent timelines.

**Available Communities Knowledge Base (Simulating ~50,000 facilities):**
${communitiesListString}`, [selectedLanguage, languageNames, communitiesListString]);

const AGENT_ASSIST_SYSTEM_INSTRUCTION = useMemo(() => `You are the "AI Senior Living Placement Assistant" in **Agent Assist Mode**. You are a silent partner for a human consultant on a live call. Your primary role is to listen to the client and provide text-based guidance, suggestions, and data points to the human consultant on their dashboard. **You MUST NOT generate any spoken audio response.**

**CRITICAL LANGUAGE REQUIREMENT - ABSOLUTE ENFORCEMENT:**
${selectedLanguage === 'en' ? `
- You MUST ONLY listen to and transcribe speech in English (en-US)
- DO NOT transcribe ANY non-English speech (Hindi, Spanish, Chinese, etc.) - completely ignore it
- DO NOT respond to non-English input - treat it as if nothing was said
- If you detect non-English speech, DO NOT transcribe it - wait for English input
- All transcriptions MUST be in English characters ONLY (ASCII characters 0-127)
- All your text-based guidance and dashboard updates must be exclusively in English
- If the user speaks in another language, silently ignore it and wait for English speech
- NEVER output Hindi, Spanish, or any other language characters - ONLY English
- The input audio transcription is set to English - respect this absolutely
- Filter out any non-ASCII characters from transcriptions before displaying them
` : `
- You must ONLY listen to and transcribe speech in ${languageNames[selectedLanguage]}
- Completely ignore any speech that is not in ${languageNames[selectedLanguage]}
- All your text-based guidance and dashboard updates must be exclusively in ${languageNames[selectedLanguage]}
`}

**Core Directives:**
1.  **Listen and Analyze:** Transcribe the client's speech accurately.
2.  **Provide Text Guidance:** Instead of speaking, your output will be text-only suggestions for the agent. This includes:
    *   **Update Dashboard:** Use the 'updateDashboard' function when you have NEW information to share. Only call it when there are genuine updates, not on every message.
    *   **Provide Actionable Guidance:** Offer 2-3 concise coaching tips via \`agentGuidance\`. Identify opportunities for upselling, rapport building, or clarifying inconsistencies. Examples: "Client mentioned their daughter lives nearby, great rapport-building opportunity!" or "Budget seems flexible, probe for potential upsell to a premium suite."
    *   **Suggest Questions:** Provide 2-3 high-priority unanswered questions via \`suggestedQuestions\`. Don't repeat questions the client has already answered.
3.  **Generate & Refine Recommendations Wisely**: Generate initial recommendations when you have enough information (at least location OR care level). Refine recommendations when you learn significant new details (budget change, care level clarification, mobility requirements). Don't update recommendations for minor conversation filler. Prioritize: location, budget, wheelchair accessibility, partner status, and 'Immediate' availability for urgent timelines.
4.  **Be Concise:** Keep your text guidance brief and to the point. The agent is on a live call and needs information quickly.

**Available Communities Knowledge Base (Simulating ~50,000 facilities):**
${communitiesListString}`, [selectedLanguage, languageNames, communitiesListString]);

  const fetchCommunities = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/communities`);
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data = await response.json();
      const mappedCommunities = data.communities.map((c: any) => ({
        id: c.CommunityID,
        name: `Community ${c.CommunityID}`,
        location: `ZIP ${c.ZIP}`,
        address: `${c.ZIP}, USA`,
        description: `A community offering ${c['Care Level']}`,
        careLevels: c['Care Level'] ? [c['Care Level']] : [],
        basePrice: c['Monthly Fee'] || 0,
        pricingDetails: `Starts at $${c['Monthly Fee'] || 0}`,
        isPartner: c['Work with Placement?'] === 'Yes',
        amenities: [], // This data is not in the excel file
        lat: 0, // This data is not in the excel file
        lng: 0, // This data is not in the excel file
        wheelchairAccessible: true, // Assuming default
        hasKitchen: false, // Assuming default
        availability: c['Est. Waitlist Length'] === 'Available' ? 'Immediate' : 'Waitlist',
      }));
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
      applyTranscriptionSnapshot([]);
      setIsAgentAssistMode(false);
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
      const summary = generateSummaryText();
      const response = await fetch(`${API_BASE_URL}/api/update-crm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientProfile,
          recommendations,
          summary
        })
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Successfully pushed to Google Sheet! Consultation ID: ${result.consultation_id}`);
      } else {
        const errorText = await response.text();
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
    } catch (err) {
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


  const handleStartCall = useCallback(async (isAssistMode = false) => {
    if(!isAssistMode) {
        resetState();
    } else {
        applyTranscriptionSnapshot([]);
        resetAudioTracking();
    }
    setIsCallPaused(false);
    isCallPausedRef.current = false;
    setCallStatus(CallStatus.CONNECTING);
    setIsAgentAssistMode(isAssistMode);

    try {
      // Use Gemini SDK directly like Google Studio
      // Try multiple sources for API key
      const apiKey = (window as any).GEMINI_API_KEY
        || (document.querySelector('meta[name="gemini-api-key"]') as HTMLMetaElement)?.content
        || (process as any)?.env?.GEMINI_API_KEY
        || (import.meta as any).env?.VITE_GEMINI_API_KEY
        || (import.meta as any).env?.GEMINI_API_KEY;
      
      console.log('========================================');
      console.log('🔑 GEMINI API KEY CHECK');
      console.log('========================================');
      console.log('API Key found:', apiKey ? '✅ YES' : '❌ NO');
      if (apiKey) {
        console.log('API Key length:', apiKey.length);
        console.log('API Key (first 10 chars):', apiKey.substring(0, 10) + '...');
        console.log('API Key (last 10 chars):', '...' + apiKey.substring(apiKey.length - 10));
      }
      console.log('========================================');
      
      if (!apiKey) {
        throw new Error("API key not available");
      }
      
      console.log('[DEBUG] Creating GoogleGenAI client...');
      const ai = new GoogleGenAI({ apiKey });
      
      // Request microphone access
      console.log('[DEBUG] Requesting microphone access...');
      const baseAudioConstraints: MediaTrackConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        channelCount: 1,
        sampleRate: 16000,
      };
      const supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
      if ((supportedConstraints as any)?.voiceIsolation) {
        (baseAudioConstraints as MediaTrackConstraints & { voiceIsolation?: boolean }).voiceIsolation = true;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: baseAudioConstraints,
      });
      mediaStreamRef.current = stream;
      console.log('[DEBUG] Microphone access granted, stream active:', stream.active);
      const primaryTrack = stream.getAudioTracks()[0];
      if (primaryTrack?.applyConstraints) {
        try {
          await primaryTrack.applyConstraints({
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          });
        } catch (constraintError) {
          console.warn('[DEBUG] Unable to apply advanced audio constraints:', constraintError);
        }
      }

      // Create audio contexts
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      // Resume audio contexts if suspended (browser requirement)
      if (inputAudioContextRef.current.state === 'suspended') {
        console.log('[DEBUG] Resuming input audio context...');
        await inputAudioContextRef.current.resume();
      }
      if (outputAudioContextRef.current.state === 'suspended') {
        console.log('[DEBUG] Resuming output audio context...');
        await outputAudioContextRef.current.resume();
      }
      console.log('[DEBUG] Audio contexts ready. Input state:', inputAudioContextRef.current.state, 'Output state:', outputAudioContextRef.current.state);
      
      const systemInstruction = isAssistMode ? AGENT_ASSIST_SYSTEM_INSTRUCTION : ACTIVE_AI_SYSTEM_INSTRUCTION;

      console.log(`[DEBUG] Configuring Gemini with language: ${selectedLanguage} (${geminiLanguageCodes[selectedLanguage]})`);

      // Store session object directly when promise resolves
      let sessionObject: any = null;
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-live-preview',
        config: {
          // AUDIO modality for audio responses
          // Transcription is enabled via inputAudioTranscription and outputAudioTranscription configs
          responseModalities: [Modality.AUDIO],
          // Enable transcription - presence of these configs enables transcription
          // Even empty objects should enable transcription
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: selectedLanguage === 'en' ? 'Puck' : selectedLanguage === 'hi' ? 'Sage' : 'Aoede',
                // Note: languageCode is not supported in prebuiltVoiceConfig or speechConfig for Live API
                // Language enforcement is handled via system instructions
              }
            },
            // Note: languageCode removed - not supported in Live API speechConfig
            // Language is enforced via system instructions instead
          },
          // Re-enable tools - system instruction references updateDashboard function
          tools: [{ functionDeclarations: [updateDashboardFunctionDeclaration] }],
          systemInstruction: systemInstruction,
        },
        callbacks: {
          onopen: async () => {
            console.log('[DEBUG] Session opened, setting up audio...');
            isSessionActiveRef.current = true;
            setCallStatus(CallStatus.ACTIVE);
            
            // CRITICAL: Store session immediately - promise should resolve before or during onopen
            // Use the sessionObject variable to avoid ref timing issues
            sessionPromise.then((session) => {
              sessionObject = session;
              sessionRef.current = session;
              console.log('[DEBUG] Session stored and ready for audio');
            }).catch((err) => {
              console.error('[DEBUG] Error storing session:', err);
              isSessionActiveRef.current = false;
            });
            
            // Wait briefly for session to be available (max 100ms)
            let waitCount = 0;
            while (!sessionObject && waitCount < 10) {
              await new Promise(resolve => setTimeout(resolve, 10));
              waitCount++;
            }
            
            if (!sessionObject) {
              console.warn('[DEBUG] Session not yet available, will retry in audio handler');
            }
            
            // CRITICAL: Ensure audio context is running BEFORE creating nodes
            if (inputAudioContextRef.current!.state === 'suspended') {
              console.log('[DEBUG] Audio context suspended, resuming...');
              await inputAudioContextRef.current!.resume();
              console.log('[DEBUG] Audio context resumed, state:', inputAudioContextRef.current!.state);
            }
            
            // Verify audio context is running
            if (inputAudioContextRef.current!.state !== 'running') {
              console.error('[DEBUG] ❌ Audio context is not running! State:', inputAudioContextRef.current!.state);
              console.error('[DEBUG] Attempting to resume again...');
              try {
                await inputAudioContextRef.current!.resume();
                console.log('[DEBUG] Audio context state after resume:', inputAudioContextRef.current!.state);
              } catch (e) {
                console.error('[DEBUG] Failed to resume audio context:', e);
              }
            }
            
            // CRITICAL: Ensure audio context is RUNNING before creating nodes
            if (inputAudioContextRef.current!.state !== 'running') {
              console.warn('[DEBUG] ⚠️ Audio context not running, forcing resume...');
              await inputAudioContextRef.current!.resume();
              // Wait a bit for state to update
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            
            console.log('[DEBUG] Audio context state:', inputAudioContextRef.current!.state);
            
            // Use ScriptProcessorNode - it's deprecated but most reliable for this use case
            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            
            // Create ScriptProcessorNode to capture audio
            // CRITICAL: ScriptProcessorNode MUST be connected to a destination to work
            // We'll connect it through a gain node (gain=0) to destination to ensure it processes
            const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(AUDIO_BUFFER_SIZE, 1, 1);
            processorRef.current = scriptProcessor;
            
            // Add a high-pass filter and compressor to strip HVAC hums + steady noise
            const highPassFilter = inputAudioContextRef.current!.createBiquadFilter();
            highPassFilter.type = 'highpass';
            highPassFilter.frequency.value = 120;
            
            const dynamicsCompressor = inputAudioContextRef.current!.createDynamicsCompressor();
            dynamicsCompressor.threshold.value = -50;
            dynamicsCompressor.knee.value = 32;
            dynamicsCompressor.ratio.value = 12;
            dynamicsCompressor.attack.value = 0.003;
            dynamicsCompressor.release.value = 0.25;
            
            // Create a gain node with gain 0 to prevent feedback but allow processing
            const outputGain = inputAudioContextRef.current!.createGain();
            outputGain.gain.value = 0; // Silent output to prevent feedback
            
            let audioChunkCount = 0;
            let lastAudioChunkTime = Date.now();
            let firstChunkReceived = false;
            let audioCheckTimeout: NodeJS.Timeout | null = null;
            
            // Set up handler BEFORE connecting to ensure it's ready
            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              // Clear timeout on first chunk
              if (!firstChunkReceived && audioCheckTimeout) {
                clearTimeout(audioCheckTimeout);
                audioCheckTimeout = null;
              }
              
              // Update last chunk time
              lastAudioChunkTime = Date.now();
              
              // Skip if session not ready yet
              if (!isSessionActiveRef.current) {
                return;
              }
              
              // Use sessionObject if available, otherwise try sessionRef
              const session = sessionObject || sessionRef.current;
              if (!session) {
                // Session promise hasn't resolved yet - skip this chunk
                // This only happens for the first few chunks (< 100ms)
                if (audioChunkCount === 0) {
                  console.warn('[DEBUG] ⚠️ Audio chunk arrived but session not ready yet');
                }
                return;
              }
              
              // Get audio data from input buffer
              const inputBuffer = audioProcessingEvent.inputBuffer;
              const inputData = inputBuffer.getChannelData(0);
              
              // Debug: Verify we're getting audio data
              if (!firstChunkReceived) {
                firstChunkReceived = true;
                console.log('[DEBUG] 🎤 ✅ FIRST AUDIO CHUNK RECEIVED!');
                console.log('[DEBUG] 🎤 First audio chunk - inputBuffer sampleRate:', inputBuffer.sampleRate);
                console.log('[DEBUG] 🎤 First audio chunk - inputBuffer length:', inputBuffer.length);
                console.log('[DEBUG] 🎤 First audio chunk - inputData length:', inputData.length);
                console.log('[DEBUG] 🎤 First audio chunk - inputData sample:', inputData[0]);
                console.log('[DEBUG] ✅ ScriptProcessorNode is firing! Audio capture is working.');
              }
              
              // Calculate audio level with RMS based gating
              let sum = 0;
              let sumSquares = 0;
              let maxSample = 0;
              for (let i = 0; i < inputData.length; i++) {
                const sample = inputData[i];
                const abs = Math.abs(sample);
                sum += abs;
                sumSquares += sample * sample;
                if (abs > maxSample) maxSample = abs;
              }
              const avgLevel = sum / inputData.length;
              const rmsLevel = Math.sqrt(sumSquares / inputData.length);
              const noiseProfile = noiseProfileRef.current;
              noiseProfile.floor = Math.max(
                MIN_SPEECH_THRESHOLD / 4,
                (noiseProfile.floor * 0.98) + (rmsLevel * 0.02)
              );
              // More sensitive threshold - use lower multiplier for better speech detection
              const threshold = Math.max(noiseProfile.floor * 3.0, MIN_SPEECH_THRESHOLD);
              const isSpeech = rmsLevel > threshold;
              const tracker = silenceTrackerRef.current;
              const now = Date.now();
              
              if (isSpeech) {
                // User is speaking - reset silence tracking and ensure turn is not ended
                tracker.lastAudioTime = now;
                tracker.silenceStart = 0;
                tracker.turnEnded = false; // Reset turn ended flag when speech detected
                tracker.turnEndedAt = 0; // Reset turn ended timestamp
                noiseProfile.lastSpeechTs = now;
              } else if (tracker.lastAudioTime && !tracker.silenceStart) {
                // User stopped speaking - start tracking silence
                tracker.silenceStart = now;
              }
              
              // Send audio continuously to keep connection alive
              audioChunkCount++;
              if (audioChunkCount === 1) {
                console.log('[DEBUG] ✅ First audio chunk processed! Audio capture is working.');
              }
              if (audioChunkCount % 100 === 0) {
                console.log(`[DEBUG] Audio RMS: ${rmsLevel.toFixed(5)}, threshold: ${threshold.toFixed(5)}, chunks: ${audioChunkCount}`);
              }
              
              const pcmBlob = createBlob(inputData);
              
              const timeSinceLastAudio = tracker.lastAudioTime ? (now - tracker.lastAudioTime) : Infinity;
              const silenceDuration = tracker.silenceStart ? (now - tracker.silenceStart) : 0;
              
              // Determine if we should end the turn
              // Only end turn if:
              // 1. User is not speaking (silence detected)
              // 2. Silence has been tracked (silenceStart is set)
              // 3. Silence duration exceeds threshold (user has stopped speaking)
              const shouldEndTurn = !isSpeech && tracker.silenceStart && silenceDuration > END_TURN_SILENCE_MS;
              
              // If we should end turn, mark it and send endOfTurn signal
              // Send endOfTurn multiple times during the confirmation window for reliability
              const timeSinceTurnEnded = tracker.turnEnded ? (now - tracker.turnEndedAt) : Infinity;
              const shouldSendEndOfTurn = shouldEndTurn && (!tracker.turnEnded || timeSinceTurnEnded < END_TURN_CONFIRMATION_MS);
              
              // Continue sending audio for a short period after turn ends to allow Gemini to process
              const CONTINUE_AUDIO_AFTER_TURN_MS = 800; // Keep sending audio for 800ms after turn ends (increased for reliability)
              const shouldContinueAfterTurn = tracker.turnEnded && timeSinceTurnEnded < CONTINUE_AUDIO_AFTER_TURN_MS;
              
              // Also send endOfTurn during continuation period for extra reliability
              const shouldSendEndOfTurnDuringContinuation = shouldContinueAfterTurn && timeSinceTurnEnded < END_TURN_CONFIRMATION_MS;
                
              if (shouldEndTurn && !tracker.turnEnded) {
                tracker.turnEnded = true;
                tracker.turnEndedAt = now;
                if (audioChunkCount % 20 === 0) {
                  console.log(`[DEBUG] 🎯 Ending turn - silence duration: ${silenceDuration}ms`);
                }
              }
              
              // Send audio if:
              // 1. User is speaking, OR
              // 2. Recent audio (within MAX_SILENCE_BEFORE_DROP), OR
              // 3. We're ending/confirming the turn (send chunks with endOfTurn flag), OR
              // 4. We're continuing to send audio after turn ends (to allow Gemini to process)
              const shouldSendAudio = isSpeech || timeSinceLastAudio < MAX_SILENCE_BEFORE_DROP || shouldSendEndOfTurn || shouldContinueAfterTurn;
              
              if (!shouldSendAudio) {
                if (audioChunkCount % 200 === 0) {
                  console.log('[DEBUG] ⏸️ Skipping gated audio chunk (silence maintained)');
                }
                return;
                }
                
              try {
                // CRITICAL: Send audio immediately to keep WebSocket alive
                // Send endOfTurn signal multiple times during confirmation window for reliability
                // Also send during continuation period for extra reliability
                const shouldSendEndOfTurnNow = shouldSendEndOfTurn || shouldSendEndOfTurnDuringContinuation;
                session.sendRealtimeInput({ 
                  media: pcmBlob,
                  ...(shouldSendEndOfTurnNow ? { endOfTurn: true } : {})
                });
              } catch (error: any) {
                if (error?.message?.includes('CLOSING') || error?.message?.includes('CLOSED')) {
                  console.warn('[DEBUG] Session closed while sending audio');
                  isSessionActiveRef.current = false;
                  return;
                }
                console.error('[DEBUG] Could not send audio:', error);
                console.error('[DEBUG] Error details:', error.message, error.stack);
              }
            };
            
            // Connect: source -> highpass -> compressor -> processor -> gain(0) -> destination
            // ScriptProcessorNode MUST be connected to a destination to trigger onaudioprocess
            // Gain node at 0 prevents feedback while ensuring audio flows through the processor
            source.connect(highPassFilter);
            highPassFilter.connect(dynamicsCompressor);
            dynamicsCompressor.connect(scriptProcessor);
            scriptProcessor.connect(outputGain);
            outputGain.connect(inputAudioContextRef.current!.destination);
            
            // CRITICAL: Verify the connection is complete
            console.log('[DEBUG] Audio graph connected: source -> HPF -> compressor -> processor -> gain(0) -> destination');
            console.log('[DEBUG] Audio context state after connect:', inputAudioContextRef.current!.state);
            
            // CRITICAL: Final check - ensure audio context is running
            if (inputAudioContextRef.current!.state !== 'running') {
              console.error('[DEBUG] ❌ Audio context still not running after connect!');
              console.error('[DEBUG] Attempting final resume...');
              try {
              await inputAudioContextRef.current!.resume();
                await new Promise(resolve => setTimeout(resolve, 100));
                console.log('[DEBUG] Audio context state after final resume:', inputAudioContextRef.current!.state);
              } catch (e) {
                console.error('[DEBUG] Failed to resume audio context:', e);
            }
            }
            
            // Set up a timeout to detect if ScriptProcessorNode never fires
            audioCheckTimeout = setTimeout(() => {
              if (!firstChunkReceived) {
                console.error('[DEBUG] ❌ ERROR: ScriptProcessorNode did not fire within 2 seconds!');
                console.error('[DEBUG] This usually means:');
                console.error('[DEBUG] 1. Audio context is not running (state:', inputAudioContextRef.current!.state, ')');
                console.error('[DEBUG] 2. Microphone permissions not granted');
                console.error('[DEBUG] 3. Audio track is muted or disabled');
                console.error('[DEBUG] 4. Browser compatibility issue with ScriptProcessorNode');
                const track = stream.getAudioTracks()[0];
                if (track) {
                  console.error('[DEBUG] Track enabled:', track.enabled);
                  console.error('[DEBUG] Track muted:', track.muted);
                  console.error('[DEBUG] Track readyState:', track.readyState);
                }
              }
            }, 2000);
            
            console.log('[DEBUG] Audio processing ready. Stream tracks:', stream.getAudioTracks().length);
            const track = stream.getAudioTracks()[0];
            console.log('[DEBUG] Audio track settings:', track?.getSettings());
            console.log('[DEBUG] Audio track enabled:', track?.enabled);
            console.log('[DEBUG] Audio track muted:', track?.muted);
            console.log('[DEBUG] Audio track readyState:', track?.readyState);
            console.log('[DEBUG] Using ScriptProcessorNode for audio capture');
            console.log('[DEBUG] Audio graph: source -> HPF -> compressor -> processor -> gain(0) -> destination');
            
            // Verify ScriptProcessorNode will fire by checking connection
            console.log('[DEBUG] ScriptProcessorNode inputs:', scriptProcessor.numberOfInputs);
            console.log('[DEBUG] ScriptProcessorNode outputs:', scriptProcessor.numberOfOutputs);
            console.log('[DEBUG] ScriptProcessorNode connected:', scriptProcessor.numberOfInputs > 0 && scriptProcessor.numberOfOutputs > 0);
            
            // Test: Try to get audio level from the track directly
            if (track) {
              track.onmute = () => console.warn('[DEBUG] ⚠️ Audio track muted!');
              track.onunmute = () => console.log('[DEBUG] ✅ Audio track unmuted');
            }
            
            // CRITICAL: Send initial audio chunk IMMEDIATELY to keep WebSocket alive
            // Also set up continuous keep-alive to prevent closure
            console.log('[DEBUG] Sending initial test audio chunk immediately...');
            const sendInitialChunk = async () => {
              // Wait for session to be available (should be ready after onopen wait)
              let attempts = 0;
              while (!sessionObject && !sessionRef.current && attempts < 20) {
                await new Promise(resolve => setTimeout(resolve, 10));
                attempts++;
              }
              
              const session = sessionObject || sessionRef.current;
              if (!session) {
                console.error('[DEBUG] ❌ Session not available after 200ms - WebSocket may close');
                return;
              }
              
              try {
                // Send initial chunk
                const testData = new Float32Array(4096).fill(0);
                const testBlob = createBlob(testData);
                session.sendRealtimeInput({ media: testBlob });
                console.log('[DEBUG] ✅ Initial test chunk sent successfully');
                
                // Set up keep-alive: send silent chunks every 50ms until real audio starts
                // This prevents the WebSocket from closing due to inactivity
                const keepAliveInterval = setInterval(() => {
                  const currentSession = sessionObject || sessionRef.current;
                  if (!currentSession || !isSessionActiveRef.current) {
                    clearInterval(keepAliveInterval);
                    return;
                  }
                  
                  // Stop keep-alive once real audio chunks start flowing
                  if (audioChunkCount > 10) {
                    clearInterval(keepAliveInterval);
                    console.log('[DEBUG] Keep-alive stopped - real audio is flowing');
                    return;
                  }
                  
                  try {
                    const keepAliveData = new Float32Array(4096).fill(0);
                    const keepAliveBlob = createBlob(keepAliveData);
                    currentSession.sendRealtimeInput({ media: keepAliveBlob });
                  } catch (e: any) {
                    if (e?.message?.includes('CLOSING') || e?.message?.includes('CLOSED')) {
                      clearInterval(keepAliveInterval);
                      return;
                    }
                    console.warn('[DEBUG] Keep-alive chunk failed:', e.message);
                  }
                }, 50);
                
                // Store interval reference for cleanup
                (window as any).__keepAliveInterval = keepAliveInterval;
              } catch (e: any) {
                console.error('[DEBUG] Failed to send initial chunk:', e);
                if (e?.message?.includes('CLOSING') || e?.message?.includes('CLOSED')) {
                  console.error('[DEBUG] WebSocket already closing - connection failed');
                } else {
                  console.error('[DEBUG] Error details:', e.message, e.stack);
                }
              }
            };
            
            // Send immediately (non-blocking)
            sendInitialChunk();
            
            // Verify audio is being processed
            setTimeout(() => {
              const timeSinceLastChunk = Date.now() - lastAudioChunkTime;
              if (audioChunkCount === 0 || timeSinceLastChunk > 2000) {
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
                console.error('[DEBUG] ⚠️ ScriptProcessorNode may not be receiving audio. Check:');
                console.error('[DEBUG]   1. Is microphone permission granted?');
                console.error('[DEBUG]   2. Is microphone working in other apps?');
                console.error('[DEBUG]   3. Is audio context running?', inputAudioContextRef.current!.state);
                
                // Try to force audio context to resume
                if (inputAudioContextRef.current!.state === 'suspended') {
                  console.log('[DEBUG] Attempting to resume audio context...');
                  inputAudioContextRef.current!.resume().then(() => {
                    console.log('[DEBUG] Audio context resumed');
                  }).catch((e) => {
                    console.error('[DEBUG] Failed to resume audio context:', e);
                  });
                }
                
                // Send periodic test chunks to keep session alive if ScriptProcessorNode isn't firing
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
                      console.log('[DEBUG] Fallback chunk sent (ScriptProcessorNode not firing)');
                    }
                  } catch (e) {
                    console.error('[DEBUG] Fallback chunk failed:', e);
                    clearInterval(fallbackInterval);
                  }
                }, 100);
                
                // Store interval ID for cleanup
                (window as any).__audioFallbackInterval = fallbackInterval;
              } else {
                console.log(`[DEBUG] ✅ Audio capture confirmed - processed ${audioChunkCount} chunks`);
                console.log(`[DEBUG] ✅ Last chunk received ${timeSinceLastChunk}ms ago`);
              }
            }, 1000);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Skip processing messages when call is paused
            if (isCallPausedRef.current) {
              console.log('[DEBUG] ⏸️ Call is paused, ignoring message');
              return;
            }
            
            // Log ALL message properties to see what we're receiving
            console.log('[DEBUG] 📨 Received message type:', typeof message);
            console.log('[DEBUG] 📨 Full message:', message);
            try {
              const msgKeys = Object.keys(message);
              console.log('[DEBUG] 📋 Message keys:', msgKeys);
              
              // Check all possible properties
              if (message.setupComplete) console.log('[DEBUG] ✅ setupComplete:', message.setupComplete);
              if (message.serverContent) {
                console.log('[DEBUG] 📦 serverContent keys:', Object.keys(message.serverContent));
                console.log('[DEBUG] 📦 Full serverContent:', JSON.stringify(message.serverContent, null, 2));
              } else {
                console.log('[DEBUG] ⚠️ serverContent is undefined');
              }
              if (message.toolCall) console.log('[DEBUG] 🔧 toolCall:', message.toolCall);
              if ((message as any).modelTurn) console.log('[DEBUG] 🎤 modelTurn:', (message as any).modelTurn);
              if ((message as any).inputTranscription) console.log('[DEBUG] 🎙️ inputTranscription:', (message as any).inputTranscription);
              if ((message as any).outputTranscription) console.log('[DEBUG] 🔊 outputTranscription:', (message as any).outputTranscription);
            } catch (e) {
              console.log('[DEBUG] ❌ Error logging message:', e);
            }
            
            // Handle setupComplete - session is ready for conversation
            if (message.setupComplete) {
              console.log('[DEBUG] ✅ Setup complete! Session is ready for conversation.');
            }
            
            // Handle goAway - API is requesting connection closure
            if ((message as any).goAway) {
              console.warn('[DEBUG] ⚠️ Received goAway message:', (message as any).goAway);
              console.warn('[DEBUG] ⚠️ API is requesting connection closure');
              // Don't close immediately - let onclose handle it
            }
            
            if(message.toolCall?.functionCalls) {
              for (const fc of message.toolCall.functionCalls) {
                if(fc.name === 'updateDashboard' && fc.args) {
                    const { clientProfile: newProfile, suggestedQuestions: newQuestions, communityRecommendations: newRecs, agentGuidance: newGuidance } = fc.args as any;
                    
                    if (newProfile) {
                      const normalized = normalizeClientProfile(newProfile);
                      if (Object.keys(normalized).length) {
                        setClientProfile(prev => ({ ...prev, ...normalized }));
                      }
                    }
                    if(newQuestions) {
                        setSuggestedQuestions(newQuestions);
                    }
                    if(newRecs) {
                        setRecommendations(newRecs);
                    }
                    if (newGuidance) {
                        setAgentGuidance(newGuidance);
                    }
                    handleAnalysisResults({
                      client_info: newProfile,
                      recommendations: Array.isArray(newRecs) ? newRecs.map((rec: any, index: number) => ({
                        community_name: rec.name,
                        final_rank: index + 1,
                        combined_rank_score: 0,
                        key_metrics: {
                          monthly_fee: rec.price ? Number(rec.price.replace(/[^0-9.]/g, '')) : undefined,
                          distance_miles: rec.distance || undefined,
                          est_waitlist: rec.availability || undefined,
                          care_level: rec.careLevels?.[0],
                          zip_code: rec.address?.replace(/\D/g, '') || undefined,
                        },
                        explanations: {
                          holistic_reason: rec.reason,
                          business_reason: null,
                          total_cost_reason: null,
                          distance_reason: null,
                          availability_reason: null,
                          budget_efficiency_reason: null,
                          amenity_reason: null,
                        },
                        rankings: {
                          business_rank: null,
                          total_cost_rank: null,
                          distance_rank: null,
                          availability_rank: null,
                          budget_efficiency_rank: null,
                          amenity_rank: null,
                          holistic_rank: null,
                        }
                      })) : [],
                      performance_metrics: null
                    }, 'live');

                    if (sessionRef.current) {
                      try {
                        sessionRef.current.sendToolResponse({
                          functionResponses: {
                            id: fc.id,
                            name: fc.name,
                            response: { result: "Dashboard updated successfully." }
                          }
                        });
                      } catch (error) {
                        console.debug('[DEBUG] Could not send tool response:', error);
                      }
                    }
                }
              }
            }
            // Check for input transcription (user speech)
            // Handle both incremental updates and final transcription
            if (message.serverContent?.inputTranscription?.text) {
                const rawText = message.serverContent.inputTranscription.text;
                if (rawText && typeof rawText === 'string' && rawText.length > 0) {
                  // Pass raw text without any processing - preserve everything
                  updateTranscriptionEntry('user', rawText);
              }
            }
            
            // Check for output transcription (AI speech)
            // Handle both incremental updates and final transcription
            if (message.serverContent?.outputTranscription?.text) {
                const rawText = message.serverContent.outputTranscription.text;
                if (rawText && typeof rawText === 'string' && rawText.length > 0) {
                  // Pass raw text without any processing - preserve everything
                  updateTranscriptionEntry('model', rawText);
                }
            }
            
            // Handle generationComplete - final transcription is ready
            if (message.serverContent?.generationComplete) {
              // Final transcription should already be in the last entry
              // This event indicates Gemini has finished generating the response
            }
            
            // Handle turnComplete - turn is finished, transcription is final
            if (message.serverContent?.turnComplete) {
              // Turn is complete, transcription should be final
              // No action needed as we've already updated with the latest text
            }
             const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              if (!isAgentAssistMode && base64Audio && outputAudioContextRef.current) {
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
            console.error('[DEBUG] ❌ Session error:', e);
            console.error('[DEBUG] Error type:', e.type);
            console.error('[DEBUG] Error message:', e.message);
            console.error('[DEBUG] Error details:', JSON.stringify(e, null, 2));
            isSessionActiveRef.current = false;
            setCallStatus(CallStatus.ERROR);
            alert(`Session error: ${e.message || 'Unknown error'}`);
            handleEndCall();
          },
          onclose: (event?: any) => {
            console.log('[DEBUG] Session closed.');
            isSessionActiveRef.current = false;
            
            if (event) {
              if (event.code !== undefined) {
                console.log('[DEBUG] Close code:', event.code);
                console.log('[DEBUG] Close reason:', event.reason || 'No reason provided');
                console.log('[DEBUG] Was clean:', event.wasClean);
                
                // Only set ERROR for abnormal closures (not normal close codes 1000 or 1001)
                // Normal closures happen when user ends call or session closes cleanly
                if (event.code !== 1000 && event.code !== 1001) {
                  console.error('[DEBUG] ❌ Abnormal WebSocket closure! Code:', event.code, 'Reason:', event.reason);
                  setCallStatus(CallStatus.ERROR);
                } else {
                  // Normal closure - set to IDLE if not already set by handleEndCall
                  console.log('[DEBUG] Normal WebSocket closure');
                  setCallStatus(CallStatus.IDLE);
                }
              } else {
                console.log('[DEBUG] Close event:', event);
                // If no code, assume normal closure
                setCallStatus(CallStatus.IDLE);
              }
            } else {
              // No event object - assume normal closure
              setCallStatus(CallStatus.IDLE);
            }
            
            // Clean up keep-alive interval
            if ((window as any).__keepAliveInterval) {
              clearInterval((window as any).__keepAliveInterval);
              (window as any).__keepAliveInterval = null;
            }
          },
        },
      });
      console.log('[DEBUG] Session promise created, waiting for connection...');
      
      // Store session when promise resolves (backup in case onopen doesn't set it)
      sessionPromise.then((session) => {
        if (!sessionRef.current) {
          sessionRef.current = session;
          console.log('[DEBUG] Session stored from promise resolution');
        }
      }).catch((err) => {
        console.error('[DEBUG] Session promise rejected:', err);
        isSessionActiveRef.current = false;
        setCallStatus(CallStatus.ERROR);
      });
      
      // Wait for promise to resolve (but don't block onopen callback)
      await sessionPromise;
      console.log('[DEBUG] Session promise resolved');
    } catch (error) {
      console.error('[DEBUG] Failed to start call:', error);
      setCallStatus(CallStatus.ERROR);
      alert(`Failed to start call: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [ACTIVE_AI_SYSTEM_INSTRUCTION, AGENT_ASSIST_SYSTEM_INSTRUCTION, selectedLanguage, geminiLanguageCodes, resetState, applyTranscriptionSnapshot, resetAudioTracking, updateTranscriptionEntry]);

  // OLD CODE - KEEP FOR FALLBACK IF NEEDED
  const handleStartCallOLD = useCallback(async (isAssistMode = false) => {
    if(!isAssistMode) {
        resetState();
    }
    setIsCallPaused(false);
    isCallPausedRef.current = false;
    setCallStatus(CallStatus.CONNECTING);
    setIsAgentAssistMode(isAssistMode);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const systemInstruction = isAssistMode ? AGENT_ASSIST_SYSTEM_INSTRUCTION : ACTIVE_AI_SYSTEM_INSTRUCTION;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-live-preview',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: [updateDashboardFunctionDeclaration] }],
          systemInstruction: systemInstruction,
        },
        callbacks: {
          onopen: () => {
            setCallStatus(CallStatus.ACTIVE);
            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
            processorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              if (isCallPausedRef.current) return;
              if (!sessionRef.current) return; // Session closed
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then((session) => {
                  if (sessionRef.current && session === sessionRef.current) {
                    try {
                      session.sendRealtimeInput({ media: pcmBlob });
                    } catch (error) {
                      // Session might be closed, ignore
                      console.debug('Could not send audio (session closed):', error);
                    }
                  }
              }).catch(() => {
                // Session closed, ignore
              });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Skip processing messages when call is paused
            if (isCallPausedRef.current) {
              console.log('[DEBUG] ⏸️ Call is paused, ignoring message');
              return;
            }
            
            console.log('[DEBUG] Received message:', message);
            if(message.toolCall?.functionCalls) {
              for (const fc of message.toolCall.functionCalls) {
                if(fc.name === 'updateDashboard' && fc.args) {
                    const { clientProfile: newProfile, suggestedQuestions: newQuestions, communityRecommendations: newRecs, agentGuidance: newGuidance } = fc.args as any;
                    
                    setClientProfile(prev => ({...prev, ...(newProfile || {})}));
                    if(newQuestions) {
                        setSuggestedQuestions(newQuestions);
                    }
                    if(newRecs) {
                        setRecommendations(newRecs);
                    }
                    if (newGuidance) {
                        setAgentGuidance(newGuidance);
                    }

                    if (sessionRef.current) {
                      try {
                        sessionRef.current.sendToolResponse({
                          functionResponses: {
                            id: fc.id,
                            name: fc.name,
                            response: { result: "Dashboard updated successfully." }
                          }
                        });
                      } catch (error) {
                        console.debug('[DEBUG] Could not send tool response:', error);
                      }
                    }
                }
              }
            }
            // Check for input transcription (user speech)
            // Handle both incremental updates and final transcription
            if (message.serverContent?.inputTranscription?.text) {
                const rawText = message.serverContent.inputTranscription.text;
                if (rawText && typeof rawText === 'string' && rawText.length > 0) {
                  // Pass raw text without any processing - preserve everything
                  updateTranscriptionEntry('user', rawText);
              }
            }
            
            // Check for output transcription (AI speech)
            // Handle both incremental updates and final transcription
            if (message.serverContent?.outputTranscription?.text) {
                const rawText = message.serverContent.outputTranscription.text;
                if (rawText && typeof rawText === 'string' && rawText.length > 0) {
                  // Pass raw text without any processing - preserve everything
                  updateTranscriptionEntry('model', rawText);
                }
            }
            
            // Handle generationComplete - final transcription is ready
            if (message.serverContent?.generationComplete) {
              // Final transcription should already be in the last entry
              // This event indicates Gemini has finished generating the response
            }
            
            // Handle turnComplete - turn is finished, transcription is final
            if (message.serverContent?.turnComplete) {
              // Turn is complete, transcription should be final
              // No action needed as we've already updated with the latest text
            }
             const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              // Don't play audio when paused
              if (!isAgentAssistMode && base64Audio && outputAudioContextRef.current && !isCallPausedRef.current) {
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
            console.error('Session error:', e);
            setCallStatus(CallStatus.ERROR);
            handleEndCall();
          },
          onclose: () => {
            console.log('Session closed.');
          },
        },
      });
      sessionRef.current = await sessionPromise;

    } catch (error) {
      console.error('Failed to start call (OLD):', error);
      setCallStatus(CallStatus.ERROR);
    }
  }, [ACTIVE_AI_SYSTEM_INSTRUCTION, AGENT_ASSIST_SYSTEM_INSTRUCTION, selectedLanguage, geminiLanguageCodes, resetState, updateTranscriptionEntry]);

  

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
        } catch (e) {
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
    if ((window as any).__audioFallbackInterval) {
      clearInterval((window as any).__audioFallbackInterval);
      (window as any).__audioFallbackInterval = null;
    }
    
    // Clear keep-alive interval if it exists
    if ((window as any).__keepAliveInterval) {
      clearInterval((window as any).__keepAliveInterval);
      (window as any).__keepAliveInterval = null;
    }
    
    // Then close the session
    if (sessionRef.current) {
      try {
        sessionRef.current.close();
      } catch (error) {
        // Session might already be closed, ignore
        console.debug('[DEBUG] Session already closed:', error);
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
    
    resetAudioTracking();
    resetTranscriptionTracking();
    
    if (setIdleOnEnd) {
      setCallStatus(CallStatus.IDLE);
    }
  }, []);
  
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

  const handleToggleAssistMode = useCallback(() => {
    if (callStatus !== CallStatus.ACTIVE) return;
    const newMode = !isAgentAssistMode;
    handleEndCall(false); 
    handleStartCall(newMode);
  }, [callStatus, isAgentAssistMode, handleEndCall, handleStartCall]);

  const handleEscalateCall = () => {
    alert('Call escalated! A manager has been notified and will join shortly.');
  };

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
    } catch (error: any) {
        alert(`Error saving community: ${error.message}`);
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
        } catch (error: any) {
             alert(`Error deleting community: ${error.message}`);
        }
    }
  };

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
            <div className="flex flex-wrap justify-center gap-12 md:gap-16 lg:gap-20 text-base sm:text-lg text-gray-600 mt-10 pt-10 border-t border-gray-200">
              <div className="text-center min-w-[200px]">
                <p className="font-bold text-gray-800 mb-2 text-lg sm:text-xl">Project Team</p>
                <p className="leading-relaxed">Shivam Sharma, Ritwik Agrawal,<br />Manu Jain, Yu Chen Lin (Ryan)</p>
              </div>
              <div className="text-center min-w-[200px]">
                <p className="font-bold text-gray-800 mb-2 text-lg sm:text-xl">Faculty Advisor</p>
                <p className="leading-relaxed">Professor Elizabeth Mohr</p>
              </div>
              <div className="text-center min-w-[200px]">
                <p className="font-bold text-gray-800 mb-2 text-lg sm:text-xl">Client Partner</p>
                <p className="leading-relaxed">Neil Russell, Culina Health</p>
              </div>
            </div>
          </div>

          {!showVisionPanel && (
            <>
              {/* Watch Demo Card - Medium Attention with Glow */}
              <div className="flex justify-center my-8">
                <a
                  href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative inline-flex items-center gap-3 rounded-xl border-2 border-red-300 bg-red-50/80 backdrop-blur px-5 py-3 text-sm font-medium text-red-700 hover:text-red-900 hover:border-red-400 hover:bg-red-50 transition-all duration-200 shadow-lg shadow-red-200/50 hover:shadow-xl hover:shadow-red-300/60 ring-2 ring-red-200/50 hover:ring-red-300/70"
                >
                  <svg className="w-5 h-5 text-red-600 group-hover:text-red-700 transition-colors" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                  </svg>
                  <span>Watch Demo / Walkthrough</span>
                  <span className="ml-2 text-xs font-semibold text-red-500 bg-red-100 px-2 py-0.5 rounded-full">Coming soon</span>
                </a>
              </div>

              <div className="grid gap-8 md:grid-cols-2 max-w-5xl mx-auto">
              {/* Primary Action Card - Launch Assistant */}
              <button
                onClick={() => {
                  setHasLaunchedAssistant(true);
                  setShowVisionPanel(false);
                }}
                className="group relative rounded-3xl border-2 border-blue-400 bg-gradient-to-br from-blue-50 via-white to-blue-50/50 backdrop-blur shadow-lg hover:shadow-2xl transition-all duration-500 p-10 text-left transform hover:scale-[1.02] cursor-pointer overflow-hidden ring-4 ring-blue-200/50 hover:ring-blue-300/70 animate-pulse"
              >
                {/* Animated background glow */}
                <div className="absolute inset-0 bg-gradient-to-r from-blue-400/20 via-blue-500/30 to-blue-400/20 opacity-60 group-hover:opacity-100 transition-opacity duration-500 animate-pulse" />
                
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-4">
                    <span className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold uppercase tracking-wide rounded-full">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                      Start Here
                    </span>
                    <svg className="h-8 w-8 text-blue-600 group-hover:translate-x-2 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </div>
                  <h2 className="text-3xl font-black text-gray-900 mb-3">Launch AI Placement Assistant</h2>
                  <p className="text-gray-700 text-base leading-relaxed mb-6">
                    Start a live consultation session. The AI will guide conversations, capture client information, and provide real-time community recommendations.
                  </p>
                  <ul className="space-y-3 text-sm text-gray-700">
                    <li className="flex items-center gap-3">
                      <span className="flex-shrink-0 h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
                      <span>Streaming audio with live AI coaching</span>
                    </li>
                    <li className="flex items-center gap-3">
                      <span className="flex-shrink-0 h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
                      <span>Partner-aware community matching</span>
                    </li>
                    <li className="flex items-center gap-3">
                      <span className="flex-shrink-0 h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
                      <span>Instant CRM-ready summaries</span>
                    </li>
                  </ul>
                </div>
              </button>

              {/* Secondary Action Card - View Playbook */}
              <button
                onClick={() => setShowVisionPanel(true)}
                className="group rounded-3xl border-2 border-gray-300 bg-white/90 backdrop-blur shadow-lg hover:shadow-xl hover:border-gray-400 transition-all duration-300 p-10 text-left transform hover:scale-[1.01] cursor-pointer"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="inline-flex items-center gap-2 px-3 py-1 bg-amber-100 text-amber-700 text-xs font-bold uppercase tracking-wide rounded-full">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    Learn More
                  </span>
                  <svg className="h-8 w-8 text-gray-600 group-hover:translate-x-2 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </div>
                <h2 className="text-3xl font-black text-gray-900 mb-3">Product Vision & Playbook</h2>
                <p className="text-gray-700 text-base leading-relaxed mb-6">
                  Explore the complete product vision, workflow guides, future roadmap, and business value proposition.
                </p>
                <div className="space-y-3 text-sm text-gray-700">
                  <div className="flex items-start gap-3">
                    <span className="mt-1.5 flex-shrink-0 h-2 w-2 rounded-full bg-amber-500" />
                    <p>Complete workflow and usage guide</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="mt-1.5 flex-shrink-0 h-2 w-2 rounded-full bg-amber-500" />
                    <p>Future features and roadmap</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="mt-1.5 flex-shrink-0 h-2 w-2 rounded-full bg-amber-500" />
                    <p>Partner-first revenue strategy</p>
                  </div>
                </div>
              </button>
              </div>
            </>
          )}

          {showVisionPanel && (
            <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-white via-blue-50/30 to-white backdrop-blur shadow-xl p-10 space-y-10">
              {/* How to Use Section */}
              <section className="bg-white/80 rounded-xl p-6 border border-blue-100">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">How to use the platform</p>
                    <h3 className="text-2xl font-bold text-gray-900 mt-1">Complete Workflow Guide</h3>
                  </div>
                </div>
                <div className="grid gap-6 md:grid-cols-2 mt-6">
                  <div className="space-y-4">
                    <div className="flex gap-4">
                      <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-sm">1</div>
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-1">Start Your Consultation</h4>
                        <p className="text-sm text-gray-600">Select your language (English or Spanish), click <strong className="text-blue-600">Start Call</strong>, and grant microphone access. The AI will greet the client and begin capturing information naturally.</p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-sm">2</div>
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-1">Real-Time Dashboard Updates</h4>
                        <p className="text-sm text-gray-600">Watch as the dashboard automatically populates with client name, budget, location, care level, timeline, and special needs. The AI provides suggested questions and agent guidance in real-time.</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex gap-4">
                      <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-sm">3</div>
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-1">Review Recommendations</h4>
                        <p className="text-sm text-gray-600">Top 3-5 communities appear automatically with partner badges highlighted. Use the <strong className="text-blue-600">Compare</strong> feature to side-by-side evaluate options. Partner communities show green badges—mention them even if ranked #2 or #3 for higher commissions.</p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-sm">4</div>
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-1">Save & Export</h4>
                        <p className="text-sm text-gray-600">Click <strong className="text-blue-600">Save Summary</strong> to generate a complete consultation report. Export to CRM or share with clients. All partner placements are tracked for commission reporting.</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex gap-3">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm text-amber-800"><strong>Pro Tip:</strong> Use <strong>Transfer to Agent</strong> mode for silent coaching—the AI provides text guidance while you take over the conversation. Perfect for experienced consultants who want AI insights without AI voice.</p>
                  </div>
                </div>
              </section>

              {/* Roadmap Section */}
              <section className="bg-white/80 rounded-xl p-6 border border-purple-100">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide">Future roadmap</p>
                    <h3 className="text-2xl font-bold text-gray-900 mt-1">Coming Soon</h3>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2 mt-6">
                  <div className="p-4 bg-purple-50/50 rounded-lg border border-purple-100">
                    <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                      <span className="text-purple-600">📱</span> Mobile Agent Assist
                    </h4>
                    <p className="text-sm text-gray-600">Silent coaching mode via SMS/texting. Consultants can receive real-time guidance on mobile devices during in-person visits or calls.</p>
                  </div>
                  <div className="p-4 bg-purple-50/50 rounded-lg border border-purple-100">
                    <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                      <span className="text-purple-600">✉️</span> Automated Follow-Ups
                    </h4>
                    <p className="text-sm text-gray-600">AI-powered concierge that sends personalized recap emails, FAQs, virtual tour links, and booking reminders to clients automatically.</p>
                  </div>
                  <div className="p-4 bg-purple-50/50 rounded-lg border border-purple-100">
                    <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                      <span className="text-purple-600">🔍</span> Market Intelligence
                    </h4>
                    <p className="text-sm text-gray-600">Gap analysis layer that flags market opportunities (e.g., "No pet-friendly partners in East Bay") to guide business development.</p>
                  </div>
                  <div className="p-4 bg-purple-50/50 rounded-lg border border-purple-100">
                    <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                      <span className="text-purple-600">💰</span> Commission Dashboard
                    </h4>
                    <p className="text-sm text-gray-600">Integrated CRM with real-time partner commission tracking, payout reports, and revenue analytics for placement agencies.</p>
                  </div>
                </div>
              </section>

              {/* Business Value Section */}
              <section className="bg-gradient-to-r from-emerald-50 to-green-50 rounded-xl p-6 border-2 border-emerald-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">Business value</p>
                    <h3 className="text-2xl font-bold text-gray-900 mt-1">Partner-First Revenue Strategy</h3>
                  </div>
                </div>
                <div className="mt-6 space-y-4">
                  <div className="bg-white/80 p-5 rounded-lg border border-emerald-100">
                    <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <span className="text-emerald-600">⭐</span> Smart Partner Prioritization
                    </h4>
                    <p className="text-gray-700 leading-relaxed">
                      The AI doesn't just rank communities by "best fit"—it balances client needs with partnership economics. Every recommendation card displays a <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full"><svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg> Partner</span> badge when applicable, making it easy to identify higher-commission opportunities.
                    </p>
                  </div>
                  <div className="bg-white/80 p-5 rounded-lg border border-emerald-100">
                    <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <span className="text-emerald-600">💡</span> Upsell Even When Ranked #2 or #3
                    </h4>
                    <p className="text-gray-700 leading-relaxed">
                      The system is designed so agents can confidently mention partner communities even when they're not ranked #1. The dashboard clearly highlights partner status, and commission tracking rewards placements with partner agencies. This keeps recommendations aligned with client needs while maximizing partner revenue share across your portfolio.
                    </p>
                  </div>
                  <div className="bg-white/80 p-5 rounded-lg border border-emerald-100">
                    <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <span className="text-emerald-600">🚀</span> Multiple Activation Paths
                    </h4>
                    <p className="text-gray-700 leading-relaxed">
                      Beyond live consultations, deploy the AI as a kiosk in community lobbies for self-service inquiries, embed into referral partner portals for seamless handoffs, or use the ranking engine to benchmark new markets before opening a territory. The platform scales from individual consultant tools to enterprise-wide placement systems.
                    </p>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
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
    <div className="min-h-screen font-sans text-gray-800 bg-gradient-to-br from-[#F8F7F2] via-white to-[#e3ecff] flex flex-col">
      <header className="bg-white/95 backdrop-blur-lg sticky top-0 z-20 border-b border-gray-200">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-4 lg:gap-6 flex-shrink-0 min-w-[300px]">
              <button
                onClick={() => {
                  setHasLaunchedAssistant(false);
                  setShowVisionPanel(false);
                }}
                className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-base hover:bg-blue-700 active:bg-blue-800 transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
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

            <div className="flex items-center justify-end gap-4 flex-shrink-0">
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
              <CallControls
                status={callStatus}
                isAgentAssistMode={isAgentAssistMode}
                isCallPaused={isCallPaused}
                selectedLanguage={selectedLanguage}
                onLanguageChange={setSelectedLanguage}
                onStart={() => handleStartCall(false)}
                onEnd={() => handleEndCall()}
                onToggleAssistMode={handleToggleAssistMode}
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
    
      <main className="flex-grow max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 w-full flex flex-col gap-6 min-h-0">
        {view === 'dashboard' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-grow min-h-0">
            <div className="lg:col-span-2 flex flex-col gap-6 min-h-0">
              <RecommendationsCard 
                recommendations={recommendations}
                allCommunities={communities}
                onCompare={handleOpenComparisonModal}
                onPushToGoogleSheet={handlePushToGoogleSheet}
                onSendEmailToClient={handleSendEmailToClient}
                onSendEmailToManager={handleSendEmailToManager}
                onClear={() => resetState()}
              />
              <div className="min-h-0 h-[480px] rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
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
            <div className="space-y-6 lg:col-span-1 flex flex-col min-h-0">
              <div className="rounded-2xl border border-gray-100 bg-white shadow-sm max-h-[360px] overflow-hidden">
                <div className="max-h-[360px] overflow-y-auto pr-2">
                  <ClientProfileCard 
                    profile={clientProfile} 
                    callHistory={history}
                    onViewHistorySummary={handleViewHistorySummary}
                    isHistoryLoading={isHistoryLoading}
                  />
                </div>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-white shadow-sm flex-1 min-h-0 overflow-hidden">
                <div className="h-full max-h-[420px] overflow-y-auto pr-2">
                  <FullRecommendationsDisplay results={analysisResults} />
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
              />
            </div>
          </div>
        </div>
      )}
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
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-gray-500">
            <div className="flex flex-wrap items-center gap-4 justify-center">
              <span className="font-semibold text-gray-700">Project Team:</span>
              <span>Shivam Sharma, Ritwik Agrawal, Manu Jain, Yu Chen Lin (Ryan)</span>
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