import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { InterviewPage } from './pages/InterviewPage';
import { StoryConfirmPage } from './pages/StoryConfirmPage';
import { StoryDetailPage } from './pages/StoryDetailPage';
import { MyStoriesPage } from './pages/MyStoriesPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  return (
    <div className="phone-env">
      <div className="phone-shell">
        <HashRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/interview" element={<InterviewPage />} />
            {/* 故事详情：阅读 + 回忆（从「我的故事」卡片进入） */}
            <Route path="/story/:id" element={<StoryDetailPage />} />
            {/* 保存确认：采访结束 / 继续讲之后整理出来的那一版 */}
            <Route path="/story/:id/confirm" element={<StoryConfirmPage />} />
            <Route path="/stories" element={<MyStoriesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </div>
    </div>
  );
}
