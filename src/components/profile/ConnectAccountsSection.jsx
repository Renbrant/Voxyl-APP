import { useState, useEffect } from 'react';
import { CheckCircle2, Link } from 'lucide-react';

const providers = [
  {
    id: 'google',
    label: 'Google',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
    ),
  },
  {
    id: 'apple',
    label: 'Apple',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
        <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.4c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.39-1.32 2.76-2.53 3.99zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
      </svg>
    ),
  },
];

export default function ConnectAccountsSection({ user }) {
  const [linked, setLinked] = useState({ google: false, apple: false });

  useEffect(() => {
    // Detect which provider was used to sign up based on presence of profile_picture or provider hint
    const email = user?.email || '';
    const picture = user?.profile_picture || '';
    // Base44 stores the auth provider in the user object when using social login
    const provider = user?.auth_provider || '';
    setLinked({
      google: provider === 'google' || (picture.includes('googleusercontent') || picture.includes('google')),
      apple: provider === 'apple',
    });
  }, [user]);

  const handleConnect = (providerId) => {
    // Redirect to the Base44 OAuth link endpoint for the provider
    const next = window.location.href;
    window.location.href = `/_auth/link/${providerId}?next=${encodeURIComponent(next)}`;
  };

  return (
    <div className="mb-5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Contas vinculadas</p>
      <div className="space-y-2">
        {providers.map(({ id, label, icon }) => {
          const isLinked = linked[id];
          return (
            <div key={id} className="flex items-center justify-between p-3 rounded-xl bg-secondary border border-border">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-background flex items-center justify-center">
                  {icon}
                </div>
                <span className="text-sm font-medium text-foreground">{label}</span>
              </div>
              {isLinked ? (
                <div className="flex items-center gap-1.5 text-xs text-green-400">
                  <CheckCircle2 size={14} />
                  Vinculado
                </div>
              ) : (
                <button
                  onClick={() => handleConnect(id)}
                  className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                >
                  <Link size={13} />
                  Conectar
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}