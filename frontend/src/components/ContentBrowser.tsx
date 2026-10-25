/**
 * ContentBrowser — Collapsible file browser for dossier content.
 *
 * Shows sections (Research, Verification, Analysis, Artifacts) with
 * expandable markdown preview and download links for binary files.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronRight, FileText, File, Download, Loader2 } from 'lucide-react';
import { dossierApi } from '../lib/api';
import type { DossierFileManifest } from '../types';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return '< 1 KB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ContentBrowserProps {
  dossierId: string;
  manifest: DossierFileManifest | null;
  isLoading: boolean;
}

export function ContentBrowser({ dossierId, manifest, isLoading }: ContentBrowserProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [loadingFiles, setLoadingFiles] = useState<Record<string, boolean>>({});
  const fileItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [scrollTarget, setScrollTarget] = useState<{ path: string; tick: number } | null>(null);

  const setFileItemRef = useCallback((path: string, el: HTMLDivElement | null) => {
    fileItemRefs.current[path] = el;
  }, []);

  useEffect(() => {
    if (!scrollTarget) return;
    const el = fileItemRefs.current[scrollTarget.path];
    if (el) {
      // Small delay to let the content render before scrolling
      const timer = setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [scrollTarget]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!manifest || manifest.sections.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-text-muted">No files found</p>
      </div>
    );
  }

  const toggleSection = (directory: string) => {
    setExpandedSections(prev => ({ ...prev, [directory]: !prev[directory] }));
  };

  const scrollTickRef = useRef(0);

  const toggleFile = async (filePath: string) => {
    const isExpanded = expandedFiles[filePath];
    if (isExpanded) {
      setExpandedFiles(prev => ({ ...prev, [filePath]: false }));
      return;
    }

    setExpandedFiles(prev => ({ ...prev, [filePath]: true }));
    scrollTickRef.current += 1;
    setScrollTarget({ path: filePath, tick: scrollTickRef.current });

    if (!fileContents[filePath]) {
      setLoadingFiles(prev => ({ ...prev, [filePath]: true }));
      let content = '';
      try {
        const result = await dossierApi.getFileContent(dossierId, filePath);
        content = result.content;
      } catch {
        content = 'Failed to load file content.';
      }
      setFileContents(prev => ({ ...prev, [filePath]: content }));
      setLoadingFiles(prev => ({ ...prev, [filePath]: false }));
      // Re-trigger scroll after content loads (content changes the element height)
      scrollTickRef.current += 1;
      setScrollTarget({ path: filePath, tick: scrollTickRef.current });
    }
  };

  return (
    <div className="space-y-3">
      {manifest.sections.map((section) => {
        const isExpanded = expandedSections[section.directory] ?? false;
        const totalWords = section.files.reduce((sum, f) => sum + f.wordCount, 0);

        return (
          <div key={section.directory} className="border border-surface-border rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection(section.directory)}
              className="w-full flex items-center justify-between px-4 py-3 bg-surface-raised hover:bg-surface-overlay transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-text-muted" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-text-muted" />
                )}
                <span className="font-medium text-text-heading">{section.label}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-text-subtle">
                <span>{section.files.length} file{section.files.length !== 1 ? 's' : ''}</span>
                {totalWords > 0 && <span>{totalWords.toLocaleString()} words</span>}
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-surface-border">
                {section.files.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-text-subtle">No files</p>
                ) : (
                  <div className="divide-y divide-surface-border">
                    {section.files.map((file) => {
                      const isFileExpanded = expandedFiles[file.path] ?? false;
                      const isFileLoading = loadingFiles[file.path] ?? false;

                      return (
                        <div key={file.path} ref={(el) => setFileItemRef(file.path, el)}>
                          <div className="flex items-center justify-between px-4 py-2.5">
                            <div className="flex items-center gap-2 min-w-0">
                              {file.isMarkdown ? (
                                <FileText className="w-4 h-4 text-text-subtle flex-shrink-0" />
                              ) : (
                                <File className="w-4 h-4 text-text-subtle flex-shrink-0" />
                              )}
                              <span className="text-sm text-text truncate">{file.name}</span>
                              {file.wordCount > 0 && (
                                <span className="text-xs text-text-subtle flex-shrink-0">
                                  {file.wordCount.toLocaleString()} words
                                </span>
                              )}
                              <span className="text-xs text-gray-400 flex-shrink-0">
                                {formatFileSize(file.sizeBytes)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                              {file.isMarkdown ? (
                                <button
                                  onClick={() => toggleFile(file.path)}
                                  className="text-xs text-brand-blue hover:underline"
                                >
                                  {isFileExpanded ? 'Collapse' : 'Expand'}
                                </button>
                              ) : (
                                <a
                                  href={dossierApi.getFileDownloadUrl(dossierId, file.path)}
                                  className="flex items-center gap-1 text-xs text-brand-blue hover:underline"
                                  download
                                >
                                  <Download className="w-3 h-3" />
                                  Download
                                </a>
                              )}
                            </div>
                          </div>

                          {isFileExpanded && file.isMarkdown && (
                            <div className="px-4 pb-4">
                              {isFileLoading ? (
                                <div className="flex items-center gap-2 py-4">
                                  <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
                                  <span className="text-sm text-text-muted">Loading...</span>
                                </div>
                              ) : (
                                <div className="p-4 bg-surface rounded-lg border border-surface-border prose prose-sm max-w-none text-text leading-relaxed
                                  prose-headings:text-text-heading prose-headings:font-display
                                  prose-h1:text-lg prose-h2:text-base prose-h3:text-sm
                                  prose-p:text-text prose-p:text-sm
                                  prose-strong:text-text-heading
                                  prose-li:text-text prose-li:text-sm
                                  prose-a:text-brand-blue
                                  prose-code:text-brand-green prose-code:bg-surface-overlay prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
                                  prose-pre:bg-surface-overlay prose-pre:rounded-lg
                                  prose-table:text-sm prose-th:text-text-heading prose-td:text-text
                                  prose-blockquote:border-brand-blue prose-blockquote:text-text-muted
                                  prose-hr:border-surface-border
                                ">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {fileContents[file.path] || ''}
                                  </ReactMarkdown>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
