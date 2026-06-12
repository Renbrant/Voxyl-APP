import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Component, useEffect } from 'react';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { PlayerProvider } from '@/lib/PlayerContext';
import Layout from '@/components/Layout';
// Add page imports here
import Feed from '@/pages/Feed';
import Explore from '@/pages/Explore';
import Playlists from '@/pages/Playlists.jsx';
import Profile from '@/pages/Profile';
import Settings from '@/pages/Settings';
import PlaylistDetail from '@/pages/PlaylistDetail';
import UserProfile from '@/pages/UserProfile';
import PlaylistPreview from '@/pages/PlaylistPreview';
import PrivacyPolicy from '@/pages/PrivacyPolicy';
import PodcastDetail from '@/pages/PodcastDetail';
import AuthCallback from '@/pages/AuthCallback';
import { base44ConfigError, isBase44Configured } from '@/lib/app-params';

const AppErrorScreen = ({ title, message }) => (
  <div className="fixed inset-0 flex items-center justify-center bg-[#0f0d0b] px-6 text-white">
    <div className="w-full max-w-sm rounded-2xl border border-orange-500/30 bg-[#191411] p-6 text-center shadow-2xl">
      <h1 className="text-xl font-semibold text-orange-500">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-white/70">{message}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-5 rounded-full bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white"
      >
        Tentar novamente
      </button>
    </div>
  </div>
);

class AppErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Voxyl startup error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <AppErrorScreen
          title="Nao foi possivel iniciar o Voxyl"
          message="O aplicativo recebeu uma resposta inesperada. Verifique sua conexao e tente novamente."
        />
      );
    }
    return this.props.children;
  }
}

const BackButtonHandler = () => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handlePopState = () => {
      if (location.pathname !== '/') {
        navigate(-1);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [location.pathname, navigate]);

  return null;
};

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();
  const location = useLocation();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-2xl overflow-hidden">
            <img src="https://media.base44.com/images/public/69e2ae13aa773b21002b1fe4/26d262763_voxyllogo.png" alt="Voxyl" className="w-full h-full object-contain" />
          </div>
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
        </div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    }
    // auth_required no longer forces redirect — app is accessible without login
  }

  return (
    <>
    <BackButtonHandler />
    <Routes location={location}>
      <Route element={<Layout />}>
        <Route path="/" element={<Feed />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/playlists" element={<Playlists />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="/playlist/:id" element={<PlaylistDetail />} />
      <Route path="/share/:id" element={<PlaylistPreview />} />
      <Route path="/user/:userId" element={<UserProfile />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/podcast/:feedUrl" element={<PodcastDetail />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </>
  );
};

function App() {
  if (!isBase44Configured) {
    return (
      <AppErrorScreen
        title="Configuração do aplicativo ausente"
        message={base44ConfigError}
      />
    );
  }

  return (
    <AppErrorBoundary>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <PlayerProvider>
            <Router>
              <AuthenticatedApp />
            </Router>
            <Toaster />
          </PlayerProvider>
        </QueryClientProvider>
      </AuthProvider>
    </AppErrorBoundary>
  );
}

export default App;