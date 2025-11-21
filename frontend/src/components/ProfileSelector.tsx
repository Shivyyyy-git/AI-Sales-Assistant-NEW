import React from 'react';
import { User } from '../types';
import { USERS_DATA } from '../data/users.data';

interface ProfileSelectorProps {
  onSelectProfile: (user: User) => void;
}

const ProfileSelector: React.FC<ProfileSelectorProps> = ({ onSelectProfile }) => {
  return (
    <div className="min-h-screen w-full bg-[#F8F7F2] flex flex-col justify-center items-center p-4">
      <div className="text-center mb-10">
        <div className="flex items-center justify-center space-x-3 mb-2">
            <svg className="w-10 h-10 text-blue-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.28 15.58L6.5 13.36l1.41-1.41 2.81 2.81 6.22-6.22 1.41 1.41-7.63 7.63z"></path></svg>
            <h1 className="text-4xl font-bold text-gray-800 tracking-tight">AI Senior Living Sales Assistant</h1>
        </div>
        <p className="text-lg text-gray-500">Please select your profile to continue.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {USERS_DATA.map(user => (
          <button
            key={user.name}
            onClick={() => onSelectProfile(user)}
            className="group bg-white/80 backdrop-blur-md border border-gray-200/80 rounded-xl p-8 text-center shadow-sm hover:shadow-lg hover:border-blue-300 transition-all duration-300 transform hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <div className="w-24 h-24 bg-blue-100 rounded-full mx-auto flex items-center justify-center mb-4 border-2 border-blue-200 group-hover:bg-blue-200 transition-colors">
              <span className="text-4xl font-bold text-blue-600">{user.avatar}</span>
            </div>
            <h2 className="text-xl font-semibold text-gray-800">{user.name}</h2>
            <p className="text-gray-500">{user.title}</p>
          </button>
        ))}
      </div>
      <footer className="absolute bottom-6 text-center text-gray-400 text-sm">
        <p>&copy; {new Date().getFullYear()} Senior Living AI. All rights reserved.</p>
        <p>This is a simulated application environment.</p>
      </footer>
    </div>
  );
};

export default ProfileSelector;
