import { GeminiInput } from '../types';
import * as geminiService from '../services/geminiService';
import * as pdfjsLib from "https://mozilla.github.io/pdf.js/build/pdf.mjs";

/**
 * Extracts text from a given file (PDF or Image).
 * @param file The file to process.
 * @returns A promise that resolves to the extracted text content.
 */
export const processFile = async (file: File): Promise<string> => {
  if (file.type === 'application/pdf') {
    return processPdf(file);
  } else if (file.type.startsWith('image/')) {
    return processImage(file);
  } else {
    throw new Error('Unsupported file type. Please upload a PDF or an image.');
  }
};

const processPdf = async (file: File): Promise<string> => {
  // The pdf.js library is now imported as an ES module, ensuring it's loaded correctly.
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc = `https://mozilla.github.io/pdf.js/build/pdf.worker.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await (pdfjsLib as any).getDocument({ data: arrayBuffer }).promise;
  let allText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(' ');
    allText += pageText + '\n\n';
  }

  return allText;
};

const processImage = async (file: File): Promise<string> => {
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
  
  const imageInput: GeminiInput['image'] = {
      data: base64Data,
      mimeType: file.type
  };
  
  return geminiService.transcribeImage(imageInput);
};