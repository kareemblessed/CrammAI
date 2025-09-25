/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI, Part, Type, Chat } from "@google/genai";

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
}

export interface ChatMessage {
    role: 'user' | 'model';
    text: string;
}


// --- API INITIALIZATION ---
// WARNING: Storing API keys client-side is insecure. In a production application,
// this entire file should be moved to a backend proxy (e.g., a Vercel Function)
// to protect the API key.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
let chat: Chat | null = null;


// --- API HELPERS ---

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

// --- API FUNCTIONS ---

/**
 * Generates a study plan by analyzing user-uploaded files.
 */
export const apiGenerateStudyPlan = async (mode: Mode, files: File[]): Promise<AnalysisResult> => {
    const fileParts = await Promise.all(files.map(file => fileToGenerativePart(file)));
    const prompt = getPromptForMode(mode);
    
    // Initialize a new chat session for this study plan
    const systemInstruction = "You are an expert study assistant. Your primary role is to answer questions based *only* on the documents provided by the user. Do not use external knowledge unless the user explicitly asks for it. When asked a question, first state which document your answer is from (e.g., 'According to your syllabus...'), then provide a clear and concise answer.";
    const contents = [...fileParts, {text: "Here are my study materials."}];

    chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: { systemInstruction },
        history: [{ role: 'user', parts: contents }]
    });

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

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [prompt, ...fileParts],
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
    
    return result;
};

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
export const apiGeneratePracticeQuiz = async (topic: Topic): Promise<QuizQuestion[]> => {
    const prompt = `You are a quiz generator. Based on the topic "${topic.topic}" and the provided study notes, generate a 3-5 question multiple-choice quiz.

**RULES:**
1. Each question must be clear and test a key concept from the notes.
2. Provide 4 distinct options for each question.
3. One option must be the correct answer.
4. Include a brief, one-sentence explanation for why the correct answer is right.

**Study Notes:**
${topic.notes}`;

    const quizSchema = {
        type: Type.OBJECT,
        properties: {
            questions: {
                type: Type.ARRAY,
                description: "A list of 3-5 multiple choice questions.",
                items: {
                    type: Type.OBJECT,
                    properties: {
                        question: { type: Type.STRING },
                        options: { type: Type.ARRAY, items: { type: Type.STRING } },
                        correct_answer: { type: Type.STRING },
                        explanation: { type: Type.STRING, description: "A short explanation for the correct answer." }
                    }
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
 * Sends a user's message to the ongoing chat session and gets a response.
 */
export const apiChatWithDocuments = async (message: string): Promise<string> => {
    if (!chat) {
        throw new Error("Chat session not initialized. Please generate a study plan first.");
    }
    const response = await chat.sendMessage({ message });
    return response.text;
};