
import React, { useState, useEffect } from 'react';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose }) => {
  const [feedbackType, setFeedbackType] = useState<'like' | 'dislike' | null>(null);
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success'>('idle');

  useEffect(() => {
    if (isOpen) {
      // Reset state when modal opens
      setStatus('idle');
      setFeedbackType(null);
      setComment('');
    }
  }, [isOpen]);

  const handleSubmit = () => {
    if (!feedbackType) {
        alert("Please select whether you liked the experience or not.");
        return;
    }
    setStatus('sending');
    // Simulate API call
    setTimeout(() => {
      console.log('Feedback submitted:', { type: feedbackType, comment });
      setStatus('success');
      setTimeout(() => {
        onClose();
      }, 2000); // Close modal after success message
    }, 1000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-900/30 backdrop-blur-sm z-50 flex justify-center items-center p-4" aria-modal="true" role="dialog">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg max-h-[90vh] flex flex-col border border-gray-200 transition-all duration-300">
        {status === 'success' ? (
          <div className="text-center p-8">
            <svg className="w-16 h-16 text-green-500 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="text-xl font-bold text-gray-800">Thank You!</h2>
            <p className="text-gray-500 mt-2">Your feedback has been submitted successfully.</p>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center border-b border-gray-200 pb-3 mb-4">
              <h2 className="text-xl font-bold text-gray-800">Provide Feedback</h2>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" disabled={status === 'sending'}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto pr-2 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-600 mb-2">How was your experience with the AI Assistant?</h3>
                <div className="flex gap-3">
                  <button
                    onClick={() => setFeedbackType('like')}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 transition-all duration-200 border ${feedbackType === 'like' ? 'bg-green-100 border-green-400 text-green-700 ring-green-500' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus:ring-blue-500'}`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333V17a1 1 0 001 1h6.758a1 1 0 00.97-1.22l-1.396-4.887A1 1 0 0012.382 11H9V6.5a1.5 1.5 0 00-3 0v3.833z" /></svg>
                    Good
                  </button>
                  <button
                    onClick={() => setFeedbackType('dislike')}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 transition-all duration-200 border ${feedbackType === 'dislike' ? 'bg-red-100 border-red-400 text-red-700 ring-red-500' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus:ring-blue-500'}`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M18 9.5a1.5 1.5 0 11-3 0v-6a1.5 1.5 0 013 0v6zM14 9.667V3a1 1 0 00-1-1H6.242a1 1 0 00-.97 1.22l1.396 4.887A1 1 0 007.618 9H11v4.5a1.5 1.5 0 003 0V9.667z" /></svg>
                    Bad
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="feedback-comment" className="block text-sm font-semibold text-gray-600 mb-1.5">Additional Comments (Optional)</label>
                <textarea
                  id="feedback-comment"
                  rows={4}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Tell us more about your experience..."
                  className="w-full px-3 py-2 border border-gray-300 bg-white text-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={status === 'sending'}
                />
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={onClose}
                disabled={status === 'sending'}
                className="px-4 py-2 text-sm font-semibold rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white transition-colors duration-200 flex items-center justify-center bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 focus:ring-blue-500 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={status === 'sending' || !feedbackType}
                className="px-4 py-2 text-sm font-semibold rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white transition-colors duration-200 flex items-center justify-center w-32 bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 disabled:opacity-50 disabled:bg-blue-400"
              >
                {status === 'sending' ? (
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  'Submit'
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default FeedbackModal;
