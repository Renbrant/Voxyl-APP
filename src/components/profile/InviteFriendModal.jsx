import { useState, useEffect } from 'react';
import { voxylApi } from '@/api/voxylApiClient';
import { X, Mail, Copy, Check, CheckCircle2, Loader2, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

const APP_BASE_URL = 'https://v.renbrant.com';

function buildInviteLink(inviterId) {
  return `${APP_BASE_URL}?ref=${inviterId}`;
}

function buildShareText(inviterName, inviteLink) {
  return `${inviterName} te convidou para o Voxyl 🎧 — o app de playlists de podcasts! Entre aqui: ${inviteLink}`;
}

function SharePlatforms({ inviteLink, inviterName }) {
  const [copied, setCopied] = useState(false);
  const text = buildShareText(inviterName, inviteLink);

  const platforms = [
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      color: 'bg-[#25D366]',
      icon: (
        <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      ),
      action: () => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank'),
    },
    {
      id: 'telegram',
      label: 'Telegram',
      color: 'bg-[#2CA5E0]',
      icon: (
        <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
        </svg>
      ),
      action: () => window.open(`https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(buildShareText(inviterName, ''))}`, '_blank'),
    },
    {
      id: 'x',
      label: 'X (Twitter)',
      color: 'bg-black',
      icon: (
        <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      ),
      action: () => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(buildShareText(inviterName, ''))}&url=${encodeURIComponent(inviteLink)}`, '_blank'),
    },
    {
      id: 'instagram',
      label: 'Instagram',
      color: 'bg-gradient-to-br from-[#f09433] via-[#dc2743] to-[#bc1888]',
      icon: (
        <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
        </svg>
      ),
      action: () => {
        navigator.clipboard.writeText(inviteLink);
        alert('Link copiado! Cole no Instagram Stories ou Bio 📸');
      },
    },
    {
      id: 'sms',
      label: 'SMS',
      color: 'bg-green-600',
      icon: (
        <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/>
        </svg>
      ),
      action: () => window.open(`sms:?body=${encodeURIComponent(text)}`, '_blank'),
    },
    {
      id: 'email',
      label: 'Email',
      color: 'bg-[#EA4335]',
      icon: (
        <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
          <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
        </svg>
      ),
      action: () => window.open(`mailto:?subject=Junte-se a mim no Voxyl!&body=${encodeURIComponent(text)}`, '_blank'),
    },
    {
      id: 'native',
      label: 'Mais',
      color: 'bg-secondary border border-border',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 text-foreground">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
      ),
      action: () => {
        if (navigator.share) {
          navigator.share({ title: 'Voxyl', text: buildShareText(inviterName, ''), url: inviteLink });
        } else {
          navigator.clipboard.writeText(inviteLink);
        }
      },
    },
  ];

  return (
    <div className="space-y-4">
      {/* Platforms grid */}
      <div className="grid grid-cols-4 gap-3">
        {platforms.map(({ id, label, color, icon, action }) => (
          <button key={id} onClick={action} className="flex flex-col items-center gap-1.5">
            <div className={`w-12 h-12 rounded-2xl ${color} flex items-center justify-center shadow-lg`}>
              {icon}
            </div>
            <span className="text-xs text-muted-foreground">{label}</span>
          </button>
        ))}
      </div>

      {/* Copy link */}
      <div className="flex items-center gap-2 p-3 rounded-2xl bg-secondary border border-border">
        <Link2 size={14} className="text-muted-foreground flex-shrink-0" />
        <p className="flex-1 text-xs text-muted-foreground truncate">{inviteLink}</p>
        <button
          onClick={() => { navigator.clipboard.writeText(inviteLink); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="flex items-center gap-1 text-xs font-medium text-primary flex-shrink-0"
        >
          {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
          {copied ? 'Copiado!' : 'Copiar'}
        </button>
      </div>
    </div>
  );
}

export default function InviteFriendModal({ onClose, playlistId = null }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);
  const [mode, setMode] = useState('share'); // 'share' | 'email'

  useEffect(() => { voxylApi.auth.me().then(setUser).catch(() => {}); }, []);

  const inviteLink = user ? buildInviteLink(user.id) : APP_BASE_URL;
  const inviterName = user?.full_name || user?.email?.split('@')[0] || 'Um amigo';

  const handleSendEmail = async () => {
    if (!email.trim() || !email.includes('@')) { setError('E-mail inválido'); return; }
    setSending(true);
    setError('');
    await voxylApi.users.inviteUser(email.trim(), 'user');
    if (user) {
      await voxylApi.entities.Referral.create({
        inviter_id: user.id,
        inviter_email: user.email,
        inviter_name: inviterName,
        invitee_email: email.trim(),
        status: 'pending',
        playlist_id: playlistId || '',
      });
    }
    setSending(false);
    setSent(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25 }}
        className="w-full max-w-md bg-card border-t border-border rounded-t-3xl p-5 max-h-[90vh] overflow-y-auto"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 5rem)' }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-grotesk font-bold">Convidar Amigos</h2>
          <button onClick={onClose} className="p-1.5 rounded-full bg-secondary text-muted-foreground">
            <X size={18} />
          </button>
        </div>

        {sent ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <div className="w-16 h-16 rounded-full gradient-primary flex items-center justify-center glow-primary">
              <CheckCircle2 size={32} className="text-white" />
            </div>
            <p className="text-lg font-semibold">Convite enviado!</p>
            <p className="text-sm text-muted-foreground text-center">
              Seu amigo receberá um e-mail para acessar o Voxyl e já vai te seguir automaticamente!
            </p>
            <Button onClick={onClose} className="mt-2 rounded-full gradient-primary border-0 px-8">
              Fechar
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-5 p-4 rounded-2xl bg-primary/10 border border-primary/20">
              <p className="text-sm text-foreground">
                🎧 Compartilhe seu link pessoal — quem entrar por ele já vai te seguir automaticamente!
              </p>
            </div>

            {/* Tab switcher */}
            <div className="flex gap-2 mb-5">
              <button
                onClick={() => setMode('share')}
                className={`flex-1 py-2 rounded-2xl text-sm font-medium transition-all ${
                  mode === 'share' ? 'gradient-primary text-white' : 'bg-secondary text-muted-foreground'
                }`}
              >
                Compartilhar link
              </button>
              <button
                onClick={() => setMode('email')}
                className={`flex-1 py-2 rounded-2xl text-sm font-medium transition-all ${
                  mode === 'email' ? 'gradient-primary text-white' : 'bg-secondary text-muted-foreground'
                }`}
              >
                Por e-mail
              </button>
            </div>

            {mode === 'share' && (
              <SharePlatforms inviteLink={inviteLink} inviterName={inviterName} />
            )}

            {mode === 'email' && (
              <>
                {error && <p className="text-destructive text-sm mb-3 bg-destructive/10 px-3 py-2 rounded-xl">{error}</p>}
                <div className="relative mb-4">
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="email@amigo.com"
                    onKeyDown={e => e.key === 'Enter' && handleSendEmail()}
                    className="w-full pl-10 pr-4 py-3 rounded-2xl bg-secondary border border-border text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <Button
                  onClick={handleSendEmail}
                  disabled={sending}
                  className="w-full rounded-2xl gradient-primary border-0 py-6 text-base font-semibold"
                >
                  {sending ? <Loader2 size={18} className="animate-spin mr-2" /> : null}
                  {sending ? 'Enviando...' : 'Enviar Convite por E-mail'}
                </Button>
              </>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}
