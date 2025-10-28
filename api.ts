/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI, Part, Type, Chat, LiveServerMessage, Modality, Blob } from "@google/genai";

// --- TYPE DEFINITIONS ---
export type Mode = 'calm' | 'warn' | 'zoom';

export interface MnemonicResult {
    title: string;
    mnemonic_word: string;
    description: string;
    breakdown: string[];
}

export interface Topic {
    topic: string;
    reason: string;
    key_points?: string[];
    notes?: string;
    mnemonic?: MnemonicResult;
}

export interface AnalysisResult {
    study_these: Topic[];
}

export interface QuizQuestion {
    question: string;
    options: string[];
    correct_answer: string;
    explanation: string;
}

export interface ChatMessage {
    role: 'user' | 'model';
    text: string;
}

export interface LiveCallbacks {
  onopen: () => void;
  onmessage: (message: LiveServerMessage) => void;
  onerror: (event: ErrorEvent) => void;
  onclose: (event: CloseEvent) => void;
}


// --- API INITIALIZATION & HELPERS ---

// The API key is read from the environment variable `process.env.API_KEY`.
// This is configured in your hosting environment's settings.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
let chat: Chat | null = null;


/**
 * Converts a file to a Gemini-compatible Part object.
 */
const fileToGenerativePart = (file: File): Promise<Part> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64Data = dataUrl.split(',')[1];
      resolve({
        inlineData: {
          mimeType: file.type,
          data: base64Data
        }
      });
    };
    reader.onerror = error => reject(error);
  });
};

/**
 * Generates the main text prompt for the Gemini API based on the selected mode.
 */
const getPromptForMode = (mode: Mode): string => {
    switch (mode) {
        case 'zoom':
            return "My exam is tonight. I need a tactical strike plan. Analyze these documents like a football playbook. Identify the critical 'plays'—the topics and concepts with the highest scoring potential. Give me a concise, high-impact briefing. Focus on the plays that will win the game. No fluff, just strategy.";
        case 'warn':
            return "My exam is in the next couple of days. I need an efficient and focused study plan. Please analyze these materials and prioritize the most important topics. Also include any secondary topics if they are quick wins. The goal is to be strategic and cover the highest-impact areas effectively.";
        case 'calm':
            return "I have over a week until my exam, so I want a comprehensive study plan. Please analyze these documents and structure a thorough plan that covers all key areas. While I want to be comprehensive, please still prioritize topics based on their importance in the materials provided.";
        default:
            return "Please analyze the provided documents and create a prioritized study plan.";
    }
}

// --- AUDIO HELPER FUNCTIONS FOR LIVE API ---

/** Encodes a Uint8Array into a Base64 string. */
export function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Creates a Gemini-compatible Blob from raw audio data. */
export function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

/** Decodes a Base64 string into a Uint8Array. */
export function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/** Decodes raw PCM audio data into an AudioBuffer for playback. */
export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}


// --- API FUNCTIONS ---

/**
 * Generates a study plan by analyzing user-uploaded files.
 * This also initializes the chat session for follow-up questions.
 */
export const apiGenerateStudyPlan = async (mode: Mode, files: File[]): Promise<AnalysisResult> => {
    const fileParts = await Promise.all(files.map(file => fileToGenerativePart(file)));
    const prompt = getPromptForMode(mode);

    // Combine files and prompt into a single request for the `generateContent` call.
    const requestParts = [...fileParts, { text: prompt }];

    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            study_these: {
                type: Type.ARRAY,
                description: "A list of the most critical topics to study, prioritized based on the user's timeline and the provided documents.",
                items: {
                    type: Type.OBJECT,
                    properties: {
                        topic: { type: Type.STRING, description: "The name of the study topic." },
                        reason: { type: Type.STRING, description: "A brief, compelling reason why this topic is critical to study, referencing the source documents (e.g., 'Mentioned 15 times in the syllabus and was a focus of the practice exam')." },
                        key_points: {
                            type: Type.ARRAY,
                            description: "A list of 3-5 specific, actionable key concepts or terms within this topic that the student must know.",
                            items: { type: Type.STRING }
                        }
                    },
                    required: ["topic", "reason"]
                }
            }
        }
    };
    
    // Use a single, robust `generateContent` call to get the study plan.
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: requestParts },
        config: {
            responseMimeType: 'application/json',
            responseSchema: responseSchema,
        },
    });

    let resultText = response.text?.trim();
    if (!resultText) throw new Error("Received an empty response from the AI.");
    
    // Clean potential markdown code block fences
    resultText = resultText.replace(/^```json\s*/, '').replace(/```$/, '');

    const result = JSON.parse(resultText);
    if (!result || !Array.isArray(result.study_these)) {
        console.error("Invalid data structure received:", result);
        throw new Error("The AI returned data in an unexpected format.");
    }
    
    // --- CHAT INITIALIZATION ---
    // Now that we have the first successful interaction, we can initialize the chat session.
    // The history will be the user's initial request (files + prompt) and the model's response (the plan).
    const hasAudio = files.some(file => file.type.startsWith('audio/'));
    const audioInstruction = hasAudio ? "Pay special attention to the content from any audio recordings provided (e.g., lectures), as they contain crucial spoken details. When answering, if the information comes from an audio file, mention that it was from the 'lecture recording' or 'audio notes'." : "";

    const systemInstruction = `You are an expert study assistant. Your primary role is to answer questions based *only* on the documents provided by the user in our initial interaction. The topic is: ${result.study_these.map((t: Topic) => t.topic).join(', ')}. Do not use external knowledge unless the user explicitly asks for it. When asked a question, first state which document your answer is from (e.g., 'According to your syllabus...'), then provide a clear and concise answer. ${audioInstruction}`;

    const history = [
        { role: 'user', parts: requestParts },
        { role: 'model', parts: [{ text: resultText }] }
    ];

    chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: { systemInstruction },
        history: history,
    });
    
    return result;
};

