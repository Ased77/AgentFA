import React from 'react'
import ReactDOM from 'react-dom/client'

// Vazirmatn is bundled rather than fetched from a font CDN: the Persian UI is
// unreadable without it, and the network the product targets cannot always reach
// Google Fonts — which used to leave the whole app rendering in a fallback face.
// These are plain CSS imports (not `@import` in index.css) so Vite owns the
// asset pipeline: the woff2 files are fingerprinted, cached forever, and only the
// script subsets a page actually needs are downloaded, via unicode-range.
import '@fontsource/vazirmatn/arabic-400.css'
import '@fontsource/vazirmatn/arabic-500.css'
import '@fontsource/vazirmatn/arabic-600.css'
import '@fontsource/vazirmatn/arabic-700.css'
import '@fontsource/vazirmatn/arabic-800.css'
import '@fontsource/vazirmatn/arabic-900.css'
import '@fontsource/vazirmatn/latin-400.css'
import '@fontsource/vazirmatn/latin-500.css'
import '@fontsource/vazirmatn/latin-600.css'
import '@fontsource/vazirmatn/latin-700.css'
import '@fontsource/vazirmatn/latin-800.css'
import '@fontsource/vazirmatn/latin-900.css'

import App from './App'
import { I18nProvider } from './lib/i18n'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
)
