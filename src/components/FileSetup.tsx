import { useState, useEffect } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { getLastFilePath, loadFromFile, createNewFile, fileExists } from '../db';

interface Props {
  onReady: () => void;
}

export function FileSetup({ onReady }: Props) {
  const [status, setStatus] = useState('Checking for saved file...');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const lastPath = await getLastFilePath();
        if (lastPath && await fileExists(lastPath)) {
          setStatus(`Loading ${lastPath}...`);
          await loadFromFile(lastPath);
          onReady();
          return;
        }
        setStatus('');
      } catch {
        setStatus('');
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleOpen() {
    setError('');
    try {
      const selected = await open({
        filters: [{ name: 'Budget Data', extensions: ['json'] }],
        multiple: false,
        directory: false,
      });
      if (!selected) return;
      const path = selected;
      setStatus(`Loading ${path}...`);
      await loadFromFile(path);
      onReady();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleNew() {
    setError('');
    try {
      const selected = await save({
        filters: [{ name: 'Budget Data', extensions: ['json'] }],
        defaultPath: 'budget-data.json',
      });
      if (!selected) return;
      const path = typeof selected === 'string' ? selected : selected;
      setStatus(`Creating ${path}...`);
      await createNewFile(path);
      onReady();
    } catch (e) {
      setError(String(e));
    }
  }

  if (status && !error) {
    return (
      <div className="file-setup">
        <p>{status}</p>
      </div>
    );
  }

  return (
    <div className="file-setup">
      <h1>Budget</h1>
      <p className="setup-desc">All your data lives in a single JSON file on your computer.</p>

      <div className="setup-actions">
        <button className="btn btn-primary" onClick={handleOpen}>
          Open existing file
        </button>
        <button className="btn btn-ghost" onClick={handleNew}>
          Create new file
        </button>
      </div>

      {error && <p className="setup-error">{error}</p>}
    </div>
  );
}
