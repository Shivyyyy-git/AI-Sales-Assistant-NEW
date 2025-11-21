
import React, { useState, useEffect } from 'react';
import { Community } from '../types';

interface CommunityFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (community: Omit<Community, 'id'>) => void;
    communityToEdit: Community | null;
}

const CommunityFormModal: React.FC<CommunityFormModalProps> = ({ isOpen, onClose, onSubmit, communityToEdit }) => {
    const [formData, setFormData] = useState<Omit<Community, 'id'>>({
        name: '',
        location: '',
        address: '',
        description: '',
        careLevels: [],
        basePrice: 0,
        pricingDetails: '',
        isPartner: false,
        amenities: [],
        lat: 0,
        lng: 0,
        wheelchairAccessible: false,
        hasKitchen: false,
        availability: 'Immediate',
    });

    useEffect(() => {
        if (communityToEdit) {
            setFormData(communityToEdit);
        } else {
            // Reset form for new entry
            setFormData({
                name: '',
                location: '',
                address: '',
                description: '',
                careLevels: [],
                basePrice: 0,
                pricingDetails: '',
                isPartner: false,
                amenities: [],
                lat: 0,
                lng: 0,
                wheelchairAccessible: false,
                hasKitchen: false,
                availability: 'Immediate',
            });
        }
    }, [communityToEdit, isOpen]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value, type } = e.target;
        if (type === 'checkbox') {
             setFormData(prev => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
        } else if (type === 'number') {
            setFormData(prev => ({ ...prev, [name]: parseFloat(value) || 0 }));
        } else {
            setFormData(prev => ({ ...prev, [name]: value }));
        }
    };
    
    const handleMultiSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const { name } = e.target;
        const selectedOptions = Array.from(e.target.selectedOptions, option => option.value);
        setFormData(prev => ({ ...prev, [name]: selectedOptions }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(formData);
    };

    if (!isOpen) return null;

    const allCareLevels = ['Independent Living', 'Assisted Living', 'Memory Care', 'Skilled Nursing', 'Luxury Senior Living'];

    return (
        <div className="fixed inset-0 bg-gray-900/30 backdrop-blur-sm z-50 flex justify-center items-center p-4" aria-modal="true" role="dialog">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] flex flex-col border border-gray-200">
                <div className="flex justify-between items-center border-b border-gray-200 pb-3 mb-4">
                    <h2 className="text-xl font-bold text-gray-800">{communityToEdit ? 'Edit Community' : 'Add New Community'}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="overflow-y-auto pr-2 flex-grow">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label htmlFor="name" className="block text-sm font-medium text-gray-700">Name</label>
                            <input type="text" name="name" id="name" value={formData.name} onChange={handleChange} required className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label htmlFor="location" className="block text-sm font-medium text-gray-700">Location (City, State)</label>
                            <input type="text" name="location" id="location" value={formData.location} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3" />
                        </div>
                        <div>
                            <label htmlFor="basePrice" className="block text-sm font-medium text-gray-700">Base Price</label>
                            <input type="number" name="basePrice" id="basePrice" value={formData.basePrice} onChange={handleChange} required className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3" />
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="careLevels" className="block text-sm font-medium text-gray-700">Care Levels</label>
                            <select multiple name="careLevels" id="careLevels" value={formData.careLevels} onChange={handleMultiSelectChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 h-24">
                                {allCareLevels.map(level => <option key={level} value={level}>{level}</option>)}
                            </select>
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="amenities" className="block text-sm font-medium text-gray-700">Amenities (comma-separated)</label>
                            <input 
                                type="text" 
                                name="amenities" 
                                id="amenities" 
                                value={Array.isArray(formData.amenities) ? formData.amenities.join(', ') : ''} 
                                onChange={(e) => setFormData(p => ({...p, amenities: e.target.value.split(',').map(s => s.trim())}))} 
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3" 
                            />
                        </div>
                        <div>
                            <label htmlFor="availability" className="block text-sm font-medium text-gray-700">Availability</label>
                            <select name="availability" id="availability" value={formData.availability} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3">
                                <option value="Immediate">Immediate</option>
                                <option value="Waitlist">Waitlist</option>
                                <option value="Available Soon">Available Soon</option>
                            </select>
                        </div>
                         <div className="md:col-span-2 grid grid-cols-3 gap-4 items-center pt-4">
                             <div className="flex items-center">
                                <input type="checkbox" name="isPartner" id="isPartner" checked={formData.isPartner} onChange={handleChange} className="h-4 w-4 text-blue-600 border-gray-300 rounded" />
                                <label htmlFor="isPartner" className="ml-2 block text-sm text-gray-900">Partner Community</label>
                            </div>
                            <div className="flex items-center">
                                <input type="checkbox" name="wheelchairAccessible" id="wheelchairAccessible" checked={formData.wheelchairAccessible} onChange={handleChange} className="h-4 w-4 text-blue-600 border-gray-300 rounded" />
                                <label htmlFor="wheelchairAccessible" className="ml-2 block text-sm text-gray-900">Wheelchair Accessible</label>
                            </div>
                             <div className="flex items-center">
                                <input type="checkbox" name="hasKitchen" id="hasKitchen" checked={formData.hasKitchen} onChange={handleChange} className="h-4 w-4 text-blue-600 border-gray-300 rounded" />
                                <label htmlFor="hasKitchen" className="ml-2 block text-sm text-gray-900">Has In-Unit Kitchen</label>
                            </div>
                        </div>
                    </div>
                </form>
                <div className="mt-6 pt-4 border-t border-gray-200 flex justify-end gap-3">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold rounded-md shadow-sm bg-white border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
                    <button type="submit" onClick={handleSubmit} className="px-4 py-2 text-sm font-semibold rounded-md shadow-sm bg-blue-600 text-white hover:bg-blue-700">{communityToEdit ? 'Save Changes' : 'Add Community'}</button>
                </div>
            </div>
        </div>
    );
};

export default CommunityFormModal;
