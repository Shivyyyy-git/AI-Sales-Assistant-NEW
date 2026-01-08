import React, { useState, useRef, useCallback } from 'react';
import { AudioUploadForm } from './AudioUploadForm';
import { CalendlyButton } from './CalendlyEmbed';

type IntakeStep = 'initial' | 'reviewing' | 'followup' | 'completed';

interface ClientIntakePageProps {
  companyName?: string;
  calendlyUrl?: string;
  onComplete: (transcript: string, clientData: any) => Promise<void>;
  onCallbackRequest?: (phone: string, clientName: string) => Promise<void>;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

/**
 * Simplified Client Intake Page
 * Step 1: Client describes needs (text or audio)
 * Step 2: AI reviews and asks follow-ups if needed
 * Step 3: Confirmation message
 */
export const ClientIntakePage: React.FC<ClientIntakePageProps> = ({
  companyName = "Senior Living Advisors",
  calendlyUrl = import.meta.env.VITE_CALENDLY_URL || 'https://calendly.com/your-username/consultation',
  onComplete,
  onCallbackRequest,
}) => {
  const [step, setStep] = useState<IntakeStep>('initial');
  const [inputMethod, setInputMethod] = useState<'text' | 'audio'>('text');
  const [textInput, setTextInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [followUpAnswers, setFollowUpAnswers] = useState<Record<string, string>>({});
  const [clientTranscript, setClientTranscript] = useState('');
  const [clientName, setClientName] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  // Callback request state
  const [showCallbackOption, setShowCallbackOption] = useState(false);
  const [callbackPhone, setCallbackPhone] = useState('');
  const [isSubmittingCallback, setIsSubmittingCallback] = useState(false);
  const [callbackSubmitted, setCallbackSubmitted] = useState(false);

  // Guidelines for what to include
  const guidelines = [
    "What daily activities are they struggling with?",
    "What medical conditions do they have and what care is required?",
    "Are they looking for a studio, 1-bedroom, 2-bedroom, or patio home?",
    "Do they feel strongly about what area of the city they want to be in?",
    "How much can they afford for housing each month, and how firm is that limit?",
    "When are they looking to move?",
    "Any other important preferences or needs?",
  ];

  // Handle initial submission
  const handleInitialSubmit = async () => {
    if (inputMethod === 'text' && !textInput.trim()) {
      setError('Please describe your needs before submitting.');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      let transcript = textInput.trim();
      
      // If audio was uploaded, it will be processed separately
      // For now, we'll handle text input
      if (!transcript && inputMethod === 'audio') {
        // Audio processing will be handled by AudioUploadForm callback
        return;
      }

      // Send to backend for AI review
      const response = await fetch(`${API_BASE_URL}/api/process-client-intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initialInput: transcript,
          inputMethod: inputMethod,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to process your submission');
      }

      const data = await response.json();
      
      setClientTranscript(transcript);
      
      // Extract client name if available
      if (data.clientInfo?.name) {
        setClientName(data.clientInfo.name);
      }
      
      // Check if follow-up questions are needed
      if (data.followUpQuestions && data.followUpQuestions.length > 0) {
        setFollowUpQuestions(data.followUpQuestions);
        setStep('reviewing');
      } else {
        // No follow-ups needed, complete immediately
        await handleComplete(transcript, data);
      }
    } catch (err) {
      console.error('Intake submission error:', err);
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle audio processing completion
  const handleAudioProcessed = async (result: any) => {
    setIsProcessing(true);
    setError(null);

    try {
      const transcript = result.transcript || result.text || '';
      
      if (!transcript) {
        throw new Error('Could not process audio. Please try typing instead.');
      }

      setClientTranscript(transcript);

      // Extract client name if available from audio result
      if (result.client_info?.client_name) {
        setClientName(result.client_info.client_name);
      }

      // Send to backend for AI review
      const response = await fetch(`${API_BASE_URL}/api/process-client-intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initialInput: transcript,
          inputMethod: 'audio',
          clientInfo: result.client_info,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to process your submission');
      }

      const data = await response.json();
      
      // Extract client name if available from backend response
      if (data.clientInfo?.name) {
        setClientName(data.clientInfo.name);
      }
      
      // Check if follow-up questions are needed
      if (data.followUpQuestions && data.followUpQuestions.length > 0) {
        setFollowUpQuestions(data.followUpQuestions);
        setStep('reviewing');
      } else {
        // No follow-ups needed, complete immediately
        await handleComplete(transcript, data);
      }
    } catch (err) {
      console.error('Audio processing error:', err);
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle follow-up questions submission
  const handleFollowUpSubmit = async () => {
    // Validate all questions are answered
    const unanswered = followUpQuestions.filter(q => !followUpAnswers[q]?.trim());
    if (unanswered.length > 0) {
      setError('Please answer all questions before continuing.');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const followUpText = followUpQuestions
        .map(q => `Q: ${q}\nA: ${followUpAnswers[q]}`)
        .join('\n\n');

      const fullTranscript = `${clientTranscript}\n\n=== Follow-up Questions ===\n${followUpText}`;

      // Send to backend for final processing
      const response = await fetch(`${API_BASE_URL}/api/process-client-intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initialInput: clientTranscript,
          followUpAnswers: followUpAnswers,
          complete: true,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to process your responses');
      }

      const data = await response.json();
      
      // Extract client name if available
      if (data.clientInfo?.name) {
        setClientName(data.clientInfo.name);
      }
      
      await handleComplete(fullTranscript, data);
    } catch (err) {
      console.error('Follow-up submission error:', err);
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Complete the intake process
  const handleComplete = async (fullTranscript: string, data: any) => {
    setStep('completed');
    
    // Call the completion handler (which will trigger email notification)
    try {
      await onComplete(fullTranscript, {
        clientInfo: data.clientInfo || {},
        recommendations: data.recommendations || [],
        summary: data.summary || {},
      });
    } catch (err) {
      console.error('Completion error:', err);
      // Don't show error to user - email may have failed but intake is complete
    }
  };

  // Welcome/Initial Input Screen
  if (step === 'initial') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
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
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 py-12">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 md:p-10">
            {/* Hero */}
            <div className="text-center mb-8">
              <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-xl">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <h1 className="text-3xl md:text-4xl font-black text-gray-900 mb-4">
                Tell Us About Your Needs
              </h1>
              <p className="text-lg text-gray-600 max-w-lg mx-auto">
                Help us understand your situation so we can connect you with the best options. This takes just a few minutes.
              </p>
            </div>

            {/* Guidelines */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-6">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Please include information about:
              </h3>
              <ul className="space-y-2 text-sm text-gray-700">
                {guidelines.map((guideline, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-blue-600 mt-1">•</span>
                    <span>{guideline}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Input Method Toggle */}
            <div className="mb-6">
              <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
                <button
                  onClick={() => setInputMethod('text')}
                  className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all ${
                    inputMethod === 'text'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  📝 Type Your Needs
                </button>
                <button
                  onClick={() => setInputMethod('audio')}
                  className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all ${
                    inputMethod === 'audio'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  🎤 Record Audio
                </button>
              </div>
            </div>

            {/* Text Input */}
            {inputMethod === 'text' && (
              <div className="mb-6">
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Type your needs here... For example: 'My mother is 82 and needs help with bathing and medications. She's diabetic and needs some nursing support. We're looking for assisted living in the Brighton area. Our budget is around $6,000 per month. She has a small cat that's important to her. We'd like to move within the next 2-3 months.'"
                  className="w-full h-64 px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all resize-none"
                  style={{ minHeight: '200px' }}
                />
                <p className="mt-2 text-xs text-gray-500">
                  Don't worry about being perfect - just share what you can. We may ask a few follow-up questions if needed.
                </p>
              </div>
            )}

            {/* Audio Input */}
            {inputMethod === 'audio' && (
              <div className="mb-6">
                <AudioUploadForm
                  onResults={handleAudioProcessed}
                  apiBaseUrl={API_BASE_URL}
                  autoPushToSheet={false}
                  setAutoPushToSheet={() => {}}
                />
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                {error}
              </div>
            )}

            {/* Submit Button */}
            {inputMethod === 'text' && (
              <button
                onClick={handleInitialSubmit}
                disabled={isProcessing || !textInput.trim()}
                className="w-full py-4 px-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105 disabled:transform-none disabled:cursor-not-allowed"
              >
                {isProcessing ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Processing...
                  </span>
                ) : (
                  '✓ Finish & Continue'
                )}
              </button>
            )}
          </div>
        </main>

        <footer className="py-6 text-center text-sm text-gray-500">
          <p>© {new Date().getFullYear()} {companyName}. All rights reserved.</p>
        </footer>
      </div>
    );
  }

  // Follow-up Questions Screen
  if (step === 'reviewing') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
        <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200">
          <div className="max-w-3xl mx-auto px-4 py-4">
            <span className="text-lg font-bold text-gray-900">{companyName}</span>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 py-12">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 md:p-10">
            <div className="text-center mb-8">
              <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">A Few Quick Questions</h2>
              <p className="text-gray-600">We just need a bit more information to help you find the best options.</p>
            </div>

            {/* Questions */}
            <div className="space-y-6 mb-8">
              {followUpQuestions.map((question, idx) => (
                <div key={idx}>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    {question}
                  </label>
                  <textarea
                    value={followUpAnswers[question] || ''}
                    onChange={(e) => setFollowUpAnswers(prev => ({ ...prev, [question]: e.target.value }))}
                    placeholder="Your answer..."
                    className="w-full h-24 px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all resize-none"
                  />
                </div>
              ))}
            </div>

            {/* Error */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleFollowUpSubmit}
              disabled={isProcessing}
              className="w-full py-4 px-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 disabled:cursor-not-allowed"
            >
              {isProcessing ? 'Processing...' : '✓ Submit & Continue'}
            </button>
          </div>
        </main>
      </div>
    );
  }

  // Handle callback request
  const handleCallbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!callbackPhone.trim()) {
      setError('Please enter your phone number');
      return;
    }

    setIsSubmittingCallback(true);
    setError(null);

    try {
      if (onCallbackRequest) {
        await onCallbackRequest(callbackPhone.trim(), clientName || 'Client');
      } else {
        // Default: send to backend
        await fetch(`${API_BASE_URL}/api/process-client-intake`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callbackRequest: true,
            phone: callbackPhone.trim(),
            clientName: clientName || 'Client',
            priority: 'ASAP',
          }),
        });
      }
      setCallbackSubmitted(true);
    } catch (err) {
      console.error('Callback request error:', err);
      setError('Failed to submit callback request. Please try again.');
    } finally {
      setIsSubmittingCallback(false);
    }
  };

  // Completion Screen
  if (step === 'completed') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 py-8 px-4">
        <div className="max-w-3xl mx-auto">
          {/* Success Message */}
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 md:p-12 text-center mb-6">
            <div className="w-20 h-20 mx-auto mb-6 bg-green-100 rounded-full flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Thank You{clientName ? `, ${clientName}` : ''}!</h2>
            <p className="text-lg text-gray-600 mb-2">
              We've received your information and our team will review it carefully.
            </p>
            <p className="text-lg font-semibold text-gray-900 mb-8">
              We'll be in touch with personalized options within the next 24 hours.
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-gray-700">
              <p>💡 <strong>What happens next?</strong></p>
              <p className="mt-2">One of our senior living advisors will contact you to confirm we have all the information correct, explain your options, and help you schedule tours of communities that interest you.</p>
            </div>
          </div>

          {/* CTA Options */}
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
            <h3 className="text-xl font-bold text-gray-900 mb-6 text-center">
              Choose How You'd Like to Connect
            </h3>

            <div className="space-y-4">
              {/* Calendly Option */}
              {calendlyUrl && (
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-100">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="text-left">
                      <h4 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
                        📅 Schedule a Time
                      </h4>
                      <p className="text-sm text-gray-600">
                        Book a consultation at a time that works for you
                      </p>
                    </div>
                    <CalendlyButton
                      url={calendlyUrl}
                      text="View Availability"
                      prefill={{ name: clientName }}
                    />
                  </div>
                </div>
              )}

              {/* Divider */}
              {(calendlyUrl && !callbackSubmitted) && (
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200"></div>
                  </div>
                  <div className="relative flex justify-center">
                    <span className="px-4 bg-white text-sm text-gray-500">or</span>
                  </div>
                </div>
              )}

              {/* ASAP Callback Option */}
              {!callbackSubmitted ? (
                showCallbackOption ? (
                  <form onSubmit={handleCallbackSubmit} className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        📞 Request Immediate Callback
                      </h4>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCallbackOption(false);
                          setError(null);
                        }}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      We'll call you as soon as possible (usually within the hour during business hours).
                    </p>
                    
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Phone Number *
                      </label>
                      <input
                        type="tel"
                        value={callbackPhone}
                        onChange={(e) => setCallbackPhone(e.target.value)}
                        placeholder="(555) 123-4567"
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-colors"
                        required
                      />
                    </div>

                    {error && (
                      <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                        {error}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isSubmittingCallback || !callbackPhone.trim()}
                      className="w-full py-3 px-6 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-400 text-white font-semibold rounded-lg transition-colors disabled:cursor-not-allowed"
                    >
                      {isSubmittingCallback ? 'Submitting...' : 'Request Callback'}
                    </button>
                  </form>
                ) : (
                  <button
                    onClick={() => setShowCallbackOption(true)}
                    className="w-full flex items-center justify-between p-6 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                      </div>
                      <div className="text-left">
                        <span className="text-gray-900 font-semibold block">📞 Request Immediate Callback</span>
                        <p className="text-xs text-gray-500">We'll call you ASAP (usually within the hour)</p>
                      </div>
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400 group-hover:text-gray-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
                  <div className="w-12 h-12 mx-auto mb-3 bg-green-100 rounded-full flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h4 className="font-semibold text-gray-900 mb-1">Callback Request Received!</h4>
                  <p className="text-sm text-gray-600">
                    We'll call you at <strong>{callbackPhone}</strong> as soon as possible.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default ClientIntakePage;
