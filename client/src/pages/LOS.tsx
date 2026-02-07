import React, { Suspense } from 'react';
import { LOSProvider } from '../contexts/LOSContext';
import '../components/LOS/globals.css';

const UnifiedMap = React.lazy(() => import('../components/LOS/UnifiedMap'));
const ToolSidebar = React.lazy(() => import('../components/LOS/panels/ToolSidebar'));

function LoadingFallback() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      background: '#0a0a0c',
      color: '#a1a1aa',
      fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 40,
          height: 40,
          border: '3px solid rgba(255,255,255,0.1)',
          borderTopColor: '#22d3ee',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          margin: '0 auto 12px',
        }} />
        <div>Loading map...</div>
      </div>
    </div>
  );
}

export default function LOS() {
  return (
    <LOSProvider>
      <div className="los-container" style={{ width: '100%', height: 'calc(100vh - 64px)' }}>
        <Suspense fallback={<LoadingFallback />}>
          <UnifiedMap />
          <ToolSidebar />
        </Suspense>
      </div>
    </LOSProvider>
  );
}
