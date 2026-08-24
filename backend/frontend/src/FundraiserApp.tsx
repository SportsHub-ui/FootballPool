import React, { useState, useEffect } from 'react';
import './FundraiserApp.css';
import FundraiserAdminPanel from './FundraiserAdminPanel';

interface Game {
  id: number;
  season: number;
  game_type: 'NFL' | 'MADNESS';
  opponent: string;
  game_dt: string;
  is_complete: boolean;
}

interface Square {
  id: number;
  square_num: number;
  player_name: string | null;
  row_digit: number | null;
  col_digit: number | null;
}

type View = 'games' | 'board' | 'join';

export default function FundraiserApp() {
  const [currentView, setCurrentView] = useState<View>('games');
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [squares, setSquares] = useState<Square[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);

  // Fetch games on mount
  useEffect(() => {
    fetchGames();
  }, []);

  const fetchGames = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/games');
      if (!response.ok) throw new Error('Failed to fetch games');
      const data = await response.json();
      setGames(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching games');
    } finally {
      setLoading(false);
    }
  };

  const fetchSquares = async (gameId: number) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/games/${gameId}/squares`);
      if (!response.ok) throw new Error('Failed to fetch squares');
      const data = await response.json();
      setSquares(data.squares);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching squares');
    } finally {
      setLoading(false);
    }
  };

  const handleGameSelect = (game: Game) => {
    setSelectedGame(game);
    fetchSquares(game.id);
    setCurrentView('board');
  };

  return (
    <div className="fundraiser-app">
      <header className="app-header">
        <h1>Football Pool Fundraiser</h1>
        <div className="nav-buttons">
          <button 
            onClick={() => setCurrentView('games')}
            className={currentView === 'games' ? 'active' : ''}
          >
            Games
          </button>
          {selectedGame && (
            <button 
              onClick={() => setCurrentView('board')}
              className={currentView === 'board' ? 'active' : ''}
            >
              Board
            </button>
          )}
          <button onClick={() => setAdminOpen(true)} title="Admin">Admin</button>
        </div>
      </header>

      <main className="app-main">
        {error && (
          <div className="error-message">
            {error}
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        {loading && <div className="loading">Loading...</div>}

        {!loading && currentView === 'games' && (
          <GamesView games={games} onSelectGame={handleGameSelect} />
        )}

        {!loading && currentView === 'board' && selectedGame && (
          <BoardView game={selectedGame} squares={squares} onRefresh={() => fetchSquares(selectedGame.id)} />
        )}
      </main>

      {adminOpen && (
        <FundraiserAdminPanel
          onCreated={() => {
            fetchGames();
            setAdminOpen(false);
          }}
          onClose={() => setAdminOpen(false)}
        />
      )}

    </div>
  );
}

interface GamesViewProps {
  games: Game[];
  onSelectGame: (game: Game) => void;
}

function GamesView({ games, onSelectGame }: GamesViewProps) {
  const nflGames = games.filter(g => g.game_type === 'NFL');
  const madnessGames = games.filter(g => g.game_type === 'MADNESS');

  return (
    <div className="games-view">
      <section className="games-section">
        <h2>NFL Games</h2>
        {nflGames.length === 0 ? (
          <p className="no-games">No NFL games scheduled</p>
        ) : (
          <div className="games-list">
            {nflGames.map(game => (
              <div key={game.id} className="game-card" onClick={() => onSelectGame(game)}>
                <div className="game-header">
                  <h3>{game.opponent}</h3>
                  <span className={`status ${game.is_complete ? 'complete' : 'upcoming'}`}>
                    {game.is_complete ? 'Complete' : 'Upcoming'}
                  </span>
                </div>
                <div className="game-date">{new Date(game.game_dt).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="games-section">
        <h2>March Madness</h2>
        {madnessGames.length === 0 ? (
          <p className="no-games">No March Madness games scheduled</p>
        ) : (
          <div className="games-list">
            {madnessGames.map(game => (
              <div key={game.id} className="game-card" onClick={() => onSelectGame(game)}>
                <div className="game-header">
                  <h3>{game.opponent}</h3>
                  <span className={`status ${game.is_complete ? 'complete' : 'upcoming'}`}>
                    {game.is_complete ? 'Complete' : 'Upcoming'}
                  </span>
                </div>
                <div className="game-date">{new Date(game.game_dt).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

interface BoardViewProps {
  game: Game;
  squares: Square[];
  onRefresh: () => void;
}

function BoardView({ game, squares, onRefresh }: BoardViewProps) {
  const [selectedSquare, setSelectedSquare] = useState<number | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleAddPlayer = async () => {
    if (!selectedSquare || !playerName.trim()) return;

    try {
      setSubmitting(true);
      const response = await fetch(`/api/games/${game.id}/add-player`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ squareNum: selectedSquare, playerName: playerName.trim() })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to add player');
      }

      setPlayerName('');
      setSelectedSquare(null);
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error adding player');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="board-view">
      <h2>{game.opponent} - {new Date(game.game_dt).toLocaleDateString()}</h2>

      <div className="board-grid">
        {Array.from({ length: 100 }, (_, i) => {
          const square = squares.find(s => s.square_num === i + 1);
          return (
            <div
              key={i + 1}
              className={`board-square ${square?.player_name ? 'assigned' : 'available'} ${selectedSquare === i + 1 ? 'selected' : ''}`}
              onClick={() => setSelectedSquare(i + 1)}
            >
              <div className="square-number">{i + 1}</div>
              {square?.player_name && (
                <div className="player-name">{square.player_name}</div>
              )}
            </div>
          );
        })}
      </div>

      {selectedSquare && !squares.find(s => s.square_num === selectedSquare)?.player_name && (
        <div className="join-form">
          <h3>Join Square #{selectedSquare}</h3>
          <input
            type="text"
            placeholder="Enter your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAddPlayer()}
          />
          <button onClick={handleAddPlayer} disabled={submitting || !playerName.trim()}>
            {submitting ? 'Joining...' : 'Join Pool'}
          </button>
          <button onClick={() => setSelectedSquare(null)} className="secondary">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
