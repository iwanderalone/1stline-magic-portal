import { createContext, useContext, useState, useEffect } from 'react';
import { lightTheme, darkTheme, shared } from '../theme';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() => localStorage.getItem('theme') || 'light');
  const [isLite, setIsLite] = useState(() => localStorage.getItem('theme-lite') === 'true');
  const theme = { ...(mode === 'dark' ? darkTheme : lightTheme), ...shared };

  useEffect(() => { localStorage.setItem('theme', mode); }, [mode]);
  useEffect(() => { localStorage.setItem('theme-lite', isLite); }, [isLite]);

  const toggle = () => setMode(m => m === 'dark' ? 'light' : 'dark');
  const toggleLite = () => setIsLite(v => !v);

  return (
    <ThemeContext.Provider value={{ theme, mode, toggle, isLite, toggleLite }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() { return useContext(ThemeContext); }
