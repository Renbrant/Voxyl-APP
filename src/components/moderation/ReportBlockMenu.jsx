import { useState } from 'react';
import { createPortal } from 'react-dom';
import { voxylApi } from '@/api/voxylApiClient';
import { MoreVertical, Flag, Ban, X, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { t } from '@/lib/i18n';

const REPORT_REASONS = [
  { value: 'inappropriate', labelKey: 'reportReasonInappropriate' },
  { value: 'spam', labelKey: 'reportReasonSpam' },
  { value: 'hate_speech', labelKey: 'reportReasonHate' },
  { value: 'misinformation', labelKey: 'reportReasonMisinformation' },
  { value: 'other', labelKey: 'reportReasonOther' },
];

export function getReportErrorKey(error) {
  if (error?.status === 401) return 'reportErrorAuth';
  if (error?.status === 404) return 'reportErrorNotFound';
  if (error?.status === 429) return 'reportErrorRateLimit';
  if (error?.code === 'own-content') return 'reportErrorOwnContent';
  return 'reportErrorGeneric';
}

export default function ReportBlockMenu({ targetUser, contentType = 'playlist', contentId, currentUser, onBlocked = null }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);
  const [blockError, setBlockError] = useState('');
  const [reportError, setReportError] = useState('');
  const [alreadyReported, setAlreadyReported] = useState(false);

  if (!currentUser || currentUser.id === targetUser?.id) return null;

  const close = () => {
    setOpen(false); setMode(null); setReason(''); setDetails('');
    setBlockError(''); setReportError(''); setAlreadyReported(false);
  };

  const handleReport = async () => {
    if (!reason || loading) return;
    setLoading(true);
    setReportError('');
    try {
      // Reporter, reported user and title are resolved by the server.
      const result = await voxylApi.reports.create({ contentType, contentId, reason, details: details.trim() });
      setAlreadyReported(Boolean(result?.duplicate));
      setMode('done');
    } catch (error) {
      console.error('[ReportBlockMenu] Failed to send report', { contentType, contentId, status: error?.status, code: error?.code });
      setReportError(t(getReportErrorKey(error)));
    } finally {
      setLoading(false);
    }
  };

  const handleBlock = async () => {
    setLoading(true);
    setBlockError('');
    try {
      await voxylApi.blocks.create(targetUser.id);
      setMode('done');
      // Notify parent so it can re-filter the list
      onBlocked?.(targetUser.id);
    } catch (error) {
      console.error('[ReportBlockMenu] Failed to block user', { targetUserId: targetUser.id, error });
      setBlockError(t('blockCreateError'));
    } finally {
      setLoading(false);
    }
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
                  {reason ? t('reportSent') : t('reportBlockedDone')}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {reason
                    ? (alreadyReported ? t('reportAlreadySent') : t('reportSentDesc'))
                    : t('reportBlockedDoneDesc')}
                </p>
                <button onClick={stopAndClose} className="mt-4 px-6 py-2 rounded-full bg-secondary text-sm font-medium">{t('reportClose')}</button>
              </div>
            )}

            {/* Report form */}
            {mode === 'report' && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-grotesk font-bold text-base">{t('reportMenuReport')}</h3>
                  <button onClick={stopAndClose}><X size={18} className="text-muted-foreground" /></button>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{t('reportQuestion')}</p>
                <div className="space-y-2 mb-3">
                  {REPORT_REASONS.map(r => (
                    <button
                      key={r.value}
                      onClick={() => setReason(r.value)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl border text-sm transition-all ${
                        reason === r.value ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-secondary text-foreground'
                      }`}
                    >
                      {t(r.labelKey)}
                    </button>
                  ))}
                </div>
                <textarea
                  value={details}
                  onChange={e => setDetails(e.target.value)}
                  placeholder={t('reportDetailsPlaceholder')}
                  maxLength={1000}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-none mb-3"
                />
                {reportError && (
                  <p role="alert" className="text-xs text-destructive mb-3">{reportError}</p>
                )}
                <button
                  onClick={handleReport}
                  disabled={!reason || loading}
                  className="w-full py-3 rounded-2xl bg-destructive text-white font-semibold text-sm disabled:opacity-50"
                >
                  {loading ? t('reportSending') : t('reportSubmit')}
                </button>
              </>
            )}

            {/* Block confirmation */}
            {mode === 'block' && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-grotesk font-bold text-base">{t('reportBlockTitle')}</h3>
                  <button onClick={stopAndClose}><X size={18} className="text-muted-foreground" /></button>
                </div>
                <p className="text-sm text-muted-foreground mb-6">
                  Você não verá mais o conteúdo de <strong className="text-foreground">{targetUser?.name || 'este usuário'}</strong> e ele não verá o seu. Esta ação pode ser desfeita no seu perfil.
                </p>
                {blockError && (
                  <p className="text-xs text-destructive mb-3">{blockError}</p>
                )}
                <button
                  onClick={handleBlock}
                  disabled={loading}
                  className="w-full py-3 rounded-2xl bg-destructive text-white font-semibold text-sm disabled:opacity-50 mb-2"
                >
                  {loading ? t('reportBlocking') : t('reportBlockConfirm')}
                </button>
                <button onClick={stopAndClose} className="w-full py-3 rounded-2xl bg-secondary text-sm font-medium">{t('cancel')}</button>
              </>
            )}

            {/* Main menu */}
            {!mode && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-grotesk font-bold text-base">{t('reportMenuTitle')}</h3>
                  <button onClick={stopAndClose}><X size={18} className="text-muted-foreground" /></button>
                </div>
                <div className="space-y-2">
                  <button
                    onClick={() => setMode('report')}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-secondary hover:bg-secondary/80 transition-colors"
                  >
                    <Flag size={18} className="text-yellow-400" />
                    <span className="text-sm font-medium flex-1 text-left">{t('reportMenuReport')}</span>
                    <ChevronRight size={16} className="text-muted-foreground" />
                  </button>
                  <button
                    onClick={() => setMode('block')}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-secondary hover:bg-secondary/80 transition-colors"
                  >
                    <Ban size={18} className="text-destructive" />
                    <span className="text-sm font-medium flex-1 text-left">{t('reportMenuBlock')}</span>
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
