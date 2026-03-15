import { createContext, useContext, useState, useEffect } from 'react';
import { lightTheme, darkTheme, shared } from '../theme';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() => localStorage.getItem('theme') || 'light');
  const theme = { ...(mode === 'dark' ? darkTheme : lightTheme), ...shared };

  useEffect(() => { localStorage.setItem('theme', mode); }, [mode]);

  const toggle = () => setMode(m => m === 'dark' ? 'light' : 'dark');

  return (
    <ThemeContext.Provider value={{ theme, mode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() { return useContext(ThemeContext); }
