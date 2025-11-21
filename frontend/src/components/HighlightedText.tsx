
import React from 'react';

interface HighlightedTextProps {
  text: string;
  keywords: string[];
  isAgentAssistMode?: boolean;
}

const HighlightedText: React.FC<HighlightedTextProps> = ({ text, keywords, isAgentAssistMode = false }) => {
  if (!keywords.length || !text) {
    return <>{text}</>;
  }

  // Function to escape regex special characters.
  const escapeRegex = (str: string) => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  // Filter out empty or very short keywords to prevent issues.
  const validKeywords = keywords.filter(kw => kw && kw.trim().length > 1);

  if (validKeywords.length === 0) {
    return <>{text}</>;
  }

  const regex = new RegExp(`(${validKeywords.map(escapeRegex).join('|')})`, 'gi');
  const parts = text.split(regex);

  const highlightClass = isAgentAssistMode
    ? "bg-purple-200/80 text-purple-900"
    : "bg-blue-200/80 text-blue-900";

  return (
    <>
      {parts.map((part, index) => {
        const isMatch = validKeywords.some(keyword => keyword.toLowerCase() === part.toLowerCase());
        return isMatch ? (
          <mark key={index} className={`${highlightClass} font-semibold rounded px-1 py-0.5 mx-px`}>
            {part}
          </mark>
        ) : (
          part
        );
      })}
    </>
  );
};

export default HighlightedText;