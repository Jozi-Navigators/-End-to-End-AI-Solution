import React, { useState, useEffect, useRef } from 'react';
import { useGemini } from '../hooks/useGemini';
import Spinner from './common/Spinner';
import ResponseDisplay from './common/ResponseDisplay';
// Fix: Updated import to include GeminiInput for more specific prop typing.
import { PanelConfig, LearningMode, GeminiInput } from '../types';
import { UploadIcon, CloseIcon, MicrophoneIcon } from './common/Icon';

interface LearningPanelProps {
  config: PanelConfig;
  // Fix: Changed the type of apiCall to accept a GeminiInput and return a Promise of any type.
  // This resolves the type mismatch for the Quiz mode which returns QuizData instead of a string.
  apiCall: (input: GeminiInput) => Promise<any>;
}

const LearningPanel: React.FC<LearningPanelProps> = ({ config, apiCall }) => {
  const [inputText, setInputText] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

  const recognitionRef = useRef<any | null>(null);
  
  const { data, isLoading, error: apiError, execute, clear } = useGemini(apiCall);
  
  const isImageMode = config.mode === LearningMode.AnalyzeImage;
  const isTextArea = config.mode === 'Summarize' || config.mode === 'Quiz';

  // Setup Speech Recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsListening(true);
        setFormError(null); // Clear previous errors on successful start
      };

      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript) {
           setInputText(prev => prev ? `${prev} ${finalTranscript}` : finalTranscript);
        }
      };
      recognition.onend = () => {
        setIsListening(false);
      };
      recognition.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        if (event.error === 'not-allowed') {
          setFormError("Microphone access was denied. Please enable it in your browser's settings to use this feature.");
        } else {
          setFormError(`Speech recognition error: ${event.error}`);
        }
        setIsListening(false);
      };
      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
        setFormError("Voice input is not supported by your browser.");
        return;
    }
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      // Clear previous permission error if user tries again
      if (formError && formError.includes("Microphone access")) {
          setFormError(null);
      }
      recognitionRef.current.start();
    }
  };

  useEffect(() => {
    // Clear state when the panel config changes
    setInputText('');
    setImageFile(null);
    setImagePreview(null);
    setFormError(null);
    clear();
  }, [config, clear]);
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        setFormError('Invalid file type. Please upload a JPG, PNG, or WEBP image.');
        return;
      }
      setFormError(null);
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    clear(); // Clear previous API data/errors

    if (isImageMode) {
      if (!imageFile || !imagePreview) {
        setFormError("Please select an image to analyze.");
        return;
      }
      const base64Data = imagePreview.split(',')[1];
      execute({ text: inputText, image: { data: base64Data, mimeType: imageFile.type } });
    } else {
      if (!inputText.trim()) {
        setFormError(`${config.inputLabel} cannot be empty.`);
        return;
      }
      execute({ text: inputText });
    }
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 animate-[fadeIn_0.5s_ease-in-out]">
        <div className="max-w-3xl mx-auto">
            <div className="text-center mb-6">
                <h2 className="text-2xl font-semibold text-slate-200 flex items-center justify-center">
                    <config.Icon className="w-6 h-6 mr-3 text-sky-400" />
                    {config.title}
                </h2>
                <p className="text-slate-400 mt-1">{config.description}</p>
            </div>

            <form onSubmit={handleSubmit}>
                {isImageMode && (
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-slate-400 mb-1">Upload Image</label>
                        {imagePreview ? (
                            <div className="relative group">
                                <img src={imagePreview} alt="Selected preview" className="w-full rounded-lg border border-slate-700 max-h-80 object-contain bg-slate-950" />
                                <button 
                                    type="button"
                                    onClick={() => { setImageFile(null); setImagePreview(null); (document.getElementById('file-upload') as HTMLInputElement).value = ''; }}
                                    className="absolute top-2 right-2 bg-slate-800/50 text-white rounded-full p-1.5 hover:bg-slate-700 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                                    aria-label="Remove image"
                                >
                                    <CloseIcon className="w-5 h-5" />
                                </button>
                            </div>
                        ) : (
                             <div className="flex justify-center items-center w-full">
                                <label htmlFor="file-upload" className="flex flex-col justify-center items-center w-full h-48 bg-slate-800 border-2 border-slate-700 border-dashed rounded-lg cursor-pointer hover:bg-slate-700/50 transition">
                                    <div className="flex flex-col justify-center items-center pt-5 pb-6">
                                        <UploadIcon className="w-10 h-10 text-slate-500 mb-3"/>
                                        <p className="mb-2 text-sm text-slate-400"><span className="font-semibold">Click to upload</span> or drag and drop</p>
                                        <p className="text-xs text-slate-500">PNG, JPG, or WEBP</p>
                                    </div>
                                    <input id="file-upload" type="file" className="hidden" accept="image/png, image/jpeg, image/webp" onChange={handleFileChange} disabled={isLoading} />
                                </label>
                            </div>
                        )}
                    </div>
                )}

                <div className="mb-4">
                    <label htmlFor="input-text" className="block text-sm font-medium text-slate-400 mb-1">
                        {config.inputLabel}
                    </label>
                    <div className="relative">
                      {isTextArea ? (
                          <textarea
                              id="input-text"
                              value={inputText}
                              onChange={(e) => setInputText(e.target.value)}
                              placeholder={config.placeholder}
                              rows={8}
                              className="w-full p-3 pr-12 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-shadow duration-200 text-slate-200 placeholder-slate-500"
                              disabled={isLoading}
                          />
                      ) : (
                          <input
                              id="input-text"
                              type="text"
                              value={inputText}
                              onChange={(e) => setInputText(e.target.value)}
                              placeholder={config.placeholder}
                              className="w-full p-3 pr-12 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-shadow duration-200 text-slate-200 placeholder-slate-500"
                              disabled={isLoading}
                          />
                      )}
                      <button 
                        type="button" 
                        onClick={toggleListening} 
                        className={`absolute right-3 top-3 p-1.5 rounded-full transition-colors ${isListening ? 'bg-red-500/20 text-red-400 animate-pulse' : 'text-slate-400 hover:bg-slate-700'}`}
                        aria-label={isListening ? 'Stop listening' : 'Start listening'}
                        disabled={isLoading}
                      >
                        <MicrophoneIcon className="w-5 h-5" />
                      </button>
                    </div>
                </div>

                {formError && (
                  <div className="mb-4 bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg text-center text-sm">
                      {formError}
                  </div>
                )}
                
                <button
                    type="submit"
                    className="w-full flex justify-center items-center py-3 px-4 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-sky-500 transition-all duration-200 disabled:bg-slate-600 disabled:cursor-not-allowed"
                    disabled={isLoading}
                >
                    {isLoading ? <Spinner /> : config.buttonText}
                </button>
            </form>

            {apiError && (
                <div className="mt-6 bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg text-center">
                    {apiError}
                </div>
            )}

            {data && <ResponseDisplay data={data} />}
        </div>
    </div>
  );
};

export default LearningPanel;