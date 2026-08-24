import React, { useState, useEffect } from 'react';

interface AdminPanelProps {
  onCreated: () => void;
  onClose: () => void;
}

export default function FundraiserAdminPanel({ onCreated, onClose }: AdminPanelProps) {
  const [season, setSeason] = useState<number>(new Date().getFullYear());
  const [gameType, setGameType] = useState<'NFL' | 'MADNESS'>('NFL');
  const [opponent, setOpponent] = useState<string>('');
  const [gameDate, setGameDate] = useState<string>('');
  const [rowNumbers, setRowNumbers] = useState<string>('0,1,2,3,4,5,6,7,8,9');
  const [colNumbers, setColNumbers] = useState<string>('0,1,2,3,4,5,6,7,8,9');
  const [adminKey, setAdminKey] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem('adminKey');
    if (stored) setAdminKey(stored);
  }, []);

  const saveAdminKey = (key: string) => {
    setAdminKey(key);
    if (key) sessionStorage.setItem('adminKey', key);
    else sessionStorage.removeItem('adminKey');
  };

  const parseNumbers = (s: string) => {
    try {
      return s.split(',').map(v => parseInt(v.trim(), 10)).filter(n => !Number.isNaN(n));
    } catch {
      return undefined;
    }
  };

  const handleCreate = async () => {
    if (!adminKey) {
      setMessage('Admin key is required');
      return;
    }
    if (!opponent.trim() || !gameDate) {
      setMessage('Opponent and game date are required');
      return;
    }

    const body: any = {
      season,
      gameType,
      opponent: opponent.trim(),
      gameDate
    };

    const rn = parseNumbers(rowNumbers);
    const cn = parseNumbers(colNumbers);
    if (rn && rn.length === 10) body.rowNumbers = rn;
    if (cn && cn.length === 10) body.colNumbers = cn;

    try {
      setSaving(true);
      setMessage(null);
      const resp = await fetch('/api/admin/games/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': adminKey
        },
        body: JSON.stringify(body)
      });

      const data = await resp.json();
      if (!resp.ok) {
        setMessage(data?.error || JSON.stringify(data));
        return;
      }

      setMessage(data?.message || 'Game created');
      onCreated();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-panel-overlay">
      <div className="admin-panel">
        <h3>Create New Game (Admin)</h3>

        <label>Admin Key</label>
        <input
          type="password"
          value={adminKey}
          onChange={(e) => saveAdminKey(e.target.value)}
          placeholder="Enter admin API key"
        />

        <label>Season</label>
        <input type="number" value={season} onChange={(e) => setSeason(Number(e.target.value))} />

        <label>Game Type</label>
        <select value={gameType} onChange={(e) => setGameType(e.target.value as any)}>
          <option value="NFL">NFL</option>
          <option value="MADNESS">March Madness</option>
        </select>

        <label>Opponent / Label</label>
        <input value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="e.g., Kansas City Chiefs" />

        <label>Game Date</label>
        <input type="date" value={gameDate} onChange={(e) => setGameDate(e.target.value)} />

        <label>Row Numbers (comma-separated, optional)</label>
        <input value={rowNumbers} onChange={(e) => setRowNumbers(e.target.value)} />

        <label>Col Numbers (comma-separated, optional)</label>
        <input value={colNumbers} onChange={(e) => setColNumbers(e.target.value)} />

        {message && <div className="admin-message">{message}</div>}

        <div className="admin-actions">
          <button onClick={handleCreate} disabled={saving}>{saving ? 'Creating...' : 'Create Game'}</button>
          <button className="secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
