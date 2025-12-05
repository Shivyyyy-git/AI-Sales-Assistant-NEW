import React, { useState } from 'react';

interface TextConsultationFormProps {
  onResults: (results: Record<string, unknown>) => void;
  apiBaseUrl: string;
  autoPushToSheet: boolean;
  setAutoPushToSheet: (value: boolean) => void;
}

type ProcessingState = 'idle' | 'processing' | 'success' | 'error';

export const TextConsultationForm: React.FC<TextConsultationFormProps> = ({ onResults, apiBaseUrl, autoPushToSheet, setAutoPushToSheet }) => {
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('english');
  const [processingState, setProcessingState] = useState<ProcessingState>('idle');
  const [statusMessage, setStatusMessage] = useState('');

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(event.target.value);
    if (processingState !== 'idle') {
      setProcessingState('idle');
      setStatusMessage('');
    }
  };

  const handleProcess = async () => {
    if (!text.trim()) {
      setProcessingState('error');
      setStatusMessage('Please paste a consultation transcript before processing.');
      return;
    }

    setProcessingState('processing');
    
    // Progress indicators for text processing
    const progressSteps = [
      { delay: 0, message: '📝 Analyzing transcript with Gemini AI...' },
      { delay: 8000, message: '🎯 Extracting client requirements...' },
      { delay: 15000, message: '⚡ Running intelligent ranking...' },
      { delay: 30000, message: '🔄 Finalizing recommendations...' }
    ];
    
    // Set up progress indicators
    const timeouts: NodeJS.Timeout[] = [];
    progressSteps.forEach(step => {
      const timeout = setTimeout(() => {
        if (processingState === 'processing') {
          setStatusMessage(step.message);
        }
      }, step.delay);
      timeouts.push(timeout);
    });

    try {
      const response = await fetch(`${apiBaseUrl}/api/process-text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          language,
          push_to_crm: autoPushToSheet,
        }),
      });

      // Clear all progress timeouts
      timeouts.forEach(t => clearTimeout(t));

      if (!response.ok) {
        const details = await response.text();
        throw new Error(details || 'Processing failed');
      }

      const result = await response.json();
      onResults(result);
      setProcessingState('success');
      setStatusMessage('✅ Transcript processed successfully. Dashboard updated!');
    } catch (error) {
      // Clear all progress timeouts
      timeouts.forEach(t => clearTimeout(t));
      
      console.error('Processing failed:', error);
      setProcessingState('error');
      setStatusMessage(error instanceof Error ? error.message : 'Failed to process transcript. Please try again.');
    }
  };

  const resetForm = () => {
    setText('');
    setProcessingState('idle');
    setStatusMessage('');
  };

  return (
    <div className="bg-white/90 border border-gray-200 rounded-2xl p-6 shadow-lg flex flex-col h-full">
      <div className="space-y-2 mb-4">
        <h3 className="text-2xl font-semibold text-gray-900">Paste a Transcript</h3>
        <p className="text-base text-gray-600">
          Drop in any call notes or intake transcripts. Gemini will extract client needs and refresh the rankings.
        </p>
      </div>

      <div className="space-y-3 flex-1 flex flex-col">
        {/* Language locked to English only - no selection needed */}

        <div className="flex-1 flex flex-col">
          <label className="block text-sm font-medium text-gray-700 mb-2">Consultation Transcript</label>
      <textarea
        value={text}
            onChange={handleTextChange}
            placeholder="Paste the full conversation transcript here..."
            rows={8}
            className="flex-1 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-800 shadow-inner focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500 resize-none"
          />
          <div className="flex justify-between items-center mt-3 text-sm text-gray-500">
            <span>{text.length.toLocaleString()} characters</span>
            {text && (
              <button onClick={resetForm} className="text-blue-600 hover:text-blue-700 font-medium">
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {/* Google Sheets Auto-Push Toggle */}
        <div className="bg-gradient-to-br from-gray-50 to-blue-50/30 rounded-xl p-4 border border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-gray-900 mb-1">Auto-push to Google Sheets</h4>
              <p className="text-xs text-gray-600">Automatically save consultation data to your CRM spreadsheet</p>
            </div>
            <button
              onClick={() => setAutoPushToSheet(!autoPushToSheet)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                autoPushToSheet ? 'bg-green-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                  autoPushToSheet ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          <div className="mt-2">
            {autoPushToSheet ? (
              <p className="text-xs text-green-700 flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Will save to Google Sheets
              </p>
            ) : (
              <p className="text-xs text-amber-700 flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                Will NOT save to CRM
              </p>
            )}
          </div>
        </div>

        <button
          onClick={handleProcess}
          disabled={processingState === 'processing'}
          className="w-full inline-flex items-center justify-center rounded-xl bg-blue-600 px-6 py-3 text-base font-semibold text-white shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-60"
        >
          {processingState === 'processing' ? 'Processing Transcript…' : 'Process Transcript'}
      </button>

        {processingState !== 'idle' && (
          <div
            className={`rounded-xl p-4 text-base ${
              processingState === 'processing'
                ? 'bg-blue-50 text-blue-800 border border-blue-200'
                : processingState === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            <p className="font-semibold">
              {processingState === 'processing' && 'Processing transcript…'}
              {processingState === 'success' && 'Analysis complete'}
              {processingState === 'error' && 'Unable to process'}
            </p>
            <p className="text-base mt-1">{statusMessage}</p>
          </div>
        )}
      </div>
    </div>
  );
};
