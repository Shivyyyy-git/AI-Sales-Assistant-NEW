
import React from 'react';

interface SummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  summaryText: string;
}

const SummaryModal: React.FC<SummaryModalProps> = ({ isOpen, onClose, summaryText }) => {
  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(summaryText);
  };

  return (
    <div className="fixed inset-0 bg-gray-900/30 backdrop-blur-sm z-50 flex justify-center items-center p-4" aria-modal="true" role="dialog">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] flex flex-col border border-gray-200">
        <div className="flex justify-between items-center border-b border-gray-200 pb-3 mb-4">
          <h2 className="text-xl font-bold text-gray-800">Call Summary</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto pr-2">
            <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 bg-gray-50 p-4 rounded-md border border-gray-200">{summaryText}</pre>
        </div>
        <div className="mt-6 pt-4 border-t border-gray-200 flex justify-end gap-3">
           <button
            onClick={handleCopy}
            className="px-4 py-2 text-sm font-semibold rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white transition-colors duration-200 flex items-center justify-center bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 focus:ring-blue-500"
          >
            Copy to Clipboard
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white transition-colors duration-200 flex items-center justify-center bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default SummaryModal;