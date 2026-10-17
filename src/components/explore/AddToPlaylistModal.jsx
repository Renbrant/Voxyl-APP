import { useState, useEffect, useRef } from 'react';
import { voxylApi } from '@/api/voxylApiClient';
import { X, Plus, Loader2, CheckCircle2, ListMusic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { t } from '@/lib/i18n';
import { createPlaylistSubmission, getPlaylistCreationErrorKey } from '@/lib/playlistCreation';
import { invalidateCreatedPlaylistQueries } from '@/lib/savedContentQueries';
import { motion } from 'framer-motion';

export default function AddToPlaylistModal({ podcast, onClose }) {
  const queryClient = useQueryClient();
  const savingRef = useRef(false);
  const submitRef = useRef(null);
  if (!submitRef.current) submitRef.current = createPlaylistSubmission(voxylApi.entities.Playlist.create);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null); // playlist name on success
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    voxylApi.auth.me().then(u => {
      setUser(u);
      return voxylApi.entities.Playlist.filter({ creator_id: u.id }, '-created_date', 50);
    }).then(data => {
      setPlaylists(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const addFeedToPlaylist = async (playlist) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const existing = playlist.rss_feeds || [];
      if (!existing.some(f => f.url === podcast.feedUrl)) {
        await voxylApi.entities.Playlist.update(playlist.id, { rss_feeds: [...existing, {
          url: podcast.feedUrl, title: podcast.title,
          description: podcast.description || '', image: podcast.image || '',
        }] });
      }
      invalidateCreatedPlaylistQueries(queryClient, user.id);
      setDone(playlist.name);
    } catch (error) {
      setError(t(getPlaylistCreationErrorKey(error)));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleCreateAndAdd = async () => {
    if (savingRef.current || !newName.trim() || !user) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const pl = await submitRef.current({
        name: newName.trim(),
        rss_feeds: [{
          url: podcast.feedUrl, title: podcast.title,
          description: podcast.description || '', image: podcast.image || '',
        }],
        visibility: 'public',
        max_duration: 0,
      });
      if (pl) {
        invalidateCreatedPlaylistQueries(queryClient, user.id);
        setDone(pl.name);
      }
    } catch (error) {
      setError(t(getPlaylistCreationErrorKey(error)));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm px-0">
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} transition={{ type: 'spring', damping: 25 }}
        className="w-full max-w-md bg-card border-t border-border rounded-t-3xl flex flex-col max-h-[85vh]"
      >
        <div className="px-5 pt-5 pb-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            {podcast.image && (
              <img src={podcast.image} alt={podcast.title} className="w-10 h-10 rounded-xl object-cover" />
            )}
            <div>
              <h2 className="text-base font-grotesk font-bold">Adicionar à Playlist</h2>
              <p className="text-xs text-muted-foreground truncate max-w-[200px]">{podcast.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full bg-secondary text-muted-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-24">
        {error && <p role="alert" className="text-destructive text-sm mb-3">{error}</p>}
        {done ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <div className="w-14 h-14 rounded-full gradient-primary flex items-center justify-center glow-primary">
              <CheckCircle2 size={28} className="text-white" />
            </div>
            <p className="font-semibold text-base">Adicionado!</p>
            <p className="text-sm text-muted-foreground text-center">
              <span className="text-foreground font-medium">{podcast.title}</span> foi adicionado à{' '}
              <span className="text-primary font-medium">{done}</span>
            </p>
            <Button onClick={onClose} className="mt-2 rounded-full gradient-primary border-0 px-8">Fechar</Button>
          </div>
        ) : (
          <>
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-primary" /></div>
            ) : (
              <div className="space-y-2">
                {/* Create new playlist option */}
                {!creatingNew ? (
                  <button
                    onClick={() => setCreatingNew(true)}
                    className="w-full flex items-center gap-3 p-3 rounded-2xl border border-dashed border-primary/40 text-primary hover:bg-primary/5 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Plus size={18} />
                    </div>
                    <span className="text-sm font-medium">Criar Nova Playlist</span>
                  </button>
                ) : (
                  <div className="p-3 rounded-2xl border border-primary/40 bg-primary/5 space-y-2">
                    <input
                      autoFocus
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleCreateAndAdd()}
                      placeholder="Nome da nova playlist..."
                      className="w-full px-3 py-2.5 rounded-xl bg-secondary border border-border text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:border-primary"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleCreateAndAdd} disabled={saving || !newName.trim()} className="flex-1 rounded-xl gradient-primary border-0">
                        {saving ? <Loader2 size={14} className="animate-spin" /> : 'Criar e Adicionar'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setCreatingNew(false)} className="rounded-xl">Cancelar</Button>
                    </div>
                  </div>
                )}

                {/* Existing playlists */}
                {playlists.length === 0 && !creatingNew && (
                  <p className="text-center text-sm text-muted-foreground py-4">Você ainda não tem playlists.</p>
                )}
                {playlists.map(pl => (
                  <button
                    key={pl.id}
                    onClick={() => addFeedToPlaylist(pl)}
                    disabled={saving}
                    className="w-full flex items-center gap-3 p-3 rounded-2xl border border-border hover:border-primary/30 hover:bg-secondary/60 transition-all text-left"
                  >
                    <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
                      <ListMusic size={16} className="text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{pl.name}</p>
                      <p className="text-xs text-muted-foreground">{pl.rss_feeds?.length || 0} feeds</p>
                    </div>
                    {saving && <Loader2 size={14} className="animate-spin text-primary flex-shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        </div>
      </motion.div>
    </div>
  );
}