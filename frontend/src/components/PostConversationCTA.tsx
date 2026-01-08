import React, { useState } from 'react';
import { CalendlyButton } from './CalendlyEmbed';

interface PostConversationCTAProps {
  clientName?: string;
  calendlyUrl: string;
  onRequestCallback: (phone: string, preferredTime: string) => Promise<void>;
  onStartNewConversation: () => void;
}

/**
 * Post-Conversation Call-to-Action Component
 * Shown after the AI conversation ends with options to book or request callback
 */
export const PostConversationCTA: React.FC<PostConversationCTAProps> = ({
  clientName,
  calendlyUrl,
  onRequestCallback,
  onStartNewConversation,
}) => {
  const [showCallbackForm, setShowCallbackForm] = useState(false);
  const [phone, setPhone] = useState('');
  const [preferredTime, setPreferredTime] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleCallbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    
    setIsSubmitting(true);
    try {
      await onRequestCallback(phone, preferredTime);
      setSubmitted(true);
    } catch (error) {
      console.error('Failed to submit callback request:', error);
      alert('Failed to submit. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="max-w-lg mx-auto p-8 bg-white rounded-2xl shadow-xl border border-gray-100 text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-2xl font-bold text-gray-900 mb-2">Request Received!</h3>
        <p className="text-gray-600 mb-6">
          We'll call you {preferredTime ? `around ${preferredTime}` : 'as soon as possible'}. 
          Thank you for your interest!
        </p>
        <button
          onClick={onStartNewConversation}
          className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-colors"
        >
          Start New Conversation
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-8 bg-white rounded-2xl shadow-xl border border-gray-100">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Thank You{clientName ? `, ${clientName}` : ''}!
        </h2>
        <p className="text-gray-600 max-w-md mx-auto">
          We've captured your preferences. Let's schedule a time to discuss personalized options that match your needs.
        </p>
      </div>

      {/* CTA Options */}
      <div className="space-y-4">
        {/* Primary: Book via Calendly */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-100">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">
                📅 Book a Free Consultation
              </h3>
              <p className="text-sm text-gray-600">
                Choose a time that works best for you
              </p>
            </div>
            <CalendlyButton 
              url={calendlyUrl}
              text="Schedule Now"
              prefill={{ name: clientName }}
            />
          </div>
        </div>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center">
            <span className="px-4 bg-white text-sm text-gray-500">or</span>
          </div>
        </div>

        {/* Secondary: Request Callback */}
        {!showCallbackForm ? (
          <button
            onClick={() => setShowCallbackForm(true)}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl transition-colors group"
          >
            <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <div className="text-left">
              <span className="text-gray-900 font-medium">📞 Request a Callback</span>
              <p className="text-xs text-gray-500">We'll call you at your convenience</p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          <form onSubmit={handleCallbackSubmit} className="bg-gray-50 rounded-xl p-6 border border-gray-200 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold text-gray-900">Request a Callback</h3>
              <button
                type="button"
                onClick={() => setShowCallbackForm(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone Number *
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Preferred Time (optional)
              </label>
              <select
                value={preferredTime}
                onChange={(e) => setPreferredTime(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors bg-white"
              >
                <option value="">Any time is fine</option>
                <option value="Morning (9am - 12pm)">Morning (9am - 12pm)</option>
                <option value="Afternoon (12pm - 5pm)">Afternoon (12pm - 5pm)</option>
                <option value="Evening (5pm - 8pm)">Evening (5pm - 8pm)</option>
              </select>
            </div>
            
            <button
              type="submit"
              disabled={isSubmitting || !phone.trim()}
              className="w-full py-3 px-6 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-400 text-white font-semibold rounded-lg transition-colors"
            >
              {isSubmitting ? 'Submitting...' : 'Request Callback'}
            </button>
          </form>
        )}
      </div>

      {/* Footer */}
      <div className="mt-8 pt-6 border-t border-gray-100 text-center">
        <p className="text-xs text-gray-500">
          A member of our team will reach out to discuss your options and answer any questions.
        </p>
      </div>
    </div>
  );
};

export default PostConversationCTA;
