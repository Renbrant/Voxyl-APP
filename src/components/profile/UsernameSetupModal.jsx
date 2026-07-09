import { useState } from 'react';
import { voxylApi } from '@/api/voxylApiClient';
import { X, AtSign, Loader2, Check } from 'lucide-react';
import { motion } from 'framer-motion';

export default function UsernameSetupModal({ currentUser, currentUsername, onClose, onSaved }) {
  const [username, setUsername] = useState(currentUsername || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const validate = (val) => {
    if (!val.trim()) return 'Nome de usuário é obrigatório';
    if (val.length < 3) return 'Mínimo 3 caracteres';
    if (val.length > 30) return 'Máximo 30 caracteres';
    if (!/^[a-zA-Z0-9_]+$/.test(val)) return 'Apenas letras, números e _ são permitidos';
    return '';
  };

  const handleSave = async () => {
    const err = validate(username.trim());
    if (err) { setError(err); return; }

    setLoading(true);
    setError('');

    // Check if username is already taken by another user
    const existing = await voxylApi.entities.User.filter({ username: username.trim().toLowerCase() }).catch(() => []);
    const taken = existing.find(u => u.id !== currentUser.id);
    if (taken) {
      setError('Este nome de usuário já está em uso');
      setLoading(false);
      return;
    }

    const uname = username.trim().toLowerCase().replace(/^@+/, '');
    await voxylApi.auth.updateMe({ username: uname });
    // Sync creator_username on ALL owned playlists via backend (bypasses RLS)
    await voxylApi.functions.invoke('syncUsername', { username: uname }).catch(() => {});
    setLoading(false);
    onSaved(uname);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25 }}
        className="w-full max-w-md bg-card border-t border-border rounded-t-3xl p-5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 5rem)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-grotesk font-bold">Nome de usuário público</h2>
          {currentUsername && (
            <button onClick={onClose} className="p-1.5 rounded-full bg-secondary text-muted-foreground">
              <X size={18} />
            </button>
          )}
        </div>

        <p className="text-xs text-muted-foreground mb-4">
          Este é o único nome que será visível para outros usuários. Seu nome real e e-mail nunca serão compartilhados.
        </p>

        <div className="relative mb-2">
          <AtSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={username}
            onChange={e => { setUsername(e.target.value); setError(''); }}
            placeholder="meu_usuario"
            className="w-full pl-9 pr-4 py-3 rounded-xl bg-secondary border border-border text-foreground text-sm focus:outline-none focus:border-primary"
            autoCapitalize="none"
            autoCorrect="off"
          />
        </div>

        {error && <p className="text-xs text-destructive mb-3">{error}</p>}

        <button
          onClick={handleSave}
          disabled={loading || !username.trim()}
          className="w-full py-3 rounded-2xl gradient-primary text-white font-semibold text-sm flex items-center justify-center gap-2 mt-3 disabled:opacity-50"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          {loading ? 'Salvando...' : 'Salvar'}
        </button>
      </motion.div>
    </div>
  );
}