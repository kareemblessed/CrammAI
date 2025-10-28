/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import type { LiveServerMessage } from '@google/genai';
import {
    apiGenerateStudyPlan,
    apiGenerateStudyNotes,
    apiGenerateMnemonic,
    apiGeneratePracticeQuiz,
    apiGenerateQuizReflection,
    apiChatWithDocuments,
    apiConnectLiveTutor,
    createBlob,
    decode,
    decodeAudioData,
} from './api';
import type { Mode, Topic, AnalysisResult, MnemonicResult, QuizQuestion, ChatMessage } from './api';

type View = 'home' | 'upload' | 'loading' | 'results' | 'study' | 'quiz' | 'quiz-summary';
type TranscriptMessage = {
    role: 'user' | 'model' | 'status';
    text: string;
    id: number;
}


const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/mp4',
  'audio/x-m4a',
];
const MAX_FILE_SIZE_AUDIO = 20 * 1024 * 1024; // 20 MB
const MAX_FILE_SIZE_DEFAULT = 10 * 1024 * 1024; // 10 MB


// --- UI HELPER FUNCTIONS ---

/**
 * Determines the UI status (theme colors and messages) based on the selected mode.
 * @param mode - The selected study mode.
 * @returns An object with theme info, colors, and status messages.
 */
const getStatus = (mode: Mode | null) => {
    if (!mode) {
        // Neutral state before a mode is selected
        return {
            themeClassName: 'theme-neutral',
            primaryColor: 'var(--crammai-calm-primary)',
            darkBgColor: 'var(--crammai-calm-dark)',
            statusText: '',
            encouragingMessage: '',
            modeTitle: '',
            modeIcon: ''
        };
    }
    switch (mode) {
        case 'zoom':
            return {
                themeClassName: 'theme-zoom',
                primaryColor: 'var(--crammai-zoom-primary)',
                darkBgColor: 'var(--crammai-zoom-dark)',
                statusText: 'ZOOM MODE ACTIVATED',
                encouragingMessage: "Time for a strategic attack on the material.",
                modeTitle: 'Zoom Mode',
                modeIcon: '⚡'
            };
        case 'warn':
            return {
                themeClassName: 'theme-warn',
                primaryColor: 'var(--crammai-warning-primary)',
                darkBgColor: 'var(--crammai-warning-dark)',
                statusText: 'TURBO MODE ENGAGED',
                encouragingMessage: 'Time to block out distractions and get it done.',
                modeTitle: 'Turbo Mode',
                modeIcon: '🚀'
            };
        case 'calm':
        default:
            return {
                themeClassName: 'theme-calm',
                primaryColor: 'var(--crammai-calm-primary)',
                darkBgColor: 'var(--crammai-calm-dark)',
                statusText: 'CRUISE CONTROL INITIATED',
                encouragingMessage: 'Plenty of time to make a solid plan. Let\'s get started.',
                modeTitle: 'Cruise Control',
                modeIcon: '🧘'
            };
    }
};

/**
 * Converts a file size in bytes to a human-readable string (KB, MB).
 */
const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Returns an emoji icon based on the file extension.
 */
const getFileIcon = (fileName: string) => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    switch (extension) {
        case 'pdf': return '📄';
        case 'docx': case 'doc': return '📝';
        case 'txt': return '📋';
        case 'pptx': case 'ppt': return '📊';
        case 'jpg': case 'jpeg': case 'png': case 'gif': return '🖼️';
        case 'mp3': case 'wav': case 'm4a': case 'mpeg': return '🎧';
        default: return '📁';
    }
};

/**
 * Truncates a file name if it's too long to fit in the UI.
 */
const truncateFileName = (name: string, maxLength = 20) => {
    if (name.length <= maxLength) return name;
    const extIndex = name.lastIndexOf('.');
    const ext = extIndex !== -1 ? name.substring(extIndex) : '';
    const baseName = extIndex !== -1 ? name.substring(0, extIndex) : name;
    return `${baseName.substring(0, maxLength - 5 - ext.length)}...${ext}`;
};

// --- REACT COMPONENTS ---

const CrammAIEmblem = () => (
    <div className="emblem">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="CrammAI Logo">
            <path d="M12 2C6.477 2 2 6.477 2 12C2 17.523 6.477 22 12 22C17.523 22 22 17.523 22 12C22 6.477 17.523 2 12 2ZM9.5 9.5C10.328 9.5 11 8.828 11 8C11 7.172 10.328 6.5 9.5 6.5C8.672 6.5 8 7.172 8 8C8 8.828 8.672 9.5 9.5 9.5ZM14.5 15.5C15.328 15.5 16 14.828 16 14C16 13.172 15.328 12.5 14.5 12.5C13.672 12.5 13 13.172 13 14C13 14.828 13.672 15.5 14.5 15.5Z" fill="url(#grad1)"/>
            <path d="M13.4,7.4 L10.6,12.6 L13,12.6 L11.6,17.6 L14.4,12.4 L12,12.4 L13.4,7.4Z" fill="url(#grad2)"/>
            <defs>
                <linearGradient id="grad1" x1="2" y1="2" x2="22" y2="22">
                    <stop offset="0%" stopColor="#8cbaff"/>
                    <stop offset="100%" stopColor="#667eea"/>
                </linearGradient>
                <linearGradient id="grad2" x1="10" y1="7" x2="14" y2="17">
                    <stop offset="0%" stopColor="#ffd166"/>
                    <stop offset="100%" stopColor="#ff9a00"/>
                </linearGradient>
            </defs>
        </svg>
        <span className="emblem-text">CrammAI</span>
    </div>
);


