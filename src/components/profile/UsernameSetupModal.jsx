import { useState } from 'react';
import { voxylApi } from '@/api/voxylApiClient';
import { X, AtSign, Loader2, Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { t } from '@/lib/i18n';
import { getUsernameErrorKey, getUsernameValidationKey, normalizeUsername } from '@/lib/username';

export default function UsernameSetupModal({ currentUsername, onClose, onSaved }) {
  const [username, setUsername] = useState(currentUsername || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    const normalized = normalizeUsername(username);
    const invalidKey = getUsernameValidationKey(normalized);

    if (invalidKey) {
      setError(t(invalidKey));
      return;
    }

    setLoading(true);
    setError('');

    try {
      // The Worker normalizes, checks availability and keeps the creator
      // handle on owned playlists in sync, in a single guarded write.
      await voxylApi.auth.updateMe({ username: normalized });
      onSaved(normalized);
      onClose();
    } catch (saveError) {
      setError(t(getUsernameErrorKey(saveError)));
    } finally {
      setLoading(false);
    }
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
          <h2 className="text-base font-grotesk font-bold">{t('usernameTitle')}</h2>
          {currentUsername && (
            <button onClick={onClose} className="p-1.5 rounded-full bg-secondary text-muted-foreground">
              <X size={18} />
            </button>
          )}
        </div>

        <p className="text-xs text-muted-foreground mb-4">{t('usernameDescription')}</p>

        <div className="relative mb-2">
          <AtSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={username}
            onChange={e => { setUsername(e.target.value); setError(''); }}
            placeholder={t('usernamePlaceholder')}
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
          {loading ? t('usernameSaving') : t('usernameSave')}
        </button>
      </motion.div>
    </div>
  );
}
