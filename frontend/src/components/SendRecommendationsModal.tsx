
import React, { useState, useEffect } from 'react';
import { Recommendation, ClientProfile } from '../types';

interface SendRecommendationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  recommendations: Recommendation[];
  clientProfile: ClientProfile;
}

const SendRecommendationsModal: React.FC<SendRecommendationsModalProps> = ({ isOpen, onClose, recommendations, clientProfile }) => {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState<'idle' | 'sending' | 'success'>('idle');
    const [error, setError] = useState('');

    useEffect(() => {
        if (isOpen) {
            setStatus('idle');
            setEmail('');
            setError('');
        }
    }, [isOpen]);

    const handleSend = () => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
            setError('Please enter a valid email address.');
            return;
        }
        setError('');
        setStatus('sending');
        // Simulate API call to CRM and Email service
        setTimeout(() => {
            console.log(`Sending recommendations to ${email} and logging to CRM.`);
            setStatus('success');
            setTimeout(() => {
                onClose();
            }, 2500); // Close modal after success message
        }, 1500); // Simulate network delay
    };

    if (!isOpen) return null;

    const hasProfileData = Object.values(clientProfile).some(v => v !== undefined && v !== null && v !== '');


    return (
        <div className="fixed inset-0 bg-gray-900/30 backdrop-blur-sm z-50 flex justify-center items-center p-4" aria-modal="true" role="dialog">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg max-h-[90vh] flex flex-col border border-gray-200 transition-all duration-300">
                {status === 'success' ? (
                    <div className="text-center p-8">
                        <svg className="w-16 h-16 text-green-500 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <h2 className="text-xl font-bold text-gray-800">Recommendations Sent!</h2>
                        <p className="text-gray-500 mt-2">A summary has been sent to <span className="font-semibold text-gray-700">{email}</span> and saved to the CRM.</p>
                    </div>
                ) : (
                <>
                    <div className="flex justify-between items-center border-b border-gray-200 pb-3 mb-4">
                        <h2 className="text-xl font-bold text-gray-800">Send Recommendations</h2>
                        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" disabled={status === 'sending'}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <div className="overflow-y-auto pr-2 space-y-4">
                        <div>
                            <h3 className="text-sm font-semibold text-gray-600 mb-2">Client Needs Summary:</h3>
                            <div className="bg-gray-50 p-3 rounded-md border border-gray-200 text-gray-600 text-sm mb-4 space-y-1">
                                {hasProfileData ? (
                                    Object.entries(clientProfile)
                                        .filter(([, value]) => value !== undefined && value !== null && value !== '')
                                        .map(([key, value]) => (
                                            <p key={key}>
                                                <span className="font-semibold capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}: </span>
                                                {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
                                            </p>
                                        ))
                                ) : (
                                    <p>No profile details captured yet.</p>
                                )}
                            </div>


                            <h3 className="text-sm font-semibold text-gray-600 mb-2">The following recommendations will be sent:</h3>
                            <ul className="list-none space-y-3 bg-gray-50 p-3 rounded-md border border-gray-200 text-gray-600 text-sm">
                                {recommendations.map(rec => (
                                     <li key={rec.name} className="border-b border-gray-200 last:border-b-0 pb-2 last:pb-0">
                                        <p className="font-semibold text-gray-800">{rec.name}</p>
                                        <p className="text-xs mt-1"><strong>Reason:</strong> {rec.reason}</p>
                                        <p className="text-xs"><strong>Price:</strong> {rec.price}</p>
                                        <p className="text-xs"><strong>Care:</strong> {rec.careLevels?.join(', ')}</p>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div>
                            <label htmlFor="client-email" className="block text-sm font-semibold text-gray-600 mb-1.5">Client's Email Address</label>
                            <input
                                id="client-email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="name@example.com"
                                className="w-full px-3 py-2 border border-gray-300 bg-white text-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                disabled={status === 'sending'}
                            />
                            {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
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
                            onClick={handleSend}
                            disabled={status === 'sending'}
                            className="px-4 py-2 text-sm font-semibold rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white transition-colors duration-200 flex items-center justify-center w-32 bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 disabled:opacity-50 disabled:bg-blue-400"
                        >
                            {status === 'sending' ? (
                                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ) : (
                                'Confirm & Send'
                            )}
                        </button>
                    </div>
                </>
                )}
            </div>
        </div>
    );
};

export default SendRecommendationsModal;
