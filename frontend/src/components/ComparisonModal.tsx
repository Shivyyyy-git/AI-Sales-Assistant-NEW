
import React from 'react';
import { Community } from '../types';

interface ComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  communities: Community[];
}

const ComparisonModal: React.FC<ComparisonModalProps> = ({ isOpen, onClose, communities }) => {
  if (!isOpen || communities.length !== 2) return null;

  const [communityA, communityB] = communities;

  const renderCheckmark = (value: boolean) => {
    return value ? (
        <svg className="h-6 w-6 text-green-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
    ) : (
        <svg className="h-6 w-6 text-red-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
    );
  };
  
  const winnerIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600 inline-block ml-2" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  );

  const availabilityRank: { [key in Community['availability']]: number } = { 'Immediate': 3, 'Available Soon': 2, 'Waitlist': 1 };

  const getWinner = (fieldKey: string): 'A' | 'B' | 'TIE' => {
      switch (fieldKey) {
          case 'basePrice':
              if (communityA.basePrice < communityB.basePrice) return 'A';
              if (communityB.basePrice < communityA.basePrice) return 'B';
              return 'TIE';
          case 'availability':
              const rankA = availabilityRank[communityA.availability] || 0;
              const rankB = availabilityRank[communityB.availability] || 0;
              if (rankA > rankB) return 'A';
              if (rankB > rankA) return 'B';
              return 'TIE';
          case 'careLevels': // More is better
              if (communityA.careLevels.length > communityB.careLevels.length) return 'A';
              if (communityB.careLevels.length > communityA.careLevels.length) return 'B';
              return 'TIE';
          case 'wheelchairAccessible':
              if (communityA.wheelchairAccessible && !communityB.wheelchairAccessible) return 'A';
              if (communityB.wheelchairAccessible && !communityA.wheelchairAccessible) return 'B';
              return 'TIE';
          case 'hasKitchen':
              if (communityA.hasKitchen && !communityB.hasKitchen) return 'A';
              if (communityB.hasKitchen && !communityA.hasKitchen) return 'B';
              return 'TIE';
          case 'amenities': // More is better
              if (communityA.amenities.length > communityB.amenities.length) return 'A';
              if (communityB.amenities.length > communityA.amenities.length) return 'B';
              return 'TIE';
          case 'isPartner':
              if (communityA.isPartner && !communityB.isPartner) return 'A';
              if (communityB.isPartner && !communityA.isPartner) return 'B';
              return 'TIE';
          default:
              return 'TIE';
      }
  };
  
  const comparisonFields = [
    { key: 'basePrice', label: 'Base Price', valueA: `$${communityA.basePrice.toLocaleString()}/mo`, valueB: `$${communityB.basePrice.toLocaleString()}/mo` },
    { key: 'availability', label: 'Availability', valueA: communityA.availability, valueB: communityB.availability },
    { key: 'careLevels', label: 'Care Levels Offered', valueA: `${communityA.careLevels.length} types`, valueB: `${communityB.careLevels.length} types` },
    { key: 'wheelchairAccessible', label: 'Wheelchair Accessible', valueA: renderCheckmark(communityA.wheelchairAccessible), valueB: renderCheckmark(communityB.wheelchairAccessible) },
    { key: 'hasKitchen', label: 'In-Unit Kitchen', valueA: renderCheckmark(communityA.hasKitchen), valueB: renderCheckmark(communityB.hasKitchen) },
    { key: 'amenities', label: 'Total Amenities', valueA: `${communityA.amenities.length} amenities`, valueB: `${communityB.amenities.length} amenities` },
    { key: 'isPartner', label: 'Partner', valueA: renderCheckmark(communityA.isPartner), valueB: renderCheckmark(communityB.isPartner) },
  ];

  const winnerHighlightClass = 'bg-green-50/80 !text-green-800 font-semibold';

  return (
    <div className="fixed inset-0 bg-gray-900/30 backdrop-blur-sm z-50 flex justify-center items-center p-4" aria-modal="true" role="dialog">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-4xl max-h-[90vh] flex flex-col border border-gray-200">
        <div className="flex justify-between items-center border-b border-gray-200 pb-3 mb-4">
          <h2 className="text-xl font-bold text-gray-800">Community Comparison</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto pr-2">
            <table className="w-full border-collapse">
                <thead>
                    <tr>
                        <th className="w-1/4 text-left p-3 font-semibold text-gray-500 bg-gray-50/80 border-b-2 border-gray-200">Feature</th>
                        <th className="w-3/8 text-left p-3 font-semibold text-gray-800 bg-gray-50/80 border-b-2 border-gray-200">{communityA.name}</th>
                        <th className="w-3/8 text-left p-3 font-semibold text-gray-800 bg-gray-50/80 border-b-2 border-gray-200">{communityB.name}</th>
                    </tr>
                </thead>
                <tbody>
                    {comparisonFields.map((field, index) => {
                      const winner = getWinner(field.key);
                      return (
                        <tr key={index} className="border-b border-gray-100 last:border-b-0">
                            <td className="p-3 font-semibold text-gray-700 align-top">{field.label}</td>
                            <td className={`p-3 text-gray-700 align-top transition-colors ${winner === 'A' ? winnerHighlightClass : ''}`}>
                                <div className="flex items-center">
                                  {field.valueA}
                                  {winner === 'A' && winnerIcon}
                                </div>
                            </td>
                            <td className={`p-3 text-gray-700 align-top transition-colors ${winner === 'B' ? winnerHighlightClass : ''}`}>
                                <div className="flex items-center">
                                  {field.valueB}
                                  {winner === 'B' && winnerIcon}
                                </div>
                            </td>
                        </tr>
                      )
                    })}
                </tbody>
            </table>
        </div>
        <div className="mt-6 pt-4 border-t border-gray-200 flex justify-end">
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

export default ComparisonModal;
