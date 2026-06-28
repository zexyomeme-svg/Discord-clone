import { useEffect } from 'react';
import useStore from './store/useStore';
import LoginScreen from './components/LoginScreen';
import LoadingScreen from './components/LoadingScreen';
import ServerList from './components/ServerList';
import ChannelList from './components/ChannelList';
import DMList from './components/DMList';
import MessageArea from './components/MessageArea';
import DMMessageArea from './components/DMMessageArea';
import MemberList from './components/MemberList';
import UserPanel from './components/UserPanel';
import SettingsModal from './components/SettingsModal';
import ErrorNotification from './components/ErrorNotification';

function MainLayout() {
  const { viewMode } = useStore();

  return (
    <div className="h-full w-full flex overflow-hidden">
      {/* Server sidebar — fixed width */}
      <ServerList />

      {/* Channel / DM sidebar + user panel */}
      <div className="flex flex-col h-full flex-shrink-0 min-h-0">
        <div className="flex-1 min-h-0 flex flex-col">
          {viewMode === 'servers' ? <ChannelList /> : <DMList />}
        </div>
        <UserPanel />
      </div>

      {/* Main content area — fills remaining space */}
      <div className="flex flex-1 min-w-0 min-h-0 h-full">
        {viewMode === 'servers' ? <MessageArea /> : <DMMessageArea />}
        {viewMode === 'servers' && <MemberList />}
      </div>

      {/* Overlays */}
      <SettingsModal />
      <ErrorNotification />
    </div>
  );
}

export default function App() {
  const { token, user, isLoading, login } = useStore();

  useEffect(() => {
    if (token && !user && !isLoading) {
      login(token).catch(() => {
        localStorage.removeItem('discord_token');
        useStore.setState({ token: null });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!token || (!user && !isLoading)) {
    return (
      <div className="h-full w-full">
        <LoginScreen />
        <ErrorNotification />
      </div>
    );
  }

  if (isLoading || !user) {
    return <div className="h-full w-full"><LoadingScreen /></div>;
  }

  return <MainLayout />;
}