/**
 * Connects to the Live API for a real-time AI Tutor session.
 */
export const apiConnectLiveTutor = (topic: Topic, callbacks: LiveCallbacks): Promise<any> => {
    const systemInstruction = `You are an enthusiastic and patient AI study tutor named CrammAI. Your goal is to help a student master the topic of "${topic.topic}". You have access to their study notes.

**Your Persona & Rules:**
- **Encouraging:** Start with a warm welcome like, "Hey there! I'm CrammAI, your personal tutor for ${topic.topic}. I'm excited to help you crush this! What's on your mind?"
- **Interactive:** Ask questions to check for understanding (e.g., "Does that make sense?", "Can you explain that back to me in your own words?").
- **Focused:** Stick to the provided study notes for this topic. If a question is outside the notes, gently guide them back by saying something like, "That's a great question! For now, let's focus on what's in your study materials to make sure we've got that covered for your exam."
- **Socratic:** Instead of just giving answers, try to guide the student to the answer themselves.
- **VERY IMPORTANT - BE CONCISE:** Keep your responses concise and your sentences short to ensure a fast-paced, interactive conversation. Aim for quick turn-taking to create a natural and responsive dialogue.

**Context:** The student has these notes available:
${topic.notes}
`;

    const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: callbacks,
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
            },
            systemInstruction: systemInstruction,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
        },
    });

    return sessionPromise;
}


/**
 * Generates detailed study notes for a specific topic.
 */
export const apiGenerateStudyNotes = async (topic: Topic): Promise<string> => {
    const prompt = `You are an expert educator and a master of clarity, tasked with creating a perfectly written study guide for the topic: "${topic.topic}". The student needs to understand this material deeply, not just memorize it.

Focus on these key concepts: ${topic.key_points?.join(', ')}.

Your entire output must be well-structured, impeccably written, and follow this exact markdown format:

### 🔎 Topic at a Glance
A concise, 1-2 sentence executive summary of the entire topic.

---

(Create 3 to 4 sections below, one for each key concept)

#### Deep Dive: [Name of Key Concept 1] 💡
*   **The Core Idea:** Explain this concept thoroughly in a detailed paragraph of approximately 30 words. It must be rich with information but easy to understand, providing a solid foundation.
*   **Key Facts & Formulas:** A bulleted list of exactly 5 critical facts. Each point must be a complete, well-written sentence of approximately 17-20 words, providing substantial detail and making perfect sense on its own.

---

#### Deep Dive: [Name of Key Concept 2] 🔬
(Follow the same structure: A ~30-word Core Idea and 5 detailed Key Facts in ~17-20 word sentences)

---

(continue for all key concepts)

Do not include any text before the first heading. The tone must be authoritative, clear, and highly educational. The goal is depth and understanding, not just brevity. Ensure every sentence is meaningful and contributes to a perfect study guide.`;
    
    const response = await ai.models.generateContent({
       model: 'gemini-2.5-flash',
       contents: prompt,
    });

    return response.text;
};


/**
 * Generates a memorable mnemonic for a given topic.
 */
