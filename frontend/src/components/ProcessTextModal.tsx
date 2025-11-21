
import React, { useState, useEffect } from 'react';

interface ProcessTextModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
}

const ProcessTextModal: React.FC<ProcessTextModalProps> = ({ isOpen, onClose, onSubmit }) => {
    const [text, setText] = useState('');
    const [status, setStatus] = useState<'idle' | 'submitting'>('idle');

    useEffect(() => {
        if (isOpen) {
            setStatus('idle');
            setText('');
        }
    }, [isOpen]);

    const handleSubmit = () => {
        if (!text.trim()) {
            return;
        }
        setStatus('submitting');
        onSubmit(text);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-gray-900/30 backdrop-blur-sm z-50 flex justify-center items-center p-4" aria-modal="true" role="dialog">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] flex flex-col border border-gray-200">
                <div className="flex justify-between items-center border-b border-gray-200 pb-3 mb-4">
                    <h2 className="text-xl font-bold text-gray-800">Process Text Consultation</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" disabled={status === 'submitting'}>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div className="overflow-y-auto pr-2 space-y-4">
                    <div>
                        <label htmlFor="text-input-modal" className="block text-sm font-semibold text-gray-600 mb-1.5">Paste or type the consultation transcript below:</label>
                        <textarea
                            id="text-input-modal"
                            rows={15}
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="e.g., Client is looking for assisted living in Sunnyvale with a budget of $6000..."
                            className="w-full px-3 py-2 border border-gray-300 bg-white text-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            disabled={status === 'submitting'}
                        />
                    </div>
                </div>
                <div className="mt-6 pt-4 border-t border-gray-200 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        disabled={status === 'submitting'}
                        className="px-4 py-2 text-sm font-semibold rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white transition-colors duration-200 flex items-center justify-center bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 focus:ring-blue-500 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={status === 'submitting' || !text.trim()}
                        className="px-4 py-2 text-sm font-semibold rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white transition-colors duration-200 flex items-center justify-center w-32 bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 disabled:opacity-50 disabled:bg-blue-400"
                    >
                        {status === 'submitting' ? 'Processing...' : 'Process Text'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ProcessTextModal;
