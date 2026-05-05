import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'

import './index.css'

const licensesUrl = `${window.location.origin}/third-party-licenses.html`;
console.info(
  '%cCheckin App%c · MIT licensed\n%c本应用使用了多个开源依赖。完整许可证清单：%c%s',
  'font-weight:bold;color:#0f766e;font-size:13px',
  'color:#64748b;font-size:13px',
  'color:#475569',
  'color:#0f766e;text-decoration:underline',
  licensesUrl
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
