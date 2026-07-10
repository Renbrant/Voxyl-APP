import { useState } from 'react';
import { createPortal } from 'react-dom';
import { voxylApi } from '@/api/voxylApiClient';
import { MoreVertical, Flag, Ban, X, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const REPORT_REASONS = [
  { value: 'inappropriate', label: 'Conteúdo inapropriado' },
  { value: 'spam', label: 'Spam' },
  { value: 'hate_speech', label: 'Discurso de ódio' },
  { value: 'misinformation', label: 'Desinformação' },
  { value: 'other', label: 'Outro' },
];

export default function ReportBlockMenu({ targetUser, contentType = 'playlist', contentId, contentTitle, currentUser, onBlocked }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);

  if (!currentUser || currentUser.id === targetUser?.id) return null;

  const close = () => { setOpen(false); setMode(null); setReason(''); setDetails(''); };

  const handleReport = async () => {
    if (!reason) return;
    setLoading(true);
    // Create report record
    await voxylApi.entities.Report.create({
      reporter_id: currentUser.id,
      reporter_email: currentUser.email,
      reported_user_id: targetUser.id,
      reported_user_email: targetUser.email || '',
      content_type: contentType,
      content_id: contentId,
      content_title: contentTitle,
      reason,
      details,
      status: 'pending',
    });
    // Increment reports_count on the playlist
    if (contentType === 'playlist' && contentId) {
      const playlists = await voxylApi.entities.Playlist.filter({ id: contentId });
      if (playlists[0]) {
        await voxylApi.entities.Playlist.update(contentId, {
          reports_count: (playlists[0].reports_count || 0) + 1,
        });
      }
    }
    setLoading(false);
    setMode('done');
  };

  const handleBlock = async () => {
    setLoading(true);
    const existing = await voxylApi.entities.Block.filter({ blocker_id: currentUser.id, blocked_id: targetUser.id });
    if (!existing.length) {
      await voxylApi.entities.Block.create({
        blocker_id: currentUser.id,
        blocker_email: currentUser.email,
        blocked_id: targetUser.id,
        blocked_email: targetUser.email || '',
        blocked_name: targetUser.name || '',
      });
    }
    setLoading(false);
    setMode('done');
    // Notify parent so it can re-filter the list
    onBlocked?.(targetUser.id);
  };

  const stopAndClose = (e) => {
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  const modal = (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/60 backdrop-blur-sm"
          onMouseDown={e => { if (e.target === e.currentTarget) close(); }}
          onTouchEnd={e => { if (e.target === e.currentTarget) close(); }}
          onClick={e => e.stopPropagation()}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25 }}
            className="w-full max-w-md bg-card border-t border-border rounded-t-3xl p-5"
            onClick={e => e.stopPropagation()}
          >
            {/* Done state */}
            {mode === 'done' && (
              <div className="text-center py-6">
                <div className="text-4xl mb-3">✅</div>
                <p className="font-semibold text-foreground">
                  {reason ? 'Denúncia enviada' : 'Usuário bloqueado'}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {reason
                    ? 'Nossa equipe irá analisar o conteúdo em breve.'
                    : 'Você não verá mais o conteúdo deste usuário.'}
                </p>
                <button onClick={stopAndClose} className="mt-4 px-6 py-2 rounded-full bg-secondary text-sm font-medium">Fechar</button>
              </div>
            )}

            {/* Report form */}
            {mode === 'report' && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-grotesk font-bold text-base">Denunciar conteúdo</h3>
                  <button onClick={stopAndClose}><X size={18} className="text-muted-foreground" /></button>
                </div>
                <p className="text-xs text-muted-foreground mb-3">Qual é o problema?</p>
                <div className="space-y-2 mb-3">
                  {REPORT_REASONS.map(r => (
                    <button
                      key={r.value}
                      onClick={() => setReason(r.value)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl border text-sm transition-all ${
                        reason === r.value ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-secondary text-foreground'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={details}
                  onChange={e => setDetails(e.target.value)}
                  placeholder="Detalhes adicionais (opcional)..."
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-none mb-3"
                />
                <button
                  onClick={handleReport}
                  disabled={!reason || loading}
                  className="w-full py-3 rounded-2xl bg-destructive text-white font-semibold text-sm disabled:opacity-50"
                >
                  {loading ? 'Enviando...' : 'Enviar denúncia'}
                </button>
              </>
            )}

            {/* Block confirmation */}
            {mode === 'block' && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-grotesk font-bold text-base">Bloquear usuário</h3>
                  <button onClick={stopAndClose}><X size={18} className="text-muted-foreground" /></button>
                </div>
                <p className="text-sm text-muted-foreground mb-6">
                  Você não verá mais o conteúdo de <strong className="text-foreground">{targetUser?.name || 'este usuário'}</strong> e ele não verá o seu. Esta ação pode ser desfeita no seu perfil.
                </p>
                <button
                  onClick={handleBlock}
                  disabled={loading}
                  className="w-full py-3 rounded-2xl bg-destructive text-white font-semibold text-sm disabled:opacity-50 mb-2"
                >
                  {loading ? 'Bloqueando...' : 'Bloquear'}
                </button>
                <button onClick={stopAndClose} className="w-full py-3 rounded-2xl bg-secondary text-sm font-medium">Cancelar</button>
              </>
            )}

            {/* Main menu */}
            {!mode && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-grotesk font-bold text-base">Opções</h3>
                  <button onClick={stopAndClose}><X size={18} className="text-muted-foreground" /></button>
                </div>
                <div className="space-y-2">
                  <button
                    onClick={() => setMode('report')}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-secondary hover:bg-secondary/80 transition-colors"
                  >
                    <Flag size={18} className="text-yellow-400" />
                    <span className="text-sm font-medium flex-1 text-left">Denunciar conteúdo</span>
                    <ChevronRight size={16} className="text-muted-foreground" />
                  </button>
                  <button
                    onClick={() => setMode('block')}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-secondary hover:bg-secondary/80 transition-colors"
                  >
                    <Ban size={18} className="text-destructive" />
                    <span className="text-sm font-medium flex-1 text-left">Bloquear usuário</span>
                    <ChevronRight size={16} className="text-muted-foreground" />
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className="p-1.5 rounded-full text-muted-foreground hover:text-foreground transition-colors"
      >
        <MoreVertical size={16} />
      </button>
      {createPortal(modal, document.body)}
    </>
  );
}