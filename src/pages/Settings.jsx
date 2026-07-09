import { useState, useEffect } from 'react';
import { t, setLanguage, lang } from '@/lib/i18n';
import { voxylApi } from '@/api/voxylApiClient';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Moon, Sun, Globe, Eye, Ban, LogOut, Trash2, Shield, Monitor } from 'lucide-react';
import VoxylHeader from '@/components/common/VoxylHeader';
import DeleteAccountModal from '@/components/profile/DeleteAccountModal';
import BlockedUsersModal from '@/components/profile/BlockedUsersModal';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import PageTransition from '@/components/common/PageTransition';

const THEME_OPTIONS = () => [
  { key: 'auto', label: t('settingsThemeAuto'), icon: Monitor },
  { key: 'dark', label: t('settingsThemeDark'), icon: Moon },
  { key: 'light', label: t('settingsThemeLight'), icon: Sun },
];

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.remove('dark', 'light');
    root.classList.add(prefersDark ? 'dark' : 'light');
  } else if (theme === 'dark') {
    root.classList.remove('light');
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
    root.classList.add('light');
  }
}

export default function Settings() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [theme, setTheme] = useState('dark');
  const [showDelete, setShowDelete] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [blockedCount, setBlockedCount] = useState(0);
  const [showDangerZone, setShowDangerZone] = useState(false);
  const [dangerTaps, setDangerTaps] = useState(0);
  const [currentLang, setCurrentLang] = useState(lang);

  useEffect(() => {
    voxylApi.auth.me().then(u => {
      setUser(u);
      const saved = localStorage.getItem('theme') || 'dark';
      setTheme(saved);
      applyTheme(saved);
    }).catch(() => {});
  }, []);

  const handleThemeChange = (t) => {
    setTheme(t);
    localStorage.setItem('theme', t);
    applyTheme(t);
    setShowThemePicker(false);
  };

  const handleLogout = () => {
    voxylApi.auth.logout('/');
  };

  const themeOptions = THEME_OPTIONS();
  const themeOption = themeOptions.find(o => o.key === theme) || themeOptions[0];
  const ThemeIcon = themeOption.icon;

  const menuItems = [
    {
      icon: Globe,
      label: t('settingsLanguage'),
      description: lang === 'pt' ? t('settingsLanguagePortuguese') : t('settingsLanguageEnglish'),
      action: () => setShowLanguagePicker(true),
      badge: null,
    },
    {
      icon: ThemeIcon,
      label: t('settingsTheme'),
      description: themeOption.label,
      action: () => setShowThemePicker(true),
      badge: null,
    },
    {
      icon: Eye,
      label: t('settingsPrivacy'),
      description: user?.profile_hidden ? t('settingsPrivacyHidden') : t('settingsPrivacyVisible'),
      action: () => {
        if (!user) return;
        const newVal = !user.profile_hidden;
        voxylApi.auth.updateMe({ profile_hidden: newVal });
        voxylApi.entities.Playlist.filter({ creator_id: user.id }).then(playlists => {
          Promise.all(playlists.map(p => voxylApi.entities.Playlist.update(p.id, { creator_hidden: newVal })));
        });
        setUser(prev => ({ ...prev, profile_hidden: newVal }));
      },
      badge: user?.profile_hidden ? t('settingsHidden') : null,
    },
    {
      icon: Ban,
      label: t('settingsBlockedUsers'),
      description: `${blockedCount} ${blockedCount !== 1 ? t('settingsBlockedCountPlural') : t('settingsBlockedCount')}`,
      action: () => setShowBlocked(true),
      badge: blockedCount > 0 ? blockedCount : null,
    },
    {
      icon: Shield,
      label: t('settingsPrivacyPolicy'),
      description: t('settingsPrivacyPolicyDesc'),
      action: () => navigate('/privacy'),
      badge: null,
    },
  ];

  const dangerItems = [
    {
      icon: LogOut,
      label: t('settingsLogout'),
      description: t('settingsLogoutDesc'),
      action: handleLogout,
      color: 'text-orange-400',
    },
    {
      icon: Trash2,
      label: t('settingsDeleteAccount'),
      description: t('settingsDeleteAccountDesc'),
      action: () => setShowDelete(true),
      color: 'text-destructive',
    },
  ];

  const handleDangerTap = () => {
    const next = dangerTaps + 1;
    setDangerTaps(next);
    if (next >= 5) {
      setShowDangerZone(true);
    }
  };

  return (
    <PageTransition>
    <div className="bg-background pb-24">
      <VoxylHeader 
        title={t('settingsTitle')}
        right={
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-full hover:bg-secondary transition-colors"
          >
            <ChevronLeft size={20} className="text-primary" />
          </button>
        }
      />

      <div className="px-4">
        {/* Theme and Privacy Settings */}
        <div className="space-y-2 mb-6">
          {menuItems.map((item, idx) => {
            const Icon = item.icon;
            return (
              <motion.button
                key={idx}
                onClick={item.action}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl bg-secondary border border-border hover:border-primary/30 transition-colors active:scale-95"
              >
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Icon size={18} className="text-primary" />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="font-semibold text-sm text-foreground">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
                {item.badge && (
                  <span className="px-2.5 py-1 rounded-full bg-primary/20 text-primary text-xs font-semibold flex-shrink-0">
                    {item.badge}
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>

        {/* Danger Zone */}
        <div className="space-y-2 mt-8 pt-6 border-t border-border">
          <button
            onClick={handleDangerTap}
            className="w-full text-left px-4 mb-3"
          >
            <p className="text-xs font-semibold text-destructive/40 uppercase tracking-wide select-none">
              {dangerTaps > 0 && dangerTaps < 5 ? '···' : 'Ações'}
            </p>
          </button>
          {dangerItems.map((item, idx) => {
            const Icon = item.icon;
            return (
              <motion.button
                key={idx}
                onClick={item.action}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: (menuItems.length + idx) * 0.05 }}
                className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl bg-secondary border border-border hover:border-destructive/30 hover:bg-destructive/5 transition-colors active:scale-95"
              >
                <div className={`w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0 ${item.color}`}>
                  <Icon size={18} />
                </div>
                <div className="flex-1 text-left">
                  <p className={`font-semibold text-sm ${item.color}`}>{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
              </motion.button>
            );
          })}


        </div>
      </div>

      <AnimatePresence>
        {showDelete && user && (
          <DeleteAccountModal user={user} onClose={() => setShowDelete(false)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showBlocked && user && (
          <BlockedUsersModal 
            user={user} 
            onClose={() => setShowBlocked(false)}
            onCountChange={setBlockedCount}
          />
        )}
      </AnimatePresence>

      {/* Theme picker bottom sheet */}
      <AnimatePresence>
        {showLanguagePicker && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-40"
            onClick={() => setShowLanguagePicker(false)}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-card rounded-t-3xl border-t border-border p-6"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 5rem)' }}
          >
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">{t('settingsChooseLanguage')}</p>
            <div className="space-y-2">
              <button
                onClick={() => setLanguage('pt')}
                className={cn(
                  'w-full flex items-center gap-4 px-4 py-4 rounded-2xl border transition-all',
                  currentLang === 'pt'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-secondary text-foreground'
                )}
              >
                <Globe size={20} />
                <span className="font-medium">{t('settingsLanguagePortuguese')}</span>
                {currentLang === 'pt' && <span className="ml-auto text-xs font-semibold text-primary">✓</span>}
              </button>
              <button
                onClick={() => setLanguage('en')}
                className={cn(
                  'w-full flex items-center gap-4 px-4 py-4 rounded-2xl border transition-all',
                  currentLang === 'en'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-secondary text-foreground'
                )}
              >
                <Globe size={20} />
                <span className="font-medium">{t('settingsLanguageEnglish')}</span>
                {currentLang === 'en' && <span className="ml-auto text-xs font-semibold text-primary">✓</span>}
              </button>
            </div>
          </motion.div>
        </>
      )}

      {showThemePicker && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40"
              onClick={() => setShowThemePicker(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-card rounded-t-3xl border-t border-border p-6"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 5rem)' }}
            >
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">{t('settingsChooseTheme')}</p>
              <div className="space-y-2">
                {THEME_OPTIONS().map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => handleThemeChange(key)}
                    className={cn(
                      'w-full flex items-center gap-4 px-4 py-4 rounded-2xl border transition-all',
                      theme === key
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-secondary text-foreground'
                    )}
                  >
                    <Icon size={20} />
                    <span className="font-medium">{label}</span>
                    {theme === key && <span className="ml-auto text-xs font-semibold text-primary">✓</span>}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
    </PageTransition>
  );
}