export const apiGenerateMnemonic = async (topic: string, previous_word?: string): Promise<{ mnemonic_result: MnemonicResult }> => {
    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            mnemonic_result: {
                type: Type.OBJECT,
                properties: {
                    mnemonic_word: { type: Type.STRING, description: "A single, catchy, and memorable word (can be a real word or a creative, made-up one) that encapsulates the topic." },
                    description: { type: Type.STRING, description: "A short, one-sentence explanation of how the mnemonic word relates to the topic." },
                    breakdown: {
                        type: Type.ARRAY,
                        description: "An array of strings, where each string maps a letter from the mnemonic_word to a key concept from the topic. Format: 'L = Long-term memory'.",
                        items: {
                            type: Type.STRING
                        }
                    }
                },
                required: ["mnemonic_word", "description", "breakdown"]
            }
        }
    };
    
    const previousWordPrompt = previous_word ? `Please generate a different mnemonic word than "${previous_word}".` : '';

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Create a mnemonic for the topic: "${topic}". The mnemonic should be a single word, with each letter representing a key part of the topic. ${previousWordPrompt}`,
        config: {
            responseMimeType: "application/json",
            responseSchema: responseSchema,
        },
    });
    
    let resultText = response.text;
    if (!resultText) throw new Error("Received an empty response from the AI for mnemonic generation.");
    
    // Clean the response text to remove potential markdown code blocks
    resultText = resultText.trim().replace(/^```json\s*/, '').replace(/```$/, '');
    
    const parsedJson = JSON.parse(resultText);

    // The model might return the object directly, or wrapped in `mnemonic_result`.
    // To handle this inconsistency, we check for the wrapper and add it if it's missing.
    if (parsedJson.mnemonic_result) {
        return parsedJson as { mnemonic_result: MnemonicResult };
    } else {
        // The object was not wrapped, so we wrap it ourselves to match the expected structure.
        return { mnemonic_result: parsedJson as MnemonicResult };
    }
};

/**
 * Generates a short, multiple-choice practice quiz for a topic.
 */
export const apiGeneratePracticeQuiz = async (topic: Topic): Promise<QuizQuestion[]> => {
    const prompt = `Create a 5-question multiple-choice quiz on the topic "${topic.topic}". The questions should be based on the following key points: ${topic.key_points?.join(', ')}. For each question, provide 4 options, one correct answer, and a brief explanation for the correct answer. The difficulty should be appropriate for a university-level exam.`;
    
    const responseSchema = {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                question: { type: Type.STRING },
                options: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    minItems: 4,
                    maxItems: 4,
                },
                correct_answer: { type: Type.STRING },
                explanation: { type: Type.STRING, description: "A clear and concise explanation of why the correct answer is right." }
            },
            required: ["question", "options", "correct_answer", "explanation"]
        }
    };

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: responseSchema,
        },
    });

    let resultText = response.text;
    if (!resultText) throw new Error("Received an empty response from the AI for quiz generation.");

    // Clean potential markdown code block fences
    resultText = resultText.trim().replace(/^```json\s*/, '').replace(/```$/, '');

    return JSON.parse(resultText);
}

/**
 * Generates a personalized reflection after a quiz.
 */
export const apiGenerateQuizReflection = async (topic: Topic, score: number, total: number, incorrectQuestions: QuizQuestion[]): Promise<string> => {
    let prompt: string;
    if (incorrectQuestions.length === 0) {
        prompt = `A student just scored a perfect ${total}/${total} on a practice quiz for the topic "${topic.topic}". Write a positive and mindful assessment reflection of about 45 words. Congratulate them on their mastery of the concepts and encourage them to continue their excellent work.`;
    } else {
        const incorrectConcepts = incorrectQuestions.map(q => `"${q.question}"`).join(', ');
        prompt = `A student just scored ${score}/${total} on a practice quiz for the topic "${topic.topic}". They struggled with questions about: ${incorrectConcepts}. 
        
Write a positive, mindful, and encouraging assessment reflection of about 45 words. 
Start by acknowledging their strong effort. 
Then, gently highlight the concepts from the questions they missed as areas for focused review. 
End with a motivational note for their next study session.`;
    }
    
    const response = await ai.models.generateContent({
       model: 'gemini-2.5-flash',
       contents: prompt,
    });

    return response.text;
};


/**
 * Handles follow-up questions using the initialized chat session.
 */
export const apiChatWithDocuments = async (message: string): Promise<string> => {
    if (!chat) {
        throw new Error("Chat not initialized. Please generate a study plan first.");
    }
    
    const response = await chat.sendMessage({ message });
    return response.text;
};