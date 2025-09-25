/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import {
    apiGenerateStudyPlan,
    apiGenerateStudyNotes,
    apiGenerateBestMnemonic,
    apiGenerateFollowUpMnemonic,
    apiGeneratePracticeQuiz,
    apiChatWithDocuments,
} from './api';
import type { Mode, Topic, AnalysisResult, MnemonicOption, QuizQuestion, ChatMessage } from './api';

type View = 'home' | 'upload' | 'loading' | 'results' | 'study' | 'quiz' | 'quiz-summary';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB


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
                        <div className="suggestion">📝 Your class notes or study guide</div>
                        <div className="suggestion">📄 Past exam or practice test</div>
                    </div>
                    <div className="suggestion-note">Supported formats: PDF, TXT, JPG, PNG. Max 10MB per file.</div>
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


const ResultsPage = ({ analysis, mode, onStudyTopic, onStartQuiz, onReset }: {
    analysis: AnalysisResult | null;
    mode: Mode;
    onStudyTopic: (topic: Topic) => void;
    onStartQuiz: (topic: Topic) => void;
    onReset: () => void;
}) => {

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
                    {study_these.map((topic, index) => (
                        <div key={index} className="topic-item" style={{ animationDelay: `${index * 100}ms` }}>
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
                                <button onClick={() => onStudyTopic(topic)} className="study-button">
                                    Deep Dive &rarr;
                                </button>
                                <button onClick={() => onStartQuiz(topic)} className="study-button secondary">
                                    Practice Quiz 🧠
                                </button>
                            </div>
                        </div>
                    ))}
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
    const [bestMnemonic, setBestMnemonic] = useState<MnemonicOption | null>(topic.best_mnemonic || null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [userInput, setUserInput] = useState<string>('');
    const [followUpQuery, setFollowUpQuery] = useState<string>('');
    const [followUpMnemonic, setFollowUpMnemonic] = useState<MnemonicOption | null>(null);
    const [isFollowUpLoading, setIsFollowUpLoading] = useState(false);
    const [followUpError, setFollowUpError] = useState<string | null>(null);

    useEffect(() => {
        if (topic.key_points && !topic.best_mnemonic) {
            setUserInput(topic.key_points.join('\n'));
        }
    }, [topic.key_points, topic.best_mnemonic]);

    const handleGenerateBestMnemonic = async () => {
        setIsLoading(true);
        setError(null);

        if (!userInput.trim()) {
            setError("Please enter some points to generate a mnemonic from.");
            setIsLoading(false);
            return;
        }

        try {
            const data = await apiGenerateBestMnemonic(topic, userInput);
            setBestMnemonic(data);
            onUpdateTopic({ ...topic, best_mnemonic: data });

        } catch (e) {
            console.error(e);
            setError("Sorry, I couldn't generate a mnemonic right now.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleGenerateFollowUpMnemonic = async () => {
        setIsFollowUpLoading(true);
        setFollowUpError(null);
        setFollowUpMnemonic(null);

        if (!followUpQuery.trim()) {
            setFollowUpError("Please enter your request.");
            setIsFollowUpLoading(false);
            return;
        }

        try {
            const data = await apiGenerateFollowUpMnemonic(topic, userInput, bestMnemonic!, followUpQuery);
            setFollowUpMnemonic(data);
        } catch (e) {
            console.error(e);
            setFollowUpError("Sorry, I couldn't generate another mnemonic right now.");
        } finally {
            setIsFollowUpLoading(false);
        }
    };

    return (
        <div className="study-section mnemonic-studio">
            <h2 className="study-section-title">Mnemonic Studio</h2>
            
            <div className="generated-mnemonics-section">
                {isLoading && <div className="mnemonic-loader-full" />}
                {error && <div className="error-message">{error}</div>}
                
                {!isLoading && !bestMnemonic && (
                    <div className="mnemonic-generator-form">
                        <p className="mnemonic-studio-intro">Enter the key points you want to remember, one per line.</p>
                        <textarea
                            className="mnemonic-input"
                            value={userInput}
                            onChange={(e) => setUserInput(e.target.value)}
                            placeholder="e.g.,&#10;Productivity&#10;Accuracy&#10;Reliability"
                            rows={5}
                            aria-label="Mnemonic input"
                        />
                        <button 
                            onClick={handleGenerateBestMnemonic} 
                            className="generate-button generate-mnemonic-button"
                            disabled={!userInput.trim()}
                        >
                            Generate Mnemonic
                        </button>
                    </div>
                )}

                {bestMnemonic && (
                    <div className="mnemonic-result">
                        <h3 className="mnemonic-result-title">Mnemonic for {topic.topic}</h3>
                        <div className="mnemonic-word">{bestMnemonic.mnemonic_word}</div>
                        <p className="mnemonic-explanation">&ndash; {bestMnemonic.explanation}</p>
                        <ul className="mnemonic-mapping-list">
                            {bestMnemonic.mappings.map((mapping, index) => (
                                <li key={index}>{mapping}</li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {bestMnemonic && !isLoading && (
                <div className="ask-ai-section">
                    <h3 className="ask-ai-title">Generate another mnemonic</h3>
                    <p className="ask-ai-intro">e.g., "Give me one based on a car brand" or "Make it shorter."</p>
                    <textarea
                        className="mnemonic-input"
                        value={followUpQuery}
                        onChange={(e) => setFollowUpQuery(e.target.value)}
                        placeholder="Type your request here..."
                        rows={3}
                        aria-label="Ask for a different mnemonic"
                    />
                    <button 
                        onClick={handleGenerateFollowUpMnemonic} 
                        className="generate-button generate-mnemonic-button"
                        disabled={isFollowUpLoading || !followUpQuery.trim()}
                    >
                        {isFollowUpLoading ? 'Generating...' : 'Ask AI'}
                    </button>
                    
                    {isFollowUpLoading && <div className="mnemonic-loader-full" />}
                    {followUpError && <div className="error-message" style={{marginTop: '12px'}}>{followUpError}</div>}
                    {followUpMnemonic && (
                        <div className="mnemonic-result follow-up-result">
                            <h3 className="mnemonic-result-title">Your new mnemonic:</h3>
                            <div className="mnemonic-word">{followUpMnemonic.mnemonic_word}</div>
                            <p className="mnemonic-explanation">&ndash; {followUpMnemonic.explanation}</p>
                            <ul className="mnemonic-mapping-list">
                                {followUpMnemonic.mappings.map((mapping, index) => (
                                    <li key={index}>{mapping}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
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


const StudyPage = ({ topic: initialTopic, onBack, updateTopicInList }: {
    topic: Topic;
    onBack: () => void;
    updateTopicInList: (topic: Topic) => void;
}) => {
    const [topic, setTopic] = useState(initialTopic);
    const [isGeneratingNotes, setIsGeneratingNotes] = useState(!initialTopic.notes);
    
    const handleUpdateTopic = (updatedTopic: Topic) => {
        setTopic(updatedTopic);
        updateTopicInList(updatedTopic);
    };

    useEffect(() => {
        const generateNotes = async () => {
            if (topic.notes) {
                setIsGeneratingNotes(false);
                return;
            };
            
            try {
                const notes = await apiGenerateStudyNotes(topic);
                handleUpdateTopic({ ...topic, notes });
            } catch (e) {
                console.error("Error generating notes:", e);
                handleUpdateTopic({ ...topic, notes: "Error: Could not generate study notes. Please try again later." });
            } finally {
                setIsGeneratingNotes(false);
            }
        };

        generateNotes();
    }, []); // Run only once on mount

    return (
        <section className="study-view">
            <header className="study-page-header">
                <button onClick={onBack} className="back-button" aria-label="Go back to study plan">&larr; Back to Plan</button>
            </header>

            <h1 className="study-topic-title">{topic.topic}</h1>
            <p className="study-topic-reason">{topic.reason}</p>

            <div className="study-content-layout">
                <div className="study-main-content">
                    <div className="study-section">
                        <h2 className="study-section-title">AI Study Notes</h2>
                        {isGeneratingNotes ? (
                            <div className="notes-loader">
                                <div className="loading-spinner small"></div>
                                <span>Generating your study notes...</span>
                            </div>
                        ) : (
                            <MarkdownRenderer text={topic.notes} className="notes-content" />
                        )}
                    </div>
                    <ChatStudio />
                </div>
                <MnemonicStudio topic={topic} onUpdateTopic={handleUpdateTopic} />
            </div>
        </section>
    );
};


const QuizPage = ({ topic, questions, onBack, onFinish }: {
    topic: Topic;
    questions: QuizQuestion[];
    onBack: () => void;
    onFinish: (score: number, total: number) => void;
}) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
    const [score, setScore] = useState(0);
    
    const currentQuestion = questions[currentIndex];

    const handleAnswerSelect = (option: string) => {
        if (selectedAnswer) return; // Prevent changing answer after selection

        setSelectedAnswer(option);
        if (option === currentQuestion.correct_answer) {
            setScore(s => s + 1);
        }
    };

    const handleNext = () => {
        if (currentIndex < questions.length - 1) {
            setCurrentIndex(prev => prev + 1);
            setSelectedAnswer(null);
        } else {
            onFinish(score, questions.length);
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

const QuizSummaryPage = ({ topic, score, total, onRetry, onBack }: {
    topic: Topic;
    score: number;
    total: number;
    onRetry: () => void;
    onBack: () => void;
}) => {
    const accuracy = total > 0 ? Math.round((score / total) * 100) : 0;
    
    const getSummaryMessage = () => {
        if (accuracy === 100) return "Perfect score! You've mastered this topic.";
        if (accuracy >= 80) return "Excellent work! You have a strong grasp of the key concepts.";
        if (accuracy >= 60) return "Good effort! A little more review will make a big difference.";
        return "You're building a foundation. Let's try that again to solidify your knowledge.";
    };

    return (
        <section className="quiz-summary-view view-container">
            <header className="page-header">
                <h1>Quiz Complete!</h1>
                <p className="subtitle">Here's your performance for the topic: {topic.topic}</p>
            </header>
            <div className="summary-card">
                <div className="summary-score-container">
                    <div className="summary-score">{score}/{total}</div>
                    <div className="summary-accuracy">{accuracy}% Accuracy</div>
                </div>
                <p className="summary-message">{getSummaryMessage()}</p>
                <div className="summary-actions">
                    <button className="summary-button secondary" onClick={onBack}>Back to Plan</button>
                    <button className="summary-button primary" onClick={onRetry}>
                        Retry Quiz
                    </button>
                </div>
            </div>
        </section>
    );
};


const App = () => {
    const [view, setView] = useState<View>('home');
    const [mode, setMode] = useState<Mode | null>(null);
    const [files, setFiles] = useState<(File | null)[]>([null, null, null]);
    const [error, setError] = useState<string | null>(null);
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
    const [activeTopic, setActiveTopic] = useState<Topic | null>(null);
    const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
    const [quizSummary, setQuizSummary] = useState<{ score: number, total: number } | null>(null);

    const handleSelectMode = (selectedMode: Mode) => {
        setMode(selectedMode);
        setView('upload');
    };

    const handleBackToHome = () => {
        setMode(null);
        setView('home');
    };

    const handleReset = () => {
        setMode(null);
        setView('home');
        setFiles([null, null, null]);
        setError(null);
        setAnalysisResult(null);
        setActiveTopic(null);
    };

    const handleAddFile = (file: File, index: number) => {
        setError(null);
        if (!ALLOWED_MIME_TYPES.includes(file.type)) {
            setError(`File type not supported: ${file.type}. Please upload a supported format.`);
            return;
        }
        if (file.size > MAX_FILE_SIZE) {
            setError(`File size exceeds the 10MB limit.`);
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
    
    const handleGeneratePlan = async () => {
        const validFiles = files.filter((f): f is File => f !== null);
        if (validFiles.length === 0 || !mode) return;
        
        setView('loading');
        setError(null);
        try {
            const result = await apiGenerateStudyPlan(mode, validFiles);
            setAnalysisResult(result);
            setView('results');
        } catch (e) {
            console.error(e);
            setError("Sorry, there was an error analyzing your documents. Please try again.");
            // On error, go back to upload view to allow user to try again
            setView('upload'); 
        }
    };
    
    const handleStudyTopic = (topic: Topic) => {
        setActiveTopic(topic);
        setView('study');
    };

    const handleStartQuiz = async (topic: Topic) => {
        // A quiz needs the study notes, which are generated on the study page.
        // Let's ensure notes exist before creating a quiz.
        setView('loading');
        try {
            let topicWithNotes = topic;
            if (!topic.notes) {
                const notes = await apiGenerateStudyNotes(topic);
                topicWithNotes = { ...topic, notes };
                // Update the topic in the main list so we don't regenerate notes next time
                updateTopicInList(topicWithNotes);
            }
            
            const generatedQuestions = await apiGeneratePracticeQuiz(topicWithNotes);
            setActiveTopic(topicWithNotes);
            setQuizQuestions(generatedQuestions);
            setView('quiz');
        } catch (e) {
            console.error("Error generating quiz:", e);
            setError("Sorry, there was an error creating the quiz. Please try again.");
            setView('results'); // Go back to results on failure
        }
    };
    
    const handleFinishQuiz = (score: number, total: number) => {
        setQuizSummary({ score, total });
        setView('quiz-summary');
    };
    
    const handleBackToResults = () => {
        setActiveTopic(null);
        setQuizSummary(null);
        setView('results');
    };

    const updateTopicInList = (updatedTopic: Topic) => {
        if (!analysisResult) return;
        const newStudyThese = analysisResult.study_these.map(t => 
            t.topic === updatedTopic.topic ? updatedTopic : t
        );
        setAnalysisResult({ ...analysisResult, study_these: newStudyThese });
    };

    useEffect(() => {
        const status = getStatus(mode);
        document.body.className = status.themeClassName;
        
        const root = document.documentElement;
        root.style.setProperty('--dynamic-primary', status.primaryColor);
        root.style.setProperty('--dynamic-primary-trans', `${status.primaryColor}40`); // For glows
        root.style.setProperty('--dynamic-bg', status.darkBgColor);

    }, [mode]);

    const renderView = () => {
        switch (view) {
            case 'home':
                return <HomePage onSelectMode={handleSelectMode} />;
            case 'upload':
                return (
                    <>
                        {error && <div className="error-message">{error}</div>}
                        <UploadPage 
                            mode={mode!} 
                            files={files} 
                            onBack={handleBackToHome} 
                            addFile={handleAddFile} 
                            onRemoveFile={handleRemoveFile}
                            onGeneratePlan={handleGeneratePlan}
                        />
                    </>
                );
            case 'loading':
                return <LoadingPage mode={mode} />;
            case 'results':
                return <ResultsPage 
                    analysis={analysisResult} 
                    mode={mode!} 
                    onStudyTopic={handleStudyTopic}
                    onStartQuiz={handleStartQuiz}
                    onReset={handleReset} 
                />;
            case 'study':
                return <StudyPage 
                            topic={activeTopic!} 
                            onBack={handleBackToResults} 
                            updateTopicInList={updateTopicInList}
                       />;
            case 'quiz':
                 return <QuizPage 
                            topic={activeTopic!} 
                            questions={quizQuestions}
                            onBack={handleBackToResults}
                            onFinish={handleFinishQuiz}
                       />;
            case 'quiz-summary':
                return <QuizSummaryPage
                            topic={activeTopic!}
                            score={quizSummary!.score}
                            total={quizSummary!.total}
                            onRetry={() => handleStartQuiz(activeTopic!)}
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
                    {renderView()}
                </main>
            </div>
        </>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<App />);