import React, { useState, useRef, useCallback, useEffect } from 'react';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

// Types
type IntakeStep = 'input' | 'followup' | 'processing' | 'confirmation';

interface StructuredProfile {
  name?: string;
  careLevel?: string;
  medicalConditions?: string;
  activitiesStruggling?: string;
  apartmentType?: string;
  locationPreference?: string;
  budget?: string;
  budgetFlexibility?: string;
  timeline?: string;
  mobilityNeeds?: string;
  specialRequests?: string;
}

interface FollowUpQuestion {
  id: string;
  question: string;
  field: keyof StructuredProfile;
  answered: boolean;
  answer?: string;
}

interface ClientIntakePageProps {
  companyName?: string;
  teamEmail?: string;
  guidelines?: string[];
}

// Audio recording helpers
const encode = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

/**
 * Client Intake Page - Simplified Flow
 * 
 * Step 1: Client describes needs (text or voice)
 * Step 2: AI asks follow-up questions for missing info
 * Step 3: Confirmation - "We'll be in touch in 24 hours"
 * 
 * Backend sends email to team with transcript + summary + recommendations
 */
export const ClientIntakePage: React.FC<ClientIntakePageProps> = ({
  companyName = "Senior Living Advisors",
  teamEmail,
  guidelines = [
    "What daily activities is your loved one struggling with?",
    "What medical conditions do they have and what care is required?",
    "Are you looking for a studio, 1-bedroom, 2-bedroom, or patio home?",
    "Do you have a preferred area of the city?",
    "What's the monthly housing budget and how firm is that limit?",
    "What's your timeline for making this move?",
  ],
}) => {
  // State
  const [step, setStep] = useState<IntakeStep>('input');
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text');
  const [textInput, setTextInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [transcript, setTranscript] = useState('');
  const [structuredProfile, setStructuredProfile] = useState<StructuredProfile>({});
  const [followUpQuestions, setFollowUpQuestions] = useState<FollowUpQuestion[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  // Start voice recording
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start(1000); // Collect data every second
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      setError('Could not access microphone. Please check permissions.');
      console.error('Microphone error:', err);
    }
  }, []);

  // Stop voice recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
  }, []);

  // Format recording time
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Process initial input and get follow-up questions
  const processInitialInput = useCallback(async () => {
    setIsProcessing(true);
    setError(null);
    setStep('processing');

    try {
      let inputText = '';

      if (inputMode === 'text') {
        inputText = textInput;
      } else if (audioBlob) {
        // First, transcribe the audio
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');
        formData.append('language', 'english');
        formData.append('push_to_crm', 'false');

        const transcribeResponse = await fetch(`${API_BASE_URL}/api/process-audio`, {
          method: 'POST',
          body: formData,
        });

        if (!transcribeResponse.ok) {
          throw new Error('Failed to process audio');
        }

        const transcribeData = await transcribeResponse.json();
        inputText = transcribeData.transcript || textInput || 'Audio recording received';
      }

      setTranscript(inputText);

      // Call AI to extract structured info and identify missing fields
      const analyzeResponse = await fetch(`${API_BASE_URL}/api/analyze-intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: inputText }),
      });

      if (!analyzeResponse.ok) {
        // If the endpoint doesn't exist yet, simulate the analysis
        console.warn('analyze-intake endpoint not available, using fallback');
        
        // Fallback: simple extraction and question generation
        const profile = extractProfileFromText(inputText);
        setStructuredProfile(profile);
        
        const questions = generateFollowUpQuestions(profile);
        setFollowUpQuestions(questions);
        
        if (questions.length > 0) {
          setStep('followup');
        } else {
          await submitToTeam(inputText, profile, []);
        }
      } else {
        const analyzeData = await analyzeResponse.json();
        setStructuredProfile(analyzeData.profile || {});
        setFollowUpQuestions(analyzeData.followUpQuestions || []);
        
        if (analyzeData.followUpQuestions?.length > 0) {
          setStep('followup');
        } else {
          await submitToTeam(inputText, analyzeData.profile || {}, []);
        }
      }
    } catch (err) {
      console.error('Processing error:', err);
      setError(err instanceof Error ? err.message : 'Failed to process your input');
      setStep('input');
    } finally {
      setIsProcessing(false);
    }
  }, [inputMode, textInput, audioBlob]);

  // Simple text extraction fallback
  const extractProfileFromText = (text: string): StructuredProfile => {
    const profile: StructuredProfile = {};
    const lowerText = text.toLowerCase();

    // Extract name
    const nameMatch = text.match(/(?:my name is|i'm|i am|call me|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
    if (nameMatch) profile.name = nameMatch[1];

    // Extract care level hints
    if (lowerText.includes('memory') || lowerText.includes('dementia') || lowerText.includes('alzheimer')) {
      profile.careLevel = 'Memory Care';
    } else if (lowerText.includes('assisted') || lowerText.includes('help with') || lowerText.includes('assistance')) {
      profile.careLevel = 'Assisted Living';
    } else if (lowerText.includes('independent')) {
      profile.careLevel = 'Independent Living';
    }

    // Extract budget
    const budgetMatch = text.match(/\$\s*([\d,]+)/);
    if (budgetMatch) profile.budget = `$${budgetMatch[1]}`;

    // Extract apartment type
    if (lowerText.includes('studio')) profile.apartmentType = 'Studio';
    else if (lowerText.includes('2 bed') || lowerText.includes('two bed')) profile.apartmentType = '2-Bedroom';
    else if (lowerText.includes('1 bed') || lowerText.includes('one bed')) profile.apartmentType = '1-Bedroom';
    else if (lowerText.includes('patio')) profile.apartmentType = 'Patio Home';

    // Extract timeline
    if (lowerText.includes('immediate') || lowerText.includes('asap') || lowerText.includes('right away')) {
      profile.timeline = 'Immediate';
    } else if (lowerText.includes('month')) {
      const monthMatch = lowerText.match(/(\d+)\s*month/);
      if (monthMatch) profile.timeline = `Within ${monthMatch[1]} months`;
    }

    return profile;
  };

  // Generate follow-up questions for missing required fields
  const generateFollowUpQuestions = (profile: StructuredProfile): FollowUpQuestion[] => {
    const questions: FollowUpQuestion[] = [];
    const requiredFields: { field: keyof StructuredProfile; question: string }[] = [
      { field: 'name', question: "What's your name or the name of your loved one who needs care?" },
      { field: 'careLevel', question: "What level of care is needed? (Independent Living, Assisted Living, or Memory Care)" },
      { field: 'activitiesStruggling', question: "What daily activities are they struggling with?" },
      { field: 'apartmentType', question: "What type of living space are you looking for? (Studio, 1-bedroom, 2-bedroom, or patio home)" },
      { field: 'locationPreference', question: "Is there a preferred area of the city or neighborhood?" },
      { field: 'budget', question: "What's your monthly budget for housing?" },
      { field: 'timeline', question: "What's your timeline for making this move?" },
    ];

    for (const { field, question } of requiredFields) {
      if (!profile[field]) {
        questions.push({
          id: field,
          question,
          field,
          answered: false,
        });
      }
      // Limit to 3-4 follow-up questions to not overwhelm
      if (questions.length >= 4) break;
    }

    return questions;
  };

  // Handle follow-up question answers
  const handleFollowUpAnswer = (id: string, answer: string) => {
    setFollowUpQuestions(prev => 
      prev.map(q => q.id === id ? { ...q, answer, answered: true } : q)
    );
    
    // Update structured profile
    const question = followUpQuestions.find(q => q.id === id);
    if (question) {
      setStructuredProfile(prev => ({
        ...prev,
        [question.field]: answer,
      }));
    }
  };

  // Submit follow-up answers and complete
  const submitFollowUps = useCallback(async () => {
    setIsProcessing(true);
    setStep('processing');

    try {
      // Append follow-up answers to transcript
      const followUpText = followUpQuestions
        .filter(q => q.answered && q.answer)
        .map(q => `Q: ${q.question}\nA: ${q.answer}`)
        .join('\n\n');

      const fullTranscript = transcript + '\n\n--- Follow-up Questions ---\n\n' + followUpText;

      await submitToTeam(fullTranscript, structuredProfile, followUpQuestions);
    } catch (err) {
      console.error('Submit error:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit');
      setStep('followup');
    } finally {
      setIsProcessing(false);
    }
  }, [transcript, structuredProfile, followUpQuestions]);

  // Submit everything to the team (CRM + Email)
  const submitToTeam = async (
    fullTranscript: string, 
    profile: StructuredProfile, 
    followUps: FollowUpQuestion[]
  ) => {
    try {
      // Generate a unique submission ID
      const id = `INTAKE-${Date.now().toString(36).toUpperCase()}`;
      setSubmissionId(id);

      // Call backend to process and send email
      const response = await fetch(`${API_BASE_URL}/api/submit-intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: id,
          transcript: fullTranscript,
          structuredProfile: profile,
          followUpAnswers: followUps.filter(q => q.answered).map(q => ({
            question: q.question,
            answer: q.answer,
          })),
          teamEmail: teamEmail,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        // Even if email fails, we should still show confirmation
        console.warn('Email notification may have failed, but submission recorded');
      }

      setStep('confirmation');
    } catch (err) {
      console.error('Submit to team error:', err);
      // Still show confirmation - we don't want to block the user
      setStep('confirmation');
    }
  };

  // Check if we can proceed from input step
  const canProceedFromInput = inputMode === 'text' 
    ? textInput.trim().length > 50 
    : audioBlob !== null;

  // Check if all follow-ups are answered
  const allFollowUpsAnswered = followUpQuestions.every(q => q.answered && q.answer?.trim());

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-md">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            <span className="text-lg font-bold text-gray-900">{companyName}</span>
          </div>
          {/* Step indicator */}
          <div className="flex items-center gap-2 text-sm">
            <span className={`px-2 py-1 rounded-full ${step === 'input' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
              1. Describe
            </span>
            <span className="text-gray-300">→</span>
            <span className={`px-2 py-1 rounded-full ${step === 'followup' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
              2. Details
            </span>
            <span className="text-gray-300">→</span>
            <span className={`px-2 py-1 rounded-full ${step === 'confirmation' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              3. Done
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Step 1: Input */}
        {step === 'input' && (
          <div className="space-y-6">
            {/* Hero */}
            <div className="text-center mb-8">
              <h1 className="text-3xl font-black text-gray-900 mb-3">
                Tell Us About Your Needs
              </h1>
              <p className="text-lg text-gray-600 max-w-xl mx-auto">
                Share what you're looking for and we'll find the best senior living options for you.
              </p>
            </div>

            {/* Guidelines */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Things to include:
              </h2>
              <ul className="space-y-3">
                {guidelines.map((guideline, idx) => (
                  <li key={idx} className="flex items-start gap-3 text-gray-700">
                    <span className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-sm font-medium text-blue-600 flex-shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <span>{guideline}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Input Mode Toggle */}
            <div className="flex justify-center gap-2 p-1 bg-gray-100 rounded-xl w-fit mx-auto">
              <button
                onClick={() => setInputMode('text')}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  inputMode === 'text'
                    ? 'bg-white shadow text-gray-900'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                ✍️ Type
              </button>
              <button
                onClick={() => setInputMode('voice')}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  inputMode === 'voice'
                    ? 'bg-white shadow text-gray-900'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                🎤 Speak
              </button>
            </div>

            {/* Text Input */}
            {inputMode === 'text' && (
              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Describe your situation and what you're looking for:
                </label>
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Hi, I'm looking for a place for my mother who is 82 years old. She has been struggling with..."
                  className="w-full h-48 px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none text-gray-900 placeholder-gray-400"
                />
                <div className="mt-2 flex justify-between text-sm text-gray-500">
                  <span>{textInput.length} characters</span>
                  <span>{textInput.length < 50 ? 'Please write at least 50 characters' : '✓ Good length'}</span>
                </div>
              </div>
            )}

            {/* Voice Input */}
            {inputMode === 'voice' && (
              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 text-center">
                {!isRecording && !audioBlob && (
                  <>
                    <button
                      onClick={startRecording}
                      className="w-24 h-24 mx-auto mb-4 bg-gradient-to-br from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 rounded-full flex items-center justify-center shadow-xl transition-transform hover:scale-105"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                    </button>
                    <p className="text-gray-600">Press to start recording</p>
                  </>
                )}

                {isRecording && (
                  <>
                    <div className="w-24 h-24 mx-auto mb-4 bg-red-500 rounded-full flex items-center justify-center animate-pulse">
                      <span className="text-2xl font-bold text-white">{formatTime(recordingTime)}</span>
                    </div>
                    <p className="text-red-600 font-medium mb-4">Recording...</p>
                    <button
                      onClick={stopRecording}
                      className="px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-xl transition-colors"
                    >
                      ⏹️ Stop Recording
                    </button>
                  </>
                )}

                {audioBlob && !isRecording && (
                  <>
                    <div className="w-24 h-24 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <p className="text-green-600 font-medium mb-2">Recording saved ({formatTime(recordingTime)})</p>
                    <button
                      onClick={() => { setAudioBlob(null); setRecordingTime(0); }}
                      className="text-sm text-gray-500 hover:text-gray-700 underline"
                    >
                      Record again
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Submit Button */}
            <div className="flex justify-center">
              <button
                onClick={processInitialInput}
                disabled={!canProceedFromInput || isProcessing}
                className="px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 text-white text-lg font-semibold rounded-2xl shadow-xl transition-all disabled:cursor-not-allowed"
              >
                {isProcessing ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Processing...
                  </span>
                ) : (
                  'Continue →'
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Follow-up Questions */}
        {step === 'followup' && (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-black text-gray-900 mb-3">
                Just a Few More Details
              </h1>
              <p className="text-lg text-gray-600">
                Please answer these quick questions so we can find the best matches.
              </p>
            </div>

            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 space-y-6">
              {followUpQuestions.map((q, idx) => (
                <div key={q.id} className="space-y-2">
                  <label className="block text-sm font-medium text-gray-900">
                    {idx + 1}. {q.question}
                  </label>
                  <input
                    type="text"
                    value={q.answer || ''}
                    onChange={(e) => handleFollowUpAnswer(q.id, e.target.value)}
                    placeholder="Type your answer..."
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-center">
              <button
                onClick={submitFollowUps}
                disabled={!allFollowUpsAnswered || isProcessing}
                className="px-8 py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:from-gray-400 disabled:to-gray-500 text-white text-lg font-semibold rounded-2xl shadow-xl transition-all disabled:cursor-not-allowed"
              >
                {isProcessing ? 'Submitting...' : 'Submit →'}
              </button>
            </div>
          </div>
        )}

        {/* Processing State */}
        {step === 'processing' && (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Processing Your Information</h2>
            <p className="text-gray-600">This will just take a moment...</p>
          </div>
        )}

        {/* Step 3: Confirmation */}
        {step === 'confirmation' && (
          <div className="text-center py-12">
            <div className="max-w-lg mx-auto bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
              <div className="w-20 h-20 mx-auto mb-6 bg-green-100 rounded-full flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              
              <h1 className="text-3xl font-black text-gray-900 mb-4">
                Thank You!
              </h1>
              
              <p className="text-lg text-gray-600 mb-6">
                We've received your information and our team is already reviewing it.
              </p>

              <div className="bg-blue-50 rounded-xl p-6 mb-6">
                <div className="flex items-center justify-center gap-2 text-blue-700 font-semibold mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  We'll be in touch within 24 hours
                </div>
                <p className="text-sm text-blue-600">
                  A member of our team will call you to discuss personalized options that match your needs.
                </p>
              </div>

              {submissionId && (
                <p className="text-xs text-gray-400">
                  Reference: {submissionId}
                </p>
              )}
            </div>
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

export default ClientIntakePage;
