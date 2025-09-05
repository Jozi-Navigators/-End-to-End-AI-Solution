import { useState, useCallback } from 'react';
import { ChatMessage, LearningMode, GeminiInput, FileProcessingProgress, Persona, SourcedContent, DocumentOverviewData } from '../types';
import * as geminiService from '../services/geminiService';
import { VectorStore } from '../lib/vectorStore';
import { processFile } from '../lib/documentProcessor';
import { personaConfigs } from '../config/personaConfig';

const personaEnabledModes = [
  LearningMode.QA,
  LearningMode.Summarize,
  LearningMode.KnowledgeBase,
];

export const useChat = () => {
  const [messagesByMode, setMessagesByMode] = useState<Record<string, ChatMessage[]>>({});
  const [activeMode, setActiveMode] = useState<LearningMode>(LearningMode.KnowledgeBase);
  const [activePersona, setActivePersona] = useState<Persona>(Persona.Default);
  const [isLoading, setIsLoading] = useState(false);
  const [vectorStore, setVectorStore] = useState<VectorStore | null>(null);
  const [qaDocument, setQaDocument] = useState<{ store: VectorStore, overviewData: DocumentOverviewData, fullText: string } | null>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [fileProcessingProgress, setFileProcessingProgress] = useState<FileProcessingProgress | null>(null);

  const addMessage = useCallback((message: Omit<ChatMessage, 'id'>) => {
    setMessagesByMode(prev => {
      const currentMessages = prev[activeMode] || [];
      return {
        ...prev,
        [activeMode]: [...currentMessages, { ...message, id: Date.now().toString() }],
      };
    });
  }, [activeMode]);

  const clearChat = useCallback(() => {
    if (activeMode === LearningMode.KnowledgeBase) {
      setVectorStore(null);
    }
    if (activeMode === LearningMode.QA) {
      setQaDocument(null);
    }
    
    const initialMessages: ChatMessage[] = [];
    
    if (activeMode === LearningMode.KnowledgeBase) {
        initialMessages.push({
            id: 'upload-prompt-after-clear',
            sender: 'system',
            content: { type: 'knowledge_upload' },
        });
    } else {
        initialMessages.push({
            id: 'init-clear',
            sender: 'system',
            content: "Chat cleared. Let's start over!",
        });
    }

    setMessagesByMode(prev => ({ ...prev, [activeMode]: initialMessages }));
  }, [activeMode]);

  const selectMode = useCallback((newMode: LearningMode) => {
    if (newMode === activeMode) return;
    
    setActiveMode(newMode);
    
    setMessagesByMode(prev => {
        if (prev[newMode]) {
            return prev; // Already initialized
        }
        
        const newModeMessages: ChatMessage[] = [];
        if (newMode === LearningMode.KnowledgeBase && !vectorStore) {
            newModeMessages.push({
                id: 'upload-prompt-on-select',
                sender: 'system',
                content: { type: 'knowledge_upload' },
            });
        }
        return { ...prev, [newMode]: newModeMessages };
    });
  }, [activeMode, vectorStore]);

  const selectPersona = useCallback((newPersona: Persona) => {
    if (newPersona === activePersona) return;
    setActivePersona(newPersona);
    const personaName = personaConfigs[newPersona].name;
    addMessage({ sender: 'system', content: `Switched to ${personaName} persona.` });
  }, [activePersona, addMessage]);

  const handleFileUpload = useCallback(async (file: File) => {
    if (activeMode === LearningMode.Quiz) {
        setIsProcessingFile(true);
        setFileProcessingProgress({ stage: `Preparing "${file.name}"...`, percentage: 0 });
        
        addMessage({ sender: 'system', content: `Generating a quiz from "${file.name}"...` });

        try {
            setFileProcessingProgress({ stage: 'Extracting text from document...', percentage: 25 });
            const text = await processFile(file);
            if (!text || text.trim().length < 10) {
              throw new Error("Could not extract sufficient text from the document.");
            }
            
            setFileProcessingProgress({ stage: 'Generating quiz questions...', percentage: 75 });
            const quizData = await geminiService.generateQuiz({ text });
            
            addMessage({ sender: 'ai', content: quizData, mode: activeMode });
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : "An unknown error occurred during processing.";
            addMessage({ sender: 'ai', content: `Error: Failed to generate quiz. ${errorMessage}` });
        } finally {
            setIsProcessingFile(false);
            setFileProcessingProgress(null);
        }
        return;
    }

    if (activeMode !== LearningMode.KnowledgeBase && activeMode !== LearningMode.QA) return;
    
    setIsProcessingFile(true);
    setFileProcessingProgress({ stage: `Preparing "${file.name}"...`, percentage: 0 });

    setMessagesByMode(prev => {
        const currentMessages = prev[activeMode] || [];
        // Clear previous upload prompts and existing document overviews
        return {
            ...prev,
            [activeMode]: currentMessages.filter(m => {
                if (m.sender !== 'system' && m.sender !== 'ai') return true;
                if (typeof m.content !== 'object' || m.content === null) return true;
                const contentType = (m.content as any).type;
                return contentType !== 'knowledge_upload' && contentType !== 'document_overview';
            })
        };
    });
    
    try {
        setFileProcessingProgress({ stage: 'Extracting text from document...', percentage: 15 });
        const text = await processFile(file);
        if (!text || text.trim().length < 10) {
          throw new Error("Could not extract sufficient text from the document.");
        }
        
        const newVectorStore = new VectorStore();
        await newVectorStore.create(text, geminiService.embedContent, (progress) => {
          setFileProcessingProgress({
            stage: progress.stage,
            percentage: 15 + Math.round(progress.percentage * 0.80) // Embeddings take 80% of time
          });
        });

        setFileProcessingProgress({ stage: 'Generating document overview...', percentage: 95 });
        const textSample = text.length > 4000 ? text.substring(0, 4000) : text;
        const overviewData = await geminiService.generateDocumentOverview(textSample);
        const fullOverviewData = { ...overviewData, fileName: file.name };

        if (activeMode === LearningMode.KnowledgeBase) {
            setVectorStore(newVectorStore);
        } else if (activeMode === LearningMode.QA) {
            setQaDocument({ store: newVectorStore, overviewData: fullOverviewData, fullText: text });
        }

        addMessage({
          sender: 'ai',
          content: {
            type: 'document_overview',
            data: fullOverviewData
          },
          mode: activeMode,
        });

    } catch (e) {
        const errorMessage = e instanceof Error ? e.message : "An unknown error occurred during processing.";
        addMessage({ sender: 'ai', content: `Error: Failed to process document. ${errorMessage}` });
    } finally {
        setIsProcessingFile(false);
        setFileProcessingProgress(null);
    }
  }, [activeMode, addMessage]);

  const generateQuizFromQADocument = useCallback(async () => {
    if (activeMode !== LearningMode.QA || !qaDocument) return;

    addMessage({ sender: 'system', content: `Generating a quiz from "${qaDocument.overviewData.fileName}"...` });
    setIsLoading(true);

    try {
      const result = await geminiService.generateQuiz({ text: qaDocument.fullText });
      addMessage({ sender: 'ai', content: result, mode: activeMode });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "An unknown API error occurred.";
      addMessage({ sender: 'ai', content: `Error: Failed to generate quiz. ${errorMessage}`, mode: activeMode });
    } finally {
      setIsLoading(false);
    }
  }, [activeMode, qaDocument, addMessage]);

  const sendMessage = useCallback(async (input: GeminiInput) => {
    const userMessageContent = input.image ? (input.text || 'Analyzed Image') : input.text!;
    if (!userMessageContent.trim()) return;

    addMessage({ sender: 'user', content: userMessageContent, mode: activeMode });
    setIsLoading(true);

    try {
      let result;
      const persona = personaConfigs[activePersona];
      const geminiConfig = personaEnabledModes.includes(activeMode)
        ? { systemInstruction: persona.systemInstruction }
        : undefined;

      switch (activeMode) {
        case LearningMode.KnowledgeBase:
          if (!vectorStore) throw new Error("Please upload a document to the Knowledge Base first.");
          const contextChunks = await vectorStore.search(input.text!, geminiService.embedContent);
          
          if (contextChunks.length === 0) {
            result = "I couldn't find any relevant information in the provided document to answer your question.";
          } else {
            const contextString = contextChunks.join('\n\n');
            const answer = await geminiService.getAnswerFromContext(input.text!, contextString, geminiConfig);
            result = {
              answer: answer,
              sources: contextChunks.map(chunk => ({
                content: chunk,
                type: 'document_chunk'
              }))
            } as SourcedContent;
          }
          break;
        case LearningMode.QA:
          if (qaDocument) {
            const qaContextChunks = await qaDocument.store.search(input.text!, geminiService.embedContent);
            if (qaContextChunks.length === 0) {
              result = "I couldn't find any relevant information in the uploaded document to answer your question.";
            } else {
              const contextString = qaContextChunks.join('\n\n');
              const answer = await geminiService.getAnswerFromContext(input.text!, contextString, geminiConfig);
              result = {
                answer: answer,
                sources: qaContextChunks.map(chunk => ({
                  content: chunk,
                  type: 'document_chunk',
                  title: `From "${qaDocument.overviewData.fileName}"`
                }))
              } as SourcedContent;
            }
          } else {
            result = await geminiService.getAnswer(input, geminiConfig);
          }
          break;
        case LearningMode.Summarize:
          result = await geminiService.getSummary(input, geminiConfig);
          break;
        case LearningMode.AnalyzeImage:
          result = await geminiService.analyzeImage(input);
          break;
        case LearningMode.Quiz:
          result = await geminiService.generateQuiz(input);
          break;
        default:
          throw new Error(`Unsupported mode: ${activeMode}`);
      }
      
      addMessage({ sender: 'ai', content: result, mode: activeMode });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "An unknown API error occurred.";
      addMessage({ sender: 'ai', content: `Error: Failed to get response. ${errorMessage}`, mode: activeMode });
    } finally {
      setIsLoading(false);
    }
  }, [activeMode, activePersona, vectorStore, qaDocument, addMessage]);

  return { 
    messages: messagesByMode[activeMode] || [], 
    sendMessage, 
    isLoading, 
    activeMode, 
    selectMode,
    activePersona,
    selectPersona,
    handleFileUpload,
    isProcessingFile,
    knowledgeBaseReady: !!vectorStore,
    isQADocumentLoaded: !!qaDocument,
    fileProcessingProgress,
    clearChat,
    generateQuizFromQADocument,
  };
};