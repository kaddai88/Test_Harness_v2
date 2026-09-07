import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

type FileFormat = 'text' | 'image' | 'pdf' | 'word' | 'excel' | 'unknown';

interface UploadedFile {
  name: string;
  content: string;
  size: number;
  type: string;
  format: FileFormat;
}

const ACCEPTED_TYPES = '.txt,.md,.csv,.json,.xml,.html,.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.svg';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export const NewSession: React.FC = () => {
  const navigate = useNavigate();
  const { createSession, loading, error, clearError } = useSessionStore();

  const [url, setUrl] = useState('');
  const [instructions, setInstructions] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [testType, setTestType] = useState<'smoke' | 'confirmation' | 'acceptance' | 'full'>('acceptance');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load settings from localStorage
  const getSettingsMaxTurns = (): number | undefined => {
    try {
      const raw = localStorage.getItem('th-dashboard-settings');
      if (raw) {
        const settings = JSON.parse(raw);
        if (settings.maxTurns) return parseInt(settings.maxTurns, 10);
      }
    } catch {
      // Ignore
    }
    return undefined;
  };

  const getSettingsMaxRetries = (): number | undefined => {
    try {
      const raw = localStorage.getItem('th-dashboard-settings');
      if (raw) {
        const settings = JSON.parse(raw);
        if (settings.maxRetriesPerAction) return parseInt(settings.maxRetriesPerAction, 10);
      }
    } catch {
      // Ignore
    }
    return undefined;
  };

  /** Detect file format from MIME type and extension */
  const detectFormat = (file: File): FileFormat => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const mime = file.type;

    if (mime.startsWith('image/')) return 'image';
    if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') return 'word';
    if (mime === 'application/vnd.ms-excel' || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || ext === 'xls' || ext === 'xlsx') return 'excel';
    if (mime.startsWith('text/') || ['txt', 'md', 'csv', 'json', 'xml', 'html'].includes(ext || '')) return 'text';
    return 'unknown';
  };

  /** Read file as text */
  const readAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error(`Failed to read "${file.name}"`));
      reader.readAsText(file);
    });
  };

  /** Read file as data URL (base64) */
  const readAsDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error(`Failed to read "${file.name}"`));
      reader.readAsDataURL(file);
    });
  };

  /** Read file as ArrayBuffer */
  const readAsArrayBuffer = (file: File): Promise<ArrayBuffer> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(new Error(`Failed to read "${file.name}"`));
      reader.readAsArrayBuffer(file);
    });
  };

  /** Extract text from PDF */
  const extractPdfText = async (file: File): Promise<string> => {
    const arrayBuffer = await readAsArrayBuffer(file);
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const texts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: any) => item.str).join(' ');
      texts.push(pageText);
    }
    return texts.join('\n\n');
  };

  /** Extract text from Word document */
  const extractWordText = async (file: File): Promise<string> => {
    const arrayBuffer = await readAsArrayBuffer(file);
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  };

  /** Extract text from Excel */
  const extractExcelText = async (file: File): Promise<string> => {
    const arrayBuffer = await readAsArrayBuffer(file);
    const workbook = XLSX.read(arrayBuffer);
    const texts: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (sheet) {
        const csv = XLSX.utils.sheet_to_csv(sheet);
        texts.push(`[Sheet: ${sheetName}]\n${csv}`);
      }
    }
    return texts.join('\n\n');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setFileError(null);

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        setFileError(`"${file.name}" exceeds 10 MB limit`);
        continue;
      }

      try {
        const format = detectFormat(file);
        let content = '';

        switch (format) {
          case 'text':
            content = await readAsText(file);
            break;
          case 'image':
            content = await readAsDataURL(file);
            break;
          case 'pdf':
            content = await extractPdfText(file);
            break;
          case 'word':
            content = await extractWordText(file);
            break;
          case 'excel':
            content = await extractExcelText(file);
            break;
          default:
            content = await readAsText(file);
        }

        setUploadedFiles(prev => [...prev, {
          name: file.name,
          content,
          size: file.size,
          type: file.type || 'application/octet-stream',
          format,
        }]);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : 'Failed to read file');
      }
    }

    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  /** Build final instructions: text files go into instructions, images go separately */
  const buildFinalInstructions = (): string | undefined => {
    const parts: string[] = [];

    if (uploadedFiles.length > 0) {
      for (const file of uploadedFiles) {
        // Only include text-based files in instructions; images are sent separately
        if (file.format !== 'image') {
          parts.push(`[Uploaded file: ${file.name}]\n${file.content}`);
        }
      }
      if (uploadedFiles.some(f => f.format !== 'image')) {
        parts.push(''); // blank separator only if we added text files
      }
    }

    if (instructions.trim()) {
      parts.push(instructions.trim());
    }

    const merged = parts.join('\n');
    return merged || undefined;
  };

  /** Extract image data URLs for vision-capable LLMs */
  const extractImages = (): string[] => {
    return uploadedFiles
      .filter(f => f.format === 'image')
      .map(f => f.content);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    try {
      const maxTurns = getSettingsMaxTurns();
      const maxRetries = getSettingsMaxRetries();
      const finalInstructions = buildFinalInstructions();
      const images = extractImages();
      const id = await createSession(
        url.trim(),
        finalInstructions,
        maxTurns,
        maxRetries,
        images.length > 0 ? images : undefined,
        testType,
      );
      navigate(`/sessions/${id}`);
    } catch {
      // Error is handled by the store
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">New Test Session</h1>
        <p className="mt-1 text-sm text-slate-400">
          Tell the AI agent what to test — it will plan and execute automatically.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Target URL */}
        <Card>
          <Input
            label="Target URL *"
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) clearError();
            }}
            required
            error={error ?? undefined}
          />
        </Card>

        {/* AI Instructions */}
        <Card>
          <h2 className="mb-2 text-lg font-semibold text-slate-100">
            🤖 Test Instructions
          </h2>
          <p className="mb-3 text-sm text-slate-400">
            Describe what you want tested, or upload a test specification file from your client.
            The AI will analyze the content and execute only the specified tests.
          </p>

          {/* Test Type Selector */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-300 mb-2">测试类型 (Test Type)</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { value: 'smoke', label: '冒烟测试', desc: '快速核心验证' },
                { value: 'confirmation', label: '确认测试', desc: '特定功能验证' },
                { value: 'acceptance', label: '验收测试', desc: '全面功能覆盖' },
                { value: 'full', label: '全量测试', desc: ' exhaustive 覆盖' },
              ].map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setTestType(type.value as any)}
                  className={`rounded-lg border px-3 py-2 text-left transition-all ${
                    testType === type.value
                      ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                      : 'border-slate-600 bg-slate-800 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <div className="text-sm font-medium">{type.label}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{type.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={8}
            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono leading-relaxed"
            placeholder={`Example:

This is a ZenTao project management system.

Login credentials:
- URL: https://example.com/zentao/user-login.html
- Username: admin
- Password: admin123

Test requirements:
1. Test the login page — verify form works
2. Test the dashboard after login — check all modules load
3. Test task creation flow
4. Check password reset functionality

Focus areas: security and functionality.`}
          />

          {/* File Upload */}
          <div className="mt-3">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              onChange={handleFileUpload}
              className="hidden"
              id="test-file-upload"
              multiple
            />
            <label
              htmlFor="test-file-upload"
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-600 bg-slate-800/50 px-4 py-3 text-sm text-slate-400 transition hover:border-blue-500 hover:text-slate-300"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
              <span>Attach test specification file</span>
              <span className="text-xs text-slate-500">(txt, md, csv, json, pdf, docx, xlsx, images — max 10 MB)</span>
            </label>

            {fileError && (
              <p className="mt-2 text-sm text-red-400">{fileError}</p>
            )}

            {uploadedFiles.length > 0 && (
              <div className="mt-3 space-y-2">
                {uploadedFiles.map((file, index) => {
                  const formatIcon = {
                    text: '📄',
                    image: '🖼️',
                    pdf: '📕',
                    word: '📘',
                    excel: '📊',
                    unknown: '📎',
                  }[file.format];

                  const previewContent = file.format === 'image'
                    ? null // Images show thumbnail instead of text
                    : file.content.slice(0, 500) + (file.content.length > 500 ? '...' : '');

                  return (
                    <div
                      key={`${file.name}-${index}`}
                      className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-800/50 p-3"
                    >
                      <span className="mt-0.5 text-xl shrink-0">{formatIcon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-slate-200">{file.name}</span>
                          <span className="shrink-0 rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-400 uppercase">
                            {file.format}
                          </span>
                          <span className="shrink-0 text-xs text-slate-500">
                            {file.size < 1024 ? `${file.size} B` : file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
                          </span>
                        </div>
                        {file.format === 'image' ? (
                          <img
                            src={file.content}
                            alt={file.name}
                            className="mt-2 max-h-32 rounded border border-slate-700"
                          />
                        ) : (
                          <pre className="mt-1 max-h-20 overflow-auto rounded bg-slate-900/50 p-2 text-xs text-slate-400 font-mono">
                            {previewContent}
                          </pre>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        className="shrink-0 rounded p-1 text-slate-500 transition hover:bg-slate-700 hover:text-red-400"
                        title="Remove file"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        {/* Submit */}
        <Card>
          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate(-1)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!url.trim() || loading}
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                  Starting...
                </>
              ) : (
                '🚀 Start Test'
              )}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
};
