import React, { useState, useRef } from 'react';

interface AudioUploadFormProps {
  onResults: (results: Record<string, unknown>) => void;
  apiBaseUrl: string;
  autoPushToSheet: boolean;
  setAutoPushToSheet: (value: boolean) => void;
}

type ProcessingState = 'idle' | 'processing' | 'success' | 'error';

export const AudioUploadForm: React.FC<AudioUploadFormProps> = ({ onResults, apiBaseUrl, autoPushToSheet, setAutoPushToSheet }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processingState, setProcessingState] = useState<ProcessingState>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [language, setLanguage] = useState('english');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetStatus = () => {
    setProcessingState('idle');
    setStatusMessage('');
  };

  const validateAndProcess = async (file: File) => {
    const validTypes = ['audio/m4a', 'audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/flac'];
    if (!(validTypes.includes(file.type) || /\.(m4a|mp3|wav|ogg|webm|flac)$/i.test(file.name))) {
      setProcessingState('error');
      setStatusMessage('Unsupported file type. Please select MP3, WAV, M4A, OGG, WebM, or FLAC.');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setProcessingState('error');
      setStatusMessage('File too large. Maximum size is 50MB.');
      return;
    }

    setSelectedFile(file);
    await processAudio(file);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      resetStatus();
      validateAndProcess(file);
    }
  };

  const processAudio = async (file: File) => {
    setProcessingState('processing');
    
    // Simulated progress updates to show users what's happening
    const progressSteps = [
      { delay: 0, message: '📤 Uploading audio file...' },
      { delay: 3000, message: '🎯 Gemini AI extracting client data...' },
      { delay: 25000, message: '⚡ Running intelligent ranking algorithms...' },
      { delay: 50000, message: '🔄 Finalizing recommendations...' }
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

    const formData = new FormData();
    formData.append('audio', file);
    formData.append('language', language);
    formData.append('push_to_crm', autoPushToSheet ? 'true' : 'false');

    try {
      const response = await fetch(`${apiBaseUrl}/api/process-audio`, {
        method: 'POST',
        body: formData,
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
      setStatusMessage('✅ Audio processed successfully. Recommendations updated!');
    } catch (error) {
      // Clear all progress timeouts
      timeouts.forEach(t => clearTimeout(t));
      
      console.error('Processing failed:', error);
      setProcessingState('error');
      setStatusMessage(error instanceof Error ? error.message : 'Failed to process audio. Please try again.');
    }
  };

  return (
    <div className="bg-white/90 border border-gray-200 rounded-2xl p-6 shadow-lg space-y-6">
      <div className="space-y-2">
        <h3 className="text-2xl font-semibold text-gray-900">Upload a Call Recording</h3>
        <p className="text-base text-gray-600">
          Select a recorded consultation (MP3/WAV/M4A). Processing starts automatically and can take a minute while Gemini extracts client requirements.
        </p>
      </div>

      {/* Language locked to English only - no selection needed */}

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
            disabled={processingState === 'processing'}
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

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept=".m4a,.mp3,.wav,.ogg,.webm,.flac"
        className="hidden"
      />

      <div
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
      >
        <p className="text-lg font-medium text-gray-800">
          {selectedFile ? selectedFile.name : 'Click to select or drop your audio file'}
        </p>
        <p className="text-sm text-gray-500 mt-2">Max size 50MB • Supported: MP3, WAV, M4A, OGG, WebM, FLAC</p>
      </div>

      {processingState !== 'idle' && (
        <div
          className={`rounded-xl p-4 text-lg ${
            processingState === 'processing'
              ? 'bg-blue-50 text-blue-800 border border-blue-200'
              : processingState === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          <p className="font-semibold">
            {processingState === 'processing' && 'Processing audio…'}
            {processingState === 'success' && 'Success'}
            {processingState === 'error' && 'Something went wrong'}
          </p>
          <p className="text-base mt-1">{statusMessage}</p>
        </div>
      )}

      {processingState === 'error' && selectedFile && (
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => processAudio(selectedFile)}
            className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-6 py-3 text-base font-semibold text-white shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            Retry Processing
      </button>
          <button
            onClick={() => {
              setSelectedFile(null);
              resetStatus();
              fileInputRef.current?.click();
            }}
            className="inline-flex items-center justify-center rounded-xl border border-gray-300 px-6 py-3 text-base font-semibold text-gray-700 shadow-sm hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300"
          >
            Choose a Different File
          </button>
        </div>
      )}
    </div>
  );
};