const BackgroundEffects = ({ mode }: { mode: Mode | null }) => {
    const theme = getStatus(mode).themeClassName;
    
    const particles = useMemo(() => {
        let count = 0;
        if (theme === 'theme-calm' || theme === 'theme-neutral') count = 20;
        if (theme === 'theme-zoom') count = 50;

        return [...Array(count)].map((_, i) => ({
            id: i,
            left: `${Math.random() * 100}%`,
            size: `${Math.random() * 3 + 1}px`,
            duration: `${Math.random() * 10 + (theme === 'theme-zoom' ? 2 : 15)}s`,
            delay: `${Math.random() * -25}s`,
            opacity: theme === 'theme-zoom' ? Math.random() * 0.3 + 0.1 : Math.random() * 0.5 + 0.2
        }));
    }, [theme]);

    const lines = useMemo(() => {
        if (theme !== 'theme-warn') return [];
        return [...Array(10)].map((_, i) => ({
            id: i,
            width: `${Math.random() * 30 + 20}vw`,
            top: `${Math.random() * 120 - 10}%`,
            left: `${Math.random() * 120 - 10}%`,
            duration: `${Math.random() * 1 + 0.5}s`,
            delay: `${Math.random() * -1.5}s`,
        }));
    }, [theme]);

    return (
        <div id="background-animations" aria-hidden="true">
            {(theme === 'theme-calm' || theme === 'theme-zoom' || theme === 'theme-neutral') && particles.map(p => (
                <div
                    key={p.id}
                    className="particle"
                    style={{
                        left: p.left,
                        width: p.size,
                        height: p.size,
                        animationDuration: p.duration,
                        animationDelay: p.delay,
                        opacity: p.opacity
                    }}
                />
            ))}
            {theme === 'theme-warn' && lines.map(l => (
                <div
                    key={l.id}
                    className="line"
                    style={{
                        width: l.width,
                        top: l.top,
                        left: l.left,
                        animationDuration: l.duration,
                        animationDelay: l.delay
                    }}
                />
            ))}
        </div>
    );
};

const FilePreview = ({ file, onRemove }: { file: File, onRemove: (e: React.MouseEvent) => void }) => (
    <div className="file-preview-container" aria-label={`File preview for ${file.name}`}>
        <div className="file-icon" aria-hidden="true">{getFileIcon(file.name)}</div>
        <div className="file-name" title={file.name}>{truncateFileName(file.name)}</div>
        <div className="file-size">{formatFileSize(file.size)}</div>
        <button className="remove-button" onClick={onRemove} aria-label={`Remove ${file.name}`}>&times;</button>
    </div>
);

const EmptySlot = ({ slotNumber, onClick }: { slotNumber: number, onClick: () => void }) => (
    <div className="empty-slot-content" onClick={onClick} role="button" tabIndex={0} aria-label={`Upload to slot ${slotNumber}`}>
        <div className="slot-number">{slotNumber}</div>
        <div className="slot-text">Drop file or click</div>
    </div>
);

type UploadSlotProps = {
    file: File | null;
    index: number;
    isActive: boolean;
    onFileDrop: (file: File, index: number) => void;
    onFileChange: (file: File, index: number) => void;
    onRemoveFile: (index: number) => void;
};

const UploadSlot: React.FC<UploadSlotProps> = ({ file, index, isActive, onFileDrop, onFileChange, onRemoveFile }) => {
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(false);
        const droppedFiles = [...e.dataTransfer.files];
        if (droppedFiles.length > 0) {
            onFileDrop(droppedFiles[0], index);
        }
    }, [onFileDrop, index]);

    const handleClick = () => {
        inputRef.current?.click();
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            onFileChange(e.target.files[0], index);
            e.target.value = '';
        }
    };

    const handleRemove = (e: React.MouseEvent) => {
        e.stopPropagation();
        onRemoveFile(index);
    }
    
    const className = `upload-slot ${file ? 'filled' : 'empty'} ${isActive && !file ? 'active' : ''} ${isDraggingOver ? 'drag-over' : ''}`;

    return (
        <div
            className={className}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            aria-label={`Upload slot ${index + 1}. ${file ? `Contains file ${file.name}` : 'Empty'}`}
        >
            <input type="file" ref={inputRef} onChange={handleFileSelect} aria-hidden="true" />
            {file ? (
                <FilePreview file={file} onRemove={handleRemove} />
            ) : (
                <EmptySlot slotNumber={index + 1} onClick={handleClick} />
            )}
        </div>
    );
};

const HomePage = ({ onSelectMode }: { onSelectMode: (mode: Mode) => void }) => (
    <section className="view-container">
        <header className="page-header">
            <h1>Your AI Study Co-pilot</h1>
            <p className="subtitle">How much time do you have? Select a mode to begin.</p>
        </header>
        <div className="mode-selection">
            <div className="mode-card calm" onClick={() => onSelectMode('calm')} role="button" tabIndex={0}>
                <div className="mode-icon">🧘</div>
                <h2 className="mode-title">Cruise Control</h2>
                <p className="mode-description">1+ week left. Plenty of time to make a solid plan.</p>
            </div>
            <div className="mode-card warn" onClick={() => onSelectMode('warn')} role="button" tabIndex={0}>
                <div className="mode-icon">🚀</div>
                <h2 className="mode-title">Turbo Mode</h2>
                <p className="mode-description">Less than 2 days. Time to block out distractions.</p>
            </div>
            <div className="mode-card zoom" onClick={() => onSelectMode('zoom')} role="button" tabIndex={0}>
                <div className="mode-icon">⚡</div>
                <h2 className="mode-title">Zoom Mode</h2>
                <p className="mode-description">Due tonight. Maximum focus, maximum efficiency.</p>
            </div>
        </div>
    </section>
);


