import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
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

const BackButtonHandler = () => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handlePopState = () => {
      // If we're not at the root, go back; otherwise let the browser handle it
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
      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </>
  );
};

function App() {
  return (
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
  );
}

export default App;