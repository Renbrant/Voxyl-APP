import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { voxylApi } from '@/api/voxylApiClient';
import { X, Plus, Trash2, Globe, Lock, Loader2, Image as ImageIcon, Sparkles, Users, Search, Timer, ChevronDown, ChevronUp, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { generateShareToken } from '@/lib/rssUtils';
import { cn } from '@/lib/utils';

const BASE_MAX_PLAYLISTS = 2;
const BASE_MAX_FEEDS = 5;
const EGG_BONUS_PLAYLISTS = 5;
const EGG_BONUS_FEEDS = 15; // 5 + 15 = 20 feeds when egg unlocked

function getLimits(isAdmin = false) {
  if (isAdmin) return { MAX_PLAYLISTS: Infinity, MAX_FEEDS: Infinity };
  const unlocked = localStorage.getItem('voxyl_egg_unlocked') === 'true';
  return {
    MAX_PLAYLISTS: BASE_MAX_PLAYLISTS + (unlocked ? EGG_BONUS_PLAYLISTS : 0),
    MAX_FEEDS: BASE_MAX_FEEDS + (unlocked ? EGG_BONUS_FEEDS : 0),
  };
}

export default function CreatePlaylistModal({ user, onClose, onCreated, playlistCount = 0 }) {
  const isAdmin = user?.role === 'admin';
  const { MAX_PLAYLISTS, MAX_FEEDS } = getLimits(isAdmin);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [maxDuration, setMaxDuration] = useState(0);
  const [timeFilterHours, setTimeFilterHours] = useState(0);
  const [feeds, setFeeds] = useState([{ url: '', skip_start_seconds: 0, skip_end_seconds: 0 }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [generatingImage, setGeneratingImage] = useState(false);
  const [podcastSearch, setPodcastSearch] = useState('');
  const [podcastResults, setPodcastResults] = useState([]);
  const [searchingPodcasts, setSearchingPodcasts] = useState(false);
  const [feedValidations, setFeedValidations] = useState({}); // { [index]: 'valid' | 'invalid' | 'checking' }

  const atPlaylistLimit = playlistCount >= MAX_PLAYLISTS;

  const addFeed = () => {
    const validCount = feeds.filter(f => f.url.trim()).length;
    if (validCount >= MAX_FEEDS) { setError(`Máximo de ${MAX_FEEDS} podcasts por playlist durante o período de testes.`); return; }
    setFeeds(prev => [...prev, { url: '' }]);
  };

  const handleSearchPodcasts = async (query) => {
    setPodcastSearch(query);
    if (!query.trim()) { setPodcastResults([]); return; }
    setSearchingPodcasts(true);
    const res = await voxylApi.functions.invoke('searchPodcasts', { query }).then(r => r.data).catch(() => ({ results: [] }));
    setPodcastResults(res.results || []);
    setSearchingPodcasts(false);
  };

  const addPodcastFeed = (podcast) => {
    const validCount = feeds.filter(f => f.url.trim()).length;
    if (validCount >= MAX_FEEDS) { setError(`Máximo de ${MAX_FEEDS} podcasts por playlist durante o período de testes.`); return; }
    if (feeds.some(f => f.url === podcast.feedUrl)) { setError('Este podcast já foi adicionado'); return; }
    setFeeds(prev => [...prev, { url: podcast.feedUrl, title: podcast.title }]);
    setPodcastSearch('');
    setPodcastResults([]);
  };
  const [expandedFeedIdx, setExpandedFeedIdx] = useState(null);
  const removeFeed = (i) => {
    setFeeds(prev => prev.filter((_, idx) => idx !== i));
    setFeedValidations(prev => {
      const next = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = Number(k);
        if (ki < i) next[ki] = v;
        else if (ki > i) next[ki - 1] = v;
      });
      return next;
    });
  };

  const validateFeedUrl = useCallback(async (i, url) => {
    if (!url.trim()) { setFeedValidations(prev => { const n = {...prev}; delete n[i]; return n; }); return; }
    setFeedValidations(prev => ({ ...prev, [i]: 'checking' }));
    try {
      const res = await voxylApi.functions.invoke('fetchRSSFeed', { url: url.trim(), count: 1 });
      const data = res.data || res;
      const valid = !!(data?.title || data?.items?.length > 0);
      setFeedValidations(prev => ({ ...prev, [i]: valid ? 'valid' : 'invalid' }));
    } catch {
      setFeedValidations(prev => ({ ...prev, [i]: 'invalid' }));
    }
  }, []);

  const updateFeed = (i, url) => {
    setFeeds(prev => prev.map((f, idx) => idx === i ? { ...f, url } : f));
    setFeedValidations(prev => { const n = {...prev}; delete n[i]; return n; });
  };
  const updateFeedSkip = (i, field, value) => setFeeds(prev => prev.map((f, idx) => idx === i ? { ...f, [field]: Number(value) || 0 } : f));

  const handleGenerateImage = async () => {
    if (!name.trim()) { setError('Digite um nome para a playlist primeiro'); return; }
    setGeneratingImage(true);
    setError('');
    const prompt = `Create a vibrant and modern podcast playlist cover art for "${name.trim()}". ${description ? `Theme: ${description.trim()}. ` : ''}Style: colorful, eye-catching, professional. No text or logos.`;
    const res = await voxylApi.integrations.Core.GenerateImage({ prompt }).catch(() => null);
    setGeneratingImage(false);
    if (res?.url) {
      setCoverImage(res.url);
    } else {
      setError('Erro ao gerar imagem');
    }
  };

  const handleUploadImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setGeneratingImage(true);
    setError('');
    const res = await voxylApi.integrations.Core.UploadFile({ file }).catch(() => null);
    setGeneratingImage(false);
    if (res?.file_url) {
      setCoverImage(res.file_url);
    } else {
      setError('Erro ao fazer upload da imagem');
    }
  };

  const handleSave = async (andExplore = false) => {
    if (!name.trim()) { setError('Nome é obrigatório'); return; }
    const validFeeds = feeds.filter(f => f.url.trim());
    if (validFeeds.length > MAX_FEEDS) { setError(`Máximo de ${MAX_FEEDS} podcasts por playlist durante o período de testes.`); return; }
    setSaving(true);
    setError('');
    await voxylApi.entities.Playlist.create({
      name: name.trim(),
      description: description.trim(),
      creator_id: user.id,
      creator_name: user.full_name || user.email.split('@')[0],
      creator_username: user.username || '',
      creator_hidden: user.profile_hidden || false,
      creator_picture: user.profile_picture || user.picture || user.avatar_url || '',
      rss_feeds: validFeeds,
      visibility,
      max_duration: maxDuration,
      time_filter_hours: timeFilterHours,
      cover_image: coverImage,
      share_token: generateShareToken(),
      likes_count: 0,
      plays_count: 0,
    });
    setSaving(false);
    onCreated();
    if (andExplore) navigate('/explore');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm px-0">
      <div className="w-full max-w-md bg-card border-t border-border rounded-t-3xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 pb-3 flex-shrink-0">
          <h2 className="text-lg font-grotesk font-bold">Nova Playlist</h2>
          <button onClick={onClose} className="p-1.5 rounded-full bg-secondary text-muted-foreground">
            <X size={18} />
          </button>
        </div>

        {atPlaylistLimit ? (
          <div className="flex-1 flex flex-col items-center justify-center py-12 px-5">
            <p className="text-4xl mb-3">🚧</p>
            <p className="font-semibold text-foreground mb-1">Limite de playlists atingido</p>
            <p className="text-sm text-muted-foreground text-center">
              O Voxyl está em fase de testes e permite até <strong>{MAX_PLAYLISTS} playlists</strong> por usuário no momento. Mais funcionalidades serão liberadas em breve!
            </p>
          </div>
        ) : (
        <>
        <div className="overflow-y-auto flex-1 px-5 pb-2">
        {error && <p className="text-destructive text-sm mb-3 bg-destructive/10 px-3 py-2 rounded-xl">{error}</p>}

        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Nome *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Tech Weekly Picks"
              className="w-full px-4 py-3 rounded-2xl bg-secondary border border-border text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Descrição</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Sobre o que é essa playlist?"
              rows={2}
              className="w-full px-4 py-3 rounded-2xl bg-secondary border border-border text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:border-primary resize-none"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Duração máxima (min, 0 = sem limite)</label>
            <input
              type="number"
              value={maxDuration}
              onChange={e => setMaxDuration(Number(e.target.value))}
              min={0}
              className="w-full px-4 py-3 rounded-2xl bg-secondary border border-border text-foreground text-sm focus:outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block flex items-center gap-1"><Timer size={11} /> Episódios publicados</label>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Sem limite', value: 0 },
                { label: 'Últimas 24h', value: 24 },
                { label: 'Últimas 48h', value: 48 },
                { label: 'Última semana', value: 168 },
                { label: 'Último mês', value: 720 },
                { label: 'Último ano', value: 8760 },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTimeFilterHours(opt.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    timeFilterHours === opt.value
                      ? 'bg-primary/20 text-primary border-primary/40'
                      : 'bg-secondary text-muted-foreground border-border'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Capa da Playlist</label>
            {coverImage ? (
              <div className="relative rounded-2xl overflow-hidden mb-3">
                <img src={coverImage} alt="Cover" className="w-full h-40 object-cover" />
                <button
                  onClick={() => setCoverImage('')}
                  className="absolute top-2 right-2 p-1.5 bg-black/60 rounded-full text-white hover:bg-black/80"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="w-full h-40 rounded-2xl bg-secondary border border-border flex items-center justify-center mb-3">
                <p className="text-xs text-muted-foreground">Nenhuma capa selecionada</p>
              </div>
            )}
            <div className="flex gap-2">
              <label className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 bg-secondary text-muted-foreground rounded-2xl border border-border cursor-pointer hover:border-primary/30 transition-all text-xs font-medium">
                <ImageIcon size={14} />
                Enviar
                <input type="file" accept="image/*" onChange={handleUploadImage} disabled={generatingImage} className="hidden" />
              </label>
              <button
                onClick={handleGenerateImage}
                disabled={generatingImage}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 gradient-primary text-white rounded-2xl text-xs font-medium disabled:opacity-50"
              >
                {generatingImage ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {generatingImage ? 'Gerando...' : 'Gerar IA'}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Visibilidade</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setVisibility('public')}
                className={cn("py-2.5 rounded-2xl text-sm font-medium transition-all border",
                  visibility === 'public' ? "gradient-primary text-white border-transparent" : "bg-secondary text-muted-foreground border-border")}
              >
                <Globe size={14} className="mx-auto mb-1" /> Pública
              </button>
              <button
                onClick={() => setVisibility('friends_only')}
                className={cn("py-2.5 rounded-2xl text-sm font-medium transition-all border",
                  visibility === 'friends_only' ? "bg-primary text-white border-transparent" : "bg-secondary text-muted-foreground border-border")}
              >
                <Users size={14} className="mx-auto mb-1" /> Seguidores
              </button>
              <button
                onClick={() => setVisibility('private')}
                className={cn("py-2.5 rounded-2xl text-sm font-medium transition-all border",
                  visibility === 'private' ? "bg-primary text-white border-transparent" : "bg-secondary text-muted-foreground border-border")}
              >
                <Lock size={14} className="mx-auto mb-1" /> Privada
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Feeds RSS</label>
            
            {/* Podcast search */}
            <div className="mb-3 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={podcastSearch}
                onChange={e => handleSearchPodcasts(e.target.value)}
                placeholder="Buscar podcast..."
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-secondary border border-border text-foreground placeholder:text-muted-foreground text-xs focus:outline-none focus:border-primary"
              />
              {searchingPodcasts && <Loader2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>

            {/* Podcast results */}
            {podcastResults.length > 0 && (
              <div className="mb-3 max-h-40 overflow-y-auto space-y-1 rounded-xl bg-secondary/50 border border-border p-2">
                {podcastResults.map(podcast => (
                  <button
                    key={podcast.id}
                    onClick={() => addPodcastFeed(podcast)}
                    className="w-full text-left flex items-center gap-2 p-2 rounded-lg hover:bg-secondary transition-colors text-xs"
                  >
                    {podcast.image && <img src={podcast.image} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />}
                    <span className="truncate font-medium text-foreground flex-1">{podcast.title}</span>
                    <Plus size={12} className="text-primary flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}

            {/* Manual RSS input */}
            <div className="space-y-2">
              {feeds.map((feed, i) => {
                const validation = feedValidations[i];
                return (
                <div key={i} className={cn("rounded-xl bg-secondary border overflow-hidden transition-colors",
                  validation === 'valid' ? 'border-green-500/60' : validation === 'invalid' ? 'border-destructive/60' : 'border-border'
                )}>
                  <div className="flex gap-2 p-2">
                    <div className="flex-1 relative">
                      <input
                        value={feed.url}
                        onChange={e => updateFeed(i, e.target.value)}
                        onBlur={e => e.target.value.trim() && validateFeedUrl(i, e.target.value)}
                        placeholder="https://feed.exemplo.com/rss"
                        className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground placeholder:text-muted-foreground text-xs focus:outline-none focus:border-primary pr-7"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        {validation === 'checking' && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
                        {validation === 'valid' && <CheckCircle2 size={12} className="text-green-500" />}
                        {validation === 'invalid' && <AlertCircle size={12} className="text-destructive" />}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedFeedIdx(expandedFeedIdx === i ? null : i)}
                      className="p-2 rounded-lg text-muted-foreground"
                    >
                      {expandedFeedIdx === i ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {feeds.length > 1 && (
                      <button onClick={() => removeFeed(i)} className="p-2 rounded-lg bg-destructive/10 text-destructive">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  {validation === 'valid' && feed.url.trim() && (
                    <p className="text-xs text-green-500 px-3 pb-2">✓ Feed RSS válido</p>
                  )}
                  {validation === 'invalid' && feed.url.trim() && (
                    <p className="text-xs text-destructive px-3 pb-2">Feed inválido ou inacessível</p>
                  )}
                  {expandedFeedIdx === i && (
                    <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
                      <p className="text-xs text-muted-foreground font-medium flex items-center gap-1"><Timer size={10} /> Pular vinheta / silêncio</p>
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <label className="text-xs text-muted-foreground block mb-1">Início (seg)</label>
                          <input
                            type="number"
                            min={0}
                            value={feed.skip_start_seconds || 0}
                            onChange={e => updateFeedSkip(i, 'skip_start_seconds', e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-foreground text-xs focus:outline-none focus:border-primary"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs text-muted-foreground block mb-1">Fim (seg)</label>
                          <input
                            type="number"
                            min={0}
                            value={feed.skip_end_seconds || 0}
                            onChange={e => updateFeedSkip(i, 'skip_end_seconds', e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-foreground text-xs focus:outline-none focus:border-primary"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                );
              })}
              <button onClick={addFeed} className="text-xs text-primary flex items-center gap-1 mt-2">
                <Plus size={12} /> Adicionar manualmente
              </button>
            </div>
          </div>
        </div>

        </div>{/* end scroll */}
        <div className="px-5 pt-3 flex-shrink-0 border-t border-border space-y-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 5rem)' }}>
          <Button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="w-full rounded-2xl gradient-primary border-0 py-6 text-base font-semibold"
          >
            {saving ? <Loader2 size={18} className="animate-spin mr-2" /> : null}
            {saving ? 'Salvando...' : 'Criar Playlist'}
          </Button>
          <Button
            onClick={() => handleSave(true)}
            disabled={saving}
            variant="outline"
            className="w-full rounded-2xl border-primary/40 text-primary py-6 text-base font-semibold"
          >
            <Search size={16} className="mr-2" />
            Salvar e buscar podcasts
          </Button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}