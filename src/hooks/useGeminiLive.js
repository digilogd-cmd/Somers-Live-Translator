"use client";

import { useState, useRef, useCallback } from 'react';

// Helpers for PCM audio conversion
function floatTo16BitPCM(input) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return output.buffer;
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function useGeminiLive() {
  const [isConnected, setIsConnected] = useState(false);
  const [subtitles, setSubtitles] = useState([]);
  
  // Capture refs (16kHz)
  const audioContextRef = useRef(null);
  const captureWorkletRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const gainNodeRef = useRef(null);
  const filterNodeRef = useRef(null);
  
  // Playback refs (24kHz)
  const playbackContextRef = useRef(null);
  const playbackWorkletRef = useRef(null);

  const wsRef = useRef(null);
  const setupCompleteRef = useRef(false);
  const turnCompleteRef = useRef(false);
  const wakeLockRef = useRef(null);

  const startListening = useCallback(async (boostLevel, inputLanguage, targetLanguage) => {
    try {
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      if (!apiKey) {
        setSubtitles(prev => [...prev, "ERROR: API KEY NOT FOUND IN .env.local"]);
        return;
      }

      setSubtitles(prev => [...prev, "SYSTEM ACTIVATING... ESTABLISHING SECURE LINK."]);

      // Request wake lock to keep screen awake
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
        }
      } catch (err) {
        console.warn('Wake Lock error:', err);
      }

      // Resolve path for GitHub pages vs Local dev
      const basePath = process.env.NODE_ENV === 'production' ? '/Somers-Live-Translator' : '';

      // 1. Playback AudioContext Setup (24kHz for output)
      const playbackCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      playbackContextRef.current = playbackCtx;
      await playbackCtx.audioWorklet.addModule(`${basePath}/audio-processors/playback.worklet.js`);
      const playbackWorklet = new AudioWorkletNode(playbackCtx, "pcm-processor");
      playbackWorkletRef.current = playbackWorklet;
      playbackWorklet.connect(playbackCtx.destination);

      // 2. Capture AudioContext Setup (16kHz for input)
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: false,
          autoGainControl: false
        } 
      });
      mediaStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;
      await audioCtx.audioWorklet.addModule(`${basePath}/audio-processors/capture.worklet.js`);
      
      const source = audioCtx.createMediaStreamSource(stream);

      // Filter
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 300; 
      filterNodeRef.current = filter;

      // Gain
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = boostLevel;
      gainNodeRef.current = gainNode;

      const captureWorklet = new AudioWorkletNode(audioCtx, "audio-capture-processor");
      captureWorkletRef.current = captureWorklet;

      source.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(captureWorklet);

      captureWorklet.port.onmessage = (event) => {
        if (wsRef.current?.readyState === WebSocket.OPEN && setupCompleteRef.current) {
          if (event.data.type === "audio") {
            const inputData = event.data.data; // Float32Array from worklet
            const pcmData = floatTo16BitPCM(inputData);
            const base64Data = arrayBufferToBase64(pcmData);

            const mediaMessage = {
              realtimeInput: {
                mediaChunks: [{
                  mimeType: "audio/pcm;rate=16000",
                  data: base64Data
                }]
              }
            };
            wsRef.current.send(JSON.stringify(mediaMessage));
          }
        }
      };

      // 3. WebSocket Setup
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setSubtitles(prev => [...prev, "LINK ESTABLISHED. CONFIGURING TARGET LANGUAGE: " + targetLanguage]);
        
        const langMap = {
          'AUTO': null,
          'KO': 'ko',
          'ko': 'ko',
          'EN': 'en',
          'en': 'en',
          'JA': 'ja',
          'ja': 'ja',
          'ZH': 'zh-Hans',
          'zh-Hans': 'zh-Hans'
        };
        const sourceCode = langMap[inputLanguage] || inputLanguage;
        const targetCode = langMap[targetLanguage] || targetLanguage;

        const translationConfig = {
          targetLanguageCode: targetCode,
          echoTargetLanguage: true
        };
        if (sourceCode && sourceCode !== 'AUTO') {
          translationConfig.sourceLanguageCode = sourceCode;
        }

        const setupMessage = {
          setup: {
            model: "models/gemini-3.5-live-translate-preview",
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            generationConfig: {
              responseModalities: ["AUDIO"],
              translationConfig: translationConfig
            }
          }
        };
        ws.send(JSON.stringify(setupMessage));
      };

      ws.onmessage = async (event) => {
        try {
          let textData = event.data;
          if (event.data instanceof Blob) {
            textData = await event.data.text();
          }
          const response = JSON.parse(textData);

          // If the user interrupted, clear the playback buffer
          if (response.serverContent?.interrupted) {
            if (playbackWorkletRef.current) {
              playbackWorkletRef.current.port.postMessage("interrupt");
            }
          }

          if (response.setupComplete) {
            setupCompleteRef.current = true;
            setSubtitles(prev => [...prev, "SOMMERS ACTIVE. INTERCEPTING AUDIO..."]);
            setIsConnected(true);
            return;
          }

          if (response.serverContent) {
            const content = response.serverContent;
            
            // Handle Transcriptions for subtitles
            if (content.outputTranscription && content.outputTranscription.text) {
              setSubtitles(prev => {
                const newArr = [...prev];
                const newText = content.outputTranscription.text;
                
                if (newArr.length === 0 || turnCompleteRef.current) {
                  newArr.push(newText);
                  turnCompleteRef.current = false;
                } else {
                  const lastStr = newArr[newArr.length - 1];
                  if (newText.startsWith(lastStr)) {
                    // Cumulative text update
                    newArr[newArr.length - 1] = newText;
                  } else {
                    // Chunked text append
                    newArr[newArr.length - 1] = lastStr + newText;
                  }
                }
                return newArr.slice(-20);
              });
            }

            if (content.turnComplete) {
              turnCompleteRef.current = true;
            }

            if (content.modelTurn?.parts) {
              const parts = content.modelTurn.parts;
              for (const part of parts) {
                // Handle Audio Response (Gemini's translated voice)
                if (part.inlineData && part.inlineData.mimeType.startsWith('audio/pcm')) {
                  const base64Audio = part.inlineData.data;
                  const binaryString = atob(base64Audio);
                  const len = binaryString.length;
                  const bytes = new Uint8Array(len);
                  for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  
                  // Convert PCM16 LE to Float32
                  const inputArray = new Int16Array(bytes.buffer);
                  const float32Data = new Float32Array(inputArray.length);
                  for (let i = 0; i < inputArray.length; i++) {
                    float32Data[i] = inputArray[i] / 32768;
                  }

                  if (playbackContextRef.current?.state === "suspended") {
                    playbackContextRef.current.resume();
                  }

                  if (playbackWorkletRef.current) {
                    // Send directly to the playback worklet queue
                    playbackWorkletRef.current.port.postMessage(float32Data);
                  }
                }
              }
            }
          }
        } catch (e) {
          console.error("Error parsing WS message", e);
        }
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        setSubtitles(prev => [...prev, `SECURE LINK TERMINATED. (${event.code}: ${event.reason || 'No Reason'})`]);
      };
      
      ws.onerror = (event) => {
        setSubtitles(prev => [...prev, `WS ERROR OCCURRED.`]);
      };

    } catch (err) {
      console.error("Audio/WS Setup Error:", err);
      setSubtitles(prev => [...prev, "CRITICAL ERROR: " + (err.message || "INITIALIZATION FAILED")]);
      setIsConnected(false);
    }
  }, []);

  const stopListening = useCallback(() => {
    if (captureWorkletRef.current) captureWorkletRef.current.disconnect();
    if (playbackWorkletRef.current) playbackWorkletRef.current.disconnect();
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(track => track.stop());
    if (audioContextRef.current) audioContextRef.current.close();
    if (playbackContextRef.current) playbackContextRef.current.close();
    if (wsRef.current) wsRef.current.close();
    
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(console.warn);
      wakeLockRef.current = null;
    }

    setupCompleteRef.current = false;
    setIsConnected(false);
  }, []);

  const updateBoostLevel = (level) => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = level;
    }
  };

  return {
    isConnected,
    subtitles,
    startListening,
    stopListening,
    updateBoostLevel
  };
}
