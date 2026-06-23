"use client";

import { useState, useEffect, useRef } from 'react';
import { useGeminiLive } from '@/hooks/useGeminiLive';

const SUPPORTED_LANGUAGES = [
  { code: 'ar', name: 'Arabic' },
  { code: 'bn', name: 'Bengali' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'zh-Hans', name: 'Chinese (Simp)' },
  { code: 'zh-Hant', name: 'Chinese (Trad)' },
  { code: 'hr', name: 'Croatian' },
  { code: 'cs', name: 'Czech' },
  { code: 'da', name: 'Danish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'en', name: 'English' },
  { code: 'et', name: 'Estonian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'lv', name: 'Latvian' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'no', name: 'Norwegian' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'sr', name: 'Serbian' },
  { code: 'sk', name: 'Slovak' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'es', name: 'Spanish' },
  { code: 'sw', name: 'Swahili' },
  { code: 'sv', name: 'Swedish' },
  { code: 'th', name: 'Thai' },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'vi', name: 'Vietnamese' }
];

export default function Home() {
  const { isConnected, subtitles: hookSubtitles, startListening, stopListening, updateBoostLevel } = useGeminiLive();
  const [language, setLanguage] = useState('AUTO');
  const [boostLevel, setBoostLevel] = useState(1);
  const [subtitles, setSubtitles] = useState([
    "SOMMERS SYSTEM INITIALIZED...",
    "WAITING FOR AUDIO INPUT..."
  ]);
  const [audioLevel, setAudioLevel] = useState(0);
  
  const messagesEndRef = useRef(null);

  // Sync hook subtitles
  useEffect(() => {
    if (hookSubtitles.length > 0) {
      setSubtitles(prev => [...prev, hookSubtitles[hookSubtitles.length - 1]]);
    }
  }, [hookSubtitles]);

  // Sync boost level
  useEffect(() => {
    updateBoostLevel(boostLevel);
  }, [boostLevel, updateBoostLevel]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [subtitles]);

  const toggleListen = () => {
    if (!isConnected) {
      startListening(boostLevel, language);
    } else {
      stopListening();
      setAudioLevel(0);
    }
  };

  // Dummy VU Meter effect for visual feedback
  useEffect(() => {
    let interval;
    if (isConnected) {
      interval = setInterval(() => {
        setAudioLevel(Math.random() * 100);
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isConnected]);

  return (
    <div className="device-container">
      {/* Waterfall UI Screen */}
      <div className="screen-container">
        {subtitles.map((text, i) => (
          <div key={i} className="teletype-text">
            {`> ${text}`}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Control Panel */}
      <div className="controls-panel">
        {/* VU Meter */}
        <div className="vu-meter">
          <div className="vu-bar" style={{ width: `${audioLevel}%` }}></div>
        </div>

        {/* Language Selection */}
        <div className="radio-group">
          {['AUTO', 'EN', 'JA', 'ZH'].map(lang => (
            <button 
              key={lang}
              className={`radio-btn ${language === lang ? 'active' : ''}`}
              onClick={() => setLanguage(lang)}
            >
              {lang}
            </button>
          ))}
          <select 
            className={`radio-btn lang-dropdown ${!['AUTO', 'EN', 'JA', 'ZH'].includes(language) ? 'active' : ''}`}
            value={!['AUTO', 'EN', 'JA', 'ZH'].includes(language) ? language : ''}
            onChange={(e) => {
              if (e.target.value) setLanguage(e.target.value);
            }}
          >
            <option value="" disabled>MORE...</option>
            {SUPPORTED_LANGUAGES.map(lang => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
        </div>

        {/* Booster Slider */}
        <div className="booster-container">
          <span className="booster-label">GAIN</span>
          <input 
            type="range" 
            min="1" max="3" step="1" 
            value={boostLevel}
            onChange={(e) => setBoostLevel(parseInt(e.target.value))}
          />
          <span className="booster-label">{boostLevel}X</span>
        </div>

        {/* Main Toggle */}
        <button 
          className={`listen-toggle ${isConnected ? 'active' : ''}`}
          onClick={toggleListen}
        >
          {isConnected ? 'INTERCEPTING...' : 'ACTIVATE SOMMERS'}
        </button>
      </div>
    </div>
  );
}
