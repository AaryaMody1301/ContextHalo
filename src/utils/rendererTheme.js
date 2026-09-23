(function initializeRendererTheme(global) {
    function createThemeController(storage, document) {
        const theme = {
            themes: {
                dark: {
                    background: '#101010',
                    text: '#e0e0e0',
                    textSecondary: '#a0a0a0',
                    textMuted: '#949494',
                    border: '#2a2a2a',
                    accent: '#ffffff',
                    btnPrimaryBg: '#ffffff',
                    btnPrimaryHover: '#e0e0e0',
                },
                light: {
                    background: '#ffffff',
                    text: '#1a1a1a',
                    textSecondary: '#555555',
                    textMuted: '#636363',
                    border: '#e0e0e0',
                    accent: '#000000',
                    btnPrimaryBg: '#1a1a1a',
                    btnPrimaryHover: '#333333',
                },
                midnight: {
                    background: '#0d1117',
                    text: '#c9d1d9',
                    textSecondary: '#8d96a0',
                    textMuted: '#8f969e',
                    border: '#30363d',
                    accent: '#58a6ff',
                    btnPrimaryBg: '#58a6ff',
                    btnPrimaryHover: '#79b8ff',
                },
                sepia: {
                    background: '#f4ecd8',
                    text: '#5c4b37',
                    textSecondary: '#635646',
                    textMuted: '#60564a',
                    border: '#d4c8b0',
                    accent: '#8b4513',
                    btnPrimaryBg: '#5c4b37',
                    btnPrimaryHover: '#7a6a56',
                },
                catppuccin: {
                    background: '#1e1e2e',
                    text: '#cdd6f4',
                    textSecondary: '#a6adc8',
                    textMuted: '#a5a6b2',
                    border: '#313244',
                    accent: '#cba6f7',
                    btnPrimaryBg: '#cba6f7',
                    btnPrimaryHover: '#b4befe',
                },
                gruvbox: {
                    background: '#1d2021',
                    text: '#ebdbb2',
                    textSecondary: '#b2a593',
                    textMuted: '#aca7a3',
                    border: '#3c3836',
                    accent: '#fe8019',
                    btnPrimaryBg: '#fe8019',
                    btnPrimaryHover: '#fabd2f',
                },
                rosepine: {
                    background: '#191724',
                    text: '#e0def4',
                    textSecondary: '#a09cb6',
                    textMuted: '#9f9daf',
                    border: '#26233a',
                    accent: '#ebbcba',
                    btnPrimaryBg: '#ebbcba',
                    btnPrimaryHover: '#f6c177',
                },
                solarized: {
                    background: '#002b36',
                    text: '#a6b2b2',
                    textSecondary: '#a6b2b3',
                    textMuted: '#a5b1b4',
                    border: '#073642',
                    accent: '#2aa198',
                    btnPrimaryBg: '#2aa198',
                    btnPrimaryHover: '#268bd2',
                },
                tokyonight: {
                    background: '#1a1b26',
                    text: '#c0caf5',
                    textSecondary: '#9aa5ce',
                    textMuted: '#9da2bb',
                    border: '#292e42',
                    accent: '#7aa2f7',
                    btnPrimaryBg: '#7aa2f7',
                    btnPrimaryHover: '#bb9af7',
                },
            },
        
            current: 'dark',
        
            get(name) {
                return this.themes[name] || this.themes.dark;
            },
        
            getAll() {
                const names = {
                    dark: 'Dark',
                    light: 'Light',
                    midnight: 'Midnight Blue',
                    sepia: 'Sepia',
                    catppuccin: 'Catppuccin Mocha',
                    gruvbox: 'Gruvbox Dark',
                    rosepine: 'Ros\u00e9 Pine',
                    solarized: 'Solarized Dark',
                    tokyonight: 'Tokyo Night',
                };
                return Object.keys(this.themes).map(key => ({
                    value: key,
                    name: names[key] || key,
                }));
            },
        
            hexToRgb(hex) {
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                return result
                    ? {
                          r: parseInt(result[1], 16),
                          g: parseInt(result[2], 16),
                          b: parseInt(result[3], 16),
                      }
                    : { r: 30, g: 30, b: 30 };
            },
        
            lightenColor(rgb, amount) {
                return {
                    r: Math.min(255, rgb.r + amount),
                    g: Math.min(255, rgb.g + amount),
                    b: Math.min(255, rgb.b + amount),
                };
            },
        
            darkenColor(rgb, amount) {
                return {
                    r: Math.max(0, rgb.r - amount),
                    g: Math.max(0, rgb.g - amount),
                    b: Math.max(0, rgb.b - amount),
                };
            },
        
            applyBackgrounds(backgroundColor, alpha = 0.8) {
                const root = document.documentElement;
                alpha = Number.isFinite(Number(alpha)) ? Math.min(1, Math.max(0, Number(alpha))) : 0.8;
                this.currentAlpha = alpha;
                const baseRgb = this.hexToRgb(backgroundColor);
                const windowBackground = `rgba(${baseRgb.r}, ${baseRgb.g}, ${baseRgb.b}, ${alpha})`;
                root.style.setProperty('--window-background', windowBackground);
                // The native BrowserWindow is transparent. Apply alpha only to the root
                // window surface; text and cards keep opaque theme colors for readability.
                root.style.setProperty('--control-color-scheme', (baseRgb.r + baseRgb.g + baseRgb.b) / 3 > 128 ? 'light' : 'dark');
                root.style.colorScheme = (baseRgb.r + baseRgb.g + baseRgb.b) / 3 > 128 ? 'light' : 'dark';
                this._appearanceRevision = (this._appearanceRevision || 0) + 1;
                root.style.setProperty('--hud-text-shadow', (baseRgb.r + baseRgb.g + baseRgb.b) / 3 > 128
                    ? '0 1px 2px rgba(255,255,255,0.85)' : '0 1px 2px rgba(0,0,0,0.9)');
        
                // For light themes, darken; for dark themes, lighten
                const isLight = (baseRgb.r + baseRgb.g + baseRgb.b) / 3 > 128;
                const adjust = isLight ? this.darkenColor.bind(this) : this.lightenColor.bind(this);
        
                const secondary = adjust(baseRgb, 10);
                const tertiary = adjust(baseRgb, 22);
                const hover = adjust(baseRgb, 28);
        
                const bgBase = `rgb(${baseRgb.r}, ${baseRgb.g}, ${baseRgb.b})`;
                const bgSurface = `rgb(${secondary.r}, ${secondary.g}, ${secondary.b})`;
                const bgElevated = `rgb(${tertiary.r}, ${tertiary.g}, ${tertiary.b})`;
                const bgHover = `rgb(${hover.r}, ${hover.g}, ${hover.b})`;
        
                // New design tokens (used by components)
                root.style.setProperty('--bg-app', bgBase);
                root.style.setProperty('--bg-surface', bgSurface);
                root.style.setProperty('--bg-elevated', bgElevated);
                root.style.setProperty('--bg-hover', bgHover);
        
            },
        
            apply(themeName, alpha = 0.8) {
                const colors = this.get(themeName);
                this.current = themeName;
                const root = document.documentElement;
        
                // New design tokens (used by components)
                root.style.setProperty('--text-primary', colors.text);
                root.style.setProperty('--text-secondary', colors.textSecondary);
                root.style.setProperty('--text-muted', colors.textMuted);
                root.style.setProperty('--border', colors.border);
                root.style.setProperty('--border-strong', colors.accent);
                root.style.setProperty('--accent', colors.btnPrimaryBg);
                root.style.setProperty('--accent-hover', colors.btnPrimaryHover);
        
        
                // Also apply background colors from theme
                this.applyBackgrounds(colors.background, alpha);
            },
        
            async load() {
                try {
                    const prefs = await storage.getPreferences();
                    const themeName = prefs.theme || 'dark';
                    const alpha = prefs.backgroundTransparency ?? 0.8;
                    this.apply(themeName, alpha);
                    return themeName;
                } catch (err) {
                    this.apply('dark');
                    return 'dark';
                }
            },
        
            async save(themeName) {
                const revision = this._appearanceRevision;
                const result = await storage.updatePreference('theme', themeName);
                const prefs = await storage.getPreferences();
                // A slow save must not repaint over a newer theme/opacity preview.
                if (revision === this._appearanceRevision) this.apply(themeName, prefs.backgroundTransparency ?? this.currentAlpha ?? 0.8);
                return result;
            },
        };
        return theme;
    }

    global.ContextHaloRendererTheme = { createThemeController };
})(window);
