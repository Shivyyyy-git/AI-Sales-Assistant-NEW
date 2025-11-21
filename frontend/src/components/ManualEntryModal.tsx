import React, { useState, useEffect } from 'react';
import { ClientProfile } from '../types';

interface ManualEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (profile: ClientProfile) => void;
  initialProfile?: ClientProfile;
}

export const ManualEntryModal: React.FC<ManualEntryModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialProfile = {}
}) => {
  const [profile, setProfile] = useState<ClientProfile>(initialProfile);

  useEffect(() => {
    if (isOpen) {
      setProfile(initialProfile);
    }
  }, [isOpen, initialProfile]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(profile);
    onClose();
  };

  const handleChange = (field: keyof ClientProfile, value: string | boolean) => {
    setProfile(prev => ({ ...prev, [field]: value }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-2xl font-bold text-gray-900">Manual Client Profile Entry</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Client Name
            </label>
            <input
              type="text"
              value={profile.name || ''}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="Enter client's full name"
              className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Monthly Budget
              </label>
              <input
                type="text"
                value={profile.budget || ''}
                onChange={(e) => handleChange('budget', e.target.value)}
                placeholder="e.g., $5000 or $5000-$6000"
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Location
              </label>
              <input
                type="text"
                value={profile.location || ''}
                onChange={(e) => handleChange('location', e.target.value)}
                placeholder="City or neighborhood"
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Care Level
              </label>
              <select
                value={profile.careLevel || ''}
                onChange={(e) => handleChange('careLevel', e.target.value)}
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              >
                <option value="">Select care level</option>
                <option value="Independent Living">Independent Living</option>
                <option value="Assisted Living">Assisted Living</option>
                <option value="Memory Care">Memory Care</option>
                <option value="Skilled Nursing">Skilled Nursing</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Timeline
              </label>
              <input
                type="text"
                value={profile.timeline || ''}
                onChange={(e) => handleChange('timeline', e.target.value)}
                placeholder="e.g., Within 3 months, ASAP"
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Mobility Needs
            </label>
            <input
              type="text"
              value={profile.mobilityNeeds || ''}
              onChange={(e) => handleChange('mobilityNeeds', e.target.value)}
              placeholder="e.g., Wheelchair accessible, Walker user"
              className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="wheelchairAccessible"
              checked={profile.wheelchairAccessible || false}
              onChange={(e) => handleChange('wheelchairAccessible', e.target.checked)}
              className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="wheelchairAccessible" className="ml-3 text-sm font-medium text-gray-700">
              Requires wheelchair accessibility
            </label>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Specific Demands / Notes
            </label>
            <textarea
              value={profile.specificDemands || ''}
              onChange={(e) => handleChange('specificDemands', e.target.value)}
              placeholder="Any other specific requirements (e.g., pet-friendly, private balcony, kosher meals)"
              rows={3}
              className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 resize-none"
            />
          </div>

          <div className="flex gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-gray-300 bg-white px-6 py-3 text-base font-semibold text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 rounded-xl bg-blue-600 px-6 py-3 text-base font-semibold text-white shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              Save & Generate Recommendations
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

