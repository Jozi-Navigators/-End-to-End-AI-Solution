import { useState, useCallback } from 'react';
import { GeminiInput } from '../types';

type GeminiApiFunction = (input: GeminiInput) => Promise<any>;

export const useGemini = (apiFunc: GeminiApiFunction) => {
  const [data, setData] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (input: GeminiInput) => {
    setIsLoading(true);
    setError(null);
    setData(null);
    try {
      const result = await apiFunc(input);
      setData(result);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "An unknown API error occurred.";
      setError(`Failed to get response. ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  }, [apiFunc]);

  const clear = useCallback(() => {
    setData(null);
    setError(null);
  }, []);

  return { data, isLoading, error, execute, clear };
};
