import { useState, useRef } from 'react';
import {
  getAISettings,
  saveCustomParser,
  executeCustomParser,
  type CustomParser,
} from '../db';
import { generateParser } from '../logic/llm';

interface Props {
  onParsersChange?: () => void;
}

export function ParserGenerator({ onParsersChange }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [parserName, setParserName] = useState('');
  const [instrument, setInstrument] = useState('Card');
  const [sampleContent, setSampleContent] = useState('');
  const [sampleFilename, setSampleFilename] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState<string | null>(null);
  const [generatedCode, setGeneratedCode] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSampleFilename(file.name);
    const text = await file.text();
    setSampleContent(text);
    // Auto-fill name from filename
    if (!parserName) {
      setParserName(file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '));
    }
  }

  async function handleGenerate() {
    if (!sampleContent.trim() || !parserName.trim()) return;
    const settings = getAISettings();
    setGenerating(true);
    setGenStatus(null);
    setGeneratedCode('');
    setTestResult(null);
    try {
      const result = await generateParser(
        sampleContent,
        parserName,
        instrument,
        settings,
        setGenStatus,
      );
      setGeneratedCode(result.code);
    } catch (e) {
      setGenStatus(`Error: ${String(e)}`);
    } finally {
      setGenerating(false);
    }
  }

  function handleTest() {
    if (!generatedCode || !sampleContent) return;
    setTesting(true);
    setTestResult(null);
    try {
      const txns = executeCustomParser(generatedCode, sampleContent, sampleFilename || 'sample.csv');
      if (txns.length === 0) {
        setTestResult('Parsed 0 transactions — check the code.');
      } else {
        const preview = txns.slice(0, 3).map((t) =>
          `  ${t.txnDate} $${Math.abs(t.amount).toFixed(2)} "${t.descriptor}" (${t.ignoreInBudget ? 'credit' : 'debit'})`,
        ).join('\n');
        setTestResult(`Parsed ${txns.length} transactions. Preview:\n${preview}${txns.length > 3 ? `\n  … and ${txns.length - 3} more` : ''}`);
      }
    } catch (e) {
      setTestResult(`Error: ${String(e)}`);
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!generatedCode || !parserName.trim()) return;
    const parser: CustomParser = {
      id: `custom_${Date.now()}`,
      name: parserName.trim(),
      instrument,
      code: generatedCode,
      sampleLines: sampleContent.split('\n').slice(0, 5).join('\n'),
      createdAt: new Date().toISOString(),
    };
    await saveCustomParser(parser);
    onParsersChange?.();
    setShowCreate(false);
    setParserName('');
    setSampleContent('');
    setSampleFilename('');
    setGeneratedCode('');
    setTestResult(null);
  }


  return (
    <div>
      {!showCreate && (
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
          + Create Parser from Sample File
        </button>
      )}

      {showCreate && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '0.75rem',
            marginTop: '0.5rem',
          }}
        >
          <div className="section-title" style={{ marginBottom: '0.5rem' }}>
            Create New Parser
          </div>

          {/* Name + instrument */}
          <div className="row" style={{ gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 2 }}>
              <label>Parser name</label>
              <input
                value={parserName}
                onChange={(e) => setParserName(e.target.value)}
                placeholder="e.g. TD Bank CSV"
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Instrument</label>
              <input
                value={instrument}
                onChange={(e) => setInstrument(e.target.value)}
                placeholder="Card, Chequing, etc."
              />
            </div>
          </div>

          {/* File upload */}
          <div className="field" style={{ marginBottom: '0.5rem' }}>
            <label>Sample file (CSV, TSV, or any text format)</label>
            <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt,.xls,.xlsx"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => fileRef.current?.click()}
              >
                {sampleFilename ? `📄 ${sampleFilename}` : 'Upload sample file'}
              </button>
              {sampleContent && (
                <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>
                  {sampleContent.split('\n').length} lines loaded
                </span>
              )}
            </div>
          </div>

          {/* Paste sample */}
          {!sampleContent && (
            <div className="field" style={{ marginBottom: '0.5rem' }}>
              <label>Or paste sample content</label>
              <textarea
                value={sampleContent}
                onChange={(e) => setSampleContent(e.target.value)}
                placeholder="Paste a few lines from your file here..."
                rows={4}
                style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '0.8rem' }}
              />
            </div>
          )}

          {sampleContent && (
            <div
              style={{
                background: 'var(--input-bg)',
                borderRadius: 4,
                padding: '0.4rem 0.6rem',
                fontFamily: 'monospace',
                fontSize: '0.78rem',
                marginBottom: '0.5rem',
                maxHeight: 100,
                overflowY: 'auto',
                whiteSpace: 'pre',
              }}
            >
              {sampleContent.split('\n').slice(0, 6).join('\n')}
            </div>
          )}

          <div className="row" style={{ gap: '0.5rem', marginBottom: '0.5rem' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleGenerate}
              disabled={generating || !sampleContent.trim() || !parserName.trim()}
            >
              {generating ? 'Generating…' : 'Generate Parser'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
          </div>

          {genStatus && (
            <div style={{ fontSize: '0.85rem', opacity: 0.8, marginBottom: '0.5rem' }}>
              {genStatus}
            </div>
          )}

          {/* Generated code preview */}
          {generatedCode && (
            <>
              <div className="field" style={{ marginBottom: '0.5rem' }}>
                <label>Generated parser code (editable)</label>
                <textarea
                  value={generatedCode}
                  onChange={(e) => setGeneratedCode(e.target.value)}
                  rows={10}
                  style={{
                    resize: 'vertical',
                    fontFamily: 'monospace',
                    fontSize: '0.78rem',
                    width: '100%',
                  }}
                />
              </div>

              <div className="row" style={{ gap: '0.5rem', marginBottom: '0.5rem' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleTest}
                  disabled={testing}
                >
                  {testing ? 'Testing…' : 'Test on sample'}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSave}
                  disabled={!generatedCode}
                >
                  Save Parser
                </button>
              </div>

              {testResult && (
                <pre
                  style={{
                    background: testResult.includes('Error') ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                    border: `1px solid ${testResult.includes('Error') ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
                    borderRadius: 6,
                    padding: '0.5rem',
                    fontSize: '0.8rem',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {testResult}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
