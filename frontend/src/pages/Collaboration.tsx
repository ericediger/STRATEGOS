/**
 * Collaboration Chat Page
 *
 * Phase 0: AI-guided conversation to define competitive analysis scope.
 * When ready, synthesizes conversation into a Research Brief.
 */

import { useState, useRef, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Send,
  Target,
  Loader2,
  AlertCircle,
  User,
  Bot,
  FileText,
  CheckCircle,
} from 'lucide-react';
import { useProject, useSynthesizeBrief } from '../hooks/useProjects';
import { collaborationApi } from '../lib/api';
import { sanitizeContent } from '../lib/sanitize';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export function Collaboration() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { data: projectData, isLoading: projectLoading } = useProject(projectId);
  const synthesizeBrief = useSynthesizeBrief();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load existing conversation history
  useEffect(() => {
    if (!projectId || !projectData) return;

    const loadHistory = async () => {
      try {
        const data = await collaborationApi.getChatHistory(projectId);
        if (data.messages && data.messages.length > 0) {
          setMessages(
            data.messages.map((msg: { role: string; content: string; timestamp?: string }, i: number) => ({
              id: `history-${i}`,
              role: msg.role as 'user' | 'assistant',
              content: msg.content,
              timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
            }))
          );
        } else {
          const projectName = projectData?.project?.name || 'your project';
          setMessages([{
            id: 'welcome',
            role: 'assistant',
            content: `Welcome to the Strategic Analysis collaboration for "${projectName}".

I'll help you define the scope and objectives for your competitive research. Let's start by understanding your competitive landscape.

**Some questions to consider:**
- What market or industry are you analyzing?
- Who are the key competitors you want to investigate?
- What specific aspects matter most? (pricing, features, market positioning, technology, go-to-market strategy, etc.)
- What decisions will this analysis inform?

Share whatever you know so far, and I'll help you refine the research scope into a comprehensive Research Brief.`,
            timestamp: new Date(),
          }]);
        }
      } catch (err) {
        console.error('Failed to load chat history:', err);
        setMessages([{
          id: 'welcome',
          role: 'assistant',
          content: `Let's define the scope of your competitive analysis. What market or competitors are you investigating?`,
          timestamp: new Date(),
        }]);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    loadHistory();
  }, [projectId, projectData]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const sendMessage = async () => {
    if (!input.trim() || !projectId) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsThinking(true);
    setError(null);

    try {
      const data = await collaborationApi.sendChat(projectId, userMessage.content);

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.reply,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      setError('Failed to send message. Please try again.');
      console.error('Chat error:', err);
    } finally {
      setIsThinking(false);
    }
  };

  const handleSynthesizeBrief = async () => {
    if (!projectId || messages.length < 3) return;

    setIsSynthesizing(true);
    setError(null);

    try {
      await synthesizeBrief.mutateAsync(projectId);
      navigate(`/project/${projectId}`);
    } catch (err) {
      setError('Failed to synthesize brief. Please try again.');
      console.error('Synthesize brief error:', err);
    } finally {
      setIsSynthesizing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (projectLoading || isLoadingHistory) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!projectData) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-status-blocked-fg" />
          <p className="text-text-muted">Project not found</p>
          <Link to="/" className="text-status-running-fg hover:underline mt-4 inline-block">
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  const projectName = projectData?.project?.name || 'Project';
  const projectStatus = projectData?.project?.status || 'not_started';
  const briefAlreadyGenerated = ['brief_generated', 'brief_approved'].includes(projectStatus) ||
    !['not_started', 'collaborating'].includes(projectStatus);
  const canSynthesize = messages.length >= 4 && !isThinking && !briefAlreadyGenerated;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-surface-border bg-surface-raised sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                to={`/project/${projectId}`}
                className="p-2 hover:bg-interactive rounded transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-text-muted" />
              </Link>
              <div>
                <div className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-status-running-fg" />
                  <h1 className="text-xl font-display font-semibold text-text-heading">Collaboration</h1>
                </div>
                <p className="text-sm text-text-muted">{projectName}</p>
              </div>
            </div>

            {/* Synthesize Brief Button */}
            {!briefAlreadyGenerated && (
              <div className="flex flex-col items-end">
                <button
                  onClick={handleSynthesizeBrief}
                  disabled={!canSynthesize || isSynthesizing}
                  className="flex items-center gap-2 px-4 py-2 bg-status-complete-bg text-status-complete-fg hover:opacity-90 rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  title={!canSynthesize ? 'Continue the conversation before synthesizing' : ''}
                >
                  {isSynthesizing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                  Create Research Brief
                </button>
                {canSynthesize && (
                  <p className="text-xs text-text-subtle mt-1">Takes about 60 seconds</p>
                )}
              </div>
            )}

            {briefAlreadyGenerated && (
              <div className="flex items-center gap-2 text-sm text-status-complete-fg">
                <CheckCircle className="w-4 h-4" />
                Brief Generated
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-4 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div
                className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                  message.role === 'user'
                    ? 'bg-interactive'
                    : 'bg-status-running-bg'
                }`}
              >
                {message.role === 'user' ? (
                  <User className="w-4 h-4 text-text" />
                ) : (
                  <Bot className="w-4 h-4 text-status-running-fg" />
                )}
              </div>

              <div
                className={`flex-1 max-w-[80%] ${
                  message.role === 'user' ? 'text-right' : ''
                }`}
              >
                <div
                  className={`inline-block px-4 py-3 rounded-lg ${
                    message.role === 'user'
                      ? 'bg-interactive text-text'
                      : 'bg-surface-raised border border-surface-border text-text'
                  }`}
                >
                  <p className="whitespace-pre-wrap text-left">{message.role === 'assistant' ? sanitizeContent(message.content) : message.content}</p>
                </div>
                <p className="text-xs text-text-subtle mt-1">
                  {message.timestamp.toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))}

          {isThinking && (
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-status-running-bg flex items-center justify-center">
                <Bot className="w-4 h-4 text-status-running-fg" />
              </div>
              <div className="flex items-center gap-2 px-4 py-3 bg-surface-raised border border-surface-border rounded-lg">
                <Loader2 className="w-4 h-4 animate-spin text-status-running-fg" />
                <span className="text-text-muted">Thinking...</span>
              </div>
            </div>
          )}

          {isSynthesizing && (
            <div className="flex justify-center">
              <div className="flex items-center gap-2 px-4 py-3 bg-status-running-bg/20 border border-status-running-border rounded-lg">
                <Loader2 className="w-4 h-4 animate-spin text-status-running-fg" />
                <span className="text-status-running-fg font-medium">
                  Synthesizing Research Brief with extended thinking...
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="flex justify-center">
              <div className="px-4 py-2 bg-status-blocked-surface border border-status-blocked-border rounded-lg">
                <p className="text-sm text-status-blocked-fg">{error}</p>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input Area */}
      <footer className="border-t border-surface-border bg-surface-raised">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe your competitive landscape, key competitors, or research questions..."
                className="w-full px-4 py-3 bg-surface border border-surface-border rounded-lg text-text placeholder:text-text-subtle focus:outline-none focus:border-interactive-border resize-none"
                rows={1}
                disabled={isThinking || isSynthesizing}
              />
            </div>

            <button
              onClick={sendMessage}
              disabled={!input.trim() || isThinking || isSynthesizing}
              className="flex-shrink-0 p-3 bg-interactive hover:bg-interactive-hover rounded-lg text-text disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>

          <p className="text-xs text-text-subtle mt-2 text-center">
            Press Enter to send, Shift+Enter for new line
            {!briefAlreadyGenerated && messages.length >= 4 && (
              <span className="ml-2 text-status-running-fg">
                Ready to synthesize brief when you're done exploring
              </span>
            )}
          </p>
        </div>
      </footer>
    </div>
  );
}