const UploadPage = ({ mode, files, onBack, addFile, onRemoveFile, onGeneratePlan }: {
    mode: Mode;
    files: (File | null)[];
    onBack: () => void;
    addFile: (file: File, index: number) => void;
    onRemoveFile: (index: number) => void;
    onGeneratePlan: () => void;
}) => {
    const { statusText, encouragingMessage } = getStatus(mode);
    const activeSlotIndex = files.findIndex(f => f === null);
    const isGenerateDisabled = files.every(f => f === null);

    return (
        <section className="view-container">
            <header className="upload-page-header">
                <button onClick={onBack} className="back-button" aria-label="Go back to mode selection">&larr; Change Mode</button>
                <div className="status-message">
                    <div className="status-text">{getStatus(mode).modeIcon} {statusText}</div>
                    <div className="status-subtext">{encouragingMessage}</div>
                </div>
            </header>

            <div className="upload-section">
                <h2 className="upload-title">Drop your top 3 study materials</h2>
                <div className="upload-slots">
                    {files.map((file, index) => (
                        <UploadSlot
                            key={index}
                            file={file}
                            index={index}
                            isActive={index === activeSlotIndex}
                            onFileDrop={addFile}
                            onFileChange={addFile}
                            onRemoveFile={onRemoveFile}
                        />
                    ))}
                </div>
                <div className="smart-suggestions">
                    <div className="suggestion-title">💡 What should you upload?</div>
                    <div className="suggestions">
                        <div className="suggestion">📋 Course syllabus (most important!)</div>
                        <div className="suggestion">📝 Class notes or lecture recording</div>
                        <div className="suggestion">📄 Past exam or practice test</div>
                    </div>
                    <div className="suggestion-note">Supported formats: PDF, TXT, JPG, PNG, MP3, WAV, M4A. Max 20MB for audio, 10MB for other files.</div>
                </div>
                 <button className="generate-button" disabled={isGenerateDisabled} onClick={onGeneratePlan}>
                    Generate My Study Plan
                </button>
            </div>
        </section>
    );
};

const LoadingPage = ({ mode }: { mode: Mode | null }) => {
    const quotes = useMemo(() => [
        `"The secret of getting ahead is getting started." - Mark Twain`,
        `"Success is not final, failure is not fatal: it is the courage to continue that counts." - Winston Churchill`,
        `"Believe you can and you're halfway there." - Theodore Roosevelt`,
        `"The only place where success comes before work is in the dictionary." - Vidal Sassoon`,
        `"I find that the harder I work, the more luck I seem to have." - Thomas Jefferson`
    ], []);
    const [quote, setQuote] = useState(quotes[0]);

    useEffect(() => {
        let index = 0;
        const interval = setInterval(() => {
            index = (index + 1) % quotes.length;
            setQuote(quotes[index]);
        }, 4000);
        return () => clearInterval(interval);
    }, [quotes]);

    return (
        <div className="loading-view">
            <div className="loading-spinner" />
            <div className="loading-text">CrammAI is Thinking</div>
            <p className="loading-quote">{quote}</p>
        </div>
    );
};

/**
 * Renders a string with markdown as HTML.
 * Handles headings (h1-h4), lists (*), bold (**), and a custom latex format ($$).
 */
const MarkdownRenderer: React.FC<{ text?: string; className?: string }> = ({ text, className }) => {
    if (!text) return null;

    const renderInlines = (line: string) => {
        // Process bold first, then latex
        const withBold = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        const withLatex = withBold.replace(/\$(.*?)\$/g, '<span class="latex">$1</span>');
        return withLatex;
    };

    const lines = text.split('\n');
    let html = '';
    let inList = false;

    for (const line of lines) {
        const trimmedLine = line.trim();
        
        if (trimmedLine.startsWith('#### ')) {
             if (inList) { html += '</ul>'; inList = false; }
            html += `<h4>${renderInlines(trimmedLine.substring(5))}</h4>`;
        } else if (trimmedLine.startsWith('### ')) {
            if (inList) { html += '</ul>'; inList = false; }
            html += `<h3>${renderInlines(trimmedLine.substring(4))}</h3>`;
        } else if (trimmedLine.startsWith('## ')) {
             if (inList) { html += '</ul>'; inList = false; }
            html += `<h2>${renderInlines(trimmedLine.substring(3))}</h2>`;
        } else if (trimmedLine.startsWith('# ')) {
             if (inList) { html += '</ul>'; inList = false; }
            html += `<h1>${renderInlines(trimmedLine.substring(2))}</h1>`;
        } else if (trimmedLine.startsWith('* ')) {
            if (!inList) { html += '<ul>'; inList = true; }
            html += `<li>${renderInlines(trimmedLine.substring(2))}</li>`;
        } else {
            if (inList) { html += '</ul>'; inList = false; }
            if (trimmedLine) {
                html += `<p>${renderInlines(line)}</p>`; // Use original line to preserve indentation for multiline paragraphs
            }
        }
    }
    if (inList) {
        html += '</ul>';
    }

    return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
};


const ResultsPage = ({ analysis, mode, onStudyTopic, onStartQuiz, onReset, highlightedTopicName, setHighlightedTopicName }: {
    analysis: AnalysisResult | null;
    mode: Mode;
    onStudyTopic: (topic: Topic) => void;
    onStartQuiz: (topic: Topic) => void;
    onReset: () => void;
    highlightedTopicName: string | null;
    setHighlightedTopicName: (name: string | null) => void;
}) => {
    const highlightedTopicRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (highlightedTopicName && highlightedTopicRef.current) {
            highlightedTopicRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });

            const timer = setTimeout(() => {
                setHighlightedTopicName(null);
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [highlightedTopicName, setHighlightedTopicName]);

    if (!analysis || !Array.isArray(analysis.study_these) || analysis.study_these.length === 0) {
        return (
            <section className="results-view empty-results">
                <h1 className="results-title">Analysis Complete</h1>
                <p className="results-subtitle">
                    I've analyzed your documents, but couldn't identify specific topics to prioritize.
                </p>
                <p className="empty-results-suggestion">
                    This can happen if the documents are very broad or don't contain clear study pointers like a syllabus. Try uploading more specific materials!
                </p>
                <button onClick={onReset} className="reset-button">Start Over</button>
            </section>
        );
    }

    const { modeTitle } = getStatus(mode);
    const { study_these } = analysis;

    return (
        <section className="results-view">
            <header className="results-header">
                <h1 className="results-title">{modeTitle} Study Plan</h1>
                <p className="results-subtitle">
                    I've analyzed your materials and created a prioritized study plan to maximize your score.
                </p>
            </header>

            <div className="triage-category">
                <h2 className="triage-category-title">Focus On These Topics</h2>
                 <div className="topic-list">
                    {study_these.map((topic, index) => {
                        const isHighlighted = topic.topic === highlightedTopicName;
                        return (
                            <div 
                                key={index} 
                                className={`topic-item ${isHighlighted ? 'highlighted' : ''}`} 
                                style={{ animationDelay: `${index * 100}ms` }}
                                ref={isHighlighted ? highlightedTopicRef : null}
                            >
                               <div className="topic-content">
                                    <h3 className="topic-name">{topic.topic}</h3>
                                    <p className="topic-evidence">{topic.reason}</p>
                                    {topic.key_points && topic.key_points.length > 0 && (
                                        <div className="key-points-section">
                                            <h4 className="key-points-title">Key Concepts</h4>
                                            <ul className="key-points-list">
                                                {topic.key_points.map((point, i) => <li key={i}>{point}</li>)}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                                <div className="topic-actions">
                                    <button
                                        onClick={() => onStudyTopic(topic)}
                                        className="study-button"
                                        disabled={!topic.notes || topic.notes.startsWith('Error:')}
                                    >
                                        {!topic.notes ? (
                                            <>
                                                Generating Notes <div className="loading-spinner small-inline"></div>
                                            </>
                                        ) : topic.notes.startsWith('Error:') ? (
                                            'Notes Failed'
                                        ) : (
                                            'Deep Dive →'
                                        )}
                                    </button>
                                    <button onClick={() => onStartQuiz(topic)} className="study-button secondary">
                                        Practice Quiz 🧠
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            
            <button onClick={onReset} className="reset-button">Start Over</button>
        </section>
    );
};

const MnemonicStudio = ({ topic, onUpdateTopic }: {
    topic: Topic;
    onUpdateTopic: (updatedTopic: Topic) => void;
}) => {
    // The text currently in the input box
    const [userInput, setUserInput] = useState<string>(topic.topic);
    // The mnemonic being displayed
    const [mnemonic, setMnemonic] = useState<MnemonicResult | null>(topic.mnemonic || null);
    // The topic used to generate the current mnemonic, for the "Try Another Version" feature
    const [generatedForTopic, setGeneratedForTopic] = useState<string | null>(topic.mnemonic ? topic.topic : null);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const studioRef = useRef<HTMLDivElement>(null);

    const handleGenerate = async (topicToGenerate: string) => {
        if (!topicToGenerate.trim()) {
            setError("Please enter a topic or idea.");
            return;
        }

        setIsLoading(true);
        setError(null);
        
        try {
            const previousWord = (mnemonic && generatedForTopic === topicToGenerate) ? mnemonic.mnemonic_word : undefined;
            const data = await apiGenerateMnemonic(topicToGenerate, previousWord);
            const newMnemonic = data.mnemonic_result;
            
            newMnemonic.title = `Mnemonic for ${topicToGenerate}`;
            
            setMnemonic(newMnemonic);
            setGeneratedForTopic(topicToGenerate); // Lock in what we just generated

            // Save if it matches the main topic for this page
            if (topicToGenerate.trim().toLowerCase() === topic.topic.trim().toLowerCase()) {
                onUpdateTopic({ ...topic, mnemonic: newMnemonic });
            }
        } catch (e) {
            console.error(e);
            setError("Sorry, I couldn't generate a mnemonic right now. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setMnemonic(null);
        setGeneratedForTopic(null);
        setUserInput('');
        setError(null);
        setTimeout(() => studioRef.current?.querySelector('textarea')?.focus(), 0);
    }

    const getIconForWord = (word: string) => {
        const lowerWord = word.toLowerCase();
        if (lowerWord.includes('tesla')) return '⚡';
        if (lowerWord.includes('ocean')) return '🌊';
        if (lowerWord.includes('paris')) return '🗼';
        if (lowerWord.includes('earth')) return '🌍';
        if (lowerWord.includes('apple')) return '🍏';
        return '🌟';
    };

    return (
        <div className="study-section mnemonic-studio" ref={studioRef}>
            <h2 className="study-section-title">Mnemonic Studio</h2>
            
            {/* Show input form only when no mnemonic is displayed or we are loading one */}
            {(!mnemonic || isLoading) && (
                <div className="mnemonic-generator-form">
                    <p className="mnemonic-studio-intro">What topic or idea do you want turned into a catchy mnemonic? Type it below!</p>
                    <textarea
                        className="mnemonic-input"
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        placeholder="e.g., Key Applications of Microwaves"
                        rows={3}
                        aria-label="Mnemonic topic input"
                        disabled={isLoading}
                    />
                </div>
            )}

            {isLoading && <div className="mnemonic-loader-full" />}
            {error && <div className="error-message">{error}</div>}

            {!isLoading && mnemonic && (
                <div className="mnemonic-result" aria-live="polite">
                    <h3 className="mnemonic-result-title">{mnemonic.title}</h3>
                    <div className="mnemonic-word">{mnemonic.mnemonic_word} {getIconForWord(mnemonic.mnemonic_word)}</div>
                    <p className="mnemonic-explanation">&ndash; {mnemonic.description}</p>
                    <ul className="mnemonic-mapping-list">
                        {mnemonic.breakdown.map((mapping, index) => (
                            <li key={index}>{mapping.replace('=', '–')}</li>
                        ))}
                    </ul>
                </div>
            )}
            
            <div className="mnemonic-actions">
                {isLoading ? null : mnemonic ? (
                    <>
                        <button 
                            onClick={() => handleGenerate(generatedForTopic!)} 
                            className="generate-button generate-mnemonic-button"
                        >
                           Try Another Version
                        </button>
                        <button 
                            onClick={handleReset}
                            className="generate-button generate-mnemonic-button secondary"
                        >
                            Create New One
                        </button>
                    </>
                ) : (
                    <button 
                        onClick={() => handleGenerate(userInput)} 
                        className="generate-button generate-mnemonic-button"
                        disabled={!userInput.trim()}
                    >
                        Generate Mnemonic
                    </button>
                )}
            </div>
        </div>
    );
};


const ChatStudio = () => {
    const [messages, setMessages] = useState<ChatMessage[]>([
        { role: 'model', text: "I'm ready! Ask me anything about your study materials." }
    ]);
    const [userInput, setUserInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!userInput.trim() || isLoading) return;

        const newUserMessage: ChatMessage = { role: 'user', text: userInput };
        setMessages(prev => [...prev, newUserMessage]);
        setUserInput('');
        setIsLoading(true);
        setError(null);

        try {
            const modelResponse = await apiChatWithDocuments(userInput);
            const newModelMessage: ChatMessage = { role: 'model', text: modelResponse };
            setMessages(prev => [...prev, newModelMessage]);
        } catch (e) {
            console.error("Chat error:", e);
            setError("Sorry, I couldn't get a response. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="study-section chat-studio">
            <h2 className="study-section-title">Chat Studio</h2>
            <div className="chat-messages">
                {messages.map((msg, index) => (
                    <div key={index} className={`chat-message ${msg.role}`}>
                        <MarkdownRenderer text={msg.text} />
                    </div>
                ))}
                {isLoading && (
                     <div className="chat-message model">
                        <div className="typing-indicator">
                            <span></span><span></span><span></span>
                        </div>
                    </div>
                )}
                {error && <div className="error-message">{error}</div>}
                <div ref={messagesEndRef} />
            </div>
            <form className="chat-input-form" onSubmit={handleSubmit}>
                <input
                    type="text"
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    placeholder="Ask about your documents..."
                    disabled={isLoading}
                    aria-label="Chat input"
                />
                <button type="submit" disabled={isLoading || !userInput.trim()}>Send</button>
            </form>
        </div>
    );
};


const StudyPage = ({ topic, onBack, updateTopicInList, onStartTutor }: {
    topic: Topic;
    onBack: () => void;
    updateTopicInList: (topic: Topic) => void;
    onStartTutor: (topic: Topic) => void;
}) => {
    // Note generation is now handled centrally in App.tsx. 
    // This component assumes topic.notes exists because the button on the previous page
    // is disabled until the notes are loaded.
    const isGeneratingNotes = !topic.notes;

    return (
        <section className="study-view">
            <header className="study-page-header">
                <button onClick={onBack} className="back-button" aria-label="Go back to study plan">&larr; Back to Plan</button>
            </header>

            <h1 className="study-topic-title">{topic.topic}</h1>
            
            <div className="study-actions-bar">
                <button className="live-tutor-button" onClick={() => onStartTutor(topic)}>
                    🎙️ Start Live Tutor Session
                </button>
            </div>
            
            <p className="study-topic-reason">{topic.reason}</p>

            <div className="study-content-layout">
                <div className="study-main-content">
                    <div className="study-section">
                        <h2 className="study-section-title">AI Study Notes</h2>
                        {isGeneratingNotes ? (
                            <div className="notes-loader">
                                <div className="loading-spinner small"></div>
                                <span>Loading your study notes...</span>
                            </div>
                        ) : (
                            <MarkdownRenderer text={topic.notes} className="notes-content" />
                        )}
                    </div>
                    <ChatStudio />
                </div>
                <MnemonicStudio topic={topic} onUpdateTopic={updateTopicInList} />
            </div>
        </section>
    );
};


const QuizPage = ({ topic, questions, onBack, onFinish }: {
    topic: Topic;
    questions: QuizQuestion[];
    onBack: () => void;
    onFinish: (score: number, total: number, incorrectQuestions: QuizQuestion[]) => void;
}) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
    const [score, setScore] = useState(0);
    const [incorrectQuestions, setIncorrectQuestions] = useState<QuizQuestion[]>([]);
    
    const currentQuestion = questions[currentIndex];

    const handleAnswerSelect = (option: string) => {
        if (selectedAnswer) return; // Prevent changing answer after selection

        setSelectedAnswer(option);
        if (option === currentQuestion.correct_answer) {
            setScore(s => s + 1);
        } else {
            setIncorrectQuestions(prev => [...prev, currentQuestion]);
        }
    };

    const handleNext = () => {
        if (currentIndex < questions.length - 1) {
            setCurrentIndex(prev => prev + 1);
            setSelectedAnswer(null);
        } else {
            onFinish(score, questions.length, incorrectQuestions);
        }
    };

    const getOptionClass = (option: string) => {
        if (!selectedAnswer) return '';
        if (option === currentQuestion.correct_answer) return 'correct';
        if (option === selectedAnswer) return 'incorrect';
        return 'disabled';
    };

    return (
        <section className="quiz-view view-container">
            <header className="quiz-header">
                <button onClick={onBack} className="back-button" aria-label="Go back to study plan">&larr; Back to Plan</button>
                <div className="quiz-progress">Question {currentIndex + 1}/{questions.length}</div>
                 <div className="quiz-score">Score: {score}</div>
            </header>
            <h1 className="study-topic-title">Practice Quiz: {topic.topic}</h1>
            
            <div className="quiz-card">
                <h2 className="quiz-question">{currentQuestion.question}</h2>
                <div className="quiz-options">
                    {currentQuestion.options.map((option, index) => (
                        <button
                            key={index}
                            className={`quiz-option ${getOptionClass(option)}`}
                            onClick={() => handleAnswerSelect(option)}
                            disabled={!!selectedAnswer}
                        >
                            {option}
                        </button>
                    ))}
                </div>

                {selectedAnswer && (
                    <div className="quiz-explanation">
                        <p><strong>Explanation:</strong> {currentQuestion.explanation}</p>
                    </div>
                )}
            </div>
            
            {selectedAnswer && (
                <button onClick={handleNext} className="quiz-next-button">
                    {currentIndex < questions.length - 1 ? 'Next Question' : 'Finish Quiz'} &rarr;
                </button>
            )}
        </section>
    );
};

const QuizSummaryPage = ({ topic, score, total, reflection, onRetry, onBack }: {
    topic: Topic;
    score: number;
    total: number;
    reflection: string;
    onRetry: () => void;
    onBack: () => void;
}) => {
    const accuracy = total > 0 ? Math.round((score / total) * 100) : 0;
    
    const getSummaryMessage = () => {
        if (accuracy === 100) return "Perfect score! You've mastered this topic.";
        if (accuracy >= 80) return "Excellent work! You have a strong grasp of the key concepts.";
        if (accuracy >= 60) return "Good effort! A little more review will make a big difference.";
        return "You're building a foundation. Let's try again to solidify these concepts.";
    };

    return (
        <section className="quiz-summary-view view-container">
            <header className="page-header">
                <h1>Quiz Results: {topic.topic}</h1>
            </header>
            <div className="summary-card">
                <div className="summary-score-container">
                    <div className="summary-score">{score}/{total}</div>
                    <div className="summary-accuracy">{accuracy}% Accuracy</div>
                </div>
                <p className="summary-message">{getSummaryMessage()}</p>
                <div className="summary-reflection">
                    <h2 className="reflection-title">💡 Assessment Reflection</h2>
                    <p className="reflection-text">{reflection}</p>
                </div>
                <div className="summary-actions">
                    <button onClick={onRetry} className="summary-button primary">
                        Try Again
                    </button>
                    <button onClick={onBack} className="summary-button secondary">
                        Back to Plan
                    </button>
                </div>
            </div>
        </section>
    );
};

const LiveTutorView = ({ topic, onEndSession }: { topic: Topic; onEndSession: () => void; }) => {
    const [status, setStatus] = useState<'connecting' | 'connected' | 'error' | 'disconnected'>('connecting');
    const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
    const [isSpeaking, setIsSpeaking] = useState(false);

    const sessionPromiseRef = useRef<any>(null); // Using `any` because the type is complex and we just need to hold it
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioNodesRef = useRef<{ source?: MediaStreamAudioSourceNode; processor?: ScriptProcessorNode }>({});
    const outputQueueRef = useRef<{ source: AudioBufferSourceNode; buffer: AudioBuffer }[]>([]);
    const nextStartTimeRef = useRef(0);
    
    // Refs to accumulate transcription text for the current turn
    const currentInputRef = useRef('');
    const currentOutputRef = useRef('');

    const transcriptEndRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [transcript]);

    const addMessage = useCallback((role: 'user' | 'model' | 'status', text: string) => {
        setTranscript(prev => [...prev, { role, text, id: Date.now() + Math.random() }]);
    }, []);

    const processTranscription = useCallback((message: LiveServerMessage) => {
        const isTurnComplete = message.serverContent?.turnComplete;
        const inputChunk = message.serverContent?.inputTranscription?.text;
        const outputChunk = message.serverContent?.outputTranscription?.text;

        if (inputChunk) {
            currentInputRef.current += inputChunk;
            setTranscript(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'user') {
                    // Update the last user message with the full accumulated text
                    const updatedLast = { ...last, text: currentInputRef.current };
                    return [...prev.slice(0, -1), updatedLast];
                } else {
                    // It's the first chunk of a new user message
                    return [...prev, { role: 'user', text: currentInputRef.current, id: Date.now() }];
                }
            });
        }

        if (outputChunk) {
            currentOutputRef.current += outputChunk;
            setTranscript(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'model') {
                    // Update the last model message with the full accumulated text
                    const updatedLast = { ...last, text: currentOutputRef.current };
                    return [...prev.slice(0, -1), updatedLast];
                } else {
                    // It's the first chunk of a new model message
                    return [...prev, { role: 'model', text: currentOutputRef.current, id: Date.now() }];
                }
            });
        }

        if (isTurnComplete) {
            // Clean up empty user message if they didn't really say anything
            if (currentInputRef.current.trim() === '') {
                setTranscript(prev => {
                    const last = prev[prev.length - 1];
                    if (last?.role === 'user' && last.text.trim() === '') {
                        return prev.slice(0, -1);
                    }
                    return prev;
                });
            }
            // Reset refs for the next turn
            currentInputRef.current = '';
            currentOutputRef.current = '';
        }
    }, []);

    const playAudio = useCallback(async (base64Audio: string) => {
        if (!outputAudioContextRef.current) return;
        setIsSpeaking(true);
        const audioData = decode(base64Audio);
        const audioBuffer = await decodeAudioData(audioData, outputAudioContextRef.current, 24000, 1);
        const source = outputAudioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(outputAudioContextRef.current.destination);

        const now = outputAudioContextRef.current.currentTime;
        const startTime = Math.max(now, nextStartTimeRef.current);
        source.start(startTime);
        nextStartTimeRef.current = startTime + audioBuffer.duration;

        const queueItem = { source, buffer: audioBuffer };
        outputQueueRef.current.push(queueItem);

        source.onended = () => {
            outputQueueRef.current.shift();
            if (outputQueueRef.current.length === 0) {
                setIsSpeaking(false);
            }
        };
    }, []);

    useEffect(() => {
        let isCancelled = false;

        const startSession = async () => {
            try {
                addMessage('status', 'Requesting microphone access...');
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (isCancelled) {
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }
                mediaStreamRef.current = stream;

                // FIX: Cast window to any to allow access to webkitAudioContext for older browser compatibility.
                inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                
                addMessage('status', 'Connecting to Live Tutor...');

                sessionPromiseRef.current = apiConnectLiveTutor(topic, {
                    onopen: () => {
                        if (isCancelled) return;
                        setStatus('connected');
                        addMessage('status', 'Connection established. You can start speaking.');
                        
                        const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
                        const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
                        
                        scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            sessionPromiseRef.current.then((session: any) => {
                                session.sendRealtimeInput({ media: pcmBlob });
                            });
                        };
                        
                        source.connect(scriptProcessor);
                        scriptProcessor.connect(inputAudioContextRef.current!.destination);
                        audioNodesRef.current = { source, processor: scriptProcessor };
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        processTranscription(message);
                        const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                        if (audio) {
                           await playAudio(audio);
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('Live session error:', e);
                        setStatus('error');
                        addMessage('status', `An error occurred: ${e.message}. Please try again.`);
                    },
                    onclose: () => {
                        setStatus('disconnected');
                    },
                });
                
                await sessionPromiseRef.current;

            // FIX: Corrected syntax for catch block. The `=>` was invalid and caused numerous scope errors.
            } catch (err: any) {
                console.error('Failed to start tutor session:', err);
                setStatus('error');
                addMessage('status', 'Could not access microphone. Please check your browser permissions and try again.');
            }
        };

        startSession();

        return () => {
            isCancelled = true;
            if (sessionPromiseRef.current) {
                sessionPromiseRef.current.then((session: any) => session.close());
            }
            mediaStreamRef.current?.getTracks().forEach(track => track.stop());
            if (audioNodesRef.current.source) {
                audioNodesRef.current.source.disconnect();
            }
            if (audioNodesRef.current.processor) {
                audioNodesRef.current.processor.disconnect();
            }
            inputAudioContextRef.current?.close();
            outputAudioContextRef.current?.close();
        };
    }, [topic, addMessage, playAudio, processTranscription]);

    const getStatusText = () => {
        switch(status) {
            case 'connecting': return 'Connecting...';
            case 'connected': return isSpeaking ? 'Tutor is speaking...' : 'Listening...';
            case 'error': return 'Connection Error';
            case 'disconnected': return 'Session Ended';
        }
    }

    return (
        <div className="tutor-overlay" role="dialog" aria-modal="true" aria-labelledby="tutor-title">
            <div className="tutor-container">
                <header className="tutor-header">
                    <h2 id="tutor-title">Live Tutor: {topic.topic}</h2>
                    <button onClick={onEndSession} className="tutor-close-button" aria-label="End session">&times;</button>
                </header>

                <div className="tutor-visualizer">
                    <div className={`tutor-orb ${status === 'connected' && !isSpeaking ? 'listening' : ''} ${isSpeaking ? 'speaking' : ''}`}>
                        {!isSpeaking ? (
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="tutor-icon">
                                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                                <line x1="12" y1="19" x2="12" y2="23"></line>
                                <line x1="8" y1="23" x2="16" y2="23"></line>
                            </svg>
                        ) : (
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="tutor-icon">
                                <path d="M12 6v12"></path>
                                <path d="M16 8v8"></path>
                                <path d="M8 8v8"></path>
                                <path d="M20 10v4"></path>
                                <path d="M4 10v4"></path>
                            </svg>
                        )}
                    </div>
                    <div className="tutor-status">{getStatusText()}</div>
                </div>

                <div className="tutor-transcript-container">
                    <div className="tutor-transcript">
                        {transcript.map((msg) => (
                            <div key={msg.id} className={`transcript-message ${msg.role}`}>
                                <div className="message-bubble">{msg.text}</div>
                            </div>
                        ))}
                         <div ref={transcriptEndRef} />
                    </div>
                </div>
            </div>
        </div>
    );
};


const App = () => {
    // App state
    const [view, setView] = useState<View>('home');
    const [mode, setMode] = useState<Mode | null>(null);
    const [files, setFiles] = useState<(File | null)[]>([null, null, null]);
    const [error, setError] = useState<string | null>(null);
    const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
    const [currentTopic, setCurrentTopic] = useState<Topic | null>(null);
    const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[] | null>(null);
    const [quizSummary, setQuizSummary] = useState<{score: number, total: number, reflection: string} | null>(null);
    const [isTutorActive, setIsTutorActive] = useState(false);
    const [highlightedTopicName, setHighlightedTopicName] = useState<string | null>(null);

    const theme = getStatus(mode);
    
    // Apply theme to body and set dynamic CSS variables
    useEffect(() => {
        document.body.className = theme.themeClassName;
        const root = document.documentElement;
        root.style.setProperty('--dynamic-primary', theme.primaryColor);
        root.style.setProperty('--dynamic-bg', theme.darkBgColor);
        root.style.setProperty('--dynamic-primary-trans', `${theme.primaryColor}50`);
    }, [theme]);
    
    const handleReset = () => {
        setView('home');
        setMode(null);
        setFiles([null, null, null]);
        setError(null);
        setAnalysis(null);
        setCurrentTopic(null);
        setQuizQuestions(null);
        setQuizSummary(null);
        setHighlightedTopicName(null);
        setIsTutorActive(false);
    };

    const handleSelectMode = (selectedMode: Mode) => {
        setMode(selectedMode);
        setView('upload');
    };
    
    const handleBackToHome = () => {
        setMode(null);
        setView('home');
    };
    
    const handleBackToResults = () => {
        setHighlightedTopicName(currentTopic?.topic ?? null);
        setView('results');
        setCurrentTopic(null);
        setQuizQuestions(null);
    }
    
    const handleAddFile = (file: File, index: number) => {
        // Validation
        if (!ALLOWED_MIME_TYPES.includes(file.type)) {
            alert(`File type not supported: ${file.type}. Please upload one of: ${ALLOWED_MIME_TYPES.join(', ')}`);
            return;
        }

        const isAudio = file.type.startsWith('audio/');
        const maxSize = isAudio ? MAX_FILE_SIZE_AUDIO : MAX_FILE_SIZE_DEFAULT;
        const maxSizeText = formatFileSize(maxSize);

        if (file.size > maxSize) {
            alert(`File is too large: ${formatFileSize(file.size)}. Maximum size for this file type is ${maxSizeText}.`);
            return;
        }

        const newFiles = [...files];
        newFiles[index] = file;
        setFiles(newFiles);
    };

    const handleRemoveFile = (index: number) => {
        const newFiles = [...files];
        newFiles[index] = null;
        setFiles(newFiles);
    };
    
    const updateTopicInList = useCallback((updatedTopic: Topic) => {
        setAnalysis(prev => {
            if (!prev) return null;
            const updatedTopics = prev.study_these.map(t =>
                t.topic === updatedTopic.topic ? updatedTopic : t
            );
            return { ...prev, study_these: updatedTopics };
        });

        setCurrentTopic(prev => (prev && prev.topic === updatedTopic.topic) ? updatedTopic : prev);
    }, []);

    const handleGeneratePlan = async () => {
        const validFiles = files.filter(f => f !== null) as File[];
        if (validFiles.length === 0 || !mode) return;

        setView('loading');
        setError(null);

        try {
            const initialAnalysis = await apiGenerateStudyPlan(mode, validFiles);
            // Set the analysis first so the results page shows topics immediately
            setAnalysis(initialAnalysis);
            setView('results');

            // Asynchronously generate notes for each topic and update UI as they complete
            initialAnalysis.study_these.forEach(async (topic) => {
                try {
                    const notes = await apiGenerateStudyNotes(topic);
                    updateTopicInList({ ...topic, notes });
                } catch (e) {
                    console.error(`Failed to generate notes for topic: ${topic.topic}`, e);
                    updateTopicInList({ ...topic, notes: "Error: Could not generate study notes. Please try again." });
                }
            });

        } catch (e) {
            console.error(e);
            setError("Sorry, I couldn't generate a study plan. The AI might be busy or an error occurred. Please try again.");
            setView('upload'); // Go back to upload page on error
        }
    };
    
    const handleStudyTopic = (topic: Topic) => {
        setCurrentTopic(topic);
        setView('study');
    };
    
    const handleStartQuiz = async (topic: Topic) => {
        setCurrentTopic(topic);
        setView('loading');
        
        try {
            const questions = await apiGeneratePracticeQuiz(topic);
            if (questions.length === 0) {
                 throw new Error("The AI didn't generate any questions.");
            }
            setQuizQuestions(questions);
            setView('quiz');
        } catch(e) {
            console.error(e);
            setError("Sorry, I couldn't create a quiz for this topic. Please try again.");
            setView('results');
        }
    }
    
    const handleFinishQuiz = async (score: number, total: number, incorrectQuestions: QuizQuestion[]) => {
        setView('loading');
        if (!currentTopic) {
            console.error("No current topic found for quiz summary.");
            setView('results');
            return;
        }

        try {
            const reflection = await apiGenerateQuizReflection(currentTopic, score, total, incorrectQuestions);
            setQuizSummary({ score, total, reflection });
        } catch (e) {
            console.error("Failed to generate quiz reflection:", e);
            // Provide a fallback reflection on error
            setQuizSummary({ 
                score, 
                total, 
                reflection: "Great effort on the quiz! Keep reviewing the material to solidify your understanding." 
            });
        } finally {
            setView('quiz-summary');
        }
    };
    
    const handleRetryQuiz = () => {
        if (currentTopic && quizQuestions) {
            setView('quiz');
        } else {
            handleBackToResults(); // Fallback if state is lost
        }
    }

    const handleStartTutor = (topic: Topic) => {
        setCurrentTopic(topic);
        setIsTutorActive(true);
    };

    const handleEndTutor = () => {
        setIsTutorActive(false);
    };

    const renderView = () => {
        switch (view) {
            case 'home':
                return <HomePage onSelectMode={handleSelectMode} />;
            case 'upload':
                return <UploadPage 
                    mode={mode!}
                    files={files}
                    onBack={handleBackToHome}
                    addFile={handleAddFile}
                    onRemoveFile={handleRemoveFile}
                    onGeneratePlan={handleGeneratePlan}
                />;
            case 'loading':
                return <LoadingPage mode={mode} />;
            case 'results':
                return <ResultsPage 
                    analysis={analysis}
                    mode={mode!}
                    onStudyTopic={handleStudyTopic}
                    onStartQuiz={handleStartQuiz}
                    onReset={handleReset}
                    highlightedTopicName={highlightedTopicName}
                    setHighlightedTopicName={setHighlightedTopicName}
                />;
            case 'study':
                return <StudyPage 
                    topic={currentTopic!} 
                    onBack={handleBackToResults}
                    updateTopicInList={updateTopicInList}
                    onStartTutor={handleStartTutor}
                />;
            case 'quiz':
                return <QuizPage
                    topic={currentTopic!}
                    questions={quizQuestions!}
                    onBack={handleBackToResults}
                    onFinish={handleFinishQuiz}
                />;
            case 'quiz-summary':
                return <QuizSummaryPage
                    topic={currentTopic!}
                    score={quizSummary!.score}
                    total={quizSummary!.total}
                    reflection={quizSummary!.reflection}
                    onRetry={handleRetryQuiz}
                    onBack={handleBackToResults}
                />;
            default:
                return <HomePage onSelectMode={handleSelectMode} />;
        }
    };

    return (
        <>
            <BackgroundEffects mode={mode} />
            <div className="container">
                <header className="app-header">
                    <CrammAIEmblem />
                </header>
                <main>
                    {error && <div className="error-message">{error}</div>}
                    {renderView()}
                </main>
            </div>
            {isTutorActive && currentTopic && (
                <LiveTutorView topic={currentTopic} onEndSession={handleEndTutor} />
            )}
        </>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);