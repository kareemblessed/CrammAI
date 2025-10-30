/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI, Part, Type, Chat, LiveServerMessage, Modality, Blob, GenerateContentResponse } from "@google/genai";

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
    imageUrl?: string;
}

export interface LiveCallbacks {
  onopen: () => void;
  onmessage: (message: LiveServerMessage) => void;
  onerror: (event: ErrorEvent) => void;
  onclose: (event: CloseEvent) => void;
}

// Add types for Chrome's built-in AI (window.ai)
declare global {
  interface Window {
    ai?: {
      canCreateTextSession: () => Promise<'readily' | 'after-prompt' | 'no'>;
      createTextSession: () => Promise<{
        prompt: (prompt: string) => Promise<string>;
        destroy: () => void;
      }>;
      summarize?: (options: { text: string }) => Promise<{ summary: string }>;
    };
  }
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
        contents: requestParts,
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
 * Prefers on-device AI (Chrome's window.ai) and falls back to server-side API.
 */
export const apiGenerateStudyNotes = async (topic: Topic): Promise<string> => {
    const prompt = `You are an expert educator creating a high-quality study guide for the topic: "${topic.topic}".
    The student needs to understand this material for an exam.

    When writing mathematical formulas, constants, and variables, you MUST follow these formatting and structure rules precisely.

    **Formatting Rules:**

    1.  **NO LaTeX Syntax:** Your output must contain no LaTeX. Do not use any LaTeX commands, dollar signs ($), backslashes (\\), carets (^), or underscores (_). Output plain, readable text with Unicode characters.

    2.  **Bold and Italic Styling:**
        *   Wrap **entire** mathematical equations, formulas, and expressions in markdown's triple-asterisk syntax (\`***...***\`) to make them bold and italic.
        *   When variables or units are mentioned in plain text, they should also be styled with bold italics. Example: "The unit for work is the ***joule (J)***."

    3.  **Proper Symbols and Characters:**
        *   Use '×' for multiplication (not '*' or '·').
        *   Use '°' for degrees.
        *   Render Greek letters (e.g., θ, α, β) as their standard unicode characters inside the bold-italic block.
        *   Use a proper minus sign '−' instead of a hyphen '-'.

    4.  **Fractions:**
        *   Write fractions with parentheses and a forward slash '/'.
        *   Example: \`***Fg = (G × m₁ × m₂) / r²***\`
        *   Example: \`***a = (v² − u²) / (2 × s)***\`

    5.  **Subscripts and Superscripts:**
        *   Use unicode subscript and superscript characters directly (e.g., ₁, ₂, ², ⁻¹¹).
        *   Example: \`***m₁***\`, \`***r²***\`, \`***10⁻¹¹***\`.

    6.  **Structure:**
        *   Keep section headers (e.g., Key Concept) bold using markdown's \`**...**\`.
        *   Use bullet points for lists.
        *   Place each equation and its explanation on separate lines for clarity.

    **Example:**
    If the original text was \`If the force is applied in the same direction as the displacement (\\theta = 0\\circ, \\cos\\theta = 1): W = Fd.\`, your output should be:
    \`If the force is applied in the same direction as the displacement (***θ = 0°, cos(θ) = 1***):\`
    \`***W = F × d***\`

    ---

    Now, generate a clear and well-structured study guide using markdown, following ALL of the rules above. The goal is depth, understanding, and perfect formatting.

    Focus on these key concepts if they are provided: ${topic.key_points?.join(', ') || 'the main concepts of the topic'}.

    Please follow this general structure:

    ### 🔎 Topic Overview
    A brief, one or two-sentence summary of the entire topic.

    ---

    #### Key Concept: [Name of a Key Concept]
    *   **Core Idea:** A clear explanation of the concept.
    *   **Important Details:** A bulleted list with a few key facts, formulas, or details.

    ---

    (Repeat for the most important key concepts)

    Your tone should be clear, educational, and authoritative. Start your response directly with the first heading. Do not include any introductory text before it.`;
    
    // Check for Chrome's built-in AI and use it if available
    if (typeof window.ai?.canCreateTextSession === 'function') {
        try {
            const canCreate = await window.ai.canCreateTextSession();
            if (canCreate === 'readily') {
                console.log("Using on-device AI for study notes.");
                const session = await window.ai.createTextSession();
                const result = await session.prompt(prompt);
                if (result && result.trim().length > 20) {
                    return result;
                }
                console.warn("On-device AI returned a short or empty response. Falling back to server-side AI.");
            }
        } catch (e) {
            console.error("On-device AI error, falling back to server-side AI:", e);
            // Fall through to the server-side implementation below
        }
    }

    // Fallback to server-side Gemini API
    console.log("Using server-side AI for study notes (fallback).");
    const MAX_RETRIES = 3;
    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const response = await ai.models.generateContent({
               model: 'gemini-2.5-flash',
               contents: prompt,
            });

            const text = response.text;
            if (text && text.trim().length > 20) { // Check for a non-trivial response
                return text;
            }
            console.warn(`Attempt ${i + 1} for generating notes for "${topic.topic}" returned a short or empty response.`);
        } catch (error) {
            console.error(`Attempt ${i + 1} failed for generating notes for "${topic.topic}":`, error);
            if (i === MAX_RETRIES - 1) {
                // Last attempt failed, throw to be handled by UI
                throw error;
            }
            // Wait a moment before the next retry
            await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
        }
    }

    // This part will only be reached if all retries resulted in empty/short responses but no errors were thrown.
    throw new Error("Failed to generate valid study notes after multiple attempts.");
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
 * Handles follow-up questions using the initialized chat session, returning a stream.
 * Supports multimodal (image) input.
 */
export const apiChatWithDocumentsStream = async (message: string, imageFile?: File): Promise<AsyncGenerator<GenerateContentResponse>> => {
    if (!chat) {
        throw new Error("Chat not initialized. Please generate a study plan first.");
    }

    const wordLimit = imageFile ? 250 : 230;
    // Append a summarization instruction to the user's message to ensure a concise response in a single API call.
    const summarizationInstruction = `\n\n(Important: Please keep your response concise and under approximately ${wordLimit} words.)`;
    const fullMessage = message + summarizationInstruction;

    const messageParts: Part[] = [{ text: fullMessage }];

    if (imageFile) {
        const imagePart = await fileToGenerativePart(imageFile);
        messageParts.unshift(imagePart); // Resulting parts: [image, text]
    }

    const responseStream = await chat.sendMessageStream({ message: messageParts });
    return responseStream;
};