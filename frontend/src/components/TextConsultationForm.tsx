import React, { useState } from 'react';

interface TextConsultationFormProps {
  onResults: (results: any) => void;
  apiBaseUrl: string;
}

type ProcessingState = 'idle' | 'processing' | 'success' | 'error';

export const TextConsultationForm: React.FC<TextConsultationFormProps> = ({ onResults, apiBaseUrl }) => {
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
    setStatusMessage('Analyzing transcript with Gemini…');

    try {
      const response = await fetch(`${apiBaseUrl}/api/process-text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          language,
          push_to_crm: true,
        }),
      });

      if (!response.ok) {
        const details = await response.text();
        throw new Error(details || 'Processing failed');
      }

      const result = await response.json();
      onResults(result);
      setProcessingState('success');
      setStatusMessage('Transcript processed successfully. Dashboard updated!');
    } catch (error: any) {
      console.error('Processing failed:', error);
      setProcessingState('error');
      setStatusMessage(error?.message || 'Failed to process transcript. Please try again.');
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
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Transcript Language</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-lg shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
          >
        <option value="english">English</option>
        <option value="hindi">Hindi</option>
        <option value="spanish">Spanish</option>
      </select>
        </div>

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
