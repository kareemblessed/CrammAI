/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
// FIX: Remove 'LiveSession' as it is not an exported member of '@google/genai'.
import { GoogleGenAI, Part, Type, Chat, LiveServerMessage, Modality, Blob } from "@google/genai";

// --- TYPE DEFINITIONS ---
export type Mode = 'calm' | 'warn' | 'zoom';

export interface MnemonicOption {
    mnemonic_word: string;
    explanation: string;
    mappings: string[];
}

export interface Topic {
    topic: string;
    reason: string;
    key_points?: string[];
    notes?: string;
    best_mnemonic?: MnemonicOption;
}

export interface AnalysisResult {
    study_these: Topic[];
}

export interface QuizQuestion {
    question: string;
    options: string[];
    correct_answer: string;
    explanation: string;
    difficulty: 'easy' | 'medium' | 'hard';
}

export interface QuizSummary {
    headline: string;
    summary_text: string;
    concepts_to_review: string[];
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
                    }
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

    const resultText = response.text;
    if (!resultText) throw new Error("Received an empty response from the AI.");

    const result = JSON.parse(resultText);
    if (!result || !Array.isArray(result.study_these)) {
        console.error("Invalid data structure received:", result);
        throw new Error("The AI returned data in an unexpected format.");
    }
    
    // --- CHAT INITIALIZATION ---
    // Now that we have the first successful interaction, we can initialize the chat session.
    // The history will be the user's initial request (files + prompt) and the model's response (the plan).
    const systemInstruction = `You are an expert study assistant. Your primary role is to answer questions based *only* on the documents provided by the user in our initial interaction: specifically, the study notes about the topic being discussed. The topic is: ${result.study_these.map(t => t.topic).join(', ')}. Do not use external knowledge unless the user explicitly asks for it. When asked a question, first state which document your answer is from (e.g., 'According to your syllabus...'), then provide a clear and concise answer.`;

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
// FIX: Update return type to Promise<any> as 'LiveSession' is not a public type.
export const apiConnectLiveTutor = (topic: Topic, callbacks: LiveCallbacks): Promise<any> => {
    const systemInstruction = `You are an enthusiastic and patient AI study tutor named CrammAi. Your goal is to help a student master the topic of "${topic.topic}". You have access to their study notes.

**Your Persona:**
- **Encouraging:** Start with a warm welcome like, "Hey there! I'm CrammAi, your personal tutor for ${topic.topic}. I'm excited to help you crush this! What's on your mind?"
- **Interactive:** Ask questions to check for understanding (e.g., "Does that make sense?", "Can you explain that back to me in your own words?").
- **Focused:** Stick to the provided study notes for this topic. If a question is outside the notes, gently guide them back by saying something like, "That's a great question! For now, let's focus on what's in your study materials to make sure we've got that covered for your exam."
- **Socratic:** Instead of just giving answers, try to guide the student to the answer themselves.
- **Concise:** Keep your answers clear and to the point.

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
    const prompt = `Create study notes that are easy to cram and remember. For the topic "${topic.topic}", follow these rules strictly:

1.  Begin with a '### 🔎 Quick Summary' of the topic in 3–5 simple sentences.
2.  Break down the main points into numbered sections. Each section must have:
    - A short, clear heading as a markdown H4 heading (e.g., '#### 1. Productivity Boost 🚀').
    - A 1–2 sentence explanation (straight to the point, no fluff).
    - A line starting with '**Example:**' followed by a real-world example.
    - A line starting with '**Remember:** 🧠' with a metaphor, image, or phrase to lock it in memory.

Use the key concepts: ${topic.key_points?.join(', ')}. Format the entire output using markdown without any other text.`;
    
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
    });
    
    return response.text;
};

/**
 * Generates the best mnemonic for a given set of key points.
 */
export const apiGenerateBestMnemonic = async (topic: Topic, userInput: string): Promise<MnemonicOption> => {
    const prompt = `You are a creative mnemonic expert, specializing in making study points lively and memorable. Your task is to generate a SINGLE, high-quality mnemonic for the given topic.

**RULES:**
1.  **Mnemonic Word:** The mnemonic MUST be a single, well-known name of a city, country, capital, brand, or celebrity.
2.  **Thematic Fit:** The chosen name MUST fit the theme of the topic. You must explain this connection. For example, for "Advantages of AI," you might choose "PARIS" because it's a city known for innovation, elegance, and structure.
3.  **Perfect Mapping:** Each letter of the mnemonic word must map to one key point. You must adapt the user's provided points (condensing, splitting, or rephrasing) to perfectly match the length of your chosen mnemonic word.
4.  **Strict Format:** You MUST follow this format exactly. Do not add any introductory text, closing remarks, or deviations.

**FORMAT:**
Mnemonic: [THE WORD] – [A short, lively explanation of why this word fits the topic.]
[First Letter] = [First key point]
[Second Letter] = [Second key point]
...and so on.

---

Now, generate a mnemonic for the following topic and key points:

**Topic:** ${topic.topic}
**Key Points:**
${userInput}`;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
    });
    
    const text = response.text.trim();
    const mnemonicLineMatch = text.match(/^Mnemonic:\s*([^\s–-]+)\s*[–-]\s*(.*)/im);
    const mnemonic_word = mnemonicLineMatch ? mnemonicLineMatch[1].trim().toUpperCase() : null;
    const explanation = mnemonicLineMatch ? mnemonicLineMatch[2].trim() : null;
    const mappingLines = text.match(/^[A-Z]\s*=\s*.*/gm);
    const mappings = mappingLines ? mappingLines.map(line => line.trim()) : [];

    if (!mnemonic_word || !explanation || mappings.length === 0) {
        console.error("Failed to parse mnemonic response:", text);
        throw new Error("AI failed to generate a mnemonic in the expected format.");
    }
    
    return { mnemonic_word, explanation, mappings };
};

/**
 * Generates a follow-up mnemonic based on user feedback.
 */
export const apiGenerateFollowUpMnemonic = async (topic: Topic, userInput: string, bestMnemonic: MnemonicOption, followUpQuery: string): Promise<MnemonicOption> => {
    const prompt = `You are a creative mnemonic expert. You have already generated one mnemonic for the user. Now, the user has a follow-up request to generate a different one.

**Original Topic:** ${topic.topic}
**Original Key Points:**
${userInput || topic.key_points?.join('\n')}

**Previously Generated Mnemonic:**
Mnemonic: ${bestMnemonic.mnemonic_word} – ${bestMnemonic.explanation}
${bestMnemonic.mappings.join('\n')}

**User's New Request:** ${followUpQuery}

**Your Task:**
Generate a SINGLE, NEW mnemonic based on the user's request.

**RULES (must follow):**
1.  **Mnemonic Word:** Must be a single, well-known name (city, brand, celebrity, etc.).
2.  **Thematic Fit:** The chosen name MUST fit the theme of the topic. Explain why.
3.  **Perfect Mapping:** Each letter must map to a key point. Adapt the original points as needed.
4.  **Strict Format:** You MUST follow the format below exactly. Do not add any text outside this format.

**FORMAT:**
Mnemonic: [THE WORD] – [A short, lively explanation of why this word fits the topic.]
[First Letter] = [First key point]
[Second Letter] = [Second key point]
...and so on.`;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
    });

    const text = response.text.trim();
    const mnemonicLineMatch = text.match(/^Mnemonic:\s*([^\s–-]+)\s*[–-]\s*(.*)/im);
    const mnemonic_word = mnemonicLineMatch ? mnemonicLineMatch[1].trim().toUpperCase() : null;
    const explanation = mnemonicLineMatch ? mnemonicLineMatch[2].trim() : null;
    const mappingLines = text.match(/^[A-Z]\s*=\s*.*/gm);
    const mappings = mappingLines ? mappingLines.map(line => line.trim()) : [];

    if (!mnemonic_word || !explanation || mappings.length === 0) {
        throw new Error("AI failed to generate a mnemonic in the expected format.");
    }

    return { mnemonic_word, explanation, mappings };
};


/**
 * Generates a practice quiz for a specific topic based on its study notes.
 */
export const apiGeneratePracticeQuiz = async (
    topic: Topic,
    difficulty: 'easy' | 'medium' | 'hard',
    count: number,
    excludeQuestions: QuizQuestion[] = []
): Promise<QuizQuestion[]> => {
    const excludedQuestionText = excludeQuestions.map(q => q.question).join('; ');

    const prompt = `You are a quiz generator. Based on the topic "${topic.topic}" and the provided study notes, generate ${count} ${difficulty}-difficulty multiple-choice questions.

**RULES:**
1.  Each question must be clear and test a key concept from the notes.
2.  The difficulty of the questions must be '${difficulty}'.
3.  Provide 4 distinct options for each question.
4.  One option must be the correct answer.
5.  Include a brief, one-sentence explanation for why the correct answer is right.
6.  Do not repeat any of these questions: ${excludedQuestionText}

**Study Notes:**
${topic.notes}`;

    const quizSchema = {
        type: Type.OBJECT,
        properties: {
            questions: {
                type: Type.ARRAY,
                description: `A list of ${count} multiple choice questions.`,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        question: { type: Type.STRING },
                        options: { type: Type.ARRAY, items: { type: Type.STRING } },
                        correct_answer: { type: Type.STRING },
                        explanation: { type: Type.STRING, description: "A short explanation for the correct answer." },
                        difficulty: { type: Type.STRING, description: `The difficulty, which must be '${difficulty}'.` }
                    },
                    required: ["question", "options", "correct_answer", "explanation", "difficulty"]
                }
            }
        }
    };

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: quizSchema,
        },
    });

    const result = JSON.parse(response.text);
    if (result.questions && result.questions.length > 0) {
        return result.questions;
    } else {
        throw new Error("No quiz questions were generated.");
    }
};

/**
 * Generates a personalized summary and feedback based on quiz performance.
 */
export const apiGenerateQuizSummary = async (
    topic: Topic,
    questions: QuizQuestion[],
    userAnswers: (string | null)[]
): Promise<QuizSummary> => {
    const resultsString = questions.map((q, i) => {
        const userAnswer = userAnswers[i];
        const isCorrect = userAnswer === q.correct_answer;
        return `Question ${i + 1} (${q.difficulty}): ${isCorrect ? 'Correct' : 'Incorrect'}. User answered "${userAnswer}", the correct answer was "${q.correct_answer}". The question was: "${q.question}"`;
    }).join('\n');

    const prompt = `You are an expert tutor providing feedback on a practice quiz for the topic: "${topic.topic}".

Here are the quiz results:
${resultsString}

Analyze the student's performance, paying close attention to the incorrect answers and their difficulty. Your goal is to provide encouraging but actionable feedback.

Generate a JSON response with the following structure:
- headline: A short, encouraging title for the summary (e.g., "Great Effort!" or "Solid Foundation!").
- summary_text: A paragraph explaining what they did well and identifying the primary area(s) for improvement based on the missed questions. Be specific. For example: "You have a good grasp of the basic concepts, but seem to struggle with questions related to [specific concept from missed question]. Let's focus on that."
- concepts_to_review: A list of 2-3 specific concepts or terms from the missed questions that the student should review in their notes.`;

    const summarySchema = {
        type: Type.OBJECT,
        properties: {
            headline: { type: Type.STRING },
            summary_text: { type: Type.STRING },
            concepts_to_review: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["headline", "summary_text", "concepts_to_review"]
    };

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: summarySchema,
        },
    });

    return JSON.parse(response.text);
};


/**
 * Sends a user's message to the ongoing chat session and gets a response.
 */
export const apiChatWithDocuments = async (message: string): Promise<string> => {
    if (!chat) {
        throw new Error("Chat session not initialized. Please generate a study plan first.");
    }
    const response = await chat.sendMessage({ message });
    return response.text;
};
