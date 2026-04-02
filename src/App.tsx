import { useApp } from './useApp';
import type { StemState } from './types';
import UploadZone from './components/UploadZone';
import StemPanel from './components/StemPanel';
import ResultPanel from './components/ResultPanel';
import './App.css';

export default function App() {
  const {
    step,
    fileName,
    stems,
    upload,
    separate,
    transcribeStem,
    transcribeAll,
    reset,
    getMidiDownloadUrl,
    getStemDownloadUrl,
  } = useApp();

  const handleDownloadMidi = async (stem: StemState) => {
    if (!stem.midiUrl) return;
    const url = await getMidiDownloadUrl(stem.midiUrl, stem.midiFilename ?? `${stem.key}.mid`);
    if (url) window.open(url, '_blank');
  };

  const handleDownloadAudio = async (stem: StemState) => {
    if (!stem.audioUrl) return;
    const url = await getStemDownloadUrl(stem.audioUrl, `${stem.key}_stem.mp3`);
    if (url) window.open(url, '_blank');
  };

  const showSeparate = step === 'ready' || step === 'separating';

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎵 Audio → MIDI</h1>
        <p className="app-subtitle">上传音频 → 分离音轨 → 逐轨转录 MIDI</p>
      </header>

      <main className="app-main">
        {/* Upload */}
        <UploadZone step={step} onUpload={upload} />

        {/* File info */}
        {fileName && (
          <div className="file-info">
            <span>📄 {fileName}</span>
            <button className="btn btn-sm btn-ghost" onClick={reset}>
              ✕ 重新选择
            </button>
          </div>
        )}

        {/* Separate button */}
        {showSeparate && (
          <div className="action-bar">
            <button
              className="btn btn-primary btn-lg"
              onClick={separate}
              disabled={step === 'separating'}
            >
              {step === 'separating' ? '⏳ 正在分离音轨...' : '🎛️ 开始分离音轨'}
            </button>
            {step === 'separating' && (
              <p className="action-hint">Demucs 正在分离 6 个音轨，通常需要 30-90 秒</p>
            )}
          </div>
        )}

        {/* Stem grid */}
        <StemPanel
          stems={stems}
          step={step}
          onTranscribe={transcribeStem}
          onTranscribeAll={transcribeAll}
          onDownloadMidi={handleDownloadMidi}
          onDownloadAudio={handleDownloadAudio}
        />

        {/* Results */}
        <ResultPanel
          stems={stems}
          onDownloadMidi={handleDownloadMidi}
          onDownloadAudio={handleDownloadAudio}
        />

        {/* Transcribing progress */}
        {step === 'transcribing' && (
          <div className="progress-bar-wrapper">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${(stems.filter((s) => s.status === 'done').length / stems.length) * 100}%`,
                }}
              />
            </div>
            <p className="progress-text">
              {stems.filter((s) => s.status === 'done').length}/{stems.length} 音轨已完成转录
            </p>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>
          Powered by{' '}
          <a href="https://replicate.com/cjwbw/demucs" target="_blank" rel="noreferrer">
            Demucs
          </a>{' '}
          +{' '}
          <a href="https://replicate.com/rhelsing/basic-pitch" target="_blank" rel="noreferrer">
            Basic Pitch
          </a>{' '}
          · MIDI velocity 为近似值 · 分离音频 1h 后自动删除
        </p>
      </footer>
    </div>
  );
}
