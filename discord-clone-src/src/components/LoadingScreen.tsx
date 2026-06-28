export default function LoadingScreen() {
  return (
    <div className="h-full w-full bg-discord-dark flex flex-col items-center justify-center gap-8">
      <div className="relative animate-scale-in">
        <svg width="60" height="60" viewBox="0 0 48 48" fill="none" className="animate-pulse">
          <path d="M40.634 8.636a39.37 39.37 0 00-9.718-3.015.148.148 0 00-.157.074c-.42.747-.886 1.722-1.213 2.489a36.347 36.347 0 00-10.9 0 25.04 25.04 0 00-1.232-2.489.154.154 0 00-.157-.074 39.28 39.28 0 00-9.718 3.015.14.14 0 00-.064.055C2.216 16.36.803 23.837 1.501 31.215c.003.043.027.084.06.11a39.58 39.58 0 0011.913 6.023.155.155 0 00.168-.055 28.283 28.283 0 002.438-3.966.151.151 0 00-.083-.21 26.08 26.08 0 01-3.726-1.775.153.153 0 01-.015-.254c.25-.188.5-.383.74-.58a.148.148 0 01.155-.021c7.817 3.57 16.28 3.57 24.008 0a.147.147 0 01.157.019c.24.197.49.394.742.582a.153.153 0 01-.013.254 24.494 24.494 0 01-3.728 1.773.152.152 0 00-.081.212 31.746 31.746 0 002.436 3.964.153.153 0 00.168.057 39.484 39.484 0 0011.93-6.023.154.154 0 00.06-.108c.837-8.666-1.402-16.19-5.934-22.524a.12.12 0 00-.063-.057zM16.357 26.834c-1.951 0-3.558-1.791-3.558-3.993 0-2.2 1.575-3.993 3.558-3.993 1.998 0 3.59 1.808 3.558 3.993 0 2.202-1.575 3.993-3.558 3.993zm13.154 0c-1.95 0-3.558-1.791-3.558-3.993 0-2.2 1.576-3.993 3.558-3.993 1.999 0 3.59 1.808 3.558 3.993 0 2.202-1.56 3.993-3.558 3.993z" fill="#5865F2"/>
        </svg>
      </div>
      <div className="text-center animate-fade-in">
        <p className="text-discord-text-muted text-sm uppercase tracking-wide font-semibold">Loading</p>
      </div>
      <div className="w-[200px] h-[3px] bg-discord-darker rounded-full overflow-hidden">
        <div className="h-full bg-discord-blurple rounded-full animate-progress" />
      </div>
      <p className="text-discord-text-muted/50 text-xs max-w-xs text-center">
        Did you know — Wumpus is Discord's mascot? He was originally called "Wumpus" after the 1973 text adventure game.
      </p>
    </div>
  );
}
