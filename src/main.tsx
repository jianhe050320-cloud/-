import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { probeServerKey } from './services/llmGateway';
import './index.css';

/*
 * 路径规范化：本应用用 HashRouter，合法地址只有 "/" 或 "/#/xxx"。
 * 如果用户拿到的是不带 # 的深链（例如分享出去的 ".../stories"），
 * 静态托管会回退到 index.html，但路由会落在首页 —— 与用户预期不符。
 * 这里把 "/stories" 这类路径改写成 "/#/stories"，让深链打开的就是对应页面。
 */
const { pathname, search, hash } = window.location;
if (!hash && pathname !== '/' && pathname !== '/index.html') {
  window.location.replace(`${window.location.origin}/#${pathname}${search}`);
}

/* 启动即探一次服务端是否自带模型密钥，避免第一轮误判成演示模式 */
void probeServerKey();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
