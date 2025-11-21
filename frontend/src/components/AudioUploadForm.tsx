import React, { useState, useRef } from 'react';

interface AudioUploadFormProps {
  onResults: (results: any) => void;
  apiBaseUrl: string;
}

type ProcessingState = 'idle' | 'processing' | 'success' | 'error';

export const AudioUploadForm: React.FC<AudioUploadFormProps> = ({ onResults, apiBaseUrl }) => {
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
    setStatusMessage('Uploading audio to Gemini…');

    const formData = new FormData();
    formData.append('audio', file);
    formData.append('language', language);
    formData.append('push_to_crm', 'true');

    try {
      const response = await fetch(`${apiBaseUrl}/api/process-audio`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const details = await response.text();
        throw new Error(details || 'Processing failed');
      }

      const result = await response.json();
      onResults(result);
      setProcessingState('success');
      setStatusMessage('Audio processed successfully. Recommendations updated!');
    } catch (error: any) {
      console.error('Processing failed:', error);
      setProcessingState('error');
      setStatusMessage(error?.message || 'Failed to process audio. Please try again.');
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

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-2">Language spoken in the call</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-lg shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            disabled={processingState === 'processing'}
          >
        <option value="english">English</option>
        <option value="hindi">Hindi</option>
        <option value="spanish">Spanish</option>
      </select>
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
