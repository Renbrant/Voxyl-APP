import { useState, useEffect } from 'react';
import { voxylApi } from '@/api/voxylApiClient';
import { X, Plus, Trash2, GripVertical, Loader2, Clock, Save, Image as ImageIcon, Lock, Globe, Users, ChevronDown, ChevronUp, Timer, ArrowDown, ArrowUp } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { cn } from '@/lib/utils';

const DURATION_OPTIONS = [
  { label: 'Sem limite', value: 0 },
  { label: 'Até 10 min', value: 10 },
  { label: 'Até 20 min', value: 20 },
  { label: 'Até 30 min', value: 30 },
  { label: 'Até 45 min', value: 45 },
  { label: 'Até 60 min', value: 60 },
  { label: 'Até 90 min', value: 90 },
];

const TIME_FILTER_OPTIONS = [
  { label: 'Sem limite', value: 0 },
  { label: 'Últimas 24h', value: 24 },
  { label: 'Últimas 48h', value: 48 },
  { label: 'Última semana', value: 168 },
  { label: 'Último mês', value: 720 },
  { label: 'Último ano', value: 8760 },
];

const BASE_MAX_FEEDS = 5;
const EGG_BONUS_FEEDS = 15;

function getMaxFeeds(isAdmin = false) {
  if (isAdmin) return Infinity;
  const unlocked = localStorage.getItem('voxyl_egg_unlocked') === 'true';
  return BASE_MAX_FEEDS + (unlocked ? EGG_BONUS_FEEDS : 0);
}

export default function EditPlaylistModal({ playlist, onClose, onSaved, user }) {
  const [currentUser, setCurrentUser] = useState(user || null);

  useEffect(() => {
    if (!user) {
      voxylApi.auth.me().then(setCurrentUser).catch(() => {});
    } else {
      setCurrentUser(user);
    }
  }, [user]);

  const MAX_FEEDS = getMaxFeeds(currentUser?.role === 'admin');
  const [name, setName] = useState(playlist.name || '');
  const [description, setDescription] = useState(playlist.description || '');
  const [maxDuration, setMaxDuration] = useState(playlist.max_duration || 0);
  const [timeFilterHours, setTimeFilterHours] = useState(playlist.time_filter_hours || 0);
  const [sortOrder, setSortOrder] = useState(playlist.episodes_sort_order || 'newest_first');
  const [feeds, setFeeds] = useState((playlist.rss_feeds || []).map(f => ({
    ...f,
    skip_start_seconds: f.skip_start_seconds || 0,
    skip_end_seconds: f.skip_end_seconds || 0,
  })));
  const [expandedFeedIdx, setExpandedFeedIdx] = useState(null);
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [addingFeed, setAddingFeed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [feedError, setFeedError] = useState('');
  const [coverImage, setCoverImage] = useState(playlist.cover_image || '');
  const [generatingImage, setGeneratingImage] = useState(false);
  const [visibility, setVisibility] = useState(playlist.visibility || 'public');

  const handleAddFeed = async () => {
    const url = newFeedUrl.trim();
    if (!url) return;
    if (feeds.some(f => f.url === url)) { setFeedError('Feed já adicionado'); return; }
    if (feeds.length >= MAX_FEEDS) { setFeedError(`Limite de ${MAX_FEEDS} podcasts por playlist durante o período de testes.`); return; }
    setAddingFeed(true);
    setFeedError('');
    const res = await voxylApi.functions.invoke('fetchRSSFeed', { url, count: 1 }).then(r => r.data).catch(() => null);
    if (!res?.title) { setFeedError('URL inválida ou feed não encontrado'); setAddingFeed(false); return; }
    setFeeds(prev => [...prev, { url, title: res.title, description: res.description || '', image: res.image || '', skip_start_seconds: 0, skip_end_seconds: 0 }]);
    setNewFeedUrl('');
    setAddingFeed(false);
  };

  const handleRemoveFeed = (idx) => setFeeds(prev => prev.filter((_, i) => i !== idx));

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const reordered = Array.from(feeds);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    setFeeds(reordered);
  };

  const handleUploadImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setGeneratingImage(true);
    const res = await voxylApi.integrations.Core.UploadFile({ file }).catch(() => null);
    setGeneratingImage(false);
    if (res?.file_url) {
      setCoverImage(res.file_url);
    }
  };

  const handleUpdateFeedSkip = (idx, field, value) => {
    setFeeds(prev => prev.map((f, i) => i === idx ? { ...f, [field]: Number(value) || 0 } : f));
  };

  const handleDelete = async () => {
    setDeleting(true);
    await voxylApi.entities.Playlist.delete(playlist.id);
    setDeleting(false);
    onSaved();
    onClose();
  };

  const handleSave = async () => {
    setSaving(true);
    await voxylApi.entities.Playlist.update(playlist.id, {
      name: name.trim() || playlist.name,
      description,
      max_duration: maxDuration,
      time_filter_hours: timeFilterHours,
      episodes_sort_order: sortOrder,
      rss_feeds: feeds,
      cover_image: coverImage,
      visibility,
    });
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md bg-card border-t border-border rounded-t-3xl flex flex-col max-h-[92vh] animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
          <h2 className="text-base font-grotesk font-bold">Editar Playlist</h2>
          <button onClick={onClose} className="p-1.5 rounded-full bg-secondary text-muted-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-24 space-y-5">
          {/* Name */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Nome</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-secondary border border-border text-foreground text-sm focus:outline-none focus:border-primary"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Descrição</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 rounded-xl bg-secondary border border-border text-foreground text-sm focus:outline-none focus:border-primary resize-none"
            />
          </div>

          {/* Visibility options */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5 flex items-center gap-1">
              <Lock size={11} /> Visibilidade
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setVisibility('public')}
                className={cn(
                  'py-2.5 rounded-2xl text-sm font-medium transition-all border',
                  visibility === 'public'
                    ? 'gradient-primary text-white border-transparent'
                    : 'bg-secondary text-muted-foreground border-border'
                )}
              >
                <Globe size={14} className="mx-auto mb-1" /> Pública
              </button>
              <button
                onClick={() => setVisibility('friends_only')}
                className={cn(
                  'py-2.5 rounded-2xl text-sm font-medium transition-all border',
                  visibility === 'friends_only'
                    ? 'bg-primary text-white border-transparent'
                    : 'bg-secondary text-muted-foreground border-border'
                )}
              >
                <Users size={14} className="mx-auto mb-1" /> Seguidores
              </button>
              <button
                onClick={() => setVisibility('private')}
                className={cn(
                  'py-2.5 rounded-2xl text-sm font-medium transition-all border',
                  visibility === 'private'
                    ? 'bg-primary text-white border-transparent'
                    : 'bg-secondary text-muted-foreground border-border'
                )}
              >
                <Lock size={14} className="mx-auto mb-1" /> Privada
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {visibility === 'public' && 'Qualquer pessoa pode ver esta playlist'}
              {visibility === 'friends_only' && 'Apenas seus seguidores aprovados podem ver esta playlist'}
              {visibility === 'private' && 'Apenas você pode ver esta playlist'}
            </p>
          </div>

          {/* Max Duration */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5 flex items-center gap-1">
              <Clock size={11} /> Duração máxima dos episódios
            </label>
            <div className="flex flex-wrap gap-2">
              {DURATION_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setMaxDuration(opt.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    maxDuration === opt.value
                      ? 'bg-primary/20 text-primary border-primary/40'
                      : 'bg-secondary text-muted-foreground border-border'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Time Filter */}
           <div>
             <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5 flex items-center gap-1">
               <Timer size={11} /> Episódios publicados
             </label>
             <div className="flex flex-wrap gap-2">
               {TIME_FILTER_OPTIONS.map(opt => (
                 <button
                   key={opt.value}
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

           {/* Episodes Sort Order */}
           <div>
             <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5 flex items-center gap-1">
               <ArrowDown size={11} /> Ordem dos episódios
             </label>
             <p className="text-xs text-muted-foreground mb-2.5">Como exibir os episódios por data de publicação</p>
             <div className="flex gap-2">
               <button
                 onClick={() => setSortOrder('newest_first')}
                 className={cn(
                   'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm transition-all border',
                   sortOrder === 'newest_first'
                     ? 'bg-primary/20 text-primary border-primary/40'
                     : 'bg-secondary text-muted-foreground border-border'
                 )}
               >
                 <ArrowDown size={14} />
                 Mais recentes
               </button>
               <button
                 onClick={() => setSortOrder('oldest_first')}
                 className={cn(
                   'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm transition-all border',
                   sortOrder === 'oldest_first'
                     ? 'bg-primary/20 text-primary border-primary/40'
                     : 'bg-secondary text-muted-foreground border-border'
                 )}
               >
                 <ArrowUp size={14} />
                 Mais antigos
               </button>
             </div>
           </div>

          {/* Cover Image */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Capa da Playlist</label>
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
            <label className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 bg-secondary text-muted-foreground rounded-2xl border border-border cursor-pointer hover:border-primary/30 transition-all text-xs font-medium">
              {generatingImage ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
              {generatingImage ? 'Enviando...' : 'Enviar foto do telefone'}
              <input type="file" accept="image/*" onChange={handleUploadImage} disabled={generatingImage} className="hidden" />
            </label>
          </div>

          {/* Feeds */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
              Feeds RSS ({feeds.length})
            </label>

            {/* Add new feed */}
            <div className="flex gap-2 mb-3">
              <input
                value={newFeedUrl}
                onChange={e => { setNewFeedUrl(e.target.value); setFeedError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleAddFeed()}
                placeholder="URL do feed RSS..."
                className="flex-1 px-3 py-2 rounded-xl bg-secondary border border-border text-foreground text-sm focus:outline-none focus:border-primary placeholder:text-muted-foreground"
              />
              <button
                onClick={handleAddFeed}
                disabled={addingFeed || !newFeedUrl.trim()}
                className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center flex-shrink-0 disabled:opacity-50"
              >
                {addingFeed ? <Loader2 size={14} className="animate-spin text-white" /> : <Plus size={14} className="text-white" />}
              </button>
            </div>
            {feedError && <p className="text-xs text-destructive mb-2">{feedError}</p>}

            {/* Draggable feed list */}
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="feeds">
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                    {feeds.map((feed, idx) => (
                      <Draggable key={feed.url} draggableId={feed.url} index={idx}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            className={`rounded-xl border transition-all ${
                              snapshot.isDragging ? 'bg-primary/10 border-primary/40 shadow-lg' : 'bg-secondary border-border'
                            }`}
                          >
                            <div className="flex items-center gap-2 p-2.5">
                              <div {...provided.dragHandleProps} className="text-muted-foreground/40 cursor-grab active:cursor-grabbing">
                                <GripVertical size={16} />
                              </div>
                              {feed.image ? (
                                <img src={feed.image} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
                              ) : (
                                <div className="w-8 h-8 rounded-lg bg-border flex-shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-foreground truncate">{feed.title || feed.url}</p>
                                <p className="text-xs text-muted-foreground truncate">{feed.url}</p>
                              </div>
                              <button
                                onClick={() => setExpandedFeedIdx(expandedFeedIdx === idx ? null : idx)}
                                className="p-1 rounded-lg text-muted-foreground flex-shrink-0"
                              >
                                {expandedFeedIdx === idx ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </button>
                              <button
                                onClick={() => handleRemoveFeed(idx)}
                                className="p-1 rounded-lg text-muted-foreground hover:text-destructive flex-shrink-0"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                            {expandedFeedIdx === idx && (
                              <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
                                <p className="text-xs text-muted-foreground font-medium flex items-center gap-1"><Timer size={10} /> Cortar silêncio / vinheta</p>
                                <div className="flex gap-3">
                                  <div className="flex-1">
                                    <label className="text-xs text-muted-foreground block mb-1">Pular início (seg)</label>
                                    <input
                                      type="number"
                                      min={0}
                                      value={feed.skip_start_seconds}
                                      onChange={e => handleUpdateFeedSkip(idx, 'skip_start_seconds', e.target.value)}
                                      className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-foreground text-xs focus:outline-none focus:border-primary"
                                    />
                                  </div>
                                  <div className="flex-1">
                                    <label className="text-xs text-muted-foreground block mb-1">Pular fim (seg)</label>
                                    <input
                                      type="number"
                                      min={0}
                                      value={feed.skip_end_seconds}
                                      onChange={e => handleUpdateFeedSkip(idx, 'skip_end_seconds', e.target.value)}
                                      className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-foreground text-xs focus:outline-none focus:border-primary"
                                    />
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>

            {feeds.length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-4">Nenhum feed adicionado</p>
            )}
          </div>
        </div>

        {/* Footer buttons */}
        <div className="px-5 pt-3 flex-shrink-0 border-t border-border space-y-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 5rem)' }}>
          <button
            onClick={handleSave}
            disabled={saving || deleting}
            className="w-full py-3.5 rounded-2xl gradient-primary text-white font-semibold flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </button>

          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={saving || deleting}
              className="w-full py-3 rounded-2xl bg-destructive/10 text-destructive font-semibold text-sm flex items-center justify-center gap-2"
            >
              <Trash2 size={15} /> Excluir playlist
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 py-3 rounded-2xl bg-secondary text-muted-foreground font-semibold text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-3 rounded-2xl bg-destructive text-white font-semibold text-sm flex items-center justify-center gap-2"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {deleting ? 'Excluindo...' : 'Confirmar'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